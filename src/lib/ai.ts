import { env } from './constants';
import { createOpenAI } from '@ai-sdk/openai';
import { experimental_transcribe, generateObject } from 'ai';
import { z } from 'zod';
import { pipeline } from '@huggingface/transformers';
import { WaveFile } from 'wavefile';

const client = createOpenAI({
  baseURL: env.OPENAI_URL,
  apiKey: env.OPENAI_API_KEY,
});

const transcriptionModel = client.transcription(env.TRANSCRIPTION_MODEL);
const textModel = client.chat(env.TEXT_MODEL);

const recipeSchema = z.object({
  '@context': z.literal('https://schema.org').default('https://schema.org'),
  '@type': z.literal('Recipe').default('Recipe'),
  name: z.string(),
  image: z.string().optional(),
  url: z.string().optional(),
  description: z.string(),
  recipeIngredient: z.array(z.string()),
  recipeInstructions: z.array(
    z.object({
      '@type': z.literal('HowToStep').default('HowToStep'),
      text: z.string(),
    }),
  ),
  keywords: z.array(z.string()).optional(),
});

let localTranscriberPromise: Promise<any> | null = null;

async function getLocalTranscriber(model: string): Promise<any> {
  if (!localTranscriberPromise) {
    localTranscriberPromise = pipeline('automatic-speech-recognition', model);
  }

  return localTranscriberPromise;
}

export async function getTranscription(blob: Blob): Promise<string> {
  if (env.LOCAL_TRANSCRIPTION_MODEL) {
    console.info('Using local Whisper model for transcription:', env.LOCAL_TRANSCRIPTION_MODEL);
    const transcriber = await getLocalTranscriber(env.LOCAL_TRANSCRIPTION_MODEL);
    const arrayBuffer = Buffer.from(await blob.arrayBuffer());

    try {
      const wav = new WaveFile(new Uint8Array(arrayBuffer));
      wav.toBitDepth('32f');
      wav.toSampleRate(16000);
      const audioData: any = wav.getSamples();
      const result = await transcriber(audioData);

      if (result && typeof result === 'object' && 'text' in result) {
        return (result as any).text;
      }

      return String(result);
    } catch (err) {
      console.error('Error transcribing with local Whisper model:', err);
      throw err;
    }
  }

  try {
    const audioBuffer = Buffer.from(await blob.arrayBuffer());

    const result = await experimental_transcribe({
      model: transcriptionModel,
      audio: audioBuffer,
    });

    return result.text;
  } catch (error) {
    console.error('Error in getTranscription (AI SDK):', error);
    throw new Error('Failed to transcribe audio via API');
  }
}

export async function generateRecipeFromAI(
  transcription: string,
  description: string,
  postURL: string,
  thumbnail: string,
  extraPrompt: string,
  tags: string[],
) {
  const transcriptionBlock =
    transcription && transcription.trim().length > 0 ? transcription : '[No transcription available]';

  try {
    const { object } = await generateObject({
      model: textModel,
      schema: recipeSchema,
      prompt: `
You are an expert chef assistant. Review the following recipe transcript and refine it for clarity, conciseness, and accuracy.
Ensure ingredients and instructions are well-formatted and easy to follow.
Correct any obvious errors or omissions.
Output must be valid JSON-LD Schema.org Recipe format.
The keywords field should not be modified; leave it as it comes. If it is not present, do not include it.

<Metadata>
  Post URL: ${postURL}
  Description: ${description}
  Thumbnail: ${thumbnail}
</Metadata>

<Transcription>
  ${transcriptionBlock}
</Transcription>

Important:
- If the transcription is missing or says "[No transcription available]", you MUST infer the recipe primarily from the Description and common cooking knowledge.
- Be conservative: do not invent exotic ingredients; keep it minimal and plausible.
- If the description does not contain ingredient amounts, use reasonable standard amounts and make steps generic but useful.

${
  tags && tags.length > 0 && Array.isArray(tags) ? `<keywords>${tags.join(', ')}</keywords>` : ''
}

${
  tags && (tags as any).length > 0 && !Array.isArray(tags) ? `<keywords>${String(tags)}</keywords>` : ''
}

Use the thumbnail for the image field and the post URL for the url field.
Extract ingredients and instructions clearly.
Output must be valid JSON-LD Schema.org Recipe format.
${
  extraPrompt.length > 1
    ? `Also the user requests that:
${extraPrompt}`
    : ''
}
      `,
    });

    return object;
  } catch (error) {
    console.error('Error generating recipe with AI:', error);
    throw new Error('Failed to generate recipe structure');
  }
}
