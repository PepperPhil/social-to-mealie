import { getRecipe, postRecipe } from "@//lib/mealie";
import type { progressType, socialMediaResult } from "@//lib/types";
import { generateRecipeFromAI, getTranscription } from "@/lib/ai";
import { env } from "@/lib/constants";
import { downloadMediaWithYtDlp } from "@/lib/yt-dlp";

interface RequestBody {
  url: string;
  tags: string[];
}

async function handleRequest(
  url: string,
  tags: string[],
  isSse: boolean,
  controller?: ReadableStreamDefaultController,
) {
  const encoder = new TextEncoder();
  let socialMediaResult: socialMediaResult;

  const progress: progressType = {
    videoDownloaded: null,
    audioTranscribed: null,
    recipeCreated: null,
  };

  try {
    if (isSse && controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`));
    }

    // 1) Download media + metadata (may be audio-only or video+audio, depending on platform)
    socialMediaResult = await downloadMediaWithYtDlp(url);
    progress.videoDownloaded = true;

    if (isSse && controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`));
    }

    // 2) Transcription (robust: if audio is missing / conversion fails, continue with metadata-only)
    let transcription = "";
    try {
      transcription = await getTranscription(socialMediaResult.blob);
      progress.audioTranscribed = true;
    } catch (e: any) {
      progress.audioTranscribed = false;
      console.warn(
        "Transcription failed, falling back to metadata-only recipe generation:",
        e?.message ?? e,
      );
    }

    if (isSse && controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`));
    }

    // Optional: add a hint if we had to fall back
    const description =
      progress.audioTranscribed === false
        ? `${socialMediaResult.description}\n\n(Hinweis: Rezept aus Post-Beschreibung rekonstruiert, da keine Audio-Transkription möglich war.)`
        : socialMediaResult.description;

    // 3) Generate recipe JSON using AI (works even if transcription is empty)
    const recipe = await generateRecipeFromAI(
      transcription,
      description,
      url, // postURL
      socialMediaResult.thumbnail,
      env.EXTRA_PROMPT || "",
      tags,
    );

    console.log("Posting recipe to Mealie", recipe);
    const mealieResponse = await postRecipe(recipe);
    const createdRecipe = await getRecipe(await mealieResponse);

    console.log("Recipe created");
    progress.recipeCreated = true;

    if (isSse && controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ progress })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(createdRecipe)}\n\n`));
      controller.close();
      return;
    }

    return new Response(JSON.stringify({ createdRecipe, progress }), { status: 200 });
  } catch (error: any) {
    if (isSse && controller) {
      progress.recipeCreated = false;
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            error: error.message,
            progress,
          })}\n\n`,
        ),
      );
      controller.close();
      return;
    }

    return new Response(JSON.stringify({ error: error.message, progress }), { status: 500 });
  }
}

export async function POST(req: Request) {
  const body: RequestBody = await req.json();
  const url = body.url;
  const tags = body.tags;
  const contentType = req.headers.get("Content-Type");

  if (contentType === "text/event-stream") {
    const stream = new ReadableStream({
      async start(controller) {
        await handleRequest(url, tags, true, controller);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  return handleRequest(url, tags, false);
}
