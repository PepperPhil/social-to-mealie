import webpush, { type PushSubscription } from 'web-push';
import fs from 'fs';
import path from 'path';
import { env } from '@/lib/constants';

const SUBSCRIPTIONS_FILE = path.join(env.DATA_DIR, 'push-subscriptions.json');

let vapidConfigured = false;

function isConfigured(): boolean {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false;

    if (!vapidConfigured) {
        webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        vapidConfigured = true;
    }

    return true;
}

function readSubscriptions(): PushSubscription[] {
    try {
        const raw = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeSubscriptions(subs: PushSubscription[]) {
    try {
        fs.mkdirSync(env.DATA_DIR, { recursive: true });
        fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subs, null, 2));
    } catch (err) {
        console.error('Failed to persist push subscriptions:', err);
    }
}

export function addSubscription(sub: PushSubscription) {
    const subs = readSubscriptions();
    if (subs.some((s) => s.endpoint === sub.endpoint)) return;
    subs.push(sub);
    writeSubscriptions(subs);
}

export function removeSubscription(endpoint: string) {
    const subs = readSubscriptions();
    const next = subs.filter((s) => s.endpoint !== endpoint);
    if (next.length !== subs.length) writeSubscriptions(next);
}

type PushPayload = {
    title: string;
    body: string;
    url?: string;
};

export async function sendPushToAll(payload: PushPayload) {
    if (!isConfigured()) return;

    const subs = readSubscriptions();
    if (subs.length === 0) return;

    const results = await Promise.allSettled(
        subs.map((sub) => webpush.sendNotification(sub, JSON.stringify(payload)))
    );

    // Drop subscriptions the push service says are gone (unsubscribed/expired).
    const stillValid = subs.filter((_, i) => {
        const result = results[i];
        if (result.status !== 'rejected') return true;
        const statusCode = (result.reason as any)?.statusCode;
        return statusCode !== 404 && statusCode !== 410;
    });

    if (stillValid.length !== subs.length) writeSubscriptions(stillValid);

    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('Push notification failed for a subscription:', result.reason?.message ?? result.reason);
        }
    }
}
