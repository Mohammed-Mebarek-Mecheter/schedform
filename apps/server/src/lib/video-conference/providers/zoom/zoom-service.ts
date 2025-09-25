// src/lib/video-conference/providers/zoom/zoom-service.ts
import type { VideoConferenceService, VideoMeeting, MeetingParticipant, MeetingRecording, MeetingTranscript, ZoomConfig } from '../../types';
import { db } from '@/db';
import { videoConferenceConnections, zoomWebhooks } from '@/db/schema/video-conference-core';
import {and, eq, sql} from 'drizzle-orm';

interface ZoomTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
}

interface ZoomParticipant {
    id: string;
    user_email: string;
    name: string;
    role: 'host' | 'attendee' | 'co-host';
    join_time: string;
    leave_time?: string;
    duration: number;
}

interface ZoomParticipantsResponse {
    participants: ZoomParticipant[];
    page_count: number;
    page_size: number;
    total_records: number;
    next_page_token?: string;
}

export class ZoomVideoService implements VideoConferenceService {
    private baseUrl = 'https://api.zoom.us/v2';

    constructor(private config: ZoomConfig) {}

    private async ensureValidToken(connectionId: string): Promise<string> {
        const connection = await this.getConnection(connectionId);

        if (connection.tokenExpiresAt && new Date(connection.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
            await this.refreshTokens(connectionId);
            const updatedConnection = await this.getConnection(connectionId);
            return updatedConnection.accessToken;
        }

        return connection.accessToken;
    }

    private async makeZoomRequest<T = any>(accessToken: string, endpoint: string, options: RequestInit = {}): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Zoom API Error: ${response.status} - ${errorText}`);
        }

        return response.json();
    }

    async validateConnection(connectionId: string): Promise<boolean> {
        try {
            const accessToken = await this.ensureValidToken(connectionId);
            await this.makeZoomRequest(accessToken, '/users/me');
            return true;
        } catch (error) {
            console.error('Zoom connection validation failed:', error);
            await this.handleConnectionError(connectionId, error);
            return false;
        }
    }

    async refreshTokens(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);

        try {
            const response = await fetch('https://zoom.us/oauth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: connection.refreshToken!,
                }),
            });

            if (!response.ok) {
                throw new Error(`Token refresh failed: ${response.status}`);
            }

            const tokens: ZoomTokenResponse = await response.json();

            await db.update(videoConferenceConnections)
                .set({
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token || connection.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                    consecutiveFailures: 0,
                    lastError: null,
                    updatedAt: new Date(),
                })
                .where(eq(videoConferenceConnections.id, connectionId));

        } catch (error) {
            console.error('Zoom token refresh failed:', error);
            await this.handleTokenRefreshError(connectionId, error);
            throw new Error('Failed to refresh Zoom tokens');
        }
    }

    async createMeeting(params: {
        connectionId: string;
        title: string;
        startTime: Date;
        duration: number;
        timeZone: string;
        agenda?: string;
        settings?: any;
    }): Promise<VideoMeeting> {
        const accessToken = await this.ensureValidToken(params.connectionId);

        const meetingData: any = {
            topic: params.title,
            type: 2, // Scheduled meeting
            start_time: params.startTime.toISOString(),
            duration: params.duration,
            timezone: params.timeZone,
            agenda: params.agenda,
            settings: {
                host_video: true,
                participant_video: false,
                join_before_host: false,
                mute_upon_entry: params.settings?.muteOnEntry || false,
                waiting_room: params.settings?.waitingRoom || true,
                auto_recording: params.settings?.autoRecord ? 'cloud' : 'none',
                ...params.settings,
            },
        };

        try {
            const response = await this.makeZoomRequest(accessToken, '/users/me/meetings', {
                method: 'POST',
                body: JSON.stringify(meetingData),
            });

            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to create Zoom meeting:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async updateMeeting(connectionId: string, meetingId: string, updates: Partial<VideoMeeting>): Promise<VideoMeeting> {
        const accessToken = await this.ensureValidToken(connectionId);

        const updateData: any = {};
        if (updates.title) updateData.topic = updates.title;
        if (updates.startTime) updateData.start_time = updates.startTime.toISOString();
        if (updates.duration) updateData.duration = updates.duration;
        if (updates.agenda) updateData.agenda = updates.agenda;

        try {
            const response = await this.makeZoomRequest(accessToken, `/meetings/${meetingId}`, {
                method: 'PATCH',
                body: JSON.stringify(updateData),
            });

            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to update Zoom meeting:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async deleteMeeting(connectionId: string, meetingId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            await this.makeZoomRequest(accessToken, `/meetings/${meetingId}`, {
                method: 'DELETE',
            });
        } catch (error) {
            console.error('Failed to delete Zoom meeting:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async getMeeting(connectionId: string, meetingId: string): Promise<VideoMeeting> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest(accessToken, `/meetings/${meetingId}`);
            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to get Zoom meeting:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async listParticipants(connectionId: string, meetingId: string): Promise<MeetingParticipant[]> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest<ZoomParticipantsResponse>(
            accessToken,
            `/report/meetings/${meetingId}/participants`
        );

        if (!response.participants) {
            return [];
        }

            return response.participants.map((participant: any) => ({
                id: participant.id,
                email: participant.user_email,
                name: participant.name,
                role: participant.role === 'host' ? 'host' : 'attendee',
                joinTime: new Date(participant.join_time),
                leaveTime: participant.leave_time ? new Date(participant.leave_time) : undefined,
                duration: participant.duration,
            }));
        } catch (error) {
            console.error('Failed to list Zoom participants:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async listRecordings(connectionId: string, meetingId: string): Promise<MeetingRecording[]> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest(accessToken, `/meetings/${meetingId}/recordings`);

            return response.recording_files.map((recording: any) => ({
                id: recording.id,
                startTime: new Date(recording.recording_start),
                endTime: new Date(recording.recording_end),
                fileSize: recording.file_size,
                fileType: recording.file_type,
                downloadUrl: recording.download_url,
                status: recording.status === 'completed' ? 'completed' : 'processing',
            }));
        } catch (error) {
            console.error('Failed to list Zoom recordings:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async listTranscripts(connectionId: string, meetingId: string): Promise<MeetingTranscript[]> {
        // Zoom transcripts are part of recordings
        const recordings = await this.listRecordings(connectionId, meetingId);

        // Filter for audio transcripts
        return recordings
            .filter(rec => rec.fileType === 'M4A')
            .map(rec => ({
                id: rec.id,
                language: 'en', // Zoom doesn't provide language info in basic API
                wordCount: 0, // Would need additional API call
                downloadUrl: rec.downloadUrl,
                status: rec.status,
            }));
    }

    async setupWebhook(connectionId: string, options: any): Promise<{ webhookId: string; expirationTime: Date }> {
        const accessToken = await this.ensureValidToken(connectionId);
        const webhookId = `webhook-${connectionId}-${Date.now()}`;
        const expirationTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days

        try {
            const response = await this.makeZoomRequest(accessToken, '/webhooks', {
                method: 'POST',
                body: JSON.stringify({
                    url: options.endpointUrl,
                    auth_user: options.authUser,
                    auth_password: options.authPassword,
                    events: options.events || ['meeting.started', 'meeting.ended', 'recording.completed'],
                }),
            });

            await db.insert(zoomWebhooks).values({
                videoConnectionId: connectionId,
                webhookId: response.webhook_id,
                eventType: options.events?.join(',') || 'meeting.started,meeting.ended,recording.completed',
                endpointUrl: options.endpointUrl,
                verificationToken: options.verificationToken,
                createdAt: new Date(),
            });

            return {
                webhookId: response.webhook_id,
                expirationTime,
            };
        } catch (error) {
            console.error('Failed to setup Zoom webhook:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            await this.makeZoomRequest(accessToken, `/webhooks/${webhookId}`, {
                method: 'DELETE',
            });

            await db.delete(zoomWebhooks)
                .where(eq(zoomWebhooks.webhookId, webhookId));

        } catch (error) {
            console.error('Failed to remove Zoom webhook:', error);
            throw this.normalizeZoomError(error);
        }
    }

    async startMeeting(connectionId: string, meetingId: string): Promise<void> {
        // Zoom meetings start automatically when host joins
        // This method would typically send a notification or update status
        console.log(`Starting Zoom meeting ${meetingId}`);
    }

    async endMeeting(connectionId: string, meetingId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            await this.makeZoomRequest(accessToken, `/meetings/${meetingId}/status`, {
                method: 'PUT',
                body: JSON.stringify({ action: 'end' }),
            });
        } catch (error) {
            console.error('Failed to end Zoom meeting:', error);
            throw this.normalizeZoomError(error);
        }
    }

    // Helper methods
    private async getConnection(connectionId: string) {
        const result = await db.select()
            .from(videoConferenceConnections)
            .where(eq(videoConferenceConnections.id, connectionId))
            .limit(1);

        if (result.length === 0) {
            throw new Error(`Video connection not found: ${connectionId}`);
        }

        return result[0];
    }

    private async handleConnectionError(connectionId: string, error: any): Promise<void> {
        await db.update(videoConferenceConnections)
            .set({
                consecutiveFailures: sql`${videoConferenceConnections.consecutiveFailures} + 1`,
                lastError: error.message,
                updatedAt: new Date(),
            })
            .where(eq(videoConferenceConnections.id, connectionId));
    }

    private async handleTokenRefreshError(connectionId: string, error: any): Promise<void> {
        await db.update(videoConferenceConnections)
            .set({
                consecutiveFailures: sql`${videoConferenceConnections.consecutiveFailures} + 1`,
                lastError: `Token refresh failed: ${error.message}`,
                isActive: false,
                updatedAt: new Date(),
            })
            .where(eq(videoConferenceConnections.id, connectionId));
    }

    private normalizeZoomMeeting(zoomMeeting: any): VideoMeeting {
        return {
            id: zoomMeeting.id,
            title: zoomMeeting.topic,
            description: zoomMeeting.agenda,
            agenda: zoomMeeting.agenda,
            startTime: new Date(zoomMeeting.start_time),
            endTime: new Date(new Date(zoomMeeting.start_time).getTime() + zoomMeeting.duration * 60000),
            timeZone: zoomMeeting.timezone,
            duration: zoomMeeting.duration,
            joinUrl: zoomMeeting.join_url,
            hostUrl: zoomMeeting.start_url,
            password: zoomMeeting.password,
            settings: {
                isRecurring: zoomMeeting.type === 8, // 8 is recurring meeting
                maxParticipants: zoomMeeting.settings?.participant_video ? 100 : 300, // Approximate
                waitingRoom: zoomMeeting.settings?.waiting_room || false,
                muteOnEntry: zoomMeeting.settings?.mute_upon_entry || false,
                autoRecord: zoomMeeting.settings?.auto_recording !== 'none',
                autoTranscribe: zoomMeeting.settings?.auto_recording === 'cloud' && zoomMeeting.settings?.auto_transcription,
            },
            providerData: zoomMeeting,
        };
    }

    private normalizeZoomError(error: any): Error {
        if (error.message?.includes('401')) {
            return new Error('Authentication failed - please reconnect your Zoom account');
        } else if (error.message?.includes('403')) {
            return new Error('Zoom access denied - check permissions');
        } else if (error.message?.includes('404')) {
            return new Error('Meeting not found');
        } else if (error.message?.includes('429')) {
            return new Error('Zoom rate limit exceeded - please try again later');
        }
        return error;
    }
}
