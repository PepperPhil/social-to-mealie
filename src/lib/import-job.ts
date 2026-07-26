import { env } from '@/lib/constants';
import { findRecipeIdentifierBySourceUrl, getRecipe, postRecipe, postRecipeImage } from '@/lib/mealie';
import { generateRecipeFromAI, getTranscription } from '@/lib/ai';
import { downloadMediaWithYtDlp } from '@/lib/yt-dlp';
import { filenameFromUrl } from '@/lib/social-source';
import { sendPushToAll } from '@/lib/push';
import { appendLog, finishJob, setJobProgress, type Job } from '@/lib/jobs';

// Runs the whole download -> transcribe -> generate -> post-to-Mealie pipeline for one job.
// This function is intentionally not tied to any HTTP response/controller: callers may
// await it directly (synchronous API consumers, e.g. the iOS Shortcut) or fire it off
// detached and stream the job's progress separately (the PWA/web UI). Either way, once
// started, the import runs to completion on the server regardless of whether a client is
// still connected, and a push notification is sent on completion.
export async function runImportJob(job: Job, url: string, tags: string[], force: boolean) {
    try {
        const existingRecipeId = await findRecipeIdentifierBySourceUrl(url);
        if (existingRecipeId && !force) {
            const existingRecipe = await getRecipe(existingRecipeId);
            finishJob(job, 'duplicate', existingRecipe);
            return;
        }

        appendLog(job, 'video', null, 'Download/Extract gestartet …');
        const socialMedia = await downloadMediaWithYtDlp(url);

        if (socialMedia.mediaType === 'image' && socialMedia.imageUrl) {
            const imageResponse = await fetch(socialMedia.imageUrl, { signal: AbortSignal.timeout(60000) });
            if (!imageResponse.ok) {
                throw new Error('Bild konnte nicht geladen werden.');
            }

            const image = await imageResponse.blob();
            const filename = filenameFromUrl(socialMedia.imageUrl);

            setJobProgress(job, { videoDownloaded: true });
            appendLog(job, 'video', true, 'Bild erfolgreich geladen.');

            appendLog(job, 'audio', null, 'Text wird aus dem Bild extrahiert …');
            appendLog(job, 'recipe', null, 'Rezept wird aus dem Bild extrahiert & nach Mealie gepostet …');

            const mealieResponse = await postRecipeImage(image, filename, tags);
            const createdRecipe = await getRecipe(mealieResponse);

            setJobProgress(job, { audioTranscribed: true });
            appendLog(job, 'audio', true, 'Text aus dem Bild extrahiert.');

            setJobProgress(job, { recipeCreated: true });
            appendLog(job, 'recipe', true, 'Rezept wurde in Mealie angelegt.');

            finishJob(job, 'done', createdRecipe);
            await notifyResult(job);
            return;
        }

        setJobProgress(job, { videoDownloaded: true });
        appendLog(job, 'video', true, 'Media/Metadaten erfolgreich geladen.');

        let transcription = '';
        appendLog(job, 'audio', null, 'Audio/Transkription wird geprüft …');

        const { blob: audioBlob } = socialMedia;

        if (!audioBlob || audioBlob.size === 0) {
            setJobProgress(job, { audioTranscribed: true });
            appendLog(job, 'audio', true, 'Kein Audiostream gefunden. Transkription übersprungen (Description-only).');
        } else {
            appendLog(job, 'audio', null, 'Transkription gestartet …');
            transcription = await getTranscription(audioBlob);
            setJobProgress(job, { audioTranscribed: true });
            appendLog(job, 'audio', true, 'Transkription erfolgreich.');
        }

        const normalizedDescription = socialMedia.description?.trim() ?? '';
        const hasDescription =
            normalizedDescription.length > 0 && normalizedDescription.toLowerCase() !== 'no description found';
        const hasTranscription = transcription.trim().length > 0;

        if (!hasDescription && !hasTranscription) {
            throw new Error('Kein Rezepttext gefunden (weder Transkription noch Beschreibung).');
        }

        appendLog(job, 'recipe', null, 'Rezept wird via KI erstellt & nach Mealie gepostet …');

        const recipe = await generateRecipeFromAI(
            transcription,
            socialMedia.description,
            url,
            socialMedia.thumbnail,
            env.EXTRA_PROMPT || '',
            tags
        );

        const mealieResponse = await postRecipe(recipe);
        const createdRecipe = await getRecipe(mealieResponse);

        setJobProgress(job, { recipeCreated: true });
        appendLog(job, 'recipe', true, 'Rezept wurde in Mealie angelegt.');

        finishJob(job, 'done', createdRecipe);
        await notifyResult(job);
    } catch (error: any) {
        const msg = String(error?.message ?? error ?? 'Unbekannter Fehler');

        setJobProgress(job, {
            videoDownloaded: job.progress.videoDownloaded ?? false,
            audioTranscribed: job.progress.audioTranscribed ?? false,
            recipeCreated: false,
        });

        let failedStep: 'video' | 'audio' | 'recipe' = 'recipe';
        if (job.progress.videoDownloaded !== true) failedStep = 'video';
        else if (job.progress.audioTranscribed !== true) failedStep = 'audio';

        appendLog(job, failedStep, false, msg);
        finishJob(job, 'error', undefined, msg);
        await notifyResult(job);
    }
}

async function notifyResult(job: Job) {
    try {
        if (job.status === 'done') {
            const recipeName = job.result?.name ? `„${job.result.name}"` : 'Dein Rezept';
            await sendPushToAll({
                title: 'Rezept übertragen ✅',
                body: `${recipeName} wurde zu Mealie hinzugefügt.`,
                url: job.result?.url ?? '/',
            });
        } else if (job.status === 'error') {
            await sendPushToAll({
                title: 'Import fehlgeschlagen ❌',
                body: job.error ?? 'Der Rezept-Import ist fehlgeschlagen.',
                url: '/',
            });
        }
    } catch (err) {
        console.error('Failed to send push notification:', err);
    }
}
