// src/lib/video-conference/providers/google-meet/google-meet-service.ts
import type { VideoConferenceService, VideoMeeting, MeetingParticipant, MeetingRecording, MeetingTranscript, GoogleMeetConfig } from '../../types';
import { google, meet_v2 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@/db';
import { videoConferenceConnections, googleMeetConfigs } from '@/db/schema/video-conference-core';
import { eq, sql } from 'drizzle-orm';
import { VideoConferenceError, VideoConferenceErrorHandler } from '../../error-handler';

export class GoogleMeetVideoService implements VideoConferenceService {
    private auth: OAuth2Client;
    private meet: meet_v2.Meet;

    constructor(private config: GoogleMeetConfig) {
        this.auth = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret,
            config.redirectUri
        );
        this.meet = google.meet({ version: 'v2', auth: this.auth });
    }

    private async ensureValidToken(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);

        if (connection.tokenExpiresAt && new Date(connection.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
            await this.refreshTokens(connectionId);
        }
    }

    async validateConnection(connectionId: string): Promise<boolean> {
        try {
            await this.ensureValidToken(connectionId);
            const connection = await this.getConnection(connectionId);

            this.auth.setCredentials({
                access_token: connection.accessToken,
                refresh_token: connection.refreshToken,
            });

            return true;
        } catch (error) {
            console.error('Google Meet connection validation failed:', error);
            await this.handleConnectionError(connectionId, error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
        }
    }

    async refreshTokens(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);
        this.auth.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
        });

        try {
            const { credentials } = await this.auth.refreshAccessToken();

            await db.update(videoConferenceConnections)
                .set({
                    accessToken: credentials.access_token!,
                    refreshToken: credentials.refresh_token || connection.refreshToken,
                    tokenExpiresAt: new Date(credentials.expiry_date!),
                    consecutiveFailures: 0,
                    lastError: null,
                    updatedAt: new Date(),
                })
                .where(eq(videoConferenceConnections.id, connectionId));

        } catch (error) {
            console.error('Token refresh failed:', error);
            await this.handleTokenRefreshError(connectionId, error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
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
        await this.ensureValidToken(params.connectionId);

        try {
            // Create a meeting space - Google Meet spaces don't have titles in API
            const spaceResponse = await this.meet.spaces.create({
                requestBody: {
                    config: {
                        accessType: params.settings?.accessType || 'PUBLIC',
                    }
                }
            });

            const space = spaceResponse.data;

            // Store Google Meet specific config
            await db.insert(googleMeetConfigs).values({
                videoConnectionId: params.connectionId,
                spaceId: space.name!.replace('spaces/', ''),
                meetingCode: space.meetingCode!,
                accessType: params.settings?.accessType || 'PUBLIC',
                recordingEnabled: params.settings?.autoRecord || false,
                transcriptionEnabled: params.settings?.autoTranscribe || false,
                moderationEnabled: params.settings?.moderationEnabled || false,
                createdAt: new Date(),
            });

            return this.normalizeGoogleMeetSpace(space, params);
        } catch (error) {
            console.error('Failed to create Google Meet:', error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
        }
    }

    async updateMeeting(connectionId: string, meetingId: string, updates: Partial<VideoMeeting>): Promise<VideoMeeting> {
        await this.ensureValidToken(connectionId);

        try {
            const updateMask: string[] = [];
            const requestBody: any = {};

            if (updates.settings) {
                requestBody.config = {
                    accessType: updates.settings.waitingRoom ? 'PRIVATE' : 'PUBLIC',
                };
                updateMask.push('config.accessType');
            }

            const response = await this.meet.spaces.patch({
                name: `spaces/${meetingId}`,
                requestBody,
                updateMask: updateMask.join(','),
            });

            // Update our config
            if (updates.settings) {
                const updateData: any = {
                    accessType: updates.settings.waitingRoom ? 'PRIVATE' : 'PUBLIC',
                    updatedAt: new Date(),
                };

                await db.update(googleMeetConfigs)
                    .set(updateData)
                    .where(eq(googleMeetConfigs.spaceId, meetingId));
            }

            return this.normalizeGoogleMeetSpace(response.data, updates);
        } catch (error) {
            console.error('Failed to update Google Meet:', error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
        }
    }

    async deleteMeeting(connectionId: string, meetingId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            // Google Meet spaces don't need to be deleted, just remove from our DB
            await db.delete(googleMeetConfigs)
                .where(eq(googleMeetConfigs.spaceId, meetingId));

        } catch (error) {
            console.error('Failed to delete Google Meet:', error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
        }
    }

    async getMeeting(connectionId: string, meetingId: string): Promise<VideoMeeting> {
        await this.ensureValidToken(connectionId);

        try {
            const response = await this.meet.spaces.get({
                name: `spaces/${meetingId}`,
            });

            // Get our stored config for additional info
            const config = await db.select()
                .from(googleMeetConfigs)
                .where(eq(googleMeetConfigs.spaceId, meetingId))
                .limit(1);

            return this.normalizeGoogleMeetSpace(response.data, {}, config[0]);
        } catch (error) {
            console.error('Failed to get Google Meet:', error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
        }
    }

    async setupWebhook(connectionId: string, options: any): Promise<{ webhookId: string; expirationTime: Date }> {
        // Google Meet uses Google Cloud Pub/Sub for notifications - complex setup
        throw new VideoConferenceError(
            'Google Meet webhooks require Google Cloud Pub/Sub setup',
            'NOT_IMPLEMENTED',
            false
        );
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        throw new VideoConferenceError(
            'Google Meet webhooks require Google Cloud Pub/Sub setup',
            'NOT_IMPLEMENTED',
            false
        );
    }

    async startMeeting(connectionId: string, meetingId: string): Promise<void> {
        // Google Meet spaces are always available - no explicit start needed
        console.log(`Google Meet space ${meetingId} is ready`);
    }

    async endMeeting(connectionId: string, meetingId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            await this.meet.spaces.endActiveConference({
                name: `spaces/${meetingId}`,
            });
        } catch (error) {
            console.error('Failed to end Google Meet:', error);
            throw VideoConferenceErrorHandler.handleGoogleMeetError(error);
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

    private normalizeGoogleMeetSpace(space: any, params: any, config?: any): VideoMeeting {
        const startTime = params.startTime || new Date();
        const duration = params.duration || 60;

        return {
            id: space.name!.replace('spaces/', ''),
            title: params.title || 'Google Meet Space',
            description: params.agenda,
            agenda: params.agenda,
            startTime: startTime,
            endTime: new Date(startTime.getTime() + duration * 60000),
            timeZone: params.timeZone || 'UTC',
            duration: duration,
            joinUrl: space.meetingUri!,
            meetingCode: space.meetingCode!,
            settings: {
                isRecurring: false,
                waitingRoom: config?.accessType === 'PRIVATE' || false,
                muteOnEntry: false, // Not configurable via API
                autoRecord: config?.recordingEnabled || false,
                autoTranscribe: config?.transcriptionEnabled || false,
            },
            providerData: space,
        };
    }
}
