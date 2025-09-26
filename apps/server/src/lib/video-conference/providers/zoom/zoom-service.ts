// src/lib/video-conference/providers/zoom/zoom-service.ts
import type { VideoConferenceService, VideoMeeting, MeetingParticipant, MeetingRecording, MeetingTranscript, ZoomConfig } from '../../types';
import { db } from '@/db';
import { videoConferenceConnections, zoomWebhooks } from '@/db/schema/video-conference-core';
import { and, eq, sql } from 'drizzle-orm';
import { VideoConferenceError, VideoConferenceErrorHandler } from '../../error-handler';

interface ZoomTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
}

interface ZoomMeeting {
    id: string;
    topic: string;
    agenda?: string;
    start_time: string;
    duration: number;
    timezone: string;
    join_url: string;
    start_url: string;
    password?: string;
    settings: {
        host_video: boolean;
        participant_video: boolean;
        join_before_host: boolean;
        mute_upon_entry: boolean;
        waiting_room: boolean;
        auto_recording: 'none' | 'local' | 'cloud';
    };
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
            throw VideoConferenceErrorHandler.handleZoomError(error);
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
            throw VideoConferenceErrorHandler.handleZoomError(error);
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

        const meetingData = {
            topic: params.title,
            type: 2, // Scheduled meeting
            start_time: params.startTime.toISOString().replace(/\.\d{3}Z$/, 'Z'), // Zoom expects specific format
            duration: params.duration,
            timezone: params.timeZone,
            agenda: params.agenda,
            settings: {
                host_video: true,
                participant_video: false,
                join_before_host: params.settings?.waitingRoom ? false : true,
                mute_upon_entry: params.settings?.muteOnEntry || false,
                waiting_room: params.settings?.waitingRoom || false,
                auto_recording: params.settings?.autoRecord ? 'cloud' : 'none',
                contact_email: params.connectionId, // Use connection email
            },
        };

        try {
            const response = await this.makeZoomRequest<ZoomMeeting>(accessToken, '/users/me/meetings', {
                method: 'POST',
                body: JSON.stringify(meetingData),
            });

            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to create Zoom meeting:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async updateMeeting(connectionId: string, meetingId: string, updates: Partial<VideoMeeting>): Promise<VideoMeeting> {
        const accessToken = await this.ensureValidToken(connectionId);

        const updateData: any = {};
        if (updates.title) updateData.topic = updates.title;
        if (updates.startTime) updateData.start_time = updates.startTime.toISOString().replace(/\.\d{3}Z$/, 'Z');
        if (updates.duration) updateData.duration = updates.duration;
        if (updates.agenda) updateData.agenda = updates.agenda;

        if (updates.settings) {
            updateData.settings = {
                join_before_host: updates.settings.waitingRoom ? false : true,
                mute_upon_entry: updates.settings.muteOnEntry || false,
                waiting_room: updates.settings.waitingRoom || false,
                auto_recording: updates.settings.autoRecord ? 'cloud' : 'none',
            };
        }

        try {
            await this.makeZoomRequest(accessToken, `/meetings/${meetingId}`, {
                method: 'PATCH',
                body: JSON.stringify(updateData),
            });

            // Get updated meeting
            const response = await this.makeZoomRequest<ZoomMeeting>(accessToken, `/meetings/${meetingId}`);
            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to update Zoom meeting:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
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
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async getMeeting(connectionId: string, meetingId: string): Promise<VideoMeeting> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest<ZoomMeeting>(accessToken, `/meetings/${meetingId}`);
            return this.normalizeZoomMeeting(response);
        } catch (error) {
            console.error('Failed to get Zoom meeting:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async setupWebhook(connectionId: string, options: any): Promise<{ webhookId: string; expirationTime: Date }> {
        const accessToken = await this.ensureValidToken(connectionId);
        const expirationTime = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)); // 30 days

        try {
            const eventsToSubscribe = [
                'meeting.created',
                'meeting.updated',
                'meeting.deleted',
                'meeting.started',
                'meeting.ended',
            ];

            const response = await this.makeZoomRequest<any>(accessToken, '/webhooks', {
                method: 'POST',
                body: JSON.stringify({
                    url: options.endpointUrl,
                    auth_user: options.authUser,
                    auth_password: options.authPassword,
                    events: eventsToSubscribe,
                }),
            });

            await db.insert(zoomWebhooks).values({
                videoConnectionId: connectionId,
                webhookId: response.id,
                eventType: eventsToSubscribe.join(','),
                endpointUrl: options.endpointUrl,
                verificationToken: options.verificationToken,
                createdAt: new Date(),
            });

            return {
                webhookId: response.id,
                expirationTime,
            };
        } catch (error) {
            console.error('Failed to setup Zoom webhook:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
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
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async startMeeting(connectionId: string, meetingId: string): Promise<void> {
        // Zoom meetings start automatically when host joins
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
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    // Helper methods
    private async getConnection(connectionId: string) {
        const result = await db.select()
            .from(videoConferenceConnections)
            .where(eq(videoConferenceConnections.id, connectionId))
            .limit(1);

        if (result.length === 0) {
            throw new VideoConferenceError(
                `Video connection not found: ${connectionId}`,
                'CONNECTION_NOT_FOUND',
                false
            );
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

    private normalizeZoomMeeting(zoomMeeting: ZoomMeeting): VideoMeeting {
        const startTime = new Date(zoomMeeting.start_time);

        return {
            id: zoomMeeting.id.toString(),
            title: zoomMeeting.topic,
            description: zoomMeeting.agenda,
            agenda: zoomMeeting.agenda,
            startTime: startTime,
            endTime: new Date(startTime.getTime() + zoomMeeting.duration * 60000),
            timeZone: zoomMeeting.timezone,
            duration: zoomMeeting.duration,
            joinUrl: zoomMeeting.join_url,
            hostUrl: zoomMeeting.start_url,
            password: zoomMeeting.password,
            settings: {
                isRecurring: false, // Simplified for MVP
                waitingRoom: zoomMeeting.settings.waiting_room,
                muteOnEntry: zoomMeeting.settings.mute_upon_entry,
                autoRecord: zoomMeeting.settings.auto_recording !== 'none',
                autoTranscribe: zoomMeeting.settings.auto_recording === 'cloud',
            },
            providerData: { ...zoomMeeting },
        };
    }
}
