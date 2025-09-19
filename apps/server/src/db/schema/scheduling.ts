// src/db/scheduling.ts

import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    pgEnum,
    index,
    uniqueIndex,
    varchar
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { user } from "./auth";
import { forms, formResponses } from "./forms";

/* ============================
   Enums (Postgres pg_enum types)
   ============================ */

export const schedulingModeEnum = pgEnum("scheduling_mode", [
    "instant", // Direct booking from available slots
    "curated", // AI suggests 2-3 optimal times via email
    "approval", // Manual approval required
]);

export const bookingStatusEnum = pgEnum("booking_status", [
    "pending",
    "confirmed",
    "cancelled",
    "completed",
    "no_show",
    "rescheduled",
]);

export const calendarProviderEnum = pgEnum("calendar_provider", [
    "google",
    "outlook",
    "apple",
    "caldav",
]);

export const meetingTypeEnum = pgEnum("meeting_type", [
    "phone",
    "video",
    "in_person",
    "hybrid",
]);

export const reminderStatusEnum = pgEnum("reminder_status", ["pending", "sent", "failed"]);

/* ============================
   Tables
   ============================ */

/**
 * calendar_connections
 * - per-user calendar OAuth connections
 */
export const calendarConnections = pgTable(
    "calendar_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

        provider: calendarProviderEnum("provider").notNull(),
        name: text("name").notNull(),
        email: text("email").notNull(),

        // OAuth tokens (store encrypted at application-level)
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at"),

        // Calendar details
        calendarId: text("calendar_id").notNull(),
        timeZone: text("time_zone").notNull(),

        // Settings
        isDefault: boolean("is_default").notNull().default(false),
        isActive: boolean("is_active").notNull().default(true),

        // Sync status
        lastSyncAt: timestamp("last_sync_at"),
        syncStatus: text("sync_status").notNull().default("pending"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("calendar_connections_user_idx").on(t.userId),
        uqUserDefault: uniqueIndex("calendar_connections_user_default_uq").on(t.userId, t.isDefault),
    })
);

/**
 * event_types
 * - meeting templates (duration, behavior, branding)
 */
export const eventTypes = pgTable(
    "event_types",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),

        title: text("title").notNull(),
        description: text("description"),
        slug: text("slug").notNull(),

        duration: integer("duration").notNull(), // minutes
        bufferTimeBefore: integer("buffer_time_before").notNull().default(0),
        bufferTimeAfter: integer("buffer_time_after").notNull().default(0),

        minimumNotice: integer("minimum_notice").notNull().default(60),
        maximumDaysOut: integer("maximum_days_out").notNull().default(30),

        meetingType: meetingTypeEnum("meeting_type").notNull().default("video"),
        location: text("location"),

        schedulingMode: schedulingModeEnum("scheduling_mode").notNull().default("instant"),
        requiresApproval: boolean("requires_approval").notNull().default(false),

        maxBookingsPerDay: integer("max_bookings_per_day"),
        maxBookingsPerWeek: integer("max_bookings_per_week"),
        bookingFrequencyLimit: integer("booking_frequency_limit"), // days

        dynamicDuration: boolean("dynamic_duration").notNull().default(false),
        singleUseLinks: boolean("single_use_links").notNull().default(false),

        requireEmailVerification: boolean("require_email_verification").notNull().default(true),
        requireSmsVerification: boolean("require_sms_verification").notNull().default(false),

        customBranding: boolean("custom_branding").notNull().default(false),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        logoUrl: text("logo_url"),

        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("event_types_user_idx").on(t.userId),
        uqSlug: uniqueIndex("event_types_slug_uq").on(t.slug),
    })
);

/**
 * availability_slots
 * - generated slots (or imported from external calendar)
 */
export const availabilitySlots = pgTable(
    "availability_slots",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        calendarConnectionId: text("calendar_connection_id").notNull().references(() => calendarConnections.id, {
            onDelete: "cascade",
        }),

        startTime: timestamp("start_time").notNull(),
        endTime: timestamp("end_time").notNull(),
        timeZone: text("time_zone").notNull(),

        isAvailable: boolean("is_available").notNull().default(true),
        isBlocked: boolean("is_blocked").notNull().default(false),

        optimalityScore: integer("optimality_score"), // 0-100

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxEventStart: index("availability_event_start_idx").on(t.eventTypeId, t.startTime),
        idxCalendarStart: index("availability_calendar_start_idx").on(t.calendarConnectionId, t.startTime),
        // consider a unique constraint for non-overlapping slots per calendarConnectionId + startTime
        uqCalendarSlot: uniqueIndex("availability_calendar_start_uq").on(t.calendarConnectionId, t.startTime),
    })
);

