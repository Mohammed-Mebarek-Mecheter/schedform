// src/lib/video-conference/providers/google-meet/google-meet-service.ts
import type { VideoConferenceService, VideoMeeting, MeetingParticipant, MeetingRecording, MeetingTranscript, GoogleMeetConfig } from '../../types';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@/db';
import { videoConferenceConnections, googleMeetConfigs } from '@/db/schema/video-conference-core';
import {and, eq, sql} from 'drizzle-orm';

export class GoogleMeetVideoService implements VideoConferenceService {
    private auth: OAuth2Client;
    private meet: any;

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

            // Test with spaces API
            await this.meet.spaces.list();
            return true;
        } catch (error) {
            console.error('Google Meet connection validation failed:', error);
            await this.handleConnectionError(connectionId, error);
            return false;
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
            throw new Error('Failed to refresh Google Meet tokens');
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
            // Create a meeting space
            const spaceResponse = await this.meet.spaces.create({
                requestBody: {
                    config: {
                        accessType: params.settings?.accessType || 'PUBLIC',
                        moderation: {
                            enabled: params.settings?.moderationEnabled || false,
                        },
                        artifactConfig: {
                            recordingConfig: { enabled: params.settings?.autoRecord || false },
                            transcriptionConfig: { enabled: params.settings?.autoTranscribe || false }
                        }
                    }
                }
            });

            const space = spaceResponse.data;

            // Store Google Meet specific config
            await db.insert(googleMeetConfigs).values({
                videoConnectionId: params.connectionId,
                spaceId: space.name!,
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
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async updateMeeting(connectionId: string, meetingId: string, updates: Partial<VideoMeeting>): Promise<VideoMeeting> {
        await this.ensureValidToken(connectionId);

        try {
            const updateMask: string[] = [];
            const requestBody: any = {};

            if (updates.title) {
                // Note: Google Meet spaces don't have a title field in the same way
                // We would store this in our database instead
            }

            if (updates.settings) {
                requestBody.config = {
                    // Map waitingRoom to entryPoints.allowJoinBeforeHost for Google Meet
                    entryPoints: {
                        allowJoinBeforeHost: !updates.settings.waitingRoom
                    },
                    // Map muteOnEntry to audioConfig.muteOnEntry
                    audioConfig: {
                        muteOnEntry: updates.settings.muteOnEntry
                    },
                    // Map autoRecord and autoTranscribe to artifactConfig
                    artifactConfig: {
                        recordingConfig: { enabled: updates.settings.autoRecord },
                        transcriptionConfig: { enabled: updates.settings.autoTranscribe }
                    }
                };
                updateMask.push('config');
            }

            const response = await this.meet.spaces.patch({
                name: meetingId,
                requestBody,
                updateMask: updateMask.join(','),
            });

            // Update our config with only the settings that exist in the VideoMeeting interface
            if (updates.settings) {
                const updateData: any = {
                    recordingEnabled: updates.settings.autoRecord,
                    transcriptionEnabled: updates.settings.autoTranscribe,
                    updatedAt: new Date(),
                };

                // Only include these fields if they exist in the settings
                if ('waitingRoom' in updates.settings) {
                    updateData.waitingRoom = updates.settings.waitingRoom;
                }
                if ('muteOnEntry' in updates.settings) {
                    updateData.muteOnEntry = updates.settings.muteOnEntry;
                }
                if ('maxParticipants' in updates.settings) {
                    updateData.maxParticipants = updates.settings.maxParticipants;
                }

                await db.update(googleMeetConfigs)
                    .set(updateData)
                    .where(eq(googleMeetConfigs.spaceId, meetingId));
            }

            return this.normalizeGoogleMeetSpace(response.data, updates);
        } catch (error) {
            console.error('Failed to update Google Meet:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async deleteMeeting(connectionId: string, meetingId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            // End active conference if running
            await this.meet.spaces.endActiveConference({
                name: meetingId,
            });

            // Delete from our config
            await db.delete(googleMeetConfigs)
                .where(eq(googleMeetConfigs.spaceId, meetingId));

        } catch (error) {
            console.error('Failed to delete Google Meet:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async getMeeting(connectionId: string, meetingId: string): Promise<VideoMeeting> {
        await this.ensureValidToken(connectionId);

        try {
            const response = await this.meet.spaces.get({
                name: meetingId,
            });

            // Get our stored config for additional info
            const config = await db.select()
                .from(googleMeetConfigs)
                .where(eq(googleMeetConfigs.spaceId, meetingId))
                .limit(1);

            return this.normalizeGoogleMeetSpace(response.data, {}, config[0]);
        } catch (error) {
            console.error('Failed to get Google Meet:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async listParticipants(connectionId: string, meetingId: string): Promise<MeetingParticipant[]> {
        await this.ensureValidToken(connectionId);

        try {
            // Google Meet participants are accessed through conference records
            const conferences = await this.meet.conferenceRecords.list({
                filter: `space="${meetingId}"`,
            });

            if (!conferences.data.conferenceRecords?.length) {
                return [];
            }

            const conferenceId = conferences.data.conferenceRecords[0].name!.split('/').pop();
            const participants = await this.meet.conferenceRecords.participants.list({
                parent: `conferenceRecords/${conferenceId}`,
            });

            return participants.data.participants?.map((participant: any) => ({
                id: participant.name!,
                email: participant.email!,
                name: participant.displayName || 'Unknown',
                role: participant.role === 'HOST' ? 'host' : 'attendee',
                joinTime: new Date(participant.startTime!),
                leaveTime: participant.endTime ? new Date(participant.endTime) : undefined,
                duration: participant.duration || 0,
            })) || [];
        } catch (error) {
            console.error('Failed to list Google Meet participants:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async listRecordings(connectionId: string, meetingId: string): Promise<MeetingRecording[]> {
        await this.ensureValidToken(connectionId);

        try {
            const conferences = await this.meet.conferenceRecords.list({
                filter: `space="${meetingId}"`,
            });

            if (!conferences.data.conferenceRecords?.length) {
                return [];
            }

            const conferenceId = conferences.data.conferenceRecords[0].name!.split('/').pop();
            const recordings = await this.meet.conferenceRecords.recordings.list({
                parent: `conferenceRecords/${conferenceId}`,
            });

            return recordings.data.recordings?.map((recording: any) => ({
                id: recording.name!,
                startTime: new Date(recording.startTime!),
                endTime: new Date(recording.endTime!),
                fileSize: recording.fileSize || 0,
                fileType: recording.format || 'mp4',
                downloadUrl: recording.driveDestination?.exportUri,
                status: recording.state === 'COMPLETED' ? 'completed' : 'processing',
            })) || [];
        } catch (error) {
            console.error('Failed to list Google Meet recordings:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async listTranscripts(connectionId: string, meetingId: string): Promise<MeetingTranscript[]> {
        await this.ensureValidToken(connectionId);

        try {
            const conferences = await this.meet.conferenceRecords.list({
                filter: `space="${meetingId}"`,
            });

            if (!conferences.data.conferenceRecords?.length) {
                return [];
            }

            const conferenceId = conferences.data.conferenceRecords[0].name!.split('/').pop();
            const transcripts = await this.meet.conferenceRecords.transcripts.list({
                parent: `conferenceRecords/${conferenceId}`,
            });

            return transcripts.data.transcripts?.map((transcript: any) => ({
                id: transcript.name!,
                language: transcript.languageCode || 'en',
                wordCount: transcript.wordCount || 0,
                downloadUrl: transcript.docsDestination?.exportUri,
                status: transcript.state === 'COMPLETED' ? 'completed' : 'processing',
            })) || [];
        } catch (error) {
            console.error('Failed to list Google Meet transcripts:', error);
            throw this.normalizeGoogleMeetError(error);
        }
    }

    async setupWebhook(connectionId: string, options: any): Promise<{ webhookId: string; expirationTime: Date }> {
        // Google Meet uses Google Cloud Pub/Sub for notifications
        // This is more complex and would require separate implementation
        throw new Error('Google Meet webhooks require Google Cloud Pub/Sub setup');
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        throw new Error('Google Meet webhooks require Google Cloud Pub/Sub setup');
    }

    async startMeeting(connectionId: string, meetingId: string): Promise<void> {
        // Google Meet spaces are always available - no explicit start needed
        console.log(`Google Meet space ${meetingId} is ready`);
    }

    async endMeeting(connectionId: string, meetingId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            await this.meet.spaces.endActiveConference({
                name: meetingId,
            });
        } catch (error) {
            console.error('Failed to end Google Meet:', error);
            throw this.normalizeGoogleMeetError(error);
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

    private normalizeGoogleMeetSpace(space: any, params: any, config?: any): VideoMeeting {
        const startTime = params.startTime || new Date();
        const duration = params.duration || 60;

        return {
            id: space.name!,
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
                isRecurring: false, // Default to false as Google Meet spaces are not recurring by default
                waitingRoom: config?.waitingRoom || false,
                muteOnEntry: config?.muteOnEntry || false,
                autoRecord: config?.recordingEnabled || false,
                autoTranscribe: config?.transcriptionEnabled || false,
                ...(config?.maxParticipants && { maxParticipants: config.maxParticipants })
            },
            providerData: space,
        };
    }

    private normalizeGoogleMeetError(error: any): Error {
        if (error.code === 401) {
            return new Error('Authentication failed - please reconnect your Google Meet account');
        } else if (error.code === 403) {
            return new Error('Google Meet access denied - check permissions');
        } else if (error.code === 404) {
            return new Error('Meeting space not found');
        } else if (error.code === 429) {
            return new Error('Google Meet rate limit exceeded - please try again later');
        }
        return error;
    }
}
