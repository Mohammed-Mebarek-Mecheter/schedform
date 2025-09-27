// src/lib/video-conference/jobs/recording-sync-job.ts
import { db } from '@/db';
import { videoMeetings, meetingRecordings, meetingTranscripts } from '@/db/schema/video-conference-core';
import {and, eq, lt, gte, sql} from 'drizzle-orm';
import { VideoConferenceServiceFactory } from '../service-factory';

export class RecordingSyncJob {
    private batchSize = 50;
    private maxRetries = 3;

    async syncCompletedMeetings(): Promise<{ processed: number; errors: number }> {
        const completedMeetings = await this.getCompletedMeetingsNeedingSync();
        let processed = 0;
        let errors = 0;

        for (const meeting of completedMeetings) {
            try {
                await this.syncMeetingRecordings(meeting);
                processed++;
            } catch (error) {
                console.error(`Failed to sync recordings for meeting ${meeting.id}:`, error);
                errors++;
            }
        }

        return { processed, errors };
    }

    private async getCompletedMeetingsNeedingSync() {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

        return await db.select()
            .from(videoMeetings)
            .where(and(
                eq(videoMeetings.status, 'completed'),
                gte(videoMeetings.actualEndTime, twentyFourHoursAgo),
                lt(videoMeetings.lastSyncedAt, oneHourAgo)
            ))
            .limit(this.batchSize);
    }

    private async syncMeetingRecordings(meeting: any) {
        const service = await VideoConferenceServiceFactory.createFromConnection(meeting.videoConnectionId);

        // Sync recordings
        const recordings = await (service as any).getMeetingRecordings(meeting.videoConnectionId, meeting.providerMeetingId);

        for (const recording of recordings) {
            await this.upsertRecording(meeting.id, recording);
        }

        // Sync transcript if available
        try {
            const transcript = await (service as any).getMeetingTranscript(meeting.videoConnectionId, meeting.providerMeetingId);
            await this.upsertTranscript(meeting.id, transcript);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            console.log(`Transcript not available for meeting ${meeting.id}:`, errorMessage);
        }

        // Update sync timestamp
        await db.update(videoMeetings)
            .set({
                lastSyncedAt: new Date(),
                syncVersion: sql`${videoMeetings.syncVersion} + 1`
            })
            .where(eq(videoMeetings.id, meeting.id));
    }

    private async upsertRecording(meetingId: string, recording: any) {
        await db.insert(meetingRecordings)
            .values({
                meetingId,
                organizationId: recording.organizationId,
                providerRecordingId: recording.providerData?.id || recording.id,
                startTime: recording.startTime,
                endTime: recording.endTime,
                fileSize: recording.fileSize,
                fileType: recording.fileType,
                downloadUrl: recording.downloadUrl,
                status: recording.status,
                metadata: recording.providerData
            })
            .onConflictDoUpdate({
                target: meetingRecordings.id,
                set: {
                    downloadUrl: recording.downloadUrl,
                    status: recording.status,
                    updatedAt: new Date()
                }
            });
    }

    private async upsertTranscript(meetingId: string, transcript: any) {
        await db.insert(meetingTranscripts)
            .values({
                meetingId,
                organizationId: transcript.organizationId,
                providerTranscriptId: transcript.providerData?.id || transcript.id,
                language: transcript.language,
                wordCount: transcript.wordCount,
                downloadUrl: transcript.downloadUrl,
                status: transcript.status,
                metadata: transcript.providerData
            })
            .onConflictDoUpdate({
                target: meetingTranscripts.id,
                set: {
                    downloadUrl: transcript.downloadUrl,
                    status: transcript.status,
                    wordCount: transcript.wordCount,
                    updatedAt: new Date()
                }
            });
    }
}
