// src/db/schema/calendarIntegrations.ts
import {
    pgTable,
    text,
    timestamp,
    jsonb,
    boolean,
    index,
    integer,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bookings } from "./scheduling";
import {calendarConnections} from "@/db/schema/calendar-core";

// Migration note: This replaces the Google-specific columns in scheduling.ts
// with provider-agnostic equivalents that support both Google and Outlook

/**
 * Provider-agnostic calendar metadata table
 * Replaces the Google-specific googleCalendarMetadata table
 */
export const calendarProviderMetadata = pgTable(
    "calendar_provider_metadata",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Provider-specific metadata stored as JSON
        providerMetadata: jsonb("provider_metadata"), // Flexible storage for any provider's specific fields

        // Common sync tracking fields
        syncToken: text("sync_token"), // For incremental sync (Google) or deltaLink (Outlook)
        nextSyncToken: text("next_sync_token"),
        deltaLink: text("delta_link"), // Microsoft Graph delta tracking URL
        nextDeltaLink: text("next_delta_link"),

        // Calendar properties from provider API
        calendarSummary: text("calendar_summary"), // Google: summary, Outlook: name
        calendarDescription: text("calendar_description"),
        calendarTimeZone: text("calendar_time_zone"),
        calendarColor: text("calendar_color"), // Unified color field

        // API usage and quota tracking
        dailyQuotaUsed: integer("daily_quota_used").default(0),
        quotaResetTime: timestamp("quota_reset_time", { mode: "date" }),
        monthlyQuotaUsed: integer("monthly_quota_used").default(0), // Outlook has monthly limits

        // Watch/webhook channel management (both providers support this)
        watchChannelId: text("watch_channel_id"),
        watchChannelExpiration: timestamp("watch_channel_expiration", { mode: "date" }),
        watchChannelResourceUri: text("watch_channel_resource_uri"),

        // Conference/meeting integration capabilities
        supportedConferenceTypes: jsonb("supported_conference_types"),
        defaultConferenceSettings: jsonb("default_conference_settings"),

        // Provider-specific API endpoints and versions
        apiVersion: text("api_version"), // e.g., "v1.0" for Graph API, "v3" for Google
        apiBaseUrl: text("api_base_url"), // Store base URL for API calls

        // Sync status and error tracking
        lastSuccessfulSync: timestamp("last_successful_sync", { mode: "date" }),
        lastSyncError: text("last_sync_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxCalendarConnection: index("calendar_provider_metadata_connection_idx").on(t.calendarConnectionId),
        idxWatchExpiration: index("calendar_provider_watch_expiration_idx").on(t.watchChannelExpiration),
        idxSyncStatus: index("calendar_provider_sync_status_idx").on(t.lastSuccessfulSync, t.consecutiveFailures),
    })
);

/**
 * Unified webhook/watch channels table for all calendar providers
 */
export const calendarWebhookChannels = pgTable(
    "calendar_webhook_channels",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Provider-agnostic channel identification
        channelId: text("channel_id").notNull(),
        resourceId: text("resource_id"), // Google uses this, Outlook uses different tracking
        resourceUri: text("resource_uri").notNull(),
        subscriptionId: text("subscription_id"), // Microsoft Graph subscriptions

        // Webhook configuration
        notificationUrl: text("notification_url").notNull(), // Where notifications are sent
        webhookToken: text("webhook_token"), // Optional verification token
        expiration: timestamp("expiration", { mode: "date" }).notNull(),

        // Provider-specific settings
        changeTypes: jsonb("change_types"), // What changes to watch for
        clientState: text("client_state"), // Custom verification data
        lifecycleNotificationUrl: text("lifecycle_notification_url"), // For subscription lifecycle events

        // Status tracking
        isActive: boolean("is_active").notNull().default(true),
        lastNotification: timestamp("last_notification", { mode: "date" }),
        notificationCount: integer("notification_count").default(0),
        validationToken: text("validation_token"), // For initial webhook validation

        // Error tracking
        lastError: text("last_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("webhook_channels_connection_idx").on(t.calendarConnectionId),
        idxExpiration: index("webhook_channels_expiration_idx").on(t.expiration),
        uqChannel: uniqueIndex("webhook_channels_channel_uq").on(t.channelId),
        idxActive: index("webhook_channels_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
    })
);

/**
 * Conference data table supporting both Google Meet and Microsoft Teams
 */