/**
 * availability_rules
 * - user-level recurring availability rules (weekly)
 */
export const availabilityRules = pgTable(
    "availability_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday
        startTime: text("start_time").notNull(), // HH:MM
        endTime: text("end_time").notNull(), // HH:MM
        timeZone: text("time_zone").notNull(),

        validFrom: timestamp("valid_from"),
        validUntil: timestamp("valid_until"),

        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("availability_rules_user_idx").on(t.userId, t.isActive),
    })
);

/**
 * blocked_times
 * - user exceptions & overrides (all-day events, external calendar blocks)
 */
export const blockedTimes = pgTable(
    "blocked_times",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        calendarConnectionId: text("calendar_connection_id").references(() => calendarConnections.id, { onDelete: "cascade" }),

        startTime: timestamp("start_time").notNull(),
        endTime: timestamp("end_time").notNull(),
        timeZone: text("time_zone").notNull(),

        title: text("title").notNull(),
        description: text("description"),
        isAllDay: boolean("is_all_day").notNull().default(false),

        externalEventId: text("external_event_id"),
        isRecurring: boolean("is_recurring").notNull().default(false),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("blocked_times_user_idx").on(t.userId),
        idxCalendar: index("blocked_times_calendar_idx").on(t.calendarConnectionId),
    })
);

/**
 * bookings
 * - appointments/bookings
 *
 * Note: originalBookingId is defined as a plain text column here to avoid
 * circular type inference in TypeScript. The self-relation FK constraint
 * (reschedule chain) is represented in relations() below for type safety.
 *
 * If you want a DB-level self-referencing FK, create it in a raw migration SQL
 * (after tables are created) to avoid TS circular inference while keeping DB integrity.
 */
export const bookings = pgTable(
    "bookings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "set null" }),
        calendarConnectionId: text("calendar_connection_id").notNull().references(() => calendarConnections.id, {
            onDelete: "cascade",
        }),

        startTime: timestamp("start_time").notNull(),
        endTime: timestamp("end_time").notNull(),
        timeZone: text("time_zone").notNull(),

        guestName: text("guest_name").notNull(),
        guestEmail: text("guest_email").notNull(),
        guestPhone: varchar("guest_phone", { length: 64 }),

        meetingType: meetingTypeEnum("meeting_type").notNull(),
        location: text("location"),
        meetingUrl: text("meeting_url"),
        meetingId: text("meeting_id"),
        meetingPassword: text("meeting_password"),

        status: bookingStatusEnum("status").notNull().default("pending"),
        confirmationCode: text("confirmation_code"),

        cancellationReason: text("cancellation_reason"),
        cancelledAt: timestamp("cancelled_at"),
        cancelledBy: text("cancelled_by"), // 'host' | 'guest'
        rescheduleCount: integer("reschedule_count").notNull().default(0),

        // keep the column here but avoid .references(() => bookings.id) to break circular inference
        originalBookingId: text("original_booking_id"),

        emailVerified: boolean("email_verified").notNull().default(false),
        emailVerificationToken: text("email_verification_token"),
        emailVerifiedAt: timestamp("email_verified_at"),

        smsVerified: boolean("sms_verified").notNull().default(false),
        smsVerificationToken: text("sms_verification_token"),
        smsVerifiedAt: timestamp("sms_verified_at"),

        externalCalendarEventId: text("external_calendar_event_id"),

        // AI insights
        qualificationSummary: text("qualification_summary"),
        priorityScore: integer("priority_score"),
        intentScore: integer("intent_score"),

        // metadata (bounded lengths)
        ipAddress: varchar("ip_address", { length: 45 }), // IPv6 max length
        userAgent: text("user_agent"),
        utmSource: varchar("utm_source", { length: 128 }),
        utmMedium: varchar("utm_medium", { length: 128 }),
        utmCampaign: varchar("utm_campaign", { length: 128 }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqConfirmationCode: uniqueIndex("bookings_confirmation_code_uq").on(t.confirmationCode),
        idxEventStart: index("bookings_event_start_idx").on(t.eventTypeId, t.startTime),
        idxCalendarStart: index("bookings_calendar_start_idx").on(t.calendarConnectionId, t.startTime),
    })
);

