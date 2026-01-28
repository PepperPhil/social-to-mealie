import { findRecipeBySourceUrl, getRecipe, postRecipeImage } from '@/lib/mealie';
import type { progressType } from '@/lib/types';

interface RequestBody {
  imageUrl?: string;
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

async function handleImageRequest(
  image: Blob,
  filename: string,
  tags: string[],
  isSse: boolean,
  controller?: ReadableStreamDefaultController
) {
  const encoder = new TextEncoder();
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

    log('video', null, 'Bild wird hochgeladen …');
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
  const contentType = req.headers.get('Content-Type') ?? '';
  let tags: string[] = [];
  let image: Blob | null = null;
  let filename = 'upload.jpg';
  let imageUrl: string | undefined;
  let force = false;

  if (contentType.includes('multipart/form-data')) {
    const data = await req.formData();
    const file = data.get('image');
    const tagsRaw = data.get('tags');
    const forceRaw = data.get('force');
    if (typeof tagsRaw === 'string') {
      try {
        tags = JSON.parse(tagsRaw);
      } catch {
        tags = [];
      }
    }
    if (typeof forceRaw === 'string') {
      force = forceRaw === 'true';
    }

    if (!file || !(file instanceof Blob)) {
      return new Response(JSON.stringify({ error: 'Kein Bild hochgeladen.' }), { status: 400 });
    }

    image = file;
    filename = typeof (file as File).name === 'string' ? (file as File).name : filename;
  } else {
    const body: RequestBody = await req.json();
    imageUrl = body.imageUrl;
    force = body.force ?? false;

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: 'Kein Bild-URL angegeben.' }), { status: 400 });
    }

    tags = addSourceTag(imageUrl, body.tags ?? []);
    filename = filenameFromUrl(imageUrl);

    if (!force) {
      const existingRecipe = await findRecipeBySourceUrl(imageUrl);
      if (existingRecipe) {
        return new Response(JSON.stringify({ duplicate: true, recipe: existingRecipe }), { status: 409 });
      }
    }

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return new Response(JSON.stringify({ error: 'Bild konnte nicht geladen werden.' }), { status: 400 });
    }

    image = await imageResponse.blob();
  }

  if (!image) {
    return new Response(JSON.stringify({ error: 'Bilddaten fehlen.' }), { status: 400 });
  }

  if (contentType === 'text/event-stream') {
    const stream = new ReadableStream({
      async start(controller) {
        await handleImageRequest(image as Blob, filename, tags, true, controller);
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

  return handleImageRequest(image as Blob, filename, tags, false);
}
