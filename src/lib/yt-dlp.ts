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

let ytdlpInstance: YtDlp | null = null;

// Erstellt (lazy) eine einzige yt-dlp Instanz mit den konfigurierten Binärpfaden.
function getYtDlp(): YtDlp {
  if (!ytdlpInstance) {
    ytdlpInstance = new YtDlp({
      ffmpegPath: env.FFMPEG_PATH,
      binaryPath: env.YTDLP_PATH,
    });
  }
  return ytdlpInstance;
}

// Prüft, ob in den Metadaten ein Audio-Stream vorhanden ist.
function hasAudioStream(metadata: VideoInfo): boolean {
  const directCodec = (metadata as any)?.acodec;
  if (directCodec && directCodec !== 'none') return true;

  const formats = (metadata as any)?.formats;
  if (!Array.isArray(formats)) return false;

  return formats.some((format: any) => format?.acodec && format.acodec !== 'none');
}

// Konvertiert beliebiges Audio/Video (Buffer) in eine Mono-WAV-Datei (16kHz).
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
    const stderrOutput: string = [error?.stderr, error?.message].filter(Boolean).join('\n');
    if (
      stderrOutput.includes('Output file #0 does not contain any stream') ||
      stderrOutput.includes('Stream map') ||
      stderrOutput.includes('does not contain any stream')
    ) {
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

// Lädt die besten verfügbaren Audio-Bytes von einer URL via yt-dlp.
async function getAudioFileBytes(url: string): Promise<Uint8Array> {
  // 1) Versuch: nur Audio-Formate (m4a bevorzugt), keine stummen Streams
  try {
    const audioFile = await getYtDlp().getFileAsync(url, {
      // je nach lib: format kann als string gut funktionieren
      format: 'bestaudio[acodec!=none][ext=m4a]/bestaudio[acodec!=none]/best[acodec!=none]',
      cookies: env.COOKIES,
    } as any);

    return await audioFile.bytes();
  } catch {
    // ignore -> fallback
  }

  // 2) Fallback: best mit Audio (kann Video sein), dann extrahiert ffmpeg Audio falls vorhanden
  const file = await getYtDlp().getFileAsync(url, {
    format: 'best[acodec!=none]/best',
    cookies: env.COOKIES,
  } as any);

  return await file.bytes();
}

// Dateiendungen, die wir als Bild-Download erkennen.
const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

// Prüft anhand von Extension + vcodec, ob es sich um ein Bild handelt.
function isImageMetadata(metadata: VideoInfo): boolean {
  const ext = metadata.ext?.toLowerCase();
  if (!ext || !imageExtensions.has(ext)) return false;

  const vcodec = (metadata as any)?.vcodec;
  return !vcodec || vcodec === 'none';
}

// Hauptfunktion: lädt Metadaten, erkennt Bild/Video und liefert Audio/Thumbnail zurück.
export async function downloadMediaWithYtDlp(url: string): Promise<socialMediaResult> {
  try {
    // Wir holen zuerst Metadaten, um Bild-Posts früh zu erkennen und unnötige Downloads zu vermeiden.
    const metadata = (await getYtDlp().getInfoAsync(
      url,
      {
        cookies: env.COOKIES,
        // ignoreNoFormatsError ist runtime-valid, aber im Typing fehlt es, daher any.
        ignoreNoFormatsError: true,
      } as any
    )) as VideoInfo;

    if (isImageMetadata(metadata)) {
      return {
        blob: new Blob([], { type: 'audio/wav' }),
        thumbnail: metadata.thumbnail,
        description: metadata.description || 'No description found',
        title: metadata.title,
        mediaType: 'image',
        imageUrl: (metadata as any)?.url ?? metadata.thumbnail,
      };
    }

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
      mediaType: 'video',
    };
  } catch (error: any) {
    const rawMessage = String(error?.message ?? error ?? 'unknown error');
    if (rawMessage.includes('There is no video in this post')) {
      console.warn('Instagram post without video detected.');
      throw new Error(
        'Instagram-Beitrag enthält kein Video. Bitte verwende einen Video-Post oder lade das Bild manuell hoch.'
      );
    }

    console.error('Error in downloadMediaWithYtDlp:', error);
    // Wichtig: text so, dass du ihn im UI sauber siehst
    throw new Error(rawMessage ?? 'Failed to download media or metadata');
  }
}