/**
 * booking_reminders
 * - scheduled reminders to be sent before meetings
 */
export const bookingReminders = pgTable(
    "booking_reminders",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),

        type: text("type").notNull(), // 'email' | 'sms' | 'both'
        triggerMinutes: integer("trigger_minutes").notNull(),

        status: reminderStatusEnum("status").notNull().default("pending"),
        sentAt: timestamp("sent_at"),
        deliveredAt: timestamp("delivered_at"),

        subject: text("subject"),
        message: text("message"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxBookingTrigger: index("booking_reminders_booking_trigger_idx").on(t.bookingId, t.triggerMinutes),
    })
);

/**
 * meeting_feedback
 * - feedback/outcome after the meeting
 */
export const meetingFeedback = pgTable(
    "meeting_feedback",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),

        hostRating: integer("host_rating"),
        guestRating: integer("guest_rating"),

        outcome: text("outcome"),
        notes: text("notes"),
        nextSteps: text("next_steps"),

        wasNoShow: boolean("was_no_show").notNull().default(false),
        wasSpam: boolean("was_spam").notNull().default(false),
        qualityScore: integer("quality_score"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxBookingFeedback: index("meeting_feedback_booking_idx").on(t.bookingId),
    })
);

/**
 * team_assignments
 * - round-robin / weighted assignment definitions
 */
export const teamAssignments = pgTable(
    "team_assignments",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

        weight: integer("weight").notNull().default(1),
        isActive: boolean("is_active").notNull().default(true),
        maxBookingsPerDay: integer("max_bookings_per_day"),

        assignmentRules: jsonb("assignment_rules"), // JSON: conditions, priorities

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxEventUser: index("team_assignments_event_user_idx").on(t.eventTypeId, t.userId),
        uqEventUser: uniqueIndex("team_assignments_event_user_uq").on(t.eventTypeId, t.userId),
    })
);

/* ============================
   Relations (type-safe helpers)
   - keep these after pgTable declarations to avoid TS circular inference
   ============================ */

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
    user: one(user, { fields: [calendarConnections.userId], references: [user.id] }),
    availabilitySlots: many(availabilitySlots),
    bookings: many(bookings),
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
    owner: one(user, { fields: [eventTypes.userId], references: [user.id] }),
    form: one(forms, { fields: [eventTypes.formId], references: [forms.id] }),
    availabilitySlots: many(availabilitySlots),
    teamAssignments: many(teamAssignments),
    bookings: many(bookings),
}));

export const availabilitySlotsRelations = relations(availabilitySlots, ({ one }) => ({
    eventType: one(eventTypes, { fields: [availabilitySlots.eventTypeId], references: [eventTypes.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [availabilitySlots.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const availabilityRulesRelations = relations(availabilityRules, ({ one }) => ({
    user: one(user, { fields: [availabilityRules.userId], references: [user.id] }),
    eventType: one(eventTypes, { fields: [availabilityRules.eventTypeId], references: [eventTypes.id] }),
}));

export const blockedTimesRelations = relations(blockedTimes, ({ one }) => ({
    user: one(user, { fields: [blockedTimes.userId], references: [user.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [blockedTimes.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
    eventType: one(eventTypes, { fields: [bookings.eventTypeId], references: [eventTypes.id] }),
    formResponse: one(formResponses, { fields: [bookings.formResponseId], references: [formResponses.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [bookings.calendarConnectionId],
        references: [calendarConnections.id],
    }),
    reminders: many(bookingReminders),
    feedback: many(meetingFeedback),
    // self-relation (rescheduled/from)
    originalBooking: one(bookings, {
        fields: [bookings.originalBookingId],
        references: [bookings.id],
    }),
}));

export const bookingRemindersRelations = relations(bookingReminders, ({ one }) => ({
    booking: one(bookings, { fields: [bookingReminders.bookingId], references: [bookings.id] }),
}));

export const meetingFeedbackRelations = relations(meetingFeedback, ({ one }) => ({
    booking: one(bookings, { fields: [meetingFeedback.bookingId], references: [bookings.id] }),
}));

export const teamAssignmentsRelations = relations(teamAssignments, ({ one }) => ({
    eventType: one(eventTypes, { fields: [teamAssignments.eventTypeId], references: [eventTypes.id] }),
    user: one(user, { fields: [teamAssignments.userId], references: [user.id] }),
}));
