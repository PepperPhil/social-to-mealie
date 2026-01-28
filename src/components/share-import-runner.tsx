'use client';

import { useMemo, useState } from 'react';
import AutoImport from '@/components/auto-import';

type StepKey = 'download' | 'convert' | 'transcribe' | 'recipe';

type StepState = {
  title: string;
  status: 'idle' | 'running' | 'ok' | 'fail';
  detail?: string;
};

type ApiProgress = {
  videoDownloaded: boolean | null;
  audioTranscribed: boolean | null;
  recipeCreated: boolean | null;
};

// Kleine Helper für UI
function pctFromSteps(steps: StepState[]) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === 'ok').length;
  const running = steps.some((s) => s.status === 'running');
  // Wenn ein Step "running" ist, geben wir etwas “Zwischenstand”
  const base = (done / total) * 100;
  return running ? Math.min(99, base + 5) : base;
}

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
  const [sharedUrlShown, setSharedUrlShown] = useState<string | null>(null);

  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    download: { title: 'Download (yt-dlp)', status: 'idle' },
    convert: { title: 'Audio → WAV (ffmpeg)', status: 'idle' },
    transcribe: { title: 'Transkription (Whisper)', status: 'idle' },
    recipe: { title: 'Rezept erzeugen + nach Mealie', status: 'idle' },
  });

  const [logs, setLogs] = useState<string[]>([]);
  const [errorText, setErrorText] = useState<string>('');

  const stepsList = useMemo(() => Object.values(steps), [steps]);
  const percent = useMemo(() => pctFromSteps(stepsList), [stepsList]);

  function log(line: string) {
    setLogs((l) => [`${new Date().toISOString()}  ${line}`, ...l].slice(0, 200));
  }

  function setStep(step: StepKey, patch: Partial<StepState>) {
    setSteps((prev) => ({
      ...prev,
      [step]: { ...prev[step], ...patch },
    }));
  }

  function resetAll(url: string) {
    setSharedUrlShown(url);
    setStatus('running');
    setErrorText('');
    setLogs([]);
    setSteps({
      download: { title: 'Download (yt-dlp)', status: 'running' },
      convert: { title: 'Audio → WAV (ffmpeg)', status: 'idle' },
      transcribe: { title: 'Transkription (Whisper)', status: 'idle' },
      recipe: { title: 'Rezept erzeugen + nach Mealie', status: 'idle' },
    });
  }

  function mapApiProgressToSteps(p?: ApiProgress) {
    if (!p) return;

    // videoDownloaded: true => download ok + convert ok (wenn du convert separat reporten willst, siehe API-Fix unten)
    if (p.videoDownloaded === true) {
      setStep('download', { status: 'ok' });
      // convert lassen wir zunächst "running", weil bei dir das ffmpeg-Problem genau da sitzt
      // Wenn du in der API künftig convert separat reportest, kannst du das sauberer trennen.
      if (steps.convert.status === 'idle') setStep('convert', { status: 'running' });
    } else if (p.videoDownloaded === false) {
      setStep('download', { status: 'fail' });
    }

    if (p.audioTranscribed === true) {
      setStep('convert', { status: 'ok' });
      setStep('transcribe', { status: 'ok' });
      if (steps.recipe.status === 'idle') setStep('recipe', { status: 'running' });
    } else if (p.audioTranscribed === false) {
      // bei dir heißt das Feld “audioTranscribed” – das kann auch “convert oder transcribe” bedeuten
      // wir markieren transcribe fail, und geben convert “detail”
      setStep('transcribe', { status: 'fail' });
    }

    if (p.recipeCreated === true) {
      setStep('recipe', { status: 'ok' });
    } else if (p.recipeCreated === false) {
      setStep('recipe', { status: 'fail' });
    }
  }

  async function startImport(url: string) {
    resetAll(url);
    log(`Import gestartet für: ${url}`);

    try {
      const res = await fetch('/api/get-url', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, tags }),
      });

      const data = await res.json().catch(() => ({} as any));

      if (!res.ok) {
        const p = data?.progress as ApiProgress | undefined;
        mapApiProgressToSteps(p);

        setStatus('error');
        const msg = data?.error ?? `Import fehlgeschlagen (HTTP ${res.status})`;
        setErrorText(msg);
        log(`FEHLER: ${msg}`);

        // Wenn Backend “debug”/”details” liefert, zeigen
        if (data?.details) log(`DETAILS: ${String(data.details)}`);
        if (data?.stderr) log(`STDERR: ${String(data.stderr)}`);

        // markiere laufende Steps als fail, damit UI nicht “hängt”
        setSteps((prev) => {
          const next = { ...prev };
          (Object.keys(next) as StepKey[]).forEach((k) => {
            if (next[k].status === 'running') next[k] = { ...next[k], status: 'fail' };
          });
          return next;
        });

        return;
      }

      // Success
      mapApiProgressToSteps(data?.progress as ApiProgress | undefined);

      setStatus('done');
      log('Rezept wurde in Mealie angelegt.');
      setStep('download', { status: 'ok' });
      setStep('convert', { status: 'ok' });
      setStep('transcribe', { status: 'ok' });
      setStep('recipe', { status: 'ok' });
    } catch (e: any) {
      setStatus('error');
      const msg = e?.message ? String(e.message) : 'Unbekannter Fehler';
      setErrorText(msg);
      log(`FEHLER (Exception): ${msg}`);

      setSteps((prev) => {
        const next = { ...prev };
        (Object.keys(next) as StepKey[]).forEach((k) => {
          if (next[k].status === 'running') next[k] = { ...next[k], status: 'fail' };
        });
        return next;
      });
    }
  }

  const barLabel =
    status === 'idle' ? 'Bereit' : status === 'running' ? 'Import läuft…' : status === 'done' ? 'Fertig' : 'Fehler';

  return (
    <>
      {/* AutoImport liest ?url=...&autostart=1 und ruft onImport(sharedUrl) */}
      <AutoImport
        sharedUrl={sharedUrl}
        autostart={autostart}
        onImport={async (u) => {
          setSharedUrlShown(u);
          await startImport(u);
        }}
      />

      {/* Panel nur zeigen wenn einmal gestartet oder url da ist */}
      {(sharedUrlShown || status !== 'idle') && (
        <div className="mt-4 w-fit min-w-96 rounded-md border p-4 text-sm">
          <div className="font-semibold">Share-Import</div>

          {sharedUrlShown ? (
            <div className="mt-2">
              <div className="text-xs opacity-70">URL</div>
              <div className="break-all">{sharedUrlShown}</div>
            </div>
          ) : null}

          <div className="mt-3">
            <div className="flex items-center justify-between text-xs opacity-80">
              <span>{barLabel}</span>
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="mt-1 h-2 w-full rounded bg-neutral-800">
              <div
                className="h-2 rounded bg-neutral-200 transition-all"
                style={{ width: `${Math.max(3, percent)}%` }}
              />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {(Object.keys(steps) as StepKey[]).map((k) => {
              const s = steps[k];
              const dot =
                s.status === 'ok'
                  ? '●'
                  : s.status === 'fail'
                    ? '●'
                    : s.status === 'running'
                      ? '◐'
                      : '○';

              return (
                <div key={k} className="flex items-start gap-2">
                  <div className="mt-[2px] w-4 text-center">{dot}</div>
                  <div className="flex-1">
                    <div className="font-medium">{s.title}</div>
                    {s.detail ? <div className="text-xs opacity-75">{s.detail}</div> : null}
                  </div>
                  <div className="text-xs opacity-70">
                    {s.status === 'idle' ? '—' : s.status === 'running' ? 'läuft' : s.status === 'ok' ? 'OK' : 'FAIL'}
                  </div>
                </div>
              );
            })}
          </div>

          {status === 'error' && errorText ? (
            <div className="mt-4 rounded-md border border-red-700/40 bg-red-900/20 p-3">
              <div className="font-semibold">Fehler</div>
              <div className="mt-1 break-words opacity-90">{errorText}</div>
            </div>
          ) : null}

          {logs.length > 0 ? (
            <div className="mt-4">
              <div className="text-xs font-semibold opacity-80">Log (neueste zuerst)</div>
              <div className="mt-2 max-h-48 overflow-auto rounded bg-neutral-950/60 p-2 text-[11px] leading-relaxed">
                {logs.map((l, i) => (
                  <div key={i} className="break-words opacity-90">
                    {l}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