export const bookingConferenceData = pgTable(
    "booking_conference_data",
    {
        id: text("id").primaryKey(),
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),

        // Provider-agnostic conference identification
        conferenceId: text("conference_id"),
        conferenceProvider: text("conference_provider").notNull(), // 'google_meet', 'teams', 'zoom', etc.
        conferenceSolutionType: text("conference_solution_type"), // Provider-specific type

        // Meeting join information
        joinUrl: text("join_url"),
        phoneNumbers: jsonb("phone_numbers"), // Array of dial-in numbers with regions
        conferencePin: text("conference_pin"),
        accessCode: text("access_code"),

        // Entry points (unified structure for all providers)
        entryPoints: jsonb("entry_points"), // [{type, uri, label, pin, accessCode, region}]

        // Provider-specific metadata
        providerMetadata: jsonb("provider_metadata"), // Flexible storage for provider-specific fields

        // Common conference settings
        recordingEnabled: boolean("recording_enabled").default(false),
        transcriptionEnabled: boolean("transcription_enabled").default(false),
        waitingRoomEnabled: boolean("waiting_room_enabled").default(false),

        // Microsoft Teams specific fields
        teamsJoinUrl: text("teams_join_url"),
        teamsThreadId: text("teams_thread_id"),
        onlineMeetingId: text("online_meeting_id"),

        // Google Meet specific fields
        hangoutLink: text("hangout_link"),
        meetCode: text("meet_code"),

        // Creation and management
        createRequest: jsonb("create_request"), // Original request data
        creationStatus: text("creation_status").default("pending"), // pending, created, failed
        errorMessage: text("error_message"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxBooking: index("conference_data_booking_idx").on(t.bookingId),
        idxConferenceId: index("conference_data_conf_id_idx").on(t.conferenceId),
        idxProvider: index("conference_data_provider_idx").on(t.conferenceProvider),
        uqBookingConference: uniqueIndex("conference_data_booking_uq").on(t.bookingId),
        chkProvider: sql`CHECK (${t.conferenceProvider} IN ('google_meet', 'teams', 'zoom', 'webex', 'custom'))`,
        chkStatus: sql`CHECK (${t.creationStatus} IN ('pending', 'created', 'failed', 'cancelled'))`,
    })
);

/**
 * Unified calendar sync logs supporting all providers
 */
export const calendarSyncLogs = pgTable(
    "calendar_sync_logs",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        syncType: text("sync_type").notNull(), // 'full', 'incremental', 'delta', 'webhook'
        syncDirection: text("sync_direction").notNull(), // 'inbound', 'outbound', 'bidirectional'
        provider: text("provider").notNull(), // 'google', 'outlook'

        // Sync timing
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }),
        timeMin: timestamp("time_min", { mode: "date" }),
        timeMax: timestamp("time_max", { mode: "date" }),

        // Sync tracking tokens
        syncTokenBefore: text("sync_token_before"),
        syncTokenAfter: text("sync_token_after"),
        deltaLinkBefore: text("delta_link_before"), // For Outlook
        deltaLinkAfter: text("delta_link_after"),

        // Results
        eventsProcessed: integer("events_processed").default(0),
        eventsCreated: integer("events_created").default(0),
        eventsUpdated: integer("events_updated").default(0),
        eventsDeleted: integer("events_deleted").default(0),

        // Status and errors
        status: text("status").notNull().default('pending'), // pending, completed, failed, partial
        errorMessage: text("error_message"),
        errorDetails: jsonb("error_details"),
        retryCount: integer("retry_count").default(0),

        // API usage tracking (different quotas for different providers)
        apiCallsMade: integer("api_calls_made").default(0),
        quotaUnitsUsed: integer("quota_units_used").default(0),
        rateLimitHits: integer("rate_limit_hits").default(0),

        // Provider-specific metrics
        providerMetrics: jsonb("provider_metrics"), // Flexible storage for provider-specific sync metrics

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnectionStatus: index("sync_logs_connection_status_idx").on(t.calendarConnectionId, t.status),
        idxSyncTime: index("sync_logs_time_idx").on(t.startTime),
        idxProvider: index("sync_logs_provider_idx").on(t.provider),
        idxStatus: index("sync_logs_status_idx").on(t.status, t.retryCount),
        chkProvider: sql`CHECK (${t.provider} IN ('google', 'outlook'))`,
        chkSyncType: sql`CHECK (${t.syncType} IN ('full', 'incremental', 'delta', 'webhook'))`,
        chkSyncDirection: sql`CHECK (${t.syncDirection} IN ('inbound', 'outbound', 'bidirectional'))`,
        chkStatus: sql`CHECK (${t.status} IN ('pending', 'completed', 'failed', 'partial'))`,
        chkCounts: sql`CHECK (${t.eventsProcessed} >= 0 AND ${t.eventsCreated} >= 0 AND ${t.eventsUpdated} >= 0 AND ${t.eventsDeleted} >= 0)`,
    })
);

