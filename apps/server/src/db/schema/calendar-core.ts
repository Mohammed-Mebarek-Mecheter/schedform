// src/db/schema/calendar-core.ts
import {
    pgTable,
    text,
    timestamp,
    jsonb,
    boolean,
    index,
    integer,
    uniqueIndex, pgEnum
} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import {availabilitySlots, blockedTimes, bookings} from "./scheduling";
import {organizations, teams, users} from "@/db/schema";

export const calendarProviderEnum = pgEnum("calendar_provider", [
    "google", "outlook"
]);

/**
 * Core calendar connections - provider agnostic
 * This replaces the mixed approach in scheduling.ts
 */
export const calendarConnections = pgTable(
    "calendar_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        // Core provider info
        provider: calendarProviderEnum("provider").notNull(),
        providerAccountId: text("provider_account_id").notNull(), // External account ID
        email: text("email").notNull(),
        displayName: text("name").notNull(),

        // Universal OAuth tokens (both providers use similar structure)
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),
        tokenScopes: jsonb("token_scopes"), // Array of granted scopes

        // Provider-agnostic calendar selection
        calendarId: text("calendar_id").notNull(), // Primary calendar to sync with
        timeZone: text("time_zone").notNull(),

        // Universal sync state (works for both Google syncToken and Outlook deltaLink)
        lastSyncToken: text("last_sync_token"), // Latest sync token/deltaLink
        lastFullSyncAt: timestamp("last_full_sync_at", { mode: "date" }),
        lastIncrementalSyncAt: timestamp("last_incremental_sync_at", { mode: "date" }),

        // Provider-specific config stored as JSONB
        providerConfig: jsonb("provider_config"), // Store unique provider settings

        // Universal settings
        isActive: boolean("is_active").notNull().default(true),
        isDefault: boolean("is_default").notNull().default(false),
        syncDirection: text("sync_direction").notNull().default("bidirectional"), // inbound, outbound, bidirectional

        // Error tracking (universal)
        lastError: text("last_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("calendar_connections_user_idx").on(t.userId),
        idxProvider: index("calendar_connections_provider_idx").on(t.provider),
        idxActive: index("calendar_connections_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        uqUserDefault: uniqueIndex("calendar_connections_user_default_uq")
            .on(t.userId, t.isDefault)
            .where(sql`${t.isDefault} = true`),
        uqProviderAccount: uniqueIndex("calendar_connections_provider_account_uq")
            .on(t.provider, t.providerAccountId, t.userId),
    })
);

/**
 * Universal event synchronization tracking
 * Works for both Google's event sync and Outlook's message tracking
 */
export const calendarSyncLogs = pgTable(
    "calendar_sync_logs",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Sync operation details
        syncType: text("sync_type").notNull(), // 'full', 'incremental', 'webhook', 'manual'
        direction: text("direction").notNull(), // 'inbound', 'outbound', 'bidirectional'

        // Time range synced
        timeRangeStart: timestamp("time_range_start", { mode: "date" }),
        timeRangeEnd: timestamp("time_range_end", { mode: "date" }),

        // Sync tokens (universal approach)
        syncTokenBefore: text("sync_token_before"),
        syncTokenAfter: text("sync_token_after"),

        // Results (universal metrics)
        eventsProcessed: integer("events_processed").default(0),
        eventsCreated: integer("events_created").default(0),
        eventsUpdated: integer("events_updated").default(0),
        eventsDeleted: integer("events_deleted").default(0),

        // Execution tracking
        startedAt: timestamp("started_at", { mode: "date" }).notNull(),
        completedAt: timestamp("completed_at", { mode: "date" }),
        status: text("status").notNull().default('running'), // running, completed, failed, partial

        // Error handling
        errorCode: text("error_code"),
        errorMessage: text("error_message"),
        errorDetails: jsonb("error_details"),
        retryCount: integer("retry_count").default(0),

        // Provider-specific metrics stored as JSONB
        providerMetrics: jsonb("provider_metrics"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("sync_logs_connection_idx").on(t.calendarConnectionId),
        idxStatus: index("sync_logs_status_idx").on(t.status, t.startedAt),
        idxTimeRange: index("sync_logs_time_range_idx").on(t.timeRangeStart, t.timeRangeEnd),
        chkSyncType: sql`CHECK (${t.syncType} IN ('full', 'incremental', 'webhook', 'manual'))`,
        chkDirection: sql`CHECK (${t.direction} IN ('inbound', 'outbound', 'bidirectional'))`,
        chkStatus: sql`CHECK (${t.status} IN ('running', 'completed', 'failed', 'partial'))`,
    })
);

/**
 * External events cache - universal structure for conflict detection
 */
