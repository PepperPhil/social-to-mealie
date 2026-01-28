'use client';

import { useMemo, useState } from 'react';
import AutoImport from '@/components/auto-import';

type StepKey = 'video' | 'audio' | 'recipe';

type Progress = {
  videoDownloaded: boolean | null;
  audioTranscribed: boolean | null;
  recipeCreated: boolean | null;
};

type StepLog = {
  step: StepKey;
  ok: boolean | null;
  message: string;
  ts: number;
};

function stepStateFromProgress(step: StepKey, p: Progress): 'idle' | 'running' | 'ok' | 'fail' {
  const v =
    step === 'video' ? p.videoDownloaded :
    step === 'audio' ? p.audioTranscribed :
    p.recipeCreated;

  if (v === true) return 'ok';
  if (v === false) return 'fail';
  return 'running';
}

function progressValueForStep(step: StepKey, p: Progress): number {
  const st = stepStateFromProgress(step, p);
  if (st === 'ok') return 100;
  if (st === 'fail') return 100;
  return 30; // running = "irgendwas passiert"
}

function label(step: StepKey) {
  if (step === 'video') return '1) Download / Extract';
  if (step === 'audio') return '2) Audio → Transkript';
  return '3) Rezept → Mealie';
}

export default function ShareImportRunner({ tags }: { tags: string[] }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<Progress>({
    videoDownloaded: null,
    audioTranscribed: null,
    recipeCreated: null,
  });
  const [message, setMessage] = useState<string>('');
  const [logs, setLogs] = useState<StepLog[]>([]);
  const [sharedUrlShown, setSharedUrlShown] = useState<string | null>(null);

  const lastLogByStep = useMemo(() => {
    const m = new Map<StepKey, StepLog>();
    for (const l of logs) m.set(l.step, l);
    return m;
  }, [logs]);

  async function startImport(url: string) {
    setSharedUrlShown(url);
    setStatus('running');
    setMessage('Import gestartet …');
    setLogs([]);
    setProgress({
      videoDownloaded: null,
      audioTranscribed: null,
      recipeCreated: null,
    });

    const response = await fetch('/api/get-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/event-stream',
      },
      body: JSON.stringify({ url, tags }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      setStatus('error');
      setMessage('Kein SSE Stream verfügbar.');
      return;
    }

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        chunk.split('\n\n').forEach((event) => {
          if (!event.startsWith('data: ')) return;

          const raw = event.replace('data: ', '');
          let data: any;
          try {
            data = JSON.parse(raw);
          } catch {
            // ignore malformed chunk
            return;
          }

          if (data.logs) setLogs(data.logs as StepLog[]);
          if (data.progress) setProgress(data.progress as Progress);

          if (data.error) {
            setStatus('error');
            setMessage(String(data.error));
          }

          // Wenn serverseitig am Ende ein createdRecipe kommt, hat es "name"
          if (data.name) {
            setStatus('done');
            setMessage('Rezept wurde in Mealie angelegt.');
          }
        });
      }

      // Falls der Stream endet ohne "name" und ohne "error"
      if (status === 'running') {
        // Heuristik: wenn recipeCreated true dann done, sonst error
        const ok = progress.recipeCreated === true;
        setStatus(ok ? 'done' : 'error');
        setMessage(ok ? 'Rezept wurde in Mealie angelegt.' : 'Import endete ohne Ergebnis.');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message ?? 'Unbekannter Fehler im Import-Stream');
    }
  }

  const steps: StepKey[] = ['video', 'audio', 'recipe'];

  return (
    <>
      <AutoImport onImport={startImport} />

      {status !== 'idle' && (
        <div className="mt-4 w-fit min-w-96 rounded-md border p-3 text-sm">
          <div className="font-semibold">Share-Import</div>

          {sharedUrlShown ? (
            <div className="mt-1 break-all opacity-80">{sharedUrlShown}</div>
          ) : null}

          <div className="mt-2">{message}</div>

          <div className="mt-3 flex flex-col gap-3">
            {steps.map((s) => {
              const st = stepStateFromProgress(s, progress);
              const v = progressValueForStep(s, progress);
              const l = lastLogByStep.get(s);

              return (
                <div key={s} className="rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{label(s)}</div>
                    <div className="text-xs opacity-80">
                      {st === 'ok' ? 'OK' : st === 'fail' ? 'FAIL' : '…'}
                    </div>
                  </div>

                  <div className="mt-2">
                    <progress className="w-full" value={v} max={100} />
                  </div>

                  {l?.message ? (
                    <div className={`mt-2 text-xs ${l.ok === false ? 'opacity-100' : 'opacity-80'}`}>
                      {l.message}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs opacity-60">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
