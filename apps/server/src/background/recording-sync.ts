// src/background/recording-sync.ts
import {RecordingSyncJob} from "@/lib/video-conference/jobs/recording-sync-job";
import type {Env} from "hono";

export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        const job = new RecordingSyncJob();
        const result = await job.syncCompletedMeetings();

        console.log(`Recording sync completed: ${result.processed} processed, ${result.errors} errors`);

        return new Response('OK');
    }
};
