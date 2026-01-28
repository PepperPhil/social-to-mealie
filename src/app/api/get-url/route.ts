import { getRecipe, postRecipe } from '@//lib/mealie';
import type { progressType, socialMediaResult } from '@//lib/types';
import { generateRecipeFromAI, getTranscription } from '@/lib/ai';
import { env } from '@/lib/constants';
import { downloadMediaWithYtDlp } from '@/lib/yt-dlp';

interface RequestBody {
  url: string;
  tags: string[];
}

type StepKey = 'video' | 'audio' | 'recipe';

type StepLog = {
  step: StepKey;
  ok: boolean | null; // null = running/unknown
  message: string;
  ts: number;
};

function now() {
  return Date.now();
}

async function handleRequest(
  url: string,
  tags: string[],
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
    // initial state
    send({ progress, logs });

    // Step 1: Download / Extract
    log('video', null, 'Download/Extract gestartet …');
    socialMedia = await downloadMediaWithYtDlp(url);
    progress.videoDownloaded = true;
    log('video', true, 'Media/Metadaten erfolgreich geladen.');
    send({ progress, logs });

    // Step 2: Transcribe
    log('audio', null, 'Transkription gestartet …');
    const transcription = await getTranscription(socialMedia.blob);
    progress.audioTranscribed = true;
    log('audio', true, 'Transkription erfolgreich.');
    send({ progress, logs });

    // Step 3: Generate + Post to Mealie
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

    return new Response(JSON.stringify({ createdRecipe, progress, logs }), {
      status: 200,
    });
  } catch (error: any) {
    const msg = String(error?.message ?? error ?? 'Unbekannter Fehler');

    // Best-effort: Step ableiten (wenn noch null ist, ist es genau dieser Step)
    let failedStep: StepKey = 'recipe';
    if (progress.videoDownloaded !== true) failedStep = 'video';
    else if (progress.audioTranscribed !== true) failedStep = 'audio';
    else failedStep = 'recipe';

    // mark failed step
    if (failedStep === 'video') progress.videoDownloaded = false;
    if (failedStep === 'audio') progress.audioTranscribed = false;
    if (failedStep === 'recipe') progress.recipeCreated = false;

    log(failedStep, false, msg);
    send({ progress, logs, error: msg });

    if (isSse && controller) {
      controller.close();
      return;
    }

    return new Response(JSON.stringify({ error: msg, progress, logs }), {
      status: 500,
    });
  }
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json();
  const url = body.url;
  const tags = body.tags ?? [];

  // Der Client in RecipeFetcher sendet bewusst "text/event-stream" als Content-Type,
  // um SSE zu triggern (so war es im Original).
  const contentType = req.headers.get('Content-Type');

  if (contentType === 'text/event-stream') {
    const stream = new ReadableStream({
      async start(controller) {
        await handleRequest(url, tags, true, controller);
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

  return handleRequest(url, tags, false);
}
