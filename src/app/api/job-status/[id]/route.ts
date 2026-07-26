import { getJob, toEventPayload } from '@/lib/jobs';

// Lets a client reconnect to a running/finished import job by id - e.g. after the PWA
// was reopened following a push notification, or after a dropped SSE connection.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const job = getJob(id);

    if (!job) {
        return new Response(JSON.stringify({ error: 'Job nicht gefunden oder abgelaufen.' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            let closed = false;

            const send = (payload: any) => {
                if (closed) return;
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                } catch {
                    closed = true;
                }
            };

            const onUpdate = () => {
                send(toEventPayload(job));
                if (job.status !== 'running') {
                    job.emitter.off('update', onUpdate);
                    if (!closed) {
                        try {
                            controller.close();
                        } catch {}
                    }
                }
            };

            if (job.status === 'running') job.emitter.on('update', onUpdate);
            onUpdate();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
