import { env } from '@/lib/constants';
import type { socialMediaResult } from '@/lib/types';
import { YtDlp, type VideoInfo } from 'ytdlp-nodejs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

const ytdlp = new YtDlp({
  ffmpegPath: env.FFMPEG_PATH,
  binaryPath: env.YTDLP_PATH,
});

function extWithDot(fileExt: string | undefined | null) {
  if (!fileExt) return '';
  return fileExt.startsWith('.') ? fileExt : `.${fileExt}`;
}

/**
 * Best-effort: Prüft ob in der Datei ein Audio-Stream vorhanden ist.
 * Nutzt ffprobe, falls verfügbar. Fallback: false bei Fehler.
 */
async function hasAudioStream(inputPath: string): Promise<boolean> {
  // ffprobe ist in vielen Images nicht garantiert – wir versuchen es trotzdem.
  const ffprobe = env.FFPROBE_PATH || 'ffprobe';

  try {
    const cmd =
      `${ffprobe} -v error -select_streams a ` +
      `-show_entries stream=codec_type -of json "${inputPath}"`;

    const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout || '{}');
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    return streams.some((s: any) => s?.codec_type === 'audio');
  } catch {
    // Wenn ffprobe nicht da ist oder JSON parse failt: wir wissen es nicht sicher.
    // Dann lassen wir später ffmpeg entscheiden – aber mit sauberer Fehlermeldung.
    return false;
  }
}

async function convertFileToWav(inputPath: string, outputPath: string): Promise<void> {
  // -vn: Video ignorieren
  // -map a:0?: versuche ersten Audio Stream, aber "?" macht es optional (ffmpeg verhält sich je nach Version etwas unterschiedlich)
  // Wenn wirklich kein Audio existiert, prüfen wir vorher per ffprobe. Falls ffprobe nicht geht, fängt ffmpeg ab.
  const cmd =
    `${env.FFMPEG_PATH} -y -i "${inputPath}" ` +
    `-vn -acodec pcm_s16le -ac 1 -ar 16000 -f wav "${outputPath}"`;

  try {
    await execAsync(cmd, { maxBuffer: 50 * 1024 * 1024 });
  } catch (err: any) {
    const stderr = String(err?.stderr ?? err?.message ?? err ?? '');

    // typische ffmpeg-Meldungen, wenn kein Audio vorhanden ist:
    const noAudioHints = [
      'Output file #0 does not contain any stream',
      'Stream map',
      'matches no streams',
      'Could not find codec parameters',
    ];

    if (noAudioHints.some((h) => stderr.includes(h))) {
      throw new Error('Kein Audiostream im Medium gefunden (nur Video).');
    }

    throw new Error(`ffmpeg Konvertierung fehlgeschlagen: ${stderr.slice(0, 800)}`);
  }
}

async function convertBufferToWav(inputBuffer: Uint8Array, inputExt: string = ''): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const ext = extWithDot(inputExt);
  const inputPath = path.join(tempDir, `input-${Date.now()}${ext || '.bin'}`);
  const outputPath = path.join(tempDir, `output-${Date.now()}.wav`);

  await writeFileAsync(inputPath, inputBuffer);

  try {
    // Wenn ffprobe verfügbar ist, liefern wir eine saubere Fehlermeldung bevor ffmpeg startet.
    const audioPresent = await hasAudioStream(inputPath);
    if (audioPresent === false) {
      // Kann false sein weil: wirklich kein Audio ODER ffprobe fehlt.
      // Wir versuchen trotzdem ffmpeg – aber bei echter Audio-Leere gibt es klare Meldung.
    }

    await convertFileToWav(inputPath, outputPath);
    const buffer = await readFileAsync(outputPath);

    // Minimal check WAV header
    if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') {
      throw new Error('WAV-Datei ungültig/zu klein (Konvertierung fehlgeschlagen).');
    }

    return buffer;
  } finally {
    try {
      await unlinkAsync(inputPath);
    } catch {}
    try {
      await unlinkAsync(outputPath);
    } catch {}
  }
}

/**
 * Robust: Lädt bevorzugt Audio-only.
 * Falls nicht möglich (oder nur Video verfügbar), liefert es "no-audio" sauber zurück.
 */
export async function downloadMediaWithYtDlp(url: string): Promise<socialMediaResult> {
  try {
    const metadata = (await ytdlp.getInfoAsync(url, {
      cookies: env.COOKIES,
    })) as VideoInfo;

    // Manche Seiten liefern Formate ohne Audio. Versuche zuerst Audio-only.
    // ytdlp-nodejs API: "format" kann je nach Version etwas zickig sein,
    // daher benutzen wir strings, die yt-dlp sicher versteht.
    let audioBytes: Uint8Array | null = null;
    let audioExt: string | undefined;

    // 1) Try bestaudio
    try {
      const audioFile = await ytdlp.getFileAsync(url, {
        // robustes yt-dlp Format: best audio
        format: 'bestaudio/best',
        cookies: env.COOKIES,
      });

      audioBytes = await audioFile.bytes();
      audioExt = (metadata as any)?.ext; // best effort
    } catch {
      audioBytes = null;
    }

    // 2) Wenn bestaudio nicht ging, versuche "audioonly" filter (wie vorher)
    if (!audioBytes) {
      try {
        const audioFile = await ytdlp.getFileAsync(url, {
          format: { filter: 'audioonly' } as any,
          cookies: env.COOKIES,
        });

        audioBytes = await audioFile.bytes();
        audioExt = (metadata as any)?.ext;
      } catch {
        audioBytes = null;
      }
    }

    // 3) Falls wir Audio bytes haben: zu WAV konvertieren
    let audioBlob: Blob | null = null;

    if (audioBytes) {
      try {
        const wavBuffer = await convertBufferToWav(audioBytes, audioExt);
        audioBlob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
      } catch (e: any) {
        // Wenn Conversion sagt "Kein Audiostream", behandeln wir das wie "kein Audio"
        const msg = String(e?.message ?? e ?? '');
        if (msg.includes('Kein Audiostream')) {
          audioBlob = null;
        } else {
          throw e;
        }
      }
    }

    // Rückgabe: blob kann null sein -> wird im API-Route handled
    return {
      // @ts-expect-error - wir lassen blob absichtlich optional (Route prüft das)
      blob: audioBlob,
      thumbnail: (metadata as any)?.thumbnail,
      description: (metadata as any)?.description || 'No description found',
      title: (metadata as any)?.title,
    } as any;
  } catch (error: any) {
    const msg = String(error?.message ?? error ?? 'Unknown error');
    console.error('Error in downloadMediaWithYtDlp:', msg);
    throw new Error(`Failed to download media or metadata: ${msg}`);
  }
}
