// src/db/schema/video-conference-core.ts
import {
    pgTable,
    text,
    timestamp,
    jsonb,
    boolean,
    index,
    integer,
    uniqueIndex,
    pgEnum
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations, teams, users } from "@/db/schema/auth";
import { bookings } from "./scheduling";

export const videoProviderEnum = pgEnum("video_provider", [
    "zoom", "google_meet"
]);

export const meetingStatusEnum = pgEnum("meeting_status", [
    "scheduled", "live", "completed", "cancelled", "failed"
]);

export const recordingStatusEnum = pgEnum("recording_status", [
    "pending", "processing", "completed", "failed", "deleted"
]);

/**
 * Core video conference connections - provider agnostic
 */
export const videoConferenceConnections = pgTable(
    "video_conference_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        // Core provider info
        provider: videoProviderEnum("provider").notNull(),
        providerAccountId: text("provider_account_id").notNull(),
        email: text("email").notNull(),
        displayName: text("display_name").notNull(),

        // Universal OAuth tokens
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),
        tokenScopes: jsonb("token_scopes"),

        // Provider-specific config stored as JSONB
        providerConfig: jsonb("provider_config"),

        // Universal settings
        isActive: boolean("is_active").notNull().default(true),
        isDefault: boolean("is_default").notNull().default(false),
        autoCreateMeetings: boolean("auto_create_meetings").notNull().default(true),
        autoRecord: boolean("auto_record").notNull().default(false),
        autoTranscribe: boolean("auto_transcribe").notNull().default(false),

        // Error tracking
        lastError: text("last_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("video_connections_user_idx").on(t.userId),
        idxProvider: index("video_connections_provider_idx").on(t.provider),
        idxActive: index("video_connections_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        uqUserDefault: uniqueIndex("video_connections_user_default_uq")
            .on(t.userId, t.isDefault)
            .where(sql`${t.isDefault} = true`),
        uqProviderAccount: uniqueIndex("video_connections_provider_account_uq")
            .on(t.provider, t.providerAccountId, t.userId),
    })
);

/**
 * Universal meeting storage - normalized across providers
 */
export const videoMeetings = pgTable(
    "video_meetings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id"), // FK defined in relations
        videoConnectionId: text("video_connection_id").notNull(),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Universal meeting identification
        providerMeetingId: text("provider_meeting_id").notNull(),
        providerSeriesId: text("provider_series_id"),

        // Core meeting details
        title: text("title").notNull(),
        description: text("description"),
        agenda: text("agenda"),

        // Time information
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),
        duration: integer("duration").notNull(), // in minutes

        // Join information
        joinUrl: text("join_url").notNull(),
        hostUrl: text("host_url"),
        meetingCode: text("meeting_code"),
        password: text("password"),

        // Settings
        isRecurring: boolean("is_recurring").default(false),
        recurrenceRule: text("recurrence_rule"),
        maxParticipants: integer("max_participants"),
        waitingRoom: boolean("waiting_room").default(false),
        muteOnEntry: boolean("mute_on_entry").default(false),
        autoRecord: boolean("auto_record").default(false),
        autoTranscribe: boolean("auto_transcribe").default(false),

        // Status tracking
        status: meetingStatusEnum("status").notNull().default("scheduled"),
        actualStartTime: timestamp("actual_start_time", { mode: "date" }),
        actualEndTime: timestamp("actual_end_time", { mode: "date" }),
        participantCount: integer("participant_count").default(0),

        // Provider-specific data
        providerData: jsonb("provider_data"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).defaultNow(),
        syncVersion: integer("sync_version").default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqProviderMeeting: uniqueIndex("video_meetings_provider_uq").on(
            t.videoConnectionId,
            t.providerMeetingId,
        ),
        idxBooking: index("video_meetings_booking_idx").on(t.bookingId),
        idxTimeRange: index("video_meetings_time_range_idx").on(t.startTime, t.endTime),
        idxStatus: index("video_meetings_status_idx").on(t.status, t.startTime),
        idxOrganization: index("video_meetings_organization_idx").on(t.organizationId),
        chkDuration: sql`CHECK (${t.duration} > 0)`,
        chkTimeOrder: sql`CHECK (${t.startTime} < ${t.endTime})`,
    }),
);

/**
 * Meeting participants - universal structure
 */