/**
 * External calendar events cache for conflict detection
 * This helps prevent double-booking across different calendar systems
 */
export const externalCalendarEvents = pgTable(
    "external_calendar_events",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // External event identification
        externalEventId: text("external_event_id").notNull(),
        externalCalendarId: text("external_calendar_id").notNull(),
        etag: text("etag"), // For conflict detection and caching

        // Event details
        summary: text("summary"),
        description: text("description"),
        location: text("location"),

        // Timing
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),
        isAllDay: boolean("is_all_day").default(false),

        // Status and properties
        status: text("status"), // confirmed, tentative, cancelled
        transparency: text("transparency"), // opaque, transparent (affects free/busy)
        visibility: text("visibility"), // default, public, private

        // Recurrence
        isRecurring: boolean("is_recurring").default(false),
        recurrenceRule: text("recurrence_rule"),
        recurringEventId: text("recurring_event_id"),

        // Organizer and attendees
        organizerEmail: varchar("organizer_email", { length: 255 }),
        attendeeEmails: jsonb("attendee_emails"), // Array of attendee email addresses
        responseStatus: text("response_status"), // accepted, declined, tentative, needsAction

        // Provider-specific data
        providerData: jsonb("provider_data"), // Store full event object for reference

        // Sync tracking
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncVersion: text("sync_version"), // For change tracking

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqExternalEvent: uniqueIndex("external_events_external_uq").on(t.calendarConnectionId, t.externalEventId),
        idxTimeRange: index("external_events_time_range_idx").on(t.startTime, t.endTime),
        idxCalendarTime: index("external_events_calendar_time_idx").on(t.calendarConnectionId, t.startTime),
        idxStatus: index("external_events_status_idx").on(t.status, t.transparency),
        idxRecurrence: index("external_events_recurrence_idx").on(t.isRecurring, t.recurringEventId),
        idxSync: index("external_events_sync_idx").on(t.lastSyncedAt),
        chkTimeOrder: sql`CHECK (${t.startTime} <= ${t.endTime})`,
        chkStatus: sql`CHECK (${t.status} IN ('confirmed', 'tentative', 'cancelled') OR ${t.status} IS NULL)`,
        chkTransparency: sql`CHECK (${t.transparency} IN ('opaque', 'transparent') OR ${t.transparency} IS NULL)`,
        chkVisibility: sql`CHECK (${t.visibility} IN ('default', 'public', 'private') OR ${t.visibility} IS NULL)`,
    })
);

/**
 * OAuth token refresh log for monitoring token health across providers
 */
export const calendarTokenRefreshLog = pgTable(
    "calendar_token_refresh_log",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Refresh attempt details
        refreshAttemptedAt: timestamp("refresh_attempted_at", { mode: "date" }).notNull(),
        refreshSuccessful: boolean("refresh_successful").notNull(),

        // Token lifecycle
        oldTokenExpiresAt: timestamp("old_token_expires_at", { mode: "date" }),
        newTokenExpiresAt: timestamp("new_token_expires_at", { mode: "date" }),
        tokenLifetimeSeconds: integer("token_lifetime_seconds"), // How long the new token is valid

        // Error tracking
        errorCode: text("error_code"),
        errorMessage: text("error_message"),
        errorDetails: jsonb("error_details"),

        // Provider context
        provider: text("provider").notNull(),
        scopesGranted: jsonb("scopes_granted"), // What scopes the refreshed token has

        // Usage context
        triggeredBy: text("triggered_by"), // 'scheduled', 'api_call', 'webhook', 'manual'
        contextualInfo: jsonb("contextual_info"), // Additional context about why refresh was needed

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("token_refresh_log_connection_idx").on(t.calendarConnectionId),
        idxAttemptTime: index("token_refresh_log_attempt_idx").on(t.refreshAttemptedAt),
        idxSuccess: index("token_refresh_log_success_idx").on(t.refreshSuccessful, t.refreshAttemptedAt),
        idxProvider: index("token_refresh_log_provider_idx").on(t.provider),
        chkProvider: sql`CHECK (${t.provider} IN ('google', 'outlook'))`,
        chkTriggeredBy: sql`CHECK (${t.triggeredBy} IN ('scheduled', 'api_call', 'webhook', 'manual'))`,
    })
);