export const externalCalendarEvents = pgTable(
    "external_calendar_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Universal event identification
        providerEventId: text("provider_event_id").notNull(), // Google: eventId, Outlook: id
        providerCalendarId: text("provider_calendar_id").notNull(),

        // Universal event data (normalized from both providers)
        title: text("title"),
        description: text("description"),
        location: text("location"),

        // Time handling (universal)
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),
        isAllDay: boolean("is_all_day").default(false),

        // Status (normalized across providers)
        status: text("status"), // confirmed, tentative, cancelled
        showAs: text("show_as"), // busy, free, tentative, outOfOffice (Outlook) / transparent, opaque (Google)

        // Organizer and attendees (universal structure)
        organizerEmail: text("organizer_email"),
        organizerName: text("organizer_name"),
        attendeeEmails: jsonb("attendee_emails"), // Array of email strings

        // Recurrence (universal)
        isRecurring: boolean("is_recurring").default(false),
        recurrenceRule: text("recurrence_rule"), // Normalized RRULE
        recurringEventId: text("recurring_event_id"),

        // Change tracking (universal)
        etag: text("etag"), // Both providers support this
        lastModified: timestamp("last_modified", { mode: "date" }),

        // Provider-specific data (stored as JSONB)
        providerData: jsonb("provider_data"), // Full original event object

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncVersion: text("sync_version"), // Incremental tracking

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqProviderEvent: uniqueIndex("external_events_provider_uq")
            .on(t.calendarConnectionId, t.providerEventId),
        idxTimeRange: index("external_events_time_range_idx").on(t.startTime, t.endTime),
        idxStatus: index("external_events_status_idx").on(t.status, t.showAs),
        idxRecurrence: index("external_events_recurrence_idx")
            .on(t.isRecurring, t.recurringEventId),
        idxSync: index("external_events_sync_idx").on(t.lastSyncedAt),
        chkTimeOrder: sql`CHECK (${t.startTime} <= ${t.endTime})`,
    })
);

// Provider-specific extensions (only when absolutely necessary)

/**
 * Google-specific webhook channels
 * Google's push notification system is unique enough to warrant separate storage
 */
export const googleWebhookChannels = pgTable(
    "google_webhook_channels",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Google-specific webhook fields
        channelId: text("channel_id").notNull(),
        resourceId: text("resource_id").notNull(),
        resourceUri: text("resource_uri").notNull(),

        // Webhook configuration
        address: text("address").notNull(), // Our notification endpoint
        token: text("token"), // Verification token
        expiration: timestamp("expiration", { mode: "date" }).notNull(),

        // Status tracking
        isActive: boolean("is_active").notNull().default(true),
        lastNotification: timestamp("last_notification", { mode: "date" }),
        notificationCount: integer("notification_count").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqChannel: uniqueIndex("google_webhook_channels_channel_uq").on(t.channelId),
        idxConnection: index("google_webhook_channels_connection_idx").on(t.calendarConnectionId),
        idxExpiration: index("google_webhook_channels_expiration_idx").on(t.expiration),
    })
);

/**
 * Outlook-specific subscriptions
 * Microsoft Graph's subscription model is different enough to need separate storage
 */
export const outlookSubscriptions = pgTable(
    "outlook_subscriptions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Outlook-specific subscription fields
        subscriptionId: text("subscription_id").notNull(),
        resource: text("resource").notNull(), // e.g., "me/calendars/{id}/events"
        changeType: text("change_type").notNull(), // "created,updated,deleted"

        // Webhook configuration
        notificationUrl: text("notification_url").notNull(),
        clientState: text("client_state"), // Custom verification string
        latestSupportedTlsVersion: text("latest_supported_tls_version"),

        // Lifecycle
        expirationDateTime: timestamp("expiration_date_time", { mode: "date" }).notNull(),
        creatorId: text("creator_id"), // Who created the subscription

        // Status tracking
        isActive: boolean("is_active").notNull().default(true),
        lastNotification: timestamp("last_notification", { mode: "date" }),
        notificationCount: integer("notification_count").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqSubscription: uniqueIndex("outlook_subscriptions_subscription_uq").on(t.subscriptionId),
        idxConnection: index("outlook_subscriptions_connection_idx").on(t.calendarConnectionId),
        idxExpiration: index("outlook_subscriptions_expiration_idx").on(t.expirationDateTime),
    })
);

/**
 * Relations for calendar connections
 */
export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
    // Auth relations
    user: one(users, {
        fields: [calendarConnections.userId],
        references: [users.id]
    }),
    organization: one(organizations, {
        fields: [calendarConnections.organizationId],
        references: [organizations.id]
    }),
    team: one(teams, {
        fields: [calendarConnections.teamId],
        references: [teams.id]
    }),

    // Calendar-core relations
    syncLogs: many(calendarSyncLogs),
    externalEvents: many(externalCalendarEvents),
    googleWebhooks: many(googleWebhookChannels),
    outlookSubscriptions: many(outlookSubscriptions),

    // Scheduling relations
    availabilitySlots: many(availabilitySlots),
    bookings: many(bookings),
    blockedTimes: many(blockedTimes),
}));

export const calendarSyncLogsRelations = relations(calendarSyncLogs, ({ one }) => ({
    calendarConnection: one(calendarConnections, {
        fields: [calendarSyncLogs.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const externalCalendarEventsRelations = relations(externalCalendarEvents, ({ one }) => ({
    calendarConnection: one(calendarConnections, {
        fields: [externalCalendarEvents.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const googleWebhookChannelsRelations = relations(googleWebhookChannels, ({ one }) => ({
    calendarConnection: one(calendarConnections, {
        fields: [googleWebhookChannels.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const outlookSubscriptionsRelations = relations(outlookSubscriptions, ({ one }) => ({
    calendarConnection: one(calendarConnections, {
        fields: [outlookSubscriptions.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));
