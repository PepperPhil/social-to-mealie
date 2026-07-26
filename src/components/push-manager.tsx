'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function PushManager() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

    setSupported(true);
    setPermission(Notification.permission);
    navigator.serviceWorker.register('/sw.js').catch((err) => console.error('Service worker registration failed:', err));
  }, []);

  async function enableNotifications() {
    setBusy(true);
    try {
      const keyRes = await fetch('/api/push/public-key');
      const { publicKey } = await keyRes.json();

      if (!publicKey) {
        alert(
          'Push-Benachrichtigungen sind serverseitig nicht konfiguriert. Setze VAPID_PUBLIC_KEY und VAPID_PRIVATE_KEY (siehe README).'
        );
        return;
      }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
    } finally {
      setBusy(false);
    }
  }

  if (!supported || permission === 'granted') return null;

  return (
    <Button variant="ghost" size="sm" type="button" onClick={enableNotifications} disabled={busy} className="text-xs opacity-70">
      {busy ? 'Aktiviere…' : '🔔 Benachrichtigungen aktivieren'}
    </Button>
  );
}
