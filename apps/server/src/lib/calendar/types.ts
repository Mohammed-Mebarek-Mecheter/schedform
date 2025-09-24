// src/lib/calendar/types.ts
import { z } from 'zod';

// Universal calendar event structure (normalized from both providers)
export const CalendarEventSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    location: z.string().optional(),

    startTime: z.date(),
    endTime: z.date(),
    timeZone: z.string(),
    isAllDay: z.boolean().default(false),

    status: z.enum(['confirmed', 'tentative', 'cancelled']),
    showAs: z.enum(['busy', 'free', 'tentative', 'outOfOffice']),

    organizer: z.object({
        email: z.email(),
        name: z.string().optional(),
    }).optional(),

    attendees: z.array(z.object({
        email: z.email(),
        name: z.string().optional(),
        responseStatus: z.enum(['accepted', 'declined', 'tentative', 'needsAction']).optional(),
    })).optional(),

    recurrence: z.object({
        rule: z.string(),
        instances: z.array(z.date()).optional(),
    }).optional(),

    // Store provider-specific data here if needed
    providerData: z.record(z.string(), z.unknown()).optional(),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// Universal service interface
export interface CalendarService {
    // Connection management
    validateConnection(connectionId: string): Promise<boolean>;
    refreshTokens(connectionId: string): Promise<void>;

    // Event management
    listEvents(params: {
        connectionId: string;
        timeMin?: Date;
        timeMax?: Date;
        maxResults?: number;
        syncToken?: string;
    }): Promise<{
        events: CalendarEvent[];
        nextSyncToken?: string;
        nextPageToken?: string;
    }>;

    createEvent(connectionId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
    updateEvent(connectionId: string, eventId: string, updates: Partial<CalendarEvent>): Promise<CalendarEvent>;
    deleteEvent(connectionId: string, eventId: string): Promise<void>;

    // Free/busy checking
    getFreeBusyInfo(params: {
        connectionId: string;
        timeMin: Date;
        timeMax: Date;
        calendars?: string[];
    }): Promise<{
        calendar: string;
        busy: Array<{ start: Date; end: Date }>;
        errors: Array<{ domain: string; reason: string }>;
    }[]>;

    // Webhook management
    setupWebhook(connectionId: string, notificationUrl: string): Promise<{
        webhookId: string;
        expirationTime: Date;
    }>;
    removeWebhook(connectionId: string, webhookId: string): Promise<void>;

    // Sync operations
    performFullSync(connectionId: string): Promise<void>;
    performIncrementalSync(connectionId: string): Promise<void>;
}

// Provider-specific configurations
export interface GoogleCalendarConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
}

export interface OutlookCalendarConfig {
    clientId: string;
    clientSecret: string;
    tenantId?: string;
    redirectUri: string;
    scopes: string[];
}

// Factory configuration
export type CalendarProviderConfig =
    | { provider: 'google'; config: GoogleCalendarConfig }
    | { provider: 'outlook'; config: OutlookCalendarConfig };

