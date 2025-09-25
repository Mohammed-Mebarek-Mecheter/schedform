// src/lib/calendar/providers/google/google-calendar-service.ts
import type {CalendarService, CalendarEvent, GoogleCalendarConfig} from '../../types';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {db} from "@/db";
import {calendarConnections, externalCalendarEvents} from "@/db/schema";
import {and, eq, sql} from "drizzle-orm";
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

    private async ensureValidToken(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);

        // Check if token is expired or about to expire (within 5 minutes)
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

            // Test with a simple API call
            await this.calendar.calendarList.list({ maxResults: 1 });
            return true;
        } catch (error) {
            console.error('Google Calendar connection validation failed:', error);
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

            // Update tokens in database
            await db.update(calendarConnections)
                .set({
                    accessToken: credentials.access_token!,
                    refreshToken: credentials.refresh_token || connection.refreshToken,
                    tokenExpiresAt: new Date(credentials.expiry_date!),
                    updatedAt: new Date(),
                    consecutiveFailures: 0,
                    lastError: null,
                })
                .where(eq(calendarConnections.id, connectionId));

        } catch (error) {
            console.error('Token refresh failed:', error);
            await this.handleTokenRefreshError(connectionId, error);
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
        await this.ensureValidToken(params.connectionId);
        const connection = await this.getConnection(params.connectionId);

        try {
            const requestParams: any = {
                calendarId: connection.calendarId,
                maxResults: params.maxResults || 250,
                singleEvents: true,
                orderBy: 'startTime',
            };

            if (params.syncToken) {
                requestParams.syncToken = params.syncToken;
            } else {
                if (params.timeMin) requestParams.timeMin = params.timeMin.toISOString();
                if (params.timeMax) requestParams.timeMax = params.timeMax.toISOString();
            }

            const response = await this.calendar.events.list(requestParams);

            const events = response.data.items?.map((event: any) => this.normalizeGoogleEvent(event)) || [];

            return {
                events,
                nextSyncToken: response.data.nextSyncToken,
                nextPageToken: response.data.nextPageToken,
            };
        } catch (error: any) {
            if (error.code === 410) { // Sync token is invalid
                // Retry without sync token
                return this.listEvents({
                    ...params,
                    syncToken: undefined
                });
            }
            console.error('Failed to list Google Calendar events:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async createEvent(connectionId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        await this.ensureValidToken(connectionId);
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
            throw this.normalizeGoogleError(error);
        }
    }

    async updateEvent(connectionId: string, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
        await this.ensureValidToken(connectionId);
        const connection = await this.getConnection(connectionId);

        const googleEvent = this.convertToGoogleEvent(updates);

        try {
            const response = await this.calendar.events.update({
                calendarId: connection.calendarId,
                eventId: eventId,
                resource: googleEvent,
            });

            return this.normalizeGoogleEvent(response.data);
        } catch (error) {
            console.error('Failed to update Google Calendar event:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async deleteEvent(connectionId: string, eventId: string): Promise<void> {
        await this.ensureValidToken(connectionId);
        const connection = await this.getConnection(connectionId);

        try {
            await this.calendar.events.delete({
                calendarId: connection.calendarId,
                eventId: eventId,
            });
        } catch (error) {
            console.error('Failed to delete Google Calendar event:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async getFreeBusyInfo(params: {
        connectionId: string;
        timeMin: Date;
        timeMax: Date;
        calendars?: string[];
    }): Promise<{
        calendar: string;
        busy: Array<{ start: Date; end: Date }>;
        errors: Array<{ domain: string; reason: string }>;
    }[]> {
        await this.ensureValidToken(params.connectionId);
        const connection = await this.getConnection(params.connectionId);

        const calendarsToCheck = params.calendars || [connection.calendarId];

        try {
            const response = await this.calendar.freebusy.query({
                resource: {
                    timeMin: params.timeMin.toISOString(),
                    timeMax: params.timeMax.toISOString(),
                    items: calendarsToCheck.map(calendarId => ({ id: calendarId })),
                },
            });

            return Object.entries(response.data.calendars || {}).map(([calendarId, calendarData]: [string, any]) => ({
                calendar: calendarId,
                busy: (calendarData.busy || []).map((busySlot: any) => ({
                    start: new Date(busySlot.start),
                    end: new Date(busySlot.end),
                })),
                errors: calendarData.errors || [],
            }));
        } catch (error) {
            console.error('Failed to get Google free/busy info:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async setupWebhook(connectionId: string, notificationUrl: string): Promise<{
        webhookId: string;
        expirationTime: Date;
    }> {
        await this.ensureValidToken(connectionId);
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
                    expiration: expiration.getTime(),
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
            throw this.normalizeGoogleError(error);
        }
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            // Stop the channel
            await this.calendar.channels.stop({
                resource: {
                    id: webhookId,
                    resourceId: webhookId, // We need to get this from our database
                },
            });

            // Remove from our database
            await db.delete(googleWebhookChannels)
                .where(eq(googleWebhookChannels.channelId, webhookId));

        } catch (error) {
            console.error('Failed to remove Google webhook:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async performFullSync(connectionId: string): Promise<void> {
        await this.ensureValidToken(connectionId);

        try {
            // Clear existing sync token to force full sync
            await db.update(calendarConnections)
                .set({
                    lastSyncToken: null,
                    updatedAt: new Date()
                })
                .where(eq(calendarConnections.id, connectionId));

            // Perform full sync with a reasonable time range (e.g., next 6 months)
            const timeMin = new Date();
            const timeMax = new Date();
            timeMax.setMonth(timeMax.getMonth() + 6);

            const result = await this.listEvents({
                connectionId,
                timeMin,
                timeMax,
                maxResults: 2500, // Google's maximum
            });

            // Store events in external events table
            await this.storeExternalEvents(connectionId, result.events);

            // Update sync token for future incremental syncs
            if (result.nextSyncToken) {
                await db.update(calendarConnections)
                    .set({
                        lastSyncToken: result.nextSyncToken,
                        lastFullSyncAt: new Date(),
                        updatedAt: new Date()
                    })
                    .where(eq(calendarConnections.id, connectionId));
            }
        } catch (error) {
            console.error('Failed to perform full sync:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    async performIncrementalSync(connectionId: string): Promise<void> {
        await this.ensureValidToken(connectionId);
        const connection = await this.getConnection(connectionId);

        if (!connection.lastSyncToken) {
            // No sync token available, perform full sync
            return this.performFullSync(connectionId);
        }

        try {
            const result = await this.listEvents({
                connectionId,
                syncToken: connection.lastSyncToken,
            });

            // Process incremental changes
            await this.processIncrementalChanges(connectionId, result.events);

            // Update sync token
            if (result.nextSyncToken) {
                await db.update(calendarConnections)
                    .set({
                        lastSyncToken: result.nextSyncToken,
                        lastIncrementalSyncAt: new Date(),
                        updatedAt: new Date()
                    })
                    .where(eq(calendarConnections.id, connectionId));
            }
        } catch (error) {
            console.error('Failed to perform incremental sync:', error);
            throw this.normalizeGoogleError(error);
        }
    }

    // Helper methods
    private async handleConnectionError(connectionId: string, error: any): Promise<void> {
        await db.update(calendarConnections)
            .set({
                consecutiveFailures: sql`${calendarConnections.consecutiveFailures} + 1`,
                lastError: error.message,
                updatedAt: new Date(),
            })
            .where(eq(calendarConnections.id, connectionId));
    }

    private async handleTokenRefreshError(connectionId: string, error: any): Promise<void> {
        await db.update(calendarConnections)
            .set({
                consecutiveFailures: sql`${calendarConnections.consecutiveFailures} + 1`,
                lastError: `Token refresh failed: ${error.message}`,
                isActive: false, // Deactivate connection if token refresh fails
                updatedAt: new Date(),
            })
            .where(eq(calendarConnections.id, connectionId));
    }

    private normalizeGoogleError(error: any): Error {
        if (error.code === 401) {
            return new Error('Authentication failed - please reconnect your calendar');
        } else if (error.code === 403) {
            return new Error('Calendar access denied - check permissions');
        } else if (error.code === 404) {
            return new Error('Calendar or event not found');
        } else if (error.code === 429) {
            return new Error('Rate limit exceeded - please try again later');
        } else if (error.code >= 500) {
            return new Error('Google Calendar service unavailable - please try again later');
        }
        return error;
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

    private normalizeGoogleEvent(googleEvent: any): CalendarEvent {
        return {
            id: googleEvent.id,
            title: googleEvent.summary || 'Untitled',
            description: googleEvent.description,
            location: googleEvent.location,

            startTime: new Date(googleEvent.start.dateTime || googleEvent.start.date + 'T00:00:00'),
            endTime: new Date(googleEvent.end.dateTime || googleEvent.end.date + 'T23:59:59'),
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
                responseStatus: this.normalizeAttendeeStatus(attendee.responseStatus),
            })),

            recurrence: googleEvent.recurrence ? {
                rule: googleEvent.recurrence[0],
            } : undefined,

            providerData: googleEvent,
        };
    }

    private convertToGoogleEvent(event: Partial<CalendarEvent>): any {
        const googleEvent: any = {
            summary: event.title,
            description: event.description,
            location: event.location,
        };

        if (event.startTime && event.endTime) {
            if (event.isAllDay) {
                googleEvent.start = { date: this.formatDateForAllDay(event.startTime) };
                googleEvent.end = { date: this.formatDateForAllDay(event.endTime) };
            } else {
                googleEvent.start = {
                    dateTime: event.startTime.toISOString(),
                    timeZone: event.timeZone || 'UTC',
                };
                googleEvent.end = {
                    dateTime: event.endTime.toISOString(),
                    timeZone: event.timeZone || 'UTC',
                };
            }
        }

        if (event.status) googleEvent.status = event.status;
        if (event.showAs) googleEvent.transparency = event.showAs === 'free' ? 'transparent' : 'opaque';

        if (event.attendees) {
            googleEvent.attendees = event.attendees.map(attendee => ({
                email: attendee.email,
                displayName: attendee.name,
            }));
        }

        if (event.recurrence) {
            googleEvent.recurrence = [event.recurrence.rule];
        }

        return googleEvent;
    }

    private formatDateForAllDay(date: Date): string {
        return date.toISOString().split('T')[0];
    }

    private normalizeGoogleStatus(status: string): 'confirmed' | 'tentative' | 'cancelled' {
        switch (status) {
            case 'confirmed': return 'confirmed';
            case 'tentative': return 'tentative';
            case 'cancelled': return 'cancelled';
            default: return 'confirmed';
        }
    }

    private normalizeAttendeeStatus(status: string): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
        switch (status) {
            case 'accepted': return 'accepted';
            case 'declined': return 'declined';
            case 'tentative': return 'tentative';
            case 'needsAction': return 'needsAction';
            default: return 'needsAction';
        }
    }

    private async storeExternalEvents(connectionId: string, events: CalendarEvent[]): Promise<void> {
        const externalEvents = events.map(event => ({
            calendarConnectionId: connectionId,
            providerEventId: event.id,
            providerCalendarId: 'primary',
            title: event.title,
            description: event.description,
            location: event.location,
            startTime: event.startTime,
            endTime: event.endTime,
            timeZone: event.timeZone,
            isAllDay: event.isAllDay,
            status: event.status,
            showAs: event.showAs,
            organizerEmail: event.organizer?.email,
            organizerName: event.organizer?.name,
            attendeeEmails: event.attendees?.map(a => a.email) || [],
            isRecurring: !!event.recurrence,
            recurrenceRule: event.recurrence?.rule,
            providerData: event.providerData,
            lastSyncedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        for (const eventData of externalEvents) {
            await db.insert(externalCalendarEvents)
                .values(eventData)
                .onConflictDoUpdate({
                    target: [externalCalendarEvents.calendarConnectionId, externalCalendarEvents.providerEventId],
                    set: {
                        title: eventData.title,
                        description: eventData.description,
                        startTime: eventData.startTime,
                        endTime: eventData.endTime,
                        status: eventData.status,
                        showAs: eventData.showAs,
                        updatedAt: new Date(),
                        lastSyncedAt: new Date(),
                    }
                });
        }
    }

    private async processIncrementalChanges(connectionId: string, events: CalendarEvent[]): Promise<void> {
        // For Google, events with status 'cancelled' should be deleted
        const activeEvents = events.filter(event => event.status !== 'cancelled');
        const cancelledEvents = events.filter(event => event.status === 'cancelled');

        // Store active events
        await this.storeExternalEvents(connectionId, activeEvents);

        // Delete cancelled events
        for (const event of cancelledEvents) {
            await db.delete(externalCalendarEvents)
                .where(
                    and(
                        eq(externalCalendarEvents.providerEventId, event.id),
                        eq(externalCalendarEvents.calendarConnectionId, connectionId)
                    )
                );
        }
    }
}
