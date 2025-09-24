// src/db/schema/googleCalendar.ts
import {pgTable, text, timestamp, jsonb, boolean, index, integer, uniqueIndex} from "drizzle-orm/pg-core";
import {bookings, calendarConnections} from "./scheduling";

export const googleCalendarMetadata = pgTable(
    "google_calendar_metadata",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Google-specific metadata
        resourceId: text("resource_id"), // For watch channels
        syncToken: text("sync_token"), // For incremental sync
        nextSyncToken: text("next_sync_token"),

        // Calendar-specific properties from Google API
        calendarSummary: text("calendar_summary"),
        calendarDescription: text("calendar_description"),
        calendarTimeZone: text("calendar_time_zone"),
        calendarBackgroundColor: text("calendar_background_color"),
        calendarForegroundColor: text("calendar_foreground_color"),

        // Google API limits and quotas
        dailyQuotaUsed: integer("daily_quota_used").default(0),
        quotaResetTime: timestamp("quota_reset_time", { mode: "date" }),

        // Watch channel management
        watchChannelId: text("watch_channel_id"),
        watchChannelExpiration: timestamp("watch_channel_expiration", { mode: "date" }),
        watchChannelResourceUri: text("watch_channel_resource_uri"),

        // Conference data support
        supportedConferenceTypes: jsonb("supported_conference_types"),
        defaultConferenceSettings: jsonb("default_conference_settings"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxCalendarConnection: index("google_cal_metadata_connection_idx").on(t.calendarConnectionId),
        idxResourceId: index("google_cal_metadata_resource_idx").on(t.resourceId),
        idxWatchExpiration: index("google_cal_watch_expiration_idx").on(t.watchChannelExpiration),
    })
);

export const calendarWatchChannels = pgTable(
    "calendar_watch_channels",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        // Watch channel details
        channelId: text("channel_id").notNull(),
        resourceId: text("resource_id").notNull(),
        resourceUri: text("resource_uri").notNull(),
        token: text("token"), // Optional channel token
        expiration: timestamp("expiration", { mode: "date" }).notNull(),

        // Watch configuration
        address: text("address").notNull(), // Notification endpoint URL
        type: text("type").default("web_hook"),
        params: jsonb("params"), // Additional parameters like TTL

        // Status
        isActive: boolean("is_active").notNull().default(true),
        lastNotification: timestamp("last_notification", { mode: "date" }),
        notificationCount: integer("notification_count").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("watch_channels_connection_idx").on(t.calendarConnectionId),
        idxExpiration: index("watch_channels_expiration_idx").on(t.expiration),
        uqChannel: uniqueIndex("watch_channels_channel_uq").on(t.channelId),
    })
);

// Enhanced bookings table additions or separate table
export const bookingConferenceData = pgTable(
    "booking_conference_data",
    {
        id: text("id").primaryKey(),
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),

        // Google Conference Data structure
        conferenceId: text("conference_id"),
        conferenceSolutionType: text("conference_solution_type"), // 'hangoutsMeet', 'eventHangout', etc.

        // Entry points
        entryPoints: jsonb("entry_points"), // [{type, uri, label, pin, accessCode}]

        // Conference metadata
        conferenceSolution: jsonb("conference_solution"), // {key, name, iconUri}
        createRequest: jsonb("create_request"), // {requestId, conferenceSolutionKey, status}

        // Google-specific fields
        signature: text("signature"),
        notes: text("notes"),
        hangoutLink: text("hangout_link"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxBooking: index("conference_data_booking_idx").on(t.bookingId),
        idxConferenceId: index("conference_data_conf_id_idx").on(t.conferenceId),
    })
);


export const calendarSyncLogs = pgTable(
    "calendar_sync_logs",
    {
        id: text("id").primaryKey(),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),

        syncType: text("sync_type").notNull(), // 'full', 'incremental', 'watch'
        syncDirection: text("sync_direction").notNull(), // 'push', 'pull', 'bidirectional'

        // Sync parameters
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }),
        timeMin: timestamp("time_min", { mode: "date" }),
        timeMax: timestamp("time_max", { mode: "date" }),

        // Results
        eventsProcessed: integer("events_processed").default(0),
        eventsCreated: integer("events_created").default(0),
        eventsUpdated: integer("events_updated").default(0),
        eventsDeleted: integer("events_deleted").default(0),
        syncTokenUsed: text("sync_token_used"),
        nextSyncToken: text("next_sync_token"),

        // Error handling
        status: text("status").notNull().default('pending'), // pending, completed, failed, partial
        errorMessage: text("error_message"),
        errorDetails: jsonb("error_details"),
        retryCount: integer("retry_count").default(0),

        // API usage tracking
        apiCallsMade: integer("api_calls_made").default(0),
        quotaUnitsUsed: integer("quota_units_used").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnectionStatus: index("sync_logs_connection_status_idx").on(t.calendarConnectionId, t.status),
        idxSyncTime: index("sync_logs_time_idx").on(t.startTime),
    })
);
