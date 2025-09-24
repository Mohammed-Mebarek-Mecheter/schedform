// src/lib/calendar/service-factory.ts
import type {CalendarService, CalendarProviderConfig} from './types';
import { GoogleCalendarService } from './providers/google/google-calendar-service';
import { OutlookCalendarService } from './providers/outlook/outlook-calendar-service';
import {calendarConnections} from "@/db/schema";
import {db} from "@/db";
import {eq} from "drizzle-orm";

export class CalendarServiceFactory {
    private static instances: Map<string, CalendarService> = new Map();

    static create(config: CalendarProviderConfig): CalendarService {
        const key = `${config.provider}:${JSON.stringify(config.config)}`;

        if (!this.instances.has(key)) {
            let service: CalendarService;

            // Use type narrowing with if statements
            if (config.provider === 'google') {
                service = new GoogleCalendarService(config.config);
            } else if (config.provider === 'outlook') {
                service = new OutlookCalendarService(config.config);
            } else {
                // This should never happen due to the discriminated union, but TypeScript needs it
                throw new Error(`Unsupported calendar provider: ${(config as any).provider}`);
            }

            this.instances.set(key, service);
        }

        return this.instances.get(key)!;
    }

    static async createFromConnection(connectionId: string): Promise<CalendarService> {
        // Fetch connection from database
        const connection = await db.select()
            .from(calendarConnections)
            .where(eq(calendarConnections.id, connectionId))
            .limit(1);

        if (connection.length === 0) {
            throw new Error(`Calendar connection not found: ${connectionId}`);
        }

        const conn = connection[0];
        const config = this.getProviderConfig(conn.provider, conn.providerConfig);

        return this.create({ provider: conn.provider, config });
    }

    private static getProviderConfig(provider: string, providerConfig: any) {
        // Extract provider-specific configuration
        switch (provider) {
            case 'google':
                return {
                    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
                    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
                    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI!,
                    scopes: ['https://www.googleapis.com/auth/calendar'],
                    ...providerConfig,
                };
            case 'outlook':
                return {
                    clientId: process.env.OUTLOOK_CALENDAR_CLIENT_ID!,
                    clientSecret: process.env.OUTLOOK_CALENDAR_CLIENT_SECRET!,
                    tenantId: process.env.OUTLOOK_TENANT_ID,
                    redirectUri: process.env.OUTLOOK_CALENDAR_REDIRECT_URI!,
                    scopes: ['https://graph.microsoft.com/calendars.readwrite'],
                    ...providerConfig,
                };
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }
}
