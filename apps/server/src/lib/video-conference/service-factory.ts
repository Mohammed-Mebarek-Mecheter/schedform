// src/lib/video-conference/service-factory.ts
import type { VideoConferenceService, VideoProviderConfig } from './types';
import { ZoomVideoService } from './providers/zoom/zoom-service';
import { GoogleMeetVideoService } from './providers/google-meet/google-meet-service';
import { videoConferenceConnections } from '@/db/schema/video-conference-core';
import { db } from '@/db';
import { eq } from 'drizzle-orm';

export class VideoConferenceServiceFactory {
    private static instances: Map<string, VideoConferenceService> = new Map();

    static create(config: VideoProviderConfig): VideoConferenceService {
        const key = `${config.provider}:${JSON.stringify(config.config)}`;

        if (!this.instances.has(key)) {
            let service: VideoConferenceService;

            if (config.provider === 'zoom') {
                service = new ZoomVideoService(config.config);
            } else if (config.provider === 'google_meet') {
                service = new GoogleMeetVideoService(config.config);
            } else {
                throw new Error(`Unsupported video provider: ${(config as any).provider}`);
            }

            this.instances.set(key, service);
        }

        return this.instances.get(key)!;
    }

    static async createFromConnection(connectionId: string): Promise<VideoConferenceService> {
        const connection = await db.select()
            .from(videoConferenceConnections)
            .where(eq(videoConferenceConnections.id, connectionId))
            .limit(1);

        if (connection.length === 0) {
            throw new Error(`Video connection not found: ${connectionId}`);
        }

        const conn = connection[0];
        const config = this.getProviderConfig(conn.provider, conn.providerConfig);

        return this.create({ provider: conn.provider, config });
    }

    private static getProviderConfig(provider: string, providerConfig: any) {
        switch (provider) {
            case 'zoom':
                return {
                    clientId: process.env.ZOOM_CLIENT_ID!,
                    clientSecret: process.env.ZOOM_CLIENT_SECRET!,
                    redirectUri: process.env.ZOOM_REDIRECT_URI!,
                    scopes: ['meeting:write', 'meeting:read', 'recording:read'],
                    ...providerConfig,
                };
            case 'google_meet':
                return {
                    clientId: process.env.GOOGLE_MEET_CLIENT_ID!,
                    clientSecret: process.env.GOOGLE_MEET_CLIENT_SECRET!,
                    redirectUri: process.env.GOOGLE_MEET_REDIRECT_URI!,
                    scopes: [
                        'https://www.googleapis.com/auth/meetings.space.created',
                        'https://www.googleapis.com/auth/meetings.space.readonly',
                    ],
                    ...providerConfig,
                };
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }
}
