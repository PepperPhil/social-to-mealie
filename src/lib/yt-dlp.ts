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

function hasAudioStream(metadata: VideoInfo): boolean {
  const directCodec = (metadata as any)?.acodec;
  if (directCodec && directCodec !== 'none') return true;

  const formats = (metadata as any)?.formats;
  if (!Array.isArray(formats)) return false;

  return formats.some((format: any) => format?.acodec && format.acodec !== 'none');
}

async function convertBufferToWav(inputBuffer: Uint8Array, fileExt = ''): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const ext = fileExt ? (fileExt.startsWith('.') ? fileExt : `.${fileExt}`) : '';
  const ts = Date.now();
  const inputPath = path.join(tempDir, `input-${ts}${ext}`);
  const outputPath = path.join(tempDir, `output-${ts}.wav`);

  await writeFileAsync(inputPath, inputBuffer);

  // Wichtig:
  // -map 0:a:0? => "nimm erste Audio-Stream wenn vorhanden, sonst nichts"
  // Wenn dann nichts gemappt wurde, meckert ffmpeg – das fangen wir ab und geben besseren Text.
  const cmd = `${env.FFMPEG_PATH} -y -i "${inputPath}" -vn -sn -dn -map 0:a:0? -acodec pcm_s16le -ac 1 -ar 16000 -f wav "${outputPath}"`;

  try {
    const { stderr } = await execAsync(cmd);

    // Validierung (minimal)
    const buffer = await readFileAsync(outputPath).catch(async () => {
      throw new Error(
        'ffmpeg hat keine WAV-Datei erzeugt. Vermutlich enthält das Medium keine Audiospur.'
      );
    });

    if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') {
      throw new Error('Erzeugte WAV-Datei ist ungültig oder zu klein.');
    }

    return buffer;
  } catch (error: any) {
    const stderr: string = error?.stderr ?? '';
    if (stderr.includes('Output file #0 does not contain any stream') || stderr.includes('Stream map')) {
      throw new Error(
        'Dieses Video enthält keine Audiospur (oder yt-dlp hat ein Video ohne Audio geliefert).'
      );
    }
    throw new Error(`Failed to convert audio to WAV: ${error?.message ?? 'unknown error'}`);
  } finally {
    try {
      await unlinkAsync(inputPath);
    } catch {}
    try {
      await unlinkAsync(outputPath);
    } catch {}
  }
}

async function getAudioFileBytes(url: string): Promise<Uint8Array> {
  // 1) Versuch: bestaudio bevorzugt (m4a), sonst bestaudio
  try {
    const audioFile = await ytdlp.getFileAsync(url, {
      // je nach lib: format kann als string gut funktionieren
      format: 'bestaudio[ext=m4a]/bestaudio/best',
      cookies: env.COOKIES,
    } as any);

    return await audioFile.bytes();
  } catch {
    // ignore -> fallback
  }

  // 2) Fallback: best (kann Video sein), dann extrahiert ffmpeg Audio falls vorhanden
  const file = await ytdlp.getFileAsync(url, {
    format: 'best',
    cookies: env.COOKIES,
  } as any);

  return await file.bytes();
}

export async function downloadMediaWithYtDlp(url: string): Promise<socialMediaResult> {
  try {
    const metadata = (await ytdlp.getInfoAsync(url, {
      cookies: env.COOKIES,
    })) as VideoInfo;

    const audioAvailable = hasAudioStream(metadata);
    let audioBlob = new Blob([], { type: 'audio/wav' });

    if (audioAvailable) {
      const bytes = await getAudioFileBytes(url);
      // ext aus metadata ist oft "mp4" – wir hängen sie dran, damit ffmpeg den Container leichter erkennt
      const wavBuffer = await convertBufferToWav(bytes, metadata.ext || '');
      audioBlob = new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' });
    }

    return {
      blob: audioBlob,
      thumbnail: metadata.thumbnail,
      description: metadata.description || 'No description found',
      title: metadata.title,
    };
  } catch (error: any) {
    console.error('Error in downloadMediaWithYtDlp:', error);
    // Wichtig: text so, dass du ihn im UI sauber siehst
    throw new Error(error?.message ?? 'Failed to download media or metadata');
  }
}
