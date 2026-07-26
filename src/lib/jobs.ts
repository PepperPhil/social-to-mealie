import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { progressType } from '@/lib/types';

export type StepKey = 'video' | 'audio' | 'recipe';

export type StepLog = {
    step: StepKey;
    ok: boolean | null;
    message: string;
    ts: number;
};

export type JobStatus = 'running' | 'done' | 'error' | 'duplicate';

export interface Job {
    id: string;
    status: JobStatus;
    progress: progressType;
    logs: StepLog[];
    result?: any;
    error?: string;
    createdAt: number;
    updatedAt: number;
    emitter: EventEmitter;
}

// In-memory job registry. Jobs run detached from any single HTTP request/SSE
// connection so a backgrounded/closed client can't interrupt an in-flight
// import - the job keeps running server-side until it finishes, and a push
// notification is fired regardless of whether anyone is still watching.
const jobs = new Map<string, Job>();

const JOB_TTL_MS = 30 * 60 * 1000;

function cleanupOldJobs() {
    const now = Date.now();
    for (const [id, job] of jobs) {
        if (job.status !== 'running' && now - job.updatedAt > JOB_TTL_MS) {
            jobs.delete(id);
        }
    }
}

export function createJob(): Job {
    cleanupOldJobs();

    const job: Job = {
        id: randomUUID(),
        status: 'running',
        progress: { videoDownloaded: null, audioTranscribed: null, recipeCreated: null },
        logs: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        emitter: new EventEmitter(),
    };
    job.emitter.setMaxListeners(20);
    jobs.set(job.id, job);
    return job;
}

export function getJob(id: string): Job | undefined {
    return jobs.get(id);
}

export function appendLog(job: Job, step: StepKey, ok: boolean | null, message: string) {
    job.logs.push({ step, ok, message, ts: Date.now() });
    job.updatedAt = Date.now();
    job.emitter.emit('update', job);
}

export function setJobProgress(job: Job, patch: Partial<progressType>) {
    job.progress = { ...job.progress, ...patch };
    job.updatedAt = Date.now();
    job.emitter.emit('update', job);
}

export function finishJob(job: Job, status: Exclude<JobStatus, 'running'>, result?: any, error?: string) {
    job.status = status;
    job.result = result;
    job.error = error;
    job.updatedAt = Date.now();
    job.emitter.emit('update', job);
}

// Snapshot of a job's current state in the shape the client-side SSE consumers expect.
export function toEventPayload(job: Job) {
    const base = { jobId: job.id, progress: job.progress, logs: job.logs };

    if (job.status === 'duplicate') return { ...base, duplicate: true, recipe: job.result };
    if (job.status === 'error') return { ...base, error: job.error };
    if (job.status === 'done') return { ...base, ...job.result };
    return base;
}
