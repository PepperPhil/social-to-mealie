import {
  findRecipeBySourceUrl,
  findRecipeIdentifierBySourceUrl,
  getRecipe,
  postRecipe,
  postRecipeImage,
} from '@/lib/mealie';
import type { progressType, socialMediaResult } from '@/lib/types';
import { generateRecipeFromAI, getTranscription } from '@/lib/ai';
import { env } from '@/lib/constants';
import { downloadMediaWithYtDlp } from '@/lib/yt-dlp';

interface RequestBody {
  url: string;
  tags: string[];
  force?: boolean;
}

type StepKey = 'video' | 'audio' | 'recipe';

type StepLog = {
  step: StepKey;
  ok: boolean | null;
  message: string;
  ts: number;
};

function now() {
  return Date.now();
}

function getSourceTag(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const normalizedHost = hostname.replace(/^m\./, '');
    const hostAliases: Record<string, string> = {
      'youtu.be': 'youtube',
    };
    const alias = hostAliases[normalizedHost];
    const hostParts = (alias ?? normalizedHost).split('.').filter(Boolean);
    const base = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];

    if (!base) return null;

    const formatted = base.charAt(0).toUpperCase() + base.slice(1);
    return `#${formatted}`;
  } catch {
    return null;
  }
}

function addSourceTag(url: string, tags: string[]) {
  const sourceTag = getSourceTag(url);
  if (!sourceTag) return tags;

  const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()));
  if (normalized.has(sourceTag.toLowerCase())) return tags;

  return [...tags, sourceTag];
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split('/').pop();
    return name && name.trim().length > 0 ? name : 'upload.jpg';
  } catch {
    return 'upload.jpg';
  }
}

async function handleRequest(
  url: string,
  tags: string[],
  force: boolean,
  isSse: boolean,
  controller?: ReadableStreamDefaultController
) {
  const encoder = new TextEncoder();
  let socialMedia: socialMediaResult;

  const progress: progressType = {
    videoDownloaded: null,
    audioTranscribed: null,
    recipeCreated: null,
  };

  const logs: StepLog[] = [];

  const send = (payload: any) => {
    if (!isSse || !controller) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
  };

  const log = (step: StepKey, ok: boolean | null, message: string) => {
    logs.push({ step, ok, message, ts: now() });
    send({ logs });
  };

  try {
    send({ progress, logs });

    const existingRecipeId = await findRecipeIdentifierBySourceUrl(url);
    if (existingRecipeId && !force) {
      const existingRecipe = await findRecipeBySourceUrl(url);
      send({ duplicate: true, recipe: existingRecipe });

      if (isSse && controller) {
        controller.close();
        return;
      }

      return new Response(JSON.stringify({ duplicate: true, recipe: existingRecipe }), { status: 409 });
    }

    // Step 1: Download / Extract
    log('video', null, 'Download/Extract gestartet …');
    socialMedia = await downloadMediaWithYtDlp(url);

    if (socialMedia.mediaType === 'image' && socialMedia.imageUrl) {
      const imageResponse = await fetch(socialMedia.imageUrl);
      if (!imageResponse.ok) {
        throw new Error('Bild konnte nicht geladen werden.');
      }

      const image = await imageResponse.blob();
      const filename = filenameFromUrl(socialMedia.imageUrl);

      progress.videoDownloaded = true;
      log('video', true, 'Bild erfolgreich geladen.');
      send({ progress, logs });

      log('audio', null, 'Text wird aus dem Bild extrahiert …');
      log('recipe', null, 'Rezept wird aus dem Bild extrahiert & nach Mealie gepostet …');

      const mealieResponse = await postRecipeImage(image, filename, tags);
      const createdRecipe = await getRecipe(mealieResponse);

      progress.audioTranscribed = true;
      log('audio', true, 'Text aus dem Bild extrahiert.');
      send({ progress, logs });

      progress.recipeCreated = true;
      log('recipe', true, 'Rezept wurde in Mealie angelegt.');
      send({ progress, logs });
      send(createdRecipe);

      if (isSse && controller) {
        controller.close();
        return;
      }

      return new Response(JSON.stringify({ createdRecipe, progress, logs }), { status: 200 });
    }

    progress.videoDownloaded = true;
    log('video', true, 'Media/Metadaten erfolgreich geladen.');
    send({ progress, logs });

    // Step 2: Transcribe (optional)
    let transcription = '';

    log('audio', null, 'Audio/Transkription wird geprüft …');

    const { blob: audioBlob } = socialMedia;

    if (!audioBlob || audioBlob.size === 0) {
      // Kein Audio -> wir überspringen Transkription, aber lassen Prozess weiterlaufen
      progress.audioTranscribed = true;
      log('audio', true, 'Kein Audiostream gefunden. Transkription übersprungen (Description-only).');
      send({ progress, logs });
    } else {
      log('audio', null, 'Transkription gestartet …');
      transcription = await getTranscription(audioBlob);
      progress.audioTranscribed = true;
      log('audio', true, 'Transkription erfolgreich.');
      send({ progress, logs });
    }

    // Step 3: Generate + Post to Mealie
    const normalizedDescription = socialMedia.description?.trim() ?? '';
    const hasDescription =
      normalizedDescription.length > 0 && normalizedDescription.toLowerCase() !== 'no description found';
    const hasTranscription = transcription.trim().length > 0;

    if (!hasDescription && !hasTranscription) {
      throw new Error('Kein Rezepttext gefunden (weder Transkription noch Beschreibung).');
    }

    log('recipe', null, 'Rezept wird via KI erstellt & nach Mealie gepostet …');

    const recipe = await generateRecipeFromAI(
      transcription,
      socialMedia.description,
      url,
      socialMedia.thumbnail,
      env.EXTRA_PROMPT || '',
      tags
    );

    const mealieResponse = await postRecipe(recipe);
    const createdRecipe = await getRecipe(await mealieResponse);

    progress.recipeCreated = true;
    log('recipe', true, 'Rezept wurde in Mealie angelegt.');
    send({ progress, logs });
    send(createdRecipe);

    if (isSse && controller) {
      controller.close();
      return;
    }

    return new Response(JSON.stringify({ createdRecipe, progress, logs }), { status: 200 });
  } catch (error: any) {
    const msg = String(error?.message ?? error ?? 'Unbekannter Fehler');

    let failedStep: StepKey = 'recipe';
    if (progress.videoDownloaded !== true) failedStep = 'video';
    else if (progress.audioTranscribed !== true) failedStep = 'audio';
    else failedStep = 'recipe';

    if (failedStep === 'video') progress.videoDownloaded = false;
    if (failedStep === 'audio') progress.audioTranscribed = false;
    if (failedStep === 'recipe') progress.recipeCreated = false;

    log(failedStep, false, msg);
    send({ progress, logs, error: msg });

    if (isSse && controller) {
      controller.close();
      return;
    }

    return new Response(JSON.stringify({ error: msg, progress, logs }), { status: 500 });
  }
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json();
  const url = body.url;
  const tags = addSourceTag(url, body.tags ?? []);
  const force = body.force ?? false;

  const contentType = req.headers.get('Content-Type');

  if (contentType === 'text/event-stream') {
    const stream = new ReadableStream({
      async start(controller) {
        await handleRequest(url, tags, force, true, controller);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  return handleRequest(url, tags, force, false);
}
