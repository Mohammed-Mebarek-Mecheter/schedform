// src/lib/calendar/providers/google/google-calendar-service.ts
import type {CalendarService, CalendarEvent, GoogleCalendarConfig} from '../../types';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {db} from "@/db";
import {calendarConnections} from "@/db/schema";
import {eq} from "drizzle-orm";
import {googleWebhookChannels} from "@/db/schema/calendar-core";

export class GoogleCalendarService implements CalendarService {
    private auth: OAuth2Client;
    private calendar: any;

    constructor(private config: GoogleCalendarConfig) {
        this.auth = new google.auth.OAuth2(
            config.clientId,
            config.clientSecret,
            config.redirectUri
        );
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
    }

    async validateConnection(connectionId: string): Promise<boolean> {
        try {
            const connection = await this.getConnectionTokens(connectionId);
            this.auth.setCredentials({
                access_token: connection.accessToken,
                refresh_token: connection.refreshToken,
            });

            // Test with a simple API call
            await this.calendar.calendarList.list({ maxResults: 1 });
            return true;
        } catch (error) {
            console.error('Google Calendar connection validation failed:', error);
            return false;
        }
    }

    async refreshTokens(connectionId: string): Promise<void> {
        const connection = await this.getConnectionTokens(connectionId);
        this.auth.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
        });

        try {
            const { credentials } = await this.auth.refreshAccessToken();

            // Update tokens in database
            await db.update(calendarConnections)
                .set({
                    accessToken: credentials.access_token!,
                    tokenExpiresAt: new Date(credentials.expiry_date!),
                    updatedAt: new Date(),
                })
                .where(eq(calendarConnections.id, connectionId));

        } catch (error) {
            console.error('Token refresh failed:', error);
            throw new Error('Failed to refresh Google Calendar tokens');
        }
    }

    async listEvents(params: {
        connectionId: string;
        timeMin?: Date;
        timeMax?: Date;
        maxResults?: number;
        syncToken?: string;
    }): Promise<{
        events: CalendarEvent[];
        nextSyncToken?: string;
        nextPageToken?: string;
    }> {
        await this.setupAuth(params.connectionId);
        const connection = await this.getConnection(params.connectionId);

        try {
            const response = await this.calendar.events.list({
                calendarId: connection.calendarId,
                timeMin: params.timeMin?.toISOString(),
                timeMax: params.timeMax?.toISOString(),
                maxResults: params.maxResults || 250,
                syncToken: params.syncToken,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const events = response.data.items?.map(this.normalizeGoogleEvent) || [];

            return {
                events,
                nextSyncToken: response.data.nextSyncToken,
                nextPageToken: response.data.nextPageToken,
            };
        } catch (error) {
            console.error('Failed to list Google Calendar events:', error);
            throw error;
        }
    }

    async createEvent(connectionId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        await this.setupAuth(connectionId);
        const connection = await this.getConnection(connectionId);

        const googleEvent = this.convertToGoogleEvent(event);

        try {
            const response = await this.calendar.events.insert({
                calendarId: connection.calendarId,
                resource: googleEvent,
            });

            return this.normalizeGoogleEvent(response.data);
        } catch (error) {
            console.error('Failed to create Google Calendar event:', error);
            throw error;
        }
    }

    async setupWebhook(connectionId: string, notificationUrl: string): Promise<{
        webhookId: string;
        expirationTime: Date;
    }> {
        await this.setupAuth(connectionId);
        const connection = await this.getConnection(connectionId);

        const channelId = `webhook-${connectionId}-${Date.now()}`;
        const expiration = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)); // 7 days

        try {
            const response = await this.calendar.events.watch({
                calendarId: connection.calendarId,
                resource: {
                    id: channelId,
                    type: 'web_hook',
                    address: notificationUrl,
                    expiration: expiration.getTime().toString(),
                },
            });

            // Store webhook info in Google-specific table
            await db.insert(googleWebhookChannels).values({
                id: channelId,
                calendarConnectionId: connectionId,
                channelId: channelId,
                resourceId: response.data.resourceId!,
                resourceUri: response.data.resourceUri!,
                address: notificationUrl,
                expiration: expiration,
            });

            return {
                webhookId: channelId,
                expirationTime: expiration,
            };
        } catch (error) {
            console.error('Failed to setup Google Calendar webhook:', error);
            throw error;
        }
    }

    // Helper methods
    private async setupAuth(connectionId: string): Promise<void> {
        const connection = await this.getConnectionTokens(connectionId);
        this.auth.setCredentials({
            access_token: connection.accessToken,
            refresh_token: connection.refreshToken,
        });
    }

    private async getConnection(connectionId: string) {
        const result = await db.select()
            .from(calendarConnections)
            .where(eq(calendarConnections.id, connectionId))
            .limit(1);

        if (result.length === 0) {
            throw new Error(`Calendar connection not found: ${connectionId}`);
        }

        return result[0];
    }

    private async getConnectionTokens(connectionId: string) {
        const connection = await this.getConnection(connectionId);
        return {
            accessToken: connection.accessToken,
            refreshToken: connection.refreshToken,
        };
    }

    private normalizeGoogleEvent(googleEvent: any): CalendarEvent {
        // Convert Google Calendar event to universal format
        return {
            id: googleEvent.id,
            title: googleEvent.summary || 'Untitled',
            description: googleEvent.description,
            location: googleEvent.location,

            startTime: new Date(googleEvent.start.dateTime || googleEvent.start.date),
            endTime: new Date(googleEvent.end.dateTime || googleEvent.end.date),
            timeZone: googleEvent.start.timeZone || 'UTC',
            isAllDay: !!googleEvent.start.date,

            status: this.normalizeGoogleStatus(googleEvent.status),
            showAs: googleEvent.transparency === 'transparent' ? 'free' : 'busy',

            organizer: googleEvent.organizer ? {
                email: googleEvent.organizer.email,
                name: googleEvent.organizer.displayName,
            } : undefined,

            attendees: googleEvent.attendees?.map((attendee: any) => ({
                email: attendee.email,
                name: attendee.displayName,
                responseStatus: attendee.responseStatus,
            })),

            recurrence: googleEvent.recurrence ? {
                rule: googleEvent.recurrence[0],
            } : undefined,

            providerData: googleEvent,
        };
    }

    private convertToGoogleEvent(event: Partial<CalendarEvent>): any {
        // Convert universal format to Google Calendar event
        return {
            summary: event.title,
            description: event.description,
            location: event.location,

            start: {
                dateTime: event.startTime?.toISOString(),
                timeZone: event.timeZone,
            },
            end: {
                dateTime: event.endTime?.toISOString(),
                timeZone: event.timeZone,
            },

            status: event.status,
            transparency: event.showAs === 'free' ? 'transparent' : 'opaque',

            attendees: event.attendees?.map(attendee => ({
                email: attendee.email,
                displayName: attendee.name,
            })),

            recurrence: event.recurrence ? [event.recurrence.rule] : undefined,
        };
    }

    private normalizeGoogleStatus(status: string): 'confirmed' | 'tentative' | 'cancelled' {
        switch (status) {
            case 'confirmed': return 'confirmed';
            case 'tentative': return 'tentative';
            case 'cancelled': return 'cancelled';
            default: return 'confirmed';
        }
    }

    // Implement other CalendarService methods...
    async updateEvent(connectionId: string, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
        // Implementation for updating events
        throw new Error('Method not implemented');
    }

    async deleteEvent(connectionId: string, eventId: string): Promise<void> {
        // Implementation for deleting events
        throw new Error('Method not implemented');
    }

    async getFreeBusyInfo(): Promise<any> {
        // Implementation for free/busy queries
        throw new Error('Method not implemented');
    }

    async removeWebhook(): Promise<void> {
        // Implementation for removing webhooks
        throw new Error('Method not implemented');
    }

    async performFullSync(): Promise<void> {
        // Implementation for full sync
        throw new Error('Method not implemented');
    }

    async performIncrementalSync(): Promise<void> {
        // Implementation for incremental sync
        throw new Error('Method not implemented');
    }
}
