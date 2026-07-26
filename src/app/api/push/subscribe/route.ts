import { NextResponse } from 'next/server';
import { addSubscription, removeSubscription } from '@/lib/push';

export async function POST(req: Request) {
    const sub = await req.json().catch(() => null);

    if (!sub?.endpoint) {
        return NextResponse.json({ error: 'Invalid push subscription.' }, { status: 400 });
    }

    addSubscription(sub);
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
    const body = await req.json().catch(() => null);

    if (!body?.endpoint) {
        return NextResponse.json({ error: 'Invalid endpoint.' }, { status: 400 });
    }

    removeSubscription(body.endpoint);
    return NextResponse.json({ ok: true });
}
