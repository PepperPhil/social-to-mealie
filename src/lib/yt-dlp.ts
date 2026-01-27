import { env } from "@/lib/constants";
import type { socialMediaResult } from "@/lib/types";
import { YtDlp, type VideoInfo } from "ytdlp-nodejs";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

const ytdlp = new YtDlp({
  ffmpegPath: env.FFMPEG_PATH,
  binaryPath: env.YTDLP_PATH,
});

function q(s: string) {
  // very small shell-escape for paths (we only quote)
  return `"${s.replaceAll(`"`, `\\"`)}"`;
}

/**
 * Convert an input media buffer (audio or video) to 16kHz mono WAV.
 * Uses optional audio mapping so we can detect "no audio stream" reliably.
 */
async function convertBufferToWav(inputBuffer: Uint8Array, fileExt: string = ""): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const ext = fileExt ? (fileExt.startsWith(".") ? fileExt : `.${fileExt}`) : "";
  const stamp = Date.now();
  const inputPath = path.join(tempDir, `input-${stamp}${ext}`);
  const outputPath = path.join(tempDir, `output-${stamp}.wav`);

  await writeFileAsync(inputPath, inputBuffer);

  try {
    // -map 0:a:0?  => map first audio stream if present; if not present, ffmpeg will not fail at mapping stage
    // We still need to detect the result and fail if no wav was produced / invalid.
    const cmd =
      `${env.FFMPEG_PATH} -y -hide_banner -loglevel error ` +
      `-i ${q(inputPath)} ` +
      `-map 0:a:0? -vn ` +
      `-acodec pcm_s16le -ac 1 -ar 16000 -f wav ${q(outputPath)}`;

    await execAsync(cmd);

    const buffer = await readFileAsync(outputPath).catch(() => Buffer.from([]));

    // WAV header sanity check
    const looksLikeWav = buffer.length >= 44 && buffer.subarray(0, 4).toString() === "RIFF";

    if (!looksLikeWav) {
      throw new Error("No valid audio stream found (WAV not created)");
    }

    return buffer;
  } catch (error) {
    console.error("Error converting audio to WAV:", error);
    throw new Error("Failed to convert audio to WAV");
  } finally {
    try {
      await unlinkAsync(inputPath);
    } catch {}
    try {
      await unlinkAsync(outputPath);
    } catch {}
  }
}

async function getInfo(url: string): Promise<VideoInfo> {
  return (await ytdlp.getInfoAsync(url, {
    cookies: env.COOKIES,
  })) as VideoInfo;
}

/**
 * Try to download audio bytes using progressively more permissive strategies.
 *
 * Why:
 * - Some platforms deliver "video-only" or weird containers when you ask for audioonly.
 * - "bestaudio/best" style selection is more reliable.
 */
async function downloadAudioBytes(url: string): Promise<{ bytes: Uint8Array; ext: string }> {
  // Strategy 1: bestaudio (preferred)
  try {
    const f = await ytdlp.getFileAsync(url, {
      // most reliable: explicit format selector string
      format: "bestaudio/best",
      cookies: env.COOKIES,
    });

    const bytes = await f.bytes();
    // ytdlp-nodejs usually keeps extension; if not available, we fallback later
    const ext = (f as any)?.ext ?? "";
    if (bytes?.length) return { bytes, ext };
  } catch (e) {
    // fallthrough
  }

  // Strategy 2: best (video+audio) then we will extract audio with ffmpeg
  const f2 = await ytdlp.getFileAsync(url, {
    format: "best",
    cookies: env.COOKIES,
  });
  const bytes2 = await f2.bytes();
  const ext2 = (f2 as any)?.ext ?? "";
  return { bytes: bytes2, ext: ext2 };
}

export async function downloadMediaWithYtDlp(url: string): Promise<socialMediaResult> {
  try {
    const metadata = await getInfo(url);

    const { bytes, ext } = await downloadAudioBytes(url);

    // Prefer ext from downloader, else metadata.ext, else empty
    const fileExt = ext || metadata.ext || "";
    const wavBuffer = await convertBufferToWav(bytes, fileExt);

    return {
      blob: new Blob([new Uint8Array(wavBuffer)], { type: "audio/wav" }),
      thumbnail: metadata.thumbnail,
      description: metadata.description || "No description found",
      title: metadata.title,
    };
  } catch (error) {
    console.error("Error in downloadMediaWithYtDlp:", error);
    throw new Error("Failed to download media or metadata");
  }
}