export const meetingParticipants = pgTable(
    "meeting_participants",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        meetingId: text("meeting_id")
            .notNull()
            .references(() => videoMeetings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Participant info
        email: text("email").notNull(),
        name: text("name").notNull(),
        role: text("role").notNull().default("attendee"), // host, co-host, attendee

        // Join/leave tracking
        joinTime: timestamp("join_time", { mode: "date" }),
        leaveTime: timestamp("leave_time", { mode: "date" }),
        duration: integer("duration").default(0), // in seconds

        // Device info
        deviceType: text("device_type"), // desktop, mobile, tablet
        ipAddress: text("ip_address"),
        location: text("location"),

        // Provider-specific ID
        providerParticipantId: text("provider_participant_id"),

        // Additional data
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqMeetingParticipant: uniqueIndex("meeting_participants_meeting_email_uq")
            .on(t.meetingId, t.email),
        idxMeeting: index("meeting_participants_meeting_idx").on(t.meetingId),
        idxEmail: index("meeting_participants_email_idx").on(t.email),
        idxRole: index("meeting_participants_role_idx").on(t.role),
        idxOrganization: index("meeting_participants_organization_idx").on(t.organizationId),
    })
);

/**
 * Meeting recordings - universal structure
 */
export const meetingRecordings = pgTable(
    "meeting_recordings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        meetingId: text("meeting_id")
            .notNull()
            .references(() => videoMeetings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Recording info
        providerRecordingId: text("provider_recording_id").notNull(),
        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        fileSize: integer("file_size"), // in bytes
        fileType: text("file_type").notNull(), // mp4, m4a, etc.

        // Storage info
        downloadUrl: text("download_url"),
        previewUrl: text("preview_url"),
        storageLocation: text("storage_location"), // google_drive, zoom_cloud, etc.

        // Status
        status: recordingStatusEnum("status").notNull().default("pending"),
        errorMessage: text("error_message"),

        // Additional metadata
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqProviderRecording: uniqueIndex("meeting_recordings_provider_uq")
            .on(t.meetingId, t.providerRecordingId),
        idxMeeting: index("meeting_recordings_meeting_idx").on(t.meetingId),
        idxStatus: index("meeting_recordings_status_idx").on(t.status),
        idxOrganization: index("meeting_recordings_organization_idx").on(t.organizationId),
        chkFileSize: sql`CHECK (${t.fileSize} IS NULL OR ${t.fileSize} >= 0)`,
    })
);

/**
 * Meeting transcripts - universal structure
 */
export const meetingTranscripts = pgTable(
    "meeting_transcripts",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        meetingId: text("meeting_id")
            .notNull()
            .references(() => videoMeetings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Transcript info
        providerTranscriptId: text("provider_transcript_id").notNull(),
        language: text("language").notNull().default("en"),
        wordCount: integer("word_count").default(0),

        // Storage info
        downloadUrl: text("download_url"),
        previewUrl: text("preview_url"),
        storageLocation: text("storage_location"),

        // Status
        status: recordingStatusEnum("status").notNull().default("pending"),
        errorMessage: text("error_message"),

        // Additional metadata
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqProviderTranscript: uniqueIndex("meeting_transcripts_provider_uq")
            .on(t.meetingId, t.providerTranscriptId),
        idxMeeting: index("meeting_transcripts_meeting_idx").on(t.meetingId),
        idxStatus: index("meeting_transcripts_status_idx").on(t.status),
        idxOrganization: index("meeting_transcripts_organization_idx").on(t.organizationId),
        chkWordCount: sql`CHECK (${t.wordCount} >= 0)`,
    })
);

// Provider-specific extensions

/**
 * Zoom-specific webhooks
 */
export const zoomWebhooks = pgTable(
    "zoom_webhooks",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        videoConnectionId: text("video_connection_id")
            .notNull()
            .references(() => videoConferenceConnections.id, { onDelete: "cascade" }),

        // Zoom webhook details
        webhookId: text("webhook_id").notNull(),
        eventType: text("event_type").notNull(), // meeting.started, meeting.ended, etc.
        endpointUrl: text("endpoint_url").notNull(),
        verificationToken: text("verification_token"),

        // Status
        isActive: boolean("is_active").notNull().default(true),
        lastNotification: timestamp("last_notification", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqWebhook: uniqueIndex("zoom_webhooks_webhook_uq").on(t.webhookId),
        idxConnection: index("zoom_webhooks_connection_idx").on(t.videoConnectionId),
    })
);

