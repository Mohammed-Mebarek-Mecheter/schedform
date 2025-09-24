// src/lib/calendar/providers/outlook/outlook-calendar-service.ts
import type {CalendarService, CalendarEvent, OutlookCalendarConfig} from '../../types';
import { Client } from '@microsoft/microsoft-graph-client';
import type {AuthenticationProvider} from '@microsoft/microsoft-graph-client';
import {db} from "@/db";
import {calendarConnections, externalCalendarEvents, outlookSubscriptions} from "@/db/schema";
import {eq} from "drizzle-orm";

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type?: string;
    scope?: string;
}

// Custom auth provider for Microsoft Graph
class CustomAuthProvider implements AuthenticationProvider {
    constructor(private accessToken: string) {}

    async getAccessToken(): Promise<string> {
        return this.accessToken;
    }
}

export class OutlookCalendarService implements CalendarService {
    private graphClient: Client | null = null;

    constructor(private config: OutlookCalendarConfig) {}

    private async getGraphClient(connectionId: string): Promise<Client> {
        const connection = await this.getConnection(connectionId);
        const authProvider = new CustomAuthProvider(connection.accessToken);

        return Client.initWithMiddleware({
            authProvider: authProvider
        });
    }

    async validateConnection(connectionId: string): Promise<boolean> {
        try {
            const graphClient = await this.getGraphClient(connectionId);

            // Test with a simple API call
            await graphClient.api('/me/calendars').top(1).get();
            return true;
        } catch (error) {
            console.error('Outlook Calendar connection validation failed:', error);
            return false;
        }
    }

    async refreshTokens(connectionId: string): Promise<void> {
        const connection = await this.getConnectionTokens(connectionId);

        try {
            // Microsoft Graph token refresh
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
                throw new Error(`Token refresh failed: ${response.statusText}`);
            }

            const tokens: TokenResponse = await response.json();

            // Update tokens in database
            await db.update(calendarConnections)
                .set({
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token || connection.refreshToken,
                    tokenExpiresAt: new Date(Date.now() + (tokens.expires_in * 1000)),
                    updatedAt: new Date(),
                })
                .where(eq(calendarConnections.id, connectionId));

        } catch (error) {
            console.error('Outlook token refresh failed:', error);
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
        const graphClient = await this.getGraphClient(params.connectionId);
        const connection = await this.getConnection(params.connectionId);

        try {
            let apiCall;

            if (params.syncToken) {
                // Use delta link for incremental sync
                // For Outlook, syncToken should be the deltaLink URL
                apiCall = graphClient.api(params.syncToken);
            } else {
                // Build fresh query for delta sync
                apiCall = graphClient.api(`/me/calendars/${connection.calendarId}/events/delta`);

                // Add filters for initial delta query
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

                if (params.maxResults) {
                    apiCall = apiCall.top(params.maxResults);
                }
            }

            const response = await apiCall.get();

            const events = response.value?.map(this.normalizeOutlookEvent) || [];

            return {
                events,
                nextSyncToken: response['@odata.deltaLink'], // Outlook's delta link for next sync
                nextPageToken: response['@odata.nextLink'],
            };
        } catch (error) {
            console.error('Failed to list Outlook Calendar events:', error);
            throw error;
        }
    }

    async createEvent(connectionId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const graphClient = await this.getGraphClient(connectionId);
        const connection = await this.getConnection(connectionId);

        const outlookEvent = this.convertToOutlookEvent(event);

        try {
            const response = await graphClient
                .api(`/me/calendars/${connection.calendarId}/events`)
                .post(outlookEvent);

            return this.normalizeOutlookEvent(response);
        } catch (error) {
            console.error('Failed to create Outlook Calendar event:', error);
            throw error;
        }
    }

