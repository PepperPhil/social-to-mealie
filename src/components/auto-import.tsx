'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function extractFirstUrl(input: string): string | null {
  const m = input.match(/https?:\/\/\S+/i);
  return m ? m[0].replace(/[)\],.]*$/, '') : null;
}

export default function AutoImport({
  onImport,
}: {
  onImport: (url: string) => Promise<void> | void;
}) {
  const sp = useSearchParams();
  const router = useRouter();
  const [ran, setRan] = useState(false);

  const sharedUrl = useMemo(() => {
    const url = sp.get('url') ?? '';
    const text = sp.get('text') ?? '';
    const raw = `${url}\n${text}`.trim();
    return extractFirstUrl(raw);
  }, [sp]);

  const autostart = sp.get('autostart') === '1';

  useEffect(() => {
    if (!autostart) return;
    if (ran) return;
    if (!sharedUrl) return;

    setRan(true);

    Promise.resolve(onImport(sharedUrl))
      .catch(() => {
        // Fehler handling macht besser die Page (Toast o.ä.)
      })
      .finally(() => {
        // Query aufräumen, damit ein Reload nicht nochmal importiert
        const clean = new URL(window.location.href);
        clean.searchParams.delete('autostart');
        // url kannst du löschen oder behalten – ich lösche sie, um Double-Imports zu verhindern:
        clean.searchParams.delete('url');
        clean.searchParams.delete('text');
        router.replace(clean.pathname + clean.search);
      });
  }, [autostart, ran, sharedUrl, onImport, router]);

  return null;
}
