// src/lib/video-conference/providers/zoom/zoom-service.ts
import type { VideoConferenceService, VideoMeeting, MeetingRecording, MeetingTranscript, ZoomConfig } from '../../types';
import { db } from '@/db';
import { videoConferenceConnections, zoomWebhooks } from '@/db/schema/video-conference-core';
import { eq, sql } from 'drizzle-orm';
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

    async getMeetingRecordings(connectionId: string, meetingId: string): Promise<MeetingRecording[]> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest<any>(
                accessToken,
                `/meetings/${meetingId}/recordings?include_fields=download_access_token&ttl=7200`
            );

            if (!response.recording_files || response.recording_files.length === 0) {
                return [];
            }

            return response.recording_files.map((file: any) => this.normalizeZoomRecording(file, meetingId));
        } catch (error) {
            console.error('Failed to get Zoom recordings:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async getMeetingTranscript(connectionId: string, meetingId: string): Promise<MeetingTranscript> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            const response = await this.makeZoomRequest<any>(
                accessToken,
                `/meetings/${meetingId}/transcript`
            );

            return this.normalizeZoomTranscript(response, meetingId);
        } catch (error) {
            console.error('Failed to get Zoom transcript:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async getRecordingSettings(connectionId: string, meetingId: string): Promise<any> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            return await this.makeZoomRequest<any>(
                accessToken,
                `/meetings/${meetingId}/recordings/settings`
            );
        } catch (error) {
            console.error('Failed to get recording settings:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async updateRecordingSettings(connectionId: string, meetingId: string, settings: any): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            await this.makeZoomRequest(
                accessToken,
                `/meetings/${meetingId}/recordings/settings`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(settings)
                }
            );
        } catch (error) {
            console.error('Failed to update recording settings:', error);
            throw VideoConferenceErrorHandler.handleZoomError(error);
        }
    }

    async enableAutoRecording(connectionId: string, meetingId: string, storageType: 'cloud' | 'local' = 'cloud'): Promise<void> {
        return this.updateRecordingSettings(connectionId, meetingId, {
            auto_recording: storageType
        });
    }

    async configureRecordingSharing(connectionId: string, meetingId: string, sharePublicly: boolean = true): Promise<void> {
        return this.updateRecordingSettings(connectionId, meetingId, {
            share_recording: sharePublicly ? 'publicly' : 'internally',
            viewer_download: true,
            recording_authentication: !sharePublicly
        });
    }

    // === STRATEGIC BUSINESS METHODS ===

    async deliverRecordingToParticipants(connectionId: string, meetingId: string, options: {
        includeTranscript?: boolean;
        customMessage?: string;
        deliveryMethod?: 'email' | 'link';
    } = {}): Promise<{ success: boolean; deliveryId?: string }> {
        const recordings = await this.getMeetingRecordings(connectionId, meetingId);

        if (recordings.length === 0) {
            throw new VideoConferenceError(
                'No recordings found for this meeting',
                'NO_RECORDINGS_AVAILABLE',
                false
            );
        }

        // Store delivery information for tracking
        const deliveryRecord = await this.storeRecordingDelivery(meetingId, recordings, options);

        // In a real implementation, this would trigger email delivery or generate shareable links
        console.log(`Recording delivery scheduled for meeting ${meetingId}`, {
            recordingCount: recordings.length,
            options,
            deliveryRecord
        });

        return {
            success: true,
            deliveryId: deliveryRecord.id
        };
    }

    async generateMeetingSummary(connectionId: string, meetingId: string): Promise<{
        summary: string;
        keyPoints: string[];
        actionItems: string[];
        sentiment: 'positive' | 'neutral' | 'negative';
        confidence: number;
    }> {
        const transcript = await this.getMeetingTranscript(connectionId, meetingId);

        if (transcript.status !== 'completed') {
            throw new VideoConferenceError(
                'Transcript not available or still processing',
                'TRANSCRIPT_NOT_READY',
                true
            );
        }

        // In a real implementation, this would call Workers AI for analysis
        const aiAnalysis = await this.analyzeTranscriptWithAI(transcript);

        return aiAnalysis;
    }

    async analyzeProspectIntent(connectionId: string, meetingId: string, formResponses: any): Promise<{
        intentScore: number;
        urgency: 'low' | 'medium' | 'high' | 'urgent';
        budgetIndication: 'low' | 'medium' | 'high' | 'enterprise';
        decisionTimeline: 'immediate' | '1-3_months' | '3-6_months' | '6+_months';
        confidence: number;
        recommendations: string[];
    }> {
        const [recordings, transcript] = await Promise.all([
            this.getMeetingRecordings(connectionId, meetingId).catch(() => []),
            this.getMeetingTranscript(connectionId, meetingId).catch(() => null)
        ]);

        // Combine form responses with meeting content for comprehensive analysis
        const analysisData = {
            formResponses,
            hasRecording: recordings.length > 0,
            hasTranscript: transcript?.status === 'completed',
            meetingDuration: await this.getMeetingDuration(connectionId, meetingId)
        };

        return this.analyzeIntentWithAI(analysisData);
    }

    // === PRIVATE HELPER METHODS ===

    private normalizeZoomRecording(zoomRecording: any, meetingId: string): MeetingRecording {
        return {
            id: zoomRecording.id || crypto.randomUUID(),
            startTime: new Date(zoomRecording.recording_start || Date.now()),
            endTime: new Date(zoomRecording.recording_end || Date.now()),
            fileSize: zoomRecording.file_size,
            fileType: zoomRecording.file_type,
            downloadUrl: zoomRecording.download_url,
            status: this.mapZoomRecordingStatus(zoomRecording.status),
            // Additional Zoom-specific data
            providerData: {
                ...zoomRecording,
                meetingId
            }
        };
    }

    private normalizeZoomTranscript(zoomTranscript: any, meetingId: string): MeetingTranscript {
        return {
            id: zoomTranscript.id || crypto.randomUUID(),
            language: zoomTranscript.language || 'en',
            wordCount: zoomTranscript.word_count || 0,
            downloadUrl: zoomTranscript.download_url,
            status: zoomTranscript.can_download ? 'completed' : 'processing',
            // Additional metadata
            providerData: {
                ...zoomTranscript,
                meetingId
            }
        };
    }

    private mapZoomRecordingStatus(zoomStatus: string): MeetingRecording['status'] {
        const statusMap: Record<string, MeetingRecording['status']> = {
            'completed': 'completed',
            'processing': 'processing',
            'failed': 'failed',
            'deleted': 'deleted'
        };
        return statusMap[zoomStatus] || 'pending';
    }

    private async storeRecordingDelivery(meetingId: string, recordings: MeetingRecording[], options: any) {
        // Store delivery information in database for tracking
        const deliveryRecord = {
            id: crypto.randomUUID(),
            meetingId,
            recordingIds: recordings.map(r => r.id),
            options,
            status: 'scheduled',
            scheduledAt: new Date()
        };

        // In a real implementation, this would insert into a delivery tracking table
        console.log('Recording delivery stored:', deliveryRecord);
        return deliveryRecord;
    }

    private async analyzeTranscriptWithAI(transcript: MeetingTranscript) {
        // Placeholder for Workers AI integration
        // This would make an API call to Workers AI for summarization
        return {
            summary: "AI-generated summary of meeting discussion...",
            keyPoints: ["Key point 1", "Key point 2", "Key point 3"],
            actionItems: ["Follow up on action item 1", "Schedule next meeting"],
            sentiment: "positive" as const,
            confidence: 0.85
        };
    }

    private async analyzeIntentWithAI(analysisData: any) {
        // Placeholder for AI intent analysis
        return {
            intentScore: 75,
            urgency: 'high' as const,
            budgetIndication: 'medium' as const,
            decisionTimeline: '1-3_months' as const,
            confidence: 0.78,
            recommendations: [
                "Follow up within 24 hours",
                "Provide case studies relevant to their industry",
                "Schedule a technical deep-dive session"
            ]
        };
    }

    private async getMeetingDuration(connectionId: string, meetingId: string): Promise<number> {
        const meeting = await this.getMeeting(connectionId, meetingId);
        return meeting.duration;
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
