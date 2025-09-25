// src/lib/calendar/providers/outlook/outlook-calendar-service.ts
import type {CalendarService, CalendarEvent, OutlookCalendarConfig} from '../../types';
import { Client } from '@microsoft/microsoft-graph-client';
import {db} from "@/db";
import {calendarConnections, externalCalendarEvents, outlookSubscriptions} from "@/db/schema/calendar-core";
import {and, eq, sql} from "drizzle-orm";

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
}

export class OutlookCalendarService implements CalendarService {
    constructor(private config: OutlookCalendarConfig) {}

    private async ensureValidToken(connectionId: string): Promise<string> {
        const connection = await this.getConnection(connectionId);

        // Check if token is expired or about to expire (within 5 minutes)
        if (connection.tokenExpiresAt && new Date(connection.tokenExpiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
            await this.refreshTokens(connectionId);
            // Get the updated connection
            const updatedConnection = await this.getConnection(connectionId);
            return updatedConnection.accessToken;
        }

        return connection.accessToken;
    }

    private async getGraphClient(accessToken: string): Promise<Client> {
        const authProvider = {
            getAccessToken: async () => accessToken
        };

        return Client.initWithMiddleware({
            authProvider: authProvider
        });
    }

    async validateConnection(connectionId: string): Promise<boolean> {
        try {
            const accessToken = await this.ensureValidToken(connectionId);
            const graphClient = await this.getGraphClient(accessToken);

            // Test with a simple API call
            await graphClient.api('/me').get();
            return true;
        } catch (error) {
            console.error('Outlook Calendar connection validation failed:', error);
            await this.handleConnectionError(connectionId, error);
            return false;
        }
    }

    async refreshTokens(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);

        try {
            const tokenEndpoint = this.config.tenantId
                ? `https://login.microsoftonline.com/${this.config.tenantId}/oauth2/v2.0/token`
                : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    refresh_token: connection.refreshToken!,
                    grant_type: 'refresh_token',
                    scope: this.config.scopes.join(' '),
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const tokens: TokenResponse = await response.json();

            // Update tokens in database
            await db.update(calendarConnections)
                .set({
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token || connection.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                    consecutiveFailures: 0,
                    lastError: null,
                    updatedAt: new Date(),
                })
                .where(eq(calendarConnections.id, connectionId));

        } catch (error) {
            console.error('Outlook token refresh failed:', error);
            await this.handleTokenRefreshError(connectionId, error);
            throw new Error('Failed to refresh Outlook Calendar tokens');
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
        const accessToken = await this.ensureValidToken(params.connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(params.connectionId);

        try {
            let apiCall;
            let isDeltaQuery = false;

            if (params.syncToken && params.syncToken.includes('delta')) {
                // Use delta link for incremental sync
                isDeltaQuery = true;
                apiCall = graphClient.api(params.syncToken);
            } else {
                // Build fresh query
                apiCall = graphClient.api(`/me/calendars/${connection.calendarId}/events`);

                // Add filters for time range
                if (params.timeMin || params.timeMax) {
                    const filters = [];
                    if (params.timeMin) {
                        filters.push(`start/dateTime ge '${params.timeMin.toISOString()}'`);
                    }
                    if (params.timeMax) {
                        filters.push(`end/dateTime le '${params.timeMax.toISOString()}'`);
                    }
                    if (filters.length > 0) {
                        apiCall = apiCall.filter(filters.join(' and '));
                    }
                }

                if (params.maxResults) {
                    apiCall = apiCall.top(params.maxResults);
                }

                // Order by start time
                apiCall = apiCall.orderby('start/dateTime');
            }

            const response = await apiCall.get();

            const events = response.value?.map((event: any) => this.normalizeOutlookEvent(event)) || [];

            return {
                events,
                nextSyncToken: isDeltaQuery ? response['@odata.deltaLink'] : undefined,
                nextPageToken: response['@odata.nextLink'],
            };
        } catch (error) {
            console.error('Failed to list Outlook Calendar events:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async createEvent(connectionId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const accessToken = await this.ensureValidToken(connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(connectionId);

        const outlookEvent = this.convertToOutlookEvent(event);

        try {
            const response = await graphClient
                .api(`/me/calendars/${connection.calendarId}/events`)
                .post(outlookEvent);

            return this.normalizeOutlookEvent(response);
        } catch (error) {
            console.error('Failed to create Outlook Calendar event:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async updateEvent(connectionId: string, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const accessToken = await this.ensureValidToken(connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(connectionId);

        const outlookUpdates = this.convertToOutlookEvent(updates);

        try {
            const response = await graphClient
                .api(`/me/calendars/${connection.calendarId}/events/${eventId}`)
                .patch(outlookUpdates);

            return this.normalizeOutlookEvent(response);
        } catch (error) {
            console.error('Failed to update Outlook Calendar event:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async deleteEvent(connectionId: string, eventId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(connectionId);

        try {
            await graphClient
                .api(`/me/calendars/${connection.calendarId}/events/${eventId}`)
                .delete();
        } catch (error) {
            console.error('Failed to delete Outlook Calendar event:', error);
            throw this.normalizeOutlookError(error);
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
        const accessToken = await this.ensureValidToken(params.connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(params.connectionId);

        const calendarsToCheck = params.calendars || [connection.calendarId];

        try {
            const response = await graphClient.api('/me/calendar/getSchedule').post({
                schedules: calendarsToCheck,
                startTime: {
                    dateTime: params.timeMin.toISOString(),
                    timeZone: 'UTC'
                },
                endTime: {
                    dateTime: params.timeMax.toISOString(),
                    timeZone: 'UTC'
                },
                availabilityViewInterval: 60
            });

            return response.value.map((schedule: any) => ({
                calendar: schedule.scheduleId,
                busy: schedule.scheduleItems?.map((item: any) => ({
                    start: new Date(item.start.dateTime),
                    end: new Date(item.end.dateTime),
                })) || [],
                errors: schedule.error ? [schedule.error] : []
            }));
        } catch (error) {
            console.error('Failed to get Outlook free/busy info:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async setupWebhook(connectionId: string, notificationUrl: string): Promise<{
        webhookId: string;
        expirationTime: Date;
    }> {
        const accessToken = await this.ensureValidToken(connectionId);
        const graphClient = await this.getGraphClient(accessToken);
        const connection = await this.getConnection(connectionId);

        const subscriptionId = `subscription-${connectionId}-${Date.now()}`;
        const expirationTime = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000)); // 2 days for Outlook

        try {
            const subscription = await graphClient.api('/subscriptions').post({
                changeType: 'created,updated,deleted',
                notificationUrl: notificationUrl,
                resource: `/me/calendars/${connection.calendarId}/events`,
                expirationDateTime: expirationTime.toISOString(),
                clientState: subscriptionId,
            });

            // Store subscription info
            await db.insert(outlookSubscriptions).values({
                id: subscriptionId,
                calendarConnectionId: connectionId,
                subscriptionId: subscription.id,
                resource: subscription.resource,
                changeType: subscription.changeType,
                notificationUrl: notificationUrl,
                clientState: subscriptionId,
                expirationDateTime: expirationTime,
                createdAt: new Date(),
            });

            return {
                webhookId: subscription.id,
                expirationTime: expirationTime,
            };
        } catch (error) {
            console.error('Failed to setup Outlook Calendar webhook:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);
        const graphClient = await this.getGraphClient(accessToken);

        try {
            await graphClient.api(`/subscriptions/${webhookId}`).delete();

            // Remove from our database
            await db.delete(outlookSubscriptions)
                .where(eq(outlookSubscriptions.subscriptionId, webhookId));

        } catch (error) {
            console.error('Failed to remove Outlook webhook:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async performFullSync(connectionId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);

        try {
            // Clear existing sync token to force full sync
            await db.update(calendarConnections)
                .set({
                    lastSyncToken: null,
                    updatedAt: new Date()
                })
                .where(eq(calendarConnections.id, connectionId));

            // Get delta token for full sync
            const graphClient = await this.getGraphClient(accessToken);
            const connection = await this.getConnection(connectionId);

            // Get initial delta token
            const deltaResponse = await graphClient
                .api(`/me/calendars/${connection.calendarId}/events/delta`)
                .top(100)
                .get();

            const events = deltaResponse.value?.map((event: any) => this.normalizeOutlookEvent(event)) || [];

            // Store events
            await this.storeExternalEvents(connectionId, events);

            // Update sync token
            if (deltaResponse['@odata.deltaLink']) {
                await db.update(calendarConnections)
                    .set({
                        lastSyncToken: deltaResponse['@odata.deltaLink'],
                        lastFullSyncAt: new Date(),
                        updatedAt: new Date()
                    })
                    .where(eq(calendarConnections.id, connectionId));
            }
        } catch (error) {
            console.error('Failed to perform full sync:', error);
            throw this.normalizeOutlookError(error);
        }
    }

    async performIncrementalSync(connectionId: string): Promise<void> {
        const accessToken = await this.ensureValidToken(connectionId);
        const connection = await this.getConnection(connectionId);

        if (!connection.lastSyncToken) {
            return this.performFullSync(connectionId);
        }

        try {
            const graphClient = await this.getGraphClient(accessToken);

            const deltaResponse = await graphClient
                .api(connection.lastSyncToken)
                .get();

            const events = deltaResponse.value?.map((event: any) => this.normalizeOutlookEvent(event)) || [];

            // Process changes (new, updated, deleted events)
            await this.processDeltaChanges(connectionId, events);

            // Update sync token
            if (deltaResponse['@odata.deltaLink']) {
                await db.update(calendarConnections)
                    .set({
                        lastSyncToken: deltaResponse['@odata.deltaLink'],
                        lastIncrementalSyncAt: new Date(),
                        updatedAt: new Date()
                    })
                    .where(eq(calendarConnections.id, connectionId));
            }
        } catch (error: any) {
            if (error.statusCode === 410) { // Delta token expired
                // Perform full sync
                await this.performFullSync(connectionId);
            } else {
                console.error('Failed to perform incremental sync:', error);
                throw this.normalizeOutlookError(error);
            }
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
                isActive: false,
                updatedAt: new Date(),
            })
            .where(eq(calendarConnections.id, connectionId));
    }

    private normalizeOutlookError(error: any): Error {
        if (error.statusCode === 401) {
            return new Error('Authentication failed - please reconnect your calendar');
        } else if (error.statusCode === 403) {
            return new Error('Calendar access denied - check permissions');
        } else if (error.statusCode === 404) {
            return new Error('Calendar or event not found');
        } else if (error.statusCode === 429) {
            return new Error('Rate limit exceeded - please try again later');
        } else if (error.statusCode >= 500) {
            return new Error('Outlook Calendar service unavailable - please try again later');
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

    private normalizeOutlookEvent(outlookEvent: any): CalendarEvent {
        return {
            id: outlookEvent.id,
            title: outlookEvent.subject || 'Untitled',
            description: outlookEvent.body?.content,
            location: outlookEvent.location?.displayName,

            startTime: new Date(outlookEvent.start.dateTime),
            endTime: new Date(outlookEvent.end.dateTime),
            timeZone: outlookEvent.start.timeZone || 'UTC',
            isAllDay: outlookEvent.isAllDay || false,

            status: this.normalizeOutlookStatus(outlookEvent.responseStatus),
            showAs: this.normalizeOutlookShowAs(outlookEvent.showAs),

            organizer: outlookEvent.organizer ? {
                email: outlookEvent.organizer.emailAddress?.address,
                name: outlookEvent.organizer.emailAddress?.name,
            } : undefined,

            attendees: outlookEvent.attendees?.map((attendee: any) => ({
                email: attendee.emailAddress.address,
                name: attendee.emailAddress.name,
                responseStatus: this.normalizeAttendeeStatus(attendee.status),
            })),

            recurrence: outlookEvent.recurrence ? {
                rule: this.convertOutlookRecurrenceToRRule(outlookEvent.recurrence),
            } : undefined,

            providerData: outlookEvent,
        };
    }

    private convertToOutlookEvent(event: Partial<CalendarEvent>): any {
        const outlookEvent: any = {
            subject: event.title,
            body: event.description ? {
                contentType: 'text',
                content: event.description
            } : undefined,
        };

        if (event.location) {
            outlookEvent.location = {
                displayName: event.location
            };
        }

        if (event.startTime && event.endTime) {
            outlookEvent.start = {
                dateTime: event.startTime.toISOString(),
                timeZone: event.timeZone || 'UTC',
            };
            outlookEvent.end = {
                dateTime: event.endTime.toISOString(),
                timeZone: event.timeZone || 'UTC',
            };
            outlookEvent.isAllDay = event.isAllDay || false;
        }

        if (event.showAs) {
            outlookEvent.showAs = this.convertShowAsToOutlook(event.showAs);
        }

        if (event.attendees) {
            outlookEvent.attendees = event.attendees.map(attendee => ({
                emailAddress: {
                    address: attendee.email,
                    name: attendee.name,
                },
                type: 'required',
            }));
        }

        return outlookEvent;
    }

    private normalizeOutlookStatus(status: any): 'confirmed' | 'tentative' | 'cancelled' {
        if (!status) return 'confirmed';

        const statusStr = typeof status === 'string' ? status : status.response;
        switch (statusStr?.toLowerCase()) {
            case 'accepted': return 'confirmed';
            case 'tentativelyaccepted': return 'tentative';
            case 'declined': return 'cancelled';
            default: return 'confirmed';
        }
    }

    private normalizeOutlookShowAs(showAs: string): 'busy' | 'free' | 'tentative' | 'outOfOffice' {
        switch (showAs?.toLowerCase()) {
            case 'free': return 'free';
            case 'tentative': return 'tentative';
            case 'busy': return 'busy';
            case 'oof': return 'outOfOffice';
            default: return 'busy';
        }
    }

    private normalizeAttendeeStatus(status: any): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
        if (!status) return 'needsAction';

        const statusStr = typeof status === 'string' ? status : status.response;
        switch (statusStr?.toLowerCase()) {
            case 'accepted': return 'accepted';
            case 'declined': return 'declined';
            case 'tentativelyaccepted': return 'tentative';
            case 'notresponded': return 'needsAction';
            default: return 'needsAction';
        }
    }

    private convertShowAsToOutlook(showAs?: string): string {
        switch (showAs) {
            case 'free': return 'free';
            case 'tentative': return 'tentative';
            case 'busy': return 'busy';
            case 'outOfOffice': return 'oof';
            default: return 'busy';
        }
    }

    private convertOutlookRecurrenceToRRule(recurrence: any): string {
        // Simplified conversion - in production, you'd want a more complete implementation
        const pattern = recurrence.pattern;
        const range = recurrence.range;

        let rrule = 'RRULE:';

        switch (pattern.type) {
            case 'daily':
                rrule += `FREQ=DAILY;INTERVAL=${pattern.interval || 1}`;
                break;
            case 'weekly':
                rrule += `FREQ=WEEKLY;INTERVAL=${pattern.interval || 1}`;
                if (pattern.daysOfWeek?.length > 0) {
                    rrule += `;BYDAY=${pattern.daysOfWeek.join(',')}`;
                }
                break;
            case 'absoluteMonthly':
                rrule += `FREQ=MONTHLY;INTERVAL=${pattern.interval || 1};BYMONTHDAY=${pattern.dayOfMonth}`;
                break;
            default:
                return 'RRULE:FREQ=DAILY;INTERVAL=1';
        }

        if (range.type === 'endDate') {
            rrule += `;UNTIL=${range.endDate}`;
        } else if (range.type === 'numbered') {
            rrule += `;COUNT=${range.numberOfOccurrences}`;
        }

        return rrule;
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

    private async processDeltaChanges(connectionId: string, events: any[]): Promise<void> {
        for (const event of events) {
            const normalizedEvent = this.normalizeOutlookEvent(event);

            if (event['@removed']) {
                // Event was deleted
                await db.delete(externalCalendarEvents)
                    .where(
                        and(
                            eq(externalCalendarEvents.providerEventId, event.id),
                            eq(externalCalendarEvents.calendarConnectionId, connectionId)
                        )
                    );
            } else {
                // Event was created or updated
                await this.storeExternalEvents(connectionId, [normalizedEvent]);
            }
        }
    }
}