/**
 * Google Meet-specific configurations
 */
export const googleMeetConfigs = pgTable(
    "google_meet_configs",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        videoConnectionId: text("video_connection_id")
            .notNull()
            .references(() => videoConferenceConnections.id, { onDelete: "cascade" }),

        // Google Meet space configuration
        spaceId: text("space_id").notNull(),
        meetingCode: text("meeting_code").notNull(),
        accessType: text("access_type").notNull().default("PUBLIC"), // PUBLIC, PRIVATE

        // Artifact settings
        recordingEnabled: boolean("recording_enabled").default(false),
        transcriptionEnabled: boolean("transcription_enabled").default(false),
        smartNotesEnabled: boolean("smart_notes_enabled").default(false),

        // Moderation settings
        moderationEnabled: boolean("moderation_enabled").default(false),
        chatRestriction: text("chat_restriction").default("NO_RESTRICTION"),
        presentRestriction: text("present_restriction").default("NO_RESTRICTION"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqSpace: uniqueIndex("google_meet_configs_space_uq").on(t.spaceId),
        uqMeetingCode: uniqueIndex("google_meet_configs_meeting_code_uq").on(t.meetingCode),
        idxConnection: index("google_meet_configs_connection_idx").on(t.videoConnectionId),
    })
);

// Relations
export const videoConferenceConnectionsRelations = relations(videoConferenceConnections, ({ one, many }) => ({
    user: one(users, {
        fields: [videoConferenceConnections.userId],
        references: [users.id]
    }),
    organization: one(organizations, {
        fields: [videoConferenceConnections.organizationId],
        references: [organizations.id]
    }),
    team: one(teams, {
        fields: [videoConferenceConnections.teamId],
        references: [teams.id]
    }),
    meetings: many(videoMeetings),
    zoomWebhooks: many(zoomWebhooks),
    googleMeetConfigs: many(googleMeetConfigs),
}));

export const videoMeetingsRelations = relations(videoMeetings, ({ one, many }) => ({
    booking: one(bookings, {
        fields: [videoMeetings.bookingId],
        references: [bookings.id]
    }),
    videoConnection: one(videoConferenceConnections, {
        fields: [videoMeetings.videoConnectionId],
        references: [videoConferenceConnections.id]
    }),
    organization: one(organizations, {
        fields: [videoMeetings.organizationId],
        references: [organizations.id]
    }),
    participants: many(meetingParticipants),
    recordings: many(meetingRecordings),
    transcripts: many(meetingTranscripts),
}));

export const meetingParticipantsRelations = relations(meetingParticipants, ({ one }) => ({
    meeting: one(videoMeetings, {
        fields: [meetingParticipants.meetingId],
        references: [videoMeetings.id]
    }),
    organization: one(organizations, {
        fields: [meetingParticipants.organizationId],
        references: [organizations.id]
    }),
}));

export const meetingRecordingsRelations = relations(meetingRecordings, ({ one }) => ({
    meeting: one(videoMeetings, {
        fields: [meetingRecordings.meetingId],
        references: [videoMeetings.id]
    }),
    organization: one(organizations, {
        fields: [meetingRecordings.organizationId],
        references: [organizations.id]
    }),
}));

export const meetingTranscriptsRelations = relations(meetingTranscripts, ({ one }) => ({
    meeting: one(videoMeetings, {
        fields: [meetingTranscripts.meetingId],
        references: [videoMeetings.id]
    }),
    organization: one(organizations, {
        fields: [meetingTranscripts.organizationId],
        references: [organizations.id]
    }),
}));

export const zoomWebhooksRelations = relations(zoomWebhooks, ({ one }) => ({
    videoConnection: one(videoConferenceConnections, {
        fields: [zoomWebhooks.videoConnectionId],
        references: [videoConferenceConnections.id]
    }),
}));

export const googleMeetConfigsRelations = relations(googleMeetConfigs, ({ one }) => ({
    videoConnection: one(videoConferenceConnections, {
        fields: [googleMeetConfigs.videoConnectionId],
        references: [videoConferenceConnections.id]
    }),
}));
