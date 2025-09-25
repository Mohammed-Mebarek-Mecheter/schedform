// src/lib/calendar/sync-service.ts
import { CalendarServiceFactory } from './service-factory';
import { db } from '@/db';
import { calendarConnections, calendarSyncLogs, externalCalendarEvents } from '@/db/schema/calendar-core';
import {and, eq, sql} from 'drizzle-orm';
import { CalendarError, withRetry } from './error-handler';

export class CalendarSyncService {
    private static readonly SYNC_BATCH_SIZE = 100;
    private static readonly MAX_SYNC_DURATION = 10 * 60 * 1000; // 10 minutes

    static async syncConnection(connectionId: string, syncType: 'full' | 'incremental' = 'incremental'): Promise<void> {
        const syncLogId = await this.createSyncLog(connectionId, syncType);

        try {
            const service = await CalendarServiceFactory.createFromConnection(connectionId);

            if (syncType === 'full') {
                await withRetry(() => service.performFullSync(connectionId));
            } else {
                await withRetry(() => service.performIncrementalSync(connectionId));
            }

            await this.updateSyncLog(syncLogId, 'completed');
        } catch (error) {
            await this.updateSyncLog(syncLogId, 'failed', error);
            throw error;
        }
    }

    static async syncAllActiveConnections(): Promise<void> {
        const activeConnections = await db.select()
            .from(calendarConnections)
            .where(eq(calendarConnections.isActive, true));

        for (const connection of activeConnections) {
            try {
                await this.syncConnection(connection.id, 'incremental');
            } catch (error) {
                console.error(`Failed to sync connection ${connection.id}:`, error);
                // Continue with other connections
            }
        }
    }

    static async getConflicts(connectionId: string, startTime: Date, endTime: Date): Promise<any[]> {
        // Find events that might conflict with scheduled bookings
        const conflicts = await db
            .select()
            .from(externalCalendarEvents)
            .where(
                and(
                    eq(externalCalendarEvents.calendarConnectionId, connectionId),
                    sql`
                        (${externalCalendarEvents.startTime} < ${endTime}
                            AND ${externalCalendarEvents.endTime} > ${startTime}
                            AND ${externalCalendarEvents.status} != 'cancelled')`
                )
            );

        return conflicts;
    }

    static async cleanupOldEvents(connectionId: string, olderThanDays: number = 30): Promise<void> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

        await db.delete(externalCalendarEvents)
            .where(
                and(
                    eq(externalCalendarEvents.calendarConnectionId, connectionId),
                    sql`${externalCalendarEvents.endTime} < ${cutoffDate}`
                )
            )
    }

    private static async createSyncLog(connectionId: string, syncType: string): Promise<string> {
        const [syncLog] = await db.insert(calendarSyncLogs)
            .values({
                calendarConnectionId: connectionId,
                syncType: syncType,
                direction: 'inbound',
                startedAt: new Date(),
                status: 'running',
            })
            .returning({ id: calendarSyncLogs.id });

        return syncLog.id;
    }

    private static async updateSyncLog(syncLogId: string, status: string, error?: any): Promise<void> {
        const updates: any = {
            status: status,
            completedAt: new Date(),
        };

        if (error) {
            updates.errorCode = error.code;
            updates.errorMessage = error.message;
            updates.errorDetails = error;
        }

        await db.update(calendarSyncLogs)
            .set(updates)
            .where(eq(calendarSyncLogs.id, syncLogId));
    }
}