    async updateEvent(connectionId: string, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent> {
        const graphClient = await this.getGraphClient(connectionId);
        const connection = await this.getConnection(connectionId);

        const outlookUpdates = this.convertToOutlookEvent(updates);

        try {
            const response = await graphClient
                .api(`/me/calendars/${connection.calendarId}/events/${eventId}`)
                .patch(outlookUpdates);

            return this.normalizeOutlookEvent(response);
        } catch (error) {
            console.error('Failed to update Outlook Calendar event:', error);
            throw error;
        }
    }

    async deleteEvent(connectionId: string, eventId: string): Promise<void> {
        const graphClient = await this.getGraphClient(connectionId);
        const connection = await this.getConnection(connectionId);

        try {
            await graphClient
                .api(`/me/calendars/${connection.calendarId}/events/${eventId}`)
                .delete();
        } catch (error) {
            console.error('Failed to delete Outlook Calendar event:', error);
            throw error;
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
        const graphClient = await this.getGraphClient(params.connectionId);
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
                busy: schedule.busyViewInterval.map((interval: string, index: number) => {
                    if (interval !== '0') { // '0' means free, other values indicate busy
                        const startTime = new Date(params.timeMin.getTime() + (index * 60 * 60 * 1000));
                        const endTime = new Date(startTime.getTime() + (60 * 60 * 1000));
                        return { start: startTime, end: endTime };
                    }
                    return null;
                }).filter(Boolean),
                errors: schedule.errors || []
            }));
        } catch (error) {
            console.error('Failed to get Outlook free/busy info:', error);
            throw error;
        }
    }

    async setupWebhook(connectionId: string, notificationUrl: string): Promise<{
        webhookId: string;
        expirationTime: Date;
    }> {
        const graphClient = await this.getGraphClient(connectionId);
        const connection = await this.getConnection(connectionId);

        const subscriptionId = `subscription-${connectionId}-${Date.now()}`;
        const expirationTime = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)); // 3 days max for Outlook

        try {
            const subscription = await graphClient.api('/subscriptions').post({
                changeType: 'created,updated,deleted',
                notificationUrl: notificationUrl,
                resource: `/me/calendars/${connection.calendarId}/events`,
                expirationDateTime: expirationTime.toISOString(),
                clientState: subscriptionId, // For verification
            });

            // Store subscription info in Outlook-specific table
            await db.insert(outlookSubscriptions).values({
                id: subscriptionId,
                calendarConnectionId: connectionId,
                subscriptionId: subscription.id,
                resource: subscription.resource,
                changeType: subscription.changeType,
                notificationUrl: notificationUrl,
                clientState: subscriptionId,
                expirationDateTime: expirationTime,
            });

            return {
                webhookId: subscription.id,
                expirationTime: expirationTime,
            };
        } catch (error) {
            console.error('Failed to setup Outlook Calendar webhook:', error);
            throw error;
        }
    }

    async removeWebhook(connectionId: string, webhookId: string): Promise<void> {
        const graphClient = await this.getGraphClient(connectionId);

        try {
            await graphClient.api(`/subscriptions/${webhookId}`).delete();

            // Remove from our database
            await db.delete(outlookSubscriptions)
                .where(eq(outlookSubscriptions.subscriptionId, webhookId));

        } catch (error) {
            console.error('Failed to remove Outlook webhook:', error);
            throw error;
        }
    }

    async performFullSync(connectionId: string): Promise<void> {
        // Clear existing sync token to force full sync
        await db.update(calendarConnections)
            .set({
                lastSyncToken: null,
                updatedAt: new Date()
            })
            .where(eq(calendarConnections.id, connectionId));

        // Perform full sync
        const result = await this.listEvents({
            connectionId,
            maxResults: 1000, // Outlook's default limit
        });

        // Store events in external events table
        await this.storeExternalEvents(connectionId, result.events);

        // Update sync token for future incremental syncs
        if (result.nextSyncToken) {
            await db.update(calendarConnections)
                .set({
                    lastSyncToken: result.nextSyncToken,
                    updatedAt: new Date()
                })
                .where(eq(calendarConnections.id, connectionId));
        }
    }

    async performIncrementalSync(connectionId: string): Promise<void> {
        const connection = await this.getConnection(connectionId);

        if (!connection.lastSyncToken) {
            // No sync token available, perform full sync
            return this.performFullSync(connectionId);
        }

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
                    updatedAt: new Date()
                })
                .where(eq(calendarConnections.id, connectionId));
        }
    }

    // Helper methods
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

    private normalizeOutlookEvent(outlookEvent: any): CalendarEvent {
        // Convert Outlook event to universal format
        return {
            id: outlookEvent.id,
            title: outlookEvent.subject || 'Untitled',
            description: outlookEvent.body?.content,
            location: outlookEvent.location?.displayName,

            startTime: new Date(outlookEvent.start.dateTime),
            endTime: new Date(outlookEvent.end.dateTime),
            timeZone: outlookEvent.start.timeZone || 'UTC',
            isAllDay: outlookEvent.isAllDay || false,

            status: this.normalizeOutlookStatus(outlookEvent.responseStatus?.response),
            showAs: this.normalizeOutlookShowAs(outlookEvent.showAs),

            organizer: outlookEvent.organizer ? {
                email: outlookEvent.organizer.emailAddress?.address,
                name: outlookEvent.organizer.emailAddress?.name,
            } : undefined,

            attendees: outlookEvent.attendees?.map((attendee: any) => ({
                email: attendee.emailAddress.address,
                name: attendee.emailAddress.name,
                responseStatus: this.normalizeResponseStatus(attendee.status?.response),
            })),

            recurrence: outlookEvent.recurrence ? {
                rule: this.convertOutlookRecurrenceToRRule(outlookEvent.recurrence),
            } : undefined,

            providerData: outlookEvent,
        };
    }

    private convertToOutlookEvent(event: Partial<CalendarEvent>): any {
        // Convert universal format to Outlook event
        return {
            subject: event.title,
            body: event.description ? {
                contentType: 'text',
                content: event.description
            } : undefined,
            location: event.location ? {
                displayName: event.location
            } : undefined,

            start: {
                dateTime: event.startTime?.toISOString(),
                timeZone: event.timeZone || 'UTC',
            },
            end: {
                dateTime: event.endTime?.toISOString(),
                timeZone: event.timeZone || 'UTC',
            },

            isAllDay: event.isAllDay,
            showAs: this.convertShowAsToOutlook(event.showAs),

            attendees: event.attendees?.map(attendee => ({
                emailAddress: {
                    address: attendee.email,
                    name: attendee.name,
                },
                type: 'required',
            })),

            recurrence: event.recurrence ?
                this.convertRRuleToOutlookRecurrence(event.recurrence.rule) : undefined,
        };
    }

    private normalizeOutlookStatus(status: string): 'confirmed' | 'tentative' | 'cancelled' {
        switch (status?.toLowerCase()) {
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

    private normalizeResponseStatus(status: string): 'accepted' | 'declined' | 'tentative' | 'needsAction' {
        switch (status?.toLowerCase()) {
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
        // Convert Outlook recurrence pattern to RRULE format
        // This is a simplified conversion - full implementation would be more complex
        const pattern = recurrence.pattern;
        let rrule = 'RRULE:';

        switch (pattern.type) {
            case 'daily':
                rrule += `FREQ=DAILY;INTERVAL=${pattern.interval}`;
                break;
            case 'weekly':
                rrule += `FREQ=WEEKLY;INTERVAL=${pattern.interval}`;
                if (pattern.daysOfWeek?.length > 0) {
                    const days = pattern.daysOfWeek.map(this.convertOutlookDayToRRule).join(',');
                    rrule += `;BYDAY=${days}`;
                }
                break;
            case 'absoluteMonthly':
                rrule += `FREQ=MONTHLY;INTERVAL=${pattern.interval};BYMONTHDAY=${pattern.dayOfMonth}`;
                break;
            case 'relativeMonthly':
                rrule += `FREQ=MONTHLY;INTERVAL=${pattern.interval}`;
                break;
            case 'absoluteYearly':
                rrule += `FREQ=YEARLY;INTERVAL=${pattern.interval};BYMONTH=${pattern.month};BYMONTHDAY=${pattern.dayOfMonth}`;
                break;
        }

        return rrule;
    }

    private convertRRuleToOutlookRecurrence(rrule: string): any {
        // Convert RRULE to Outlook recurrence pattern
        // This is a simplified conversion - full implementation would be more complex
        // You would parse the RRULE and convert to Outlook's format
        throw new Error('RRULE to Outlook recurrence conversion not implemented');
    }

    private convertOutlookDayToRRule(day: string): string {
        const dayMap: { [key: string]: string } = {
            'sunday': 'SU',
            'monday': 'MO',
            'tuesday': 'TU',
            'wednesday': 'WE',
            'thursday': 'TH',
            'friday': 'FR',
            'saturday': 'SA'
        };
        return dayMap[day.toLowerCase()] || day;
    }

    private async storeExternalEvents(connectionId: string, events: CalendarEvent[]): Promise<void> {
        // Implementation for storing events in externalCalendarEvents table
        for (const event of events) {
            await db.insert(externalCalendarEvents)
                .values({
                    calendarConnectionId: connectionId,
                    providerEventId: event.id,
                    providerCalendarId: 'primary', // or get from connection
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
                })
                .onConflictDoUpdate({
                    target: [externalCalendarEvents.calendarConnectionId, externalCalendarEvents.providerEventId],
                    set: {
                        title: event.title,
                        description: event.description,
                        startTime: event.startTime,
                        endTime: event.endTime,
                        updatedAt: new Date(),
                    }
                });
        }
    }

    private async processIncrementalChanges(connectionId: string, events: CalendarEvent[]): Promise<void> {
        // Similar to storeExternalEvents but handles deletions differently
        await this.storeExternalEvents(connectionId, events);
    }
}
