import { NextResponse } from 'next/server';
import { addSourceTag } from '@/lib/social-source';
import { createJob, toEventPayload } from '@/lib/jobs';
import { runImportJob } from '@/lib/import-job';

interface RequestBody {
    url: string;
    tags: string[];
    force?: boolean;
}

export async function POST(req: Request) {
    const body: RequestBody = await req.json();
    const url = body.url;
    const tags = addSourceTag(url, body.tags ?? []);
    const force = body.force ?? false;

    const contentType = req.headers.get('Content-Type');
    const job = createJob();

    // Always start the job detached from the request. For SSE clients this means the
    // import keeps running even if the client disconnects (backgrounded/closed app); for
    // the plain-JSON path below we simply await the same promise, keeping that response
    // contract synchronous for existing integrations (e.g. the iOS Shortcut).
    const runPromise = runImportJob(job, url, tags, force);

    if (contentType === 'text/event-stream') {
        runPromise.catch((err) => console.error('Import job crashed:', err));

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                let closed = false;

                const send = (payload: any) => {
                    if (closed) return;
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    } catch {
                        // Client is gone; stop pushing to this stream, but the job itself
                        // keeps running in the background and will still send a push
                        // notification once it finishes.
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

                job.emitter.on('update', onUpdate);
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

    await runPromise;

    if (job.status === 'duplicate') {
        return NextResponse.json({ duplicate: true, recipe: job.result }, { status: 409 });
    }

    if (job.status === 'error') {
        return NextResponse.json({ error: job.error, progress: job.progress, logs: job.logs }, { status: 500 });
    }

    return NextResponse.json({ createdRecipe: job.result, progress: job.progress, logs: job.logs }, { status: 200 });
}
