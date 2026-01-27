'use client';

import { useMemo, useState } from 'react';
import AutoImport from '@/components/auto-import';

type Progress = {
  videoDownloaded: boolean | null;
  audioTranscribed: boolean | null;
  recipeCreated: boolean | null;
};

export default function ShareImportRunner({ tags }: { tags: string[] }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<Progress>({
    videoDownloaded: null,
    audioTranscribed: null,
    recipeCreated: null,
  });
  const [message, setMessage] = useState<string>('');

  const pretty = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Video: ${progress.videoDownloaded === null ? '…' : progress.videoDownloaded ? 'OK' : 'FAIL'}`);
    parts.push(`Audio: ${progress.audioTranscribed === null ? '…' : progress.audioTranscribed ? 'OK' : 'FAIL'}`);
    parts.push(`Rezept: ${progress.recipeCreated === null ? '…' : progress.recipeCreated ? 'OK' : 'FAIL'}`);
    return parts.join(' | ');
  }, [progress]);

  async function startImport(url: string) {
    setStatus('running');
    setMessage('Import gestartet …');

    // Optional: initialer Status
    setProgress({
      videoDownloaded: null,
      audioTranscribed: null,
      recipeCreated: null,
    });

    // Vereinfachte Variante (kein SSE): wir warten auf das Ergebnis.
    // Wenn du unbedingt Progress live willst, kann ich dir danach SSE-Version bauen.
    const res = await fetch('/api/get-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, tags }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus('error');
      setProgress(data?.progress ?? progress);
      setMessage(data?.error ?? 'Import fehlgeschlagen');
      return;
    }

    setProgress(data?.progress ?? { videoDownloaded: true, audioTranscribed: true, recipeCreated: true });
    setStatus('done');

    // Optional: wenn du später automatisch zu Mealie springen willst,
    // können wir aus data.createdRecipe eine URL bauen – dafür brauchen wir deine externe Mealie Base URL im Client.
    setMessage('Rezept wurde in Mealie angelegt.');
  }

  return (
    <>
      <AutoImport onImport={startImport} />

      {status !== 'idle' && (
        <div className="mt-4 w-fit min-w-96 rounded-md border p-3 text-sm">
          <div className="font-semibold">Share-Import</div>
          <div className="mt-1">{message}</div>
          <div className="mt-2 opacity-80">{pretty}</div>
        </div>
      )}
    </>
  );
}
