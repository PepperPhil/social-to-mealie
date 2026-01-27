'use client';

import { useEffect, useRef } from 'react';

export default function AutoImport({
  onImport,
  sharedUrl,
  autostart,
}: {
  onImport: (url: string) => Promise<void> | void;
  sharedUrl?: string;
  autostart?: boolean;
}) {
  // verhindert Doppellauf (auch bei React Strict Mode / Re-Renders)
  const startedRef = useRef(false);

  useEffect(() => {
    if (!autostart) return;
    if (!sharedUrl) return;
    if (startedRef.current) return;

    startedRef.current = true;

    Promise.resolve(onImport(sharedUrl)).catch(() => {
      // Fehlerhandling macht der Caller (ShareImportRunner) via Status/Message
    });
  }, [autostart, sharedUrl, onImport]);

  return null;
}
