'use client';

import { useEffect, useMemo, useState } from 'react';
import AutoImport from '@/components/auto-import';

type Progress = {
  videoDownloaded: boolean | null;
  audioTranscribed: boolean | null;
  recipeCreated: boolean | null;
};

export default function ShareImportRunner({
  tags,
  sharedUrl,
  autostart,
}: {
  tags: string[];
  sharedUrl?: string;
  autostart?: boolean;
}) {
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

    setProgress({
      videoDownloaded: null,
      audioTranscribed: null,
      recipeCreated: null,
    });

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
    setMessage('Rezept wurde in Mealie angelegt.');
  }

  // Autostart: wenn /share auf /?url=...&autostart=1 redirected
  useEffect(() => {
    if (!autostart) return;
    if (!sharedUrl) return;
    if (status !== 'idle') return; // verhindert Doppellauf

    startImport(sharedUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autostart, sharedUrl]);

  return (
    <>
      {/* Manuelles AutoImport beibehalten (falls du es brauchst), aber es ist jetzt nicht mehr zwingend */}
      <AutoImport onImport={startImport} />

      {status !== 'idle' && (
        <div className="mt-4 w-fit min-w-96 rounded-md border p-3 text-sm">
          <div className="font-semibold">Share-Import</div>
          {sharedUrl ? <div className="mt-1 break-all opacity-80">{sharedUrl}</div> : null}
          <div className="mt-2">{message}</div>
          <div className="mt-2 opacity-80">{pretty}</div>
        </div>
      )}
    </>
  );
}
