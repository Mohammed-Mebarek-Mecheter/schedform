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
    varchar,
    real
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
    "draft", // Initial creation, not yet confirmed
    "pending", // Awaiting confirmation (approval mode)
    "confirmed", // Confirmed and calendar event created
    "cancelled", // Cancelled by host or guest
    "completed", // Meeting took place
    "no_show", // Guest didn't show up
    "rescheduled", // Moved to different time
    "rejected", // Host rejected the booking request
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

export const noShowReasonEnum = pgEnum("no_show_reason", [
    "guest_no_show",
    "host_no_show",
    "both_no_show",
    "technical_issues",
    "reschedule_request",
]);

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
        syncErrors: jsonb("sync_errors"), // Track sync issues

        // Performance tracking
        totalBookings: integer("total_bookings").notNull().default(0),
        failedSyncs: integer("failed_syncs").notNull().default(0),

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
 * - meeting templates (duration, behavior, branding) - Enhanced for SchedForm integration
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

        // Meeting configuration
        duration: integer("duration").notNull(), // minutes
        bufferTimeBefore: integer("buffer_time_before").notNull().default(0),
        bufferTimeAfter: integer("buffer_time_after").notNull().default(0),

        // Availability windows
        minimumNotice: integer("minimum_notice").notNull().default(60), // minutes
        maximumDaysOut: integer("maximum_days_out").notNull().default(30),

        // Meeting details
        meetingType: meetingTypeEnum("meeting_type").notNull().default("video"),
        location: text("location"),
        meetingUrl: text("meeting_url"), // Fixed meeting URL if not dynamic

        // SchedForm's core scheduling modes
        schedulingMode: schedulingModeEnum("scheduling_mode").notNull().default("instant"),
        requiresApproval: boolean("requires_approval").notNull().default(false),

        // Enhanced booking limits
        maxBookingsPerDay: integer("max_bookings_per_day"),
        maxBookingsPerWeek: integer("max_bookings_per_week"),
        maxBookingsPerMonth: integer("max_bookings_per_month"), // New
        bookingFrequencyLimit: integer("booking_frequency_limit"), // days between bookings from same person

        // SchedForm-specific features
        dynamicDuration: boolean("dynamic_duration").notNull().default(false), // AI can adjust duration
        singleUseLinks: boolean("single_use_links").notNull().default(false),
        enableAiOptimization: boolean("enable_ai_optimization").notNull().default(true), // Use AI for slot suggestions

        // Enhanced verification requirements
        requireEmailVerification: boolean("require_email_verification").notNull().default(true),
        requireSmsVerification: boolean("require_sms_verification").notNull().default(false),
        highValueThreshold: integer("high_value_threshold"), // Qualification score threshold for extra verification

        // White-labeling and branding
        customBranding: boolean("custom_branding").notNull().default(false),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        logoUrl: text("logo_url"),
        brandingConfig: jsonb("branding_config"), // Comprehensive branding settings

        // Qualification requirements
        minimumQualificationScore: real("minimum_qualification_score"), // Minimum score to book
        requiresManualReview: boolean("requires_manual_review").notNull().default(false),
        qualificationCriteria: jsonb("qualification_criteria"), // Custom qualification rules

        // Pricing (for paid event types)
        price: real("price"), // Cost per meeting
        currency: text("currency").default("USD"),
        paymentRequired: boolean("payment_required").notNull().default(false),

        // Analytics and performance
        totalBookings: integer("total_bookings").notNull().default(0),
        completedBookings: integer("completed_bookings").notNull().default(0),
        noShowRate: real("no_show_rate").notNull().default(0),
        averageQualificationScore: real("average_qualification_score").notNull().default(0),

        // Status
        isActive: boolean("is_active").notNull().default(true),
        archivedAt: timestamp("archived_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("event_types_user_idx").on(t.userId),
        uqSlug: uniqueIndex("event_types_slug_uq").on(t.slug),
        idxForm: index("event_types_form_idx").on(t.formId),
        idxActive: index("event_types_active_idx").on(t.isActive),
    })
);

/**
 * availability_slots - Enhanced with AI optimization scores
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

        // AI optimization
        optimalityScore: integer("optimality_score"), // 0-100, how optimal is this slot
        aiRecommendationReason: text("ai_recommendation_reason"), // Why AI recommends this slot

        // Booking limits per slot
        maxBookings: integer("max_bookings").default(1), // Allow multiple bookings per slot if needed
        currentBookings: integer("current_bookings").default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxEventStart: index("availability_event_start_idx").on(t.eventTypeId, t.startTime),
        idxCalendarStart: index("availability_calendar_start_idx").on(t.calendarConnectionId, t.startTime),
        idxOptimality: index("availability_optimality_idx").on(t.optimalityScore),
        uqCalendarSlot: uniqueIndex("availability_calendar_start_uq").on(t.calendarConnectionId, t.startTime),
    })
);

/**
 * availability_rules - Enhanced with more flexible scheduling
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

        // Enhanced scheduling rules
        validFrom: timestamp("valid_from"),
        validUntil: timestamp("valid_until"),
        maxBookingsPerSlot: integer("max_bookings_per_slot").default(1),

        // Recurring patterns
        recurringPattern: jsonb("recurring_pattern"), // For complex recurring rules
        exceptions: jsonb("exceptions"), // Specific date exceptions

        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("availability_rules_user_idx").on(t.userId, t.isActive),
        idxEventType: index("availability_rules_event_type_idx").on(t.eventTypeId),
    })
);

/**
 * blocked_times - Enhanced with more context
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

        // External calendar integration
        externalEventId: text("external_event_id"),
        isRecurring: boolean("is_recurring").notNull().default(false),

        // Block type and priority
        blockType: text("block_type").default("busy"), // busy, tentative, out_of_office, focus_time
        blockPriority: integer("block_priority").default(1), // 1-5, higher = more important

        // Auto-sync from external calendars
        isSyncedFromExternal: boolean("is_synced_from_external").notNull().default(false),
        lastSyncedAt: timestamp("last_synced_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("blocked_times_user_idx").on(t.userId),
        idxCalendar: index("blocked_times_calendar_idx").on(t.calendarConnectionId),
        idxTimeRange: index("blocked_times_time_range_idx").on(t.startTime, t.endTime),
    })
);

/**
 * bookings - Enhanced for SchedForm's conversational flow
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

        // Meeting time
        startTime: timestamp("start_time").notNull(),
        endTime: timestamp("end_time").notNull(),
        timeZone: text("time_zone").notNull(),

        // Enhanced guest information
        guestName: text("guest_name").notNull(),
        guestEmail: text("guest_email").notNull(),
        guestPhone: varchar("guest_phone", { length: 64 }),
        guestCompany: text("guest_company"),
        guestTitle: text("guest_title"),

        // Meeting configuration
        meetingType: meetingTypeEnum("meeting_type").notNull(),
        location: text("location"),
        meetingUrl: text("meeting_url"),
        meetingId: text("meeting_id"),
        meetingPassword: text("meeting_password"),
        dialInNumber: text("dial_in_number"),

        // Enhanced status tracking
        status: bookingStatusEnum("status").notNull().default("draft"),
        statusHistory: jsonb("status_history"), // Track all status changes
        confirmationCode: text("confirmation_code"),

        // Cancellation and rescheduling
        cancellationReason: text("cancellation_reason"),
        cancelledAt: timestamp("cancelled_at"),
        cancelledBy: text("cancelled_by"), // 'host' | 'guest' | 'system'
        rescheduleCount: integer("reschedule_count").notNull().default(0),
        originalBookingId: text("original_booking_id"), // For reschedule chain tracking

        // SchedForm-specific: Qualification and AI insights
        qualificationScore: real("qualification_score"), // Score from conversational flow
        qualificationSummary: text("qualification_summary"), // AI-generated summary
        priorityScore: integer("priority_score"), // 1-100, how important is this prospect
        intentScore: integer("intent_score"), // 1-100, how serious is their intent

        // Prospect insights for meeting preparation
        prospectInsights: jsonb("prospect_insights"), // AI-generated insights about the prospect
        meetingPreparation: jsonb("meeting_preparation"), // AI-suggested preparation tasks
        expectedOutcome: text("expected_outcome"), // What we expect from this meeting

        // Verification status
        emailVerified: boolean("email_verified").notNull().default(false),
        emailVerificationToken: text("email_verification_token"),
        emailVerifiedAt: timestamp("email_verified_at"),

        smsVerified: boolean("sms_verified").notNull().default(false),
        smsVerificationToken: text("sms_verification_token"),
        smsVerifiedAt: timestamp("sms_verified_at"),

        // Calendar integration
        externalCalendarEventId: text("external_calendar_event_id"),
        calendarEventCreated: boolean("calendar_event_created").notNull().default(false),
        calendarEventError: text("calendar_event_error"),

        // No-show tracking
        noShowReason: noShowReasonEnum("no_show_reason"),
        noShowDetectedAt: timestamp("no_show_detected_at"),
        noShowFollowUpSent: boolean("no_show_follow_up_sent").notNull().default(false),

        // Pricing and payment
        price: real("price"),
        currency: text("currency"),
        paymentStatus: text("payment_status"), // pending, paid, refunded, failed
        paymentIntentId: text("payment_intent_id"), // Stripe payment intent ID

        // Enhanced metadata
        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),
        utmSource: varchar("utm_source", { length: 128 }),
        utmMedium: varchar("utm_medium", { length: 128 }),
        utmCampaign: varchar("utm_campaign", { length: 128 }),
        referrer: text("referrer"),

        // Performance tracking
        bookingDuration: integer("booking_duration"), // Time to complete booking flow in seconds
        conversionSource: text("conversion_source"), // How they found the booking page

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqConfirmationCode: uniqueIndex("bookings_confirmation_code_uq").on(t.confirmationCode),
        idxEventStart: index("bookings_event_start_idx").on(t.eventTypeId, t.startTime),
        idxCalendarStart: index("bookings_calendar_start_idx").on(t.calendarConnectionId, t.startTime),
        idxStatus: index("bookings_status_idx").on(t.status),
        idxGuest: index("bookings_guest_idx").on(t.guestEmail),
        idxQualification: index("bookings_qualification_idx").on(t.qualificationScore),
        idxPriority: index("bookings_priority_idx").on(t.priorityScore),
    })
);

/**
 * booking_reminders - Enhanced with more reminder types
 */
export const bookingReminders = pgTable(
    "booking_reminders",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),

        type: text("type").notNull(), // 'email' | 'sms' | 'both' | 'push'
        triggerMinutes: integer("trigger_minutes").notNull(), // Minutes before meeting

        // Enhanced reminder configuration
        reminderTemplate: text("reminder_template"), // Template ID or name
        customMessage: text("custom_message"), // Override default message
        includeQualificationSummary: boolean("include_qualification_summary").notNull().default(false),
        includePreparationTips: boolean("include_preparation_tips").notNull().default(false),

        status: reminderStatusEnum("status").notNull().default("pending"),
        sentAt: timestamp("sent_at"),
        deliveredAt: timestamp("delivered_at"),
        failureReason: text("failure_reason"),

        subject: text("subject"),
        message: text("message"),

        // Delivery tracking
        externalId: text("external_id"), // ID from email/SMS provider
        deliveryStatus: text("delivery_status"), // delivered, bounced, opened, clicked

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxBookingTrigger: index("booking_reminders_booking_trigger_idx").on(t.bookingId, t.triggerMinutes),
        idxStatus: index("booking_reminders_status_idx").on(t.status),
    })
);

/**
 * meeting_feedback - Enhanced with more detailed outcomes
 */
export const meetingFeedback = pgTable(
    "meeting_feedback",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id").notNull().references(() => bookings.id, { onDelete: "cascade" }),

        // Ratings
        hostRating: integer("host_rating"), // 1-5 stars from guest
        guestRating: integer("guestRating"), // 1-5 stars from host
        overallSatisfaction: integer("overall_satisfaction"), // 1-5 composite score

        // Meeting outcomes
        outcome: text("outcome"), // qualified, not_qualified, demo_scheduled, contract_sent, etc.
        notes: text("notes"),
        nextSteps: text("next_steps"),

        // Enhanced tracking
        wasNoShow: boolean("was_no_show").notNull().default(false),
        wasSpam: boolean("was_spam").notNull().default(false),
        wasQualified: boolean("was_qualified"), // Did they meet qualification criteria in the actual meeting?
        qualityScore: integer("quality_score"), // 1-100, overall lead quality

        // Follow-up tracking
        followUpRequired: boolean("follow_up_required").notNull().default(false),
        followUpCompleted: boolean("follow_up_completed").notNull().default(false),
        followUpDate: timestamp("follow_up_date"),

        // Business impact
        estimatedValue: real("estimated_value"), // Potential deal value
        closeProbability: integer("close_probability"), // 0-100, likelihood of closing deal
        timeToClose: integer("time_to_close"), // Estimated days to close

        // AI analysis of meeting
        aiMeetingSummary: text("ai_meeting_summary"), // AI-generated meeting summary
        aiNextStepsRecommendation: text("ai_next_steps_recommendation"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxBookingFeedback: index("meeting_feedback_booking_idx").on(t.bookingId),
        idxOutcome: index("meeting_feedback_outcome_idx").on(t.outcome),
        idxQuality: index("meeting_feedback_quality_idx").on(t.qualityScore),
    })
);

/**
 * team_assignments - Enhanced for better round-robin and weighted assignment
 */
export const teamAssignments = pgTable(
    "team_assignments",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

        // Assignment configuration
        weight: integer("weight").notNull().default(1), // Higher weight = more assignments
        isActive: boolean("is_active").notNull().default(true),

        // Limits and constraints
        maxBookingsPerDay: integer("max_bookings_per_day"),
        maxBookingsPerWeek: integer("max_bookings_per_week"),
        maxBookingsPerMonth: integer("max_bookings_per_month"),

        // Assignment rules and criteria
        assignmentRules: jsonb("assignment_rules"), // Complex assignment logic
        qualificationRequirements: jsonb("qualification_requirements"), // Only assign certain types of prospects

        // Availability overrides
        availabilityOverrides: jsonb("availability_overrides"), // Team member specific availability
        timeZonePreferences: jsonb("time_zone_preferences"), // Preferred time zones

        // Performance tracking
        totalAssignments: integer("total_assignments").notNull().default(0),
        completedMeetings: integer("completed_meetings").notNull().default(0),
        noShows: integer("no_shows").notNull().default(0),
        averageRating: real("average_rating").notNull().default(0),
        lastAssignedAt: timestamp("last_assigned_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxEventUser: index("team_assignments_event_user_idx").on(t.eventTypeId, t.userId),
        uqEventUser: uniqueIndex("team_assignments_event_user_uq").on(t.eventTypeId, t.userId),
        idxActive: index("team_assignments_active_idx").on(t.isActive),
    })
);

/**
 * booking_analytics - Daily aggregates for scheduling performance
 */
export const bookingAnalytics = pgTable(
    "booking_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),

        date: timestamp("date").notNull(),

        // Core booking metrics
        totalBookings: integer("total_bookings").notNull().default(0),
        confirmedBookings: integer("confirmed_bookings").notNull().default(0),
        completedMeetings: integer("completed_meetings").notNull().default(0),
        cancelledBookings: integer("cancelled_bookings").notNull().default(0),
        noShows: integer("no_shows").notNull().default(0),
        rescheduledBookings: integer("rescheduled_bookings").notNull().default(0),

        // SchedForm-specific metrics
        averageQualificationScore: real("average_qualification_score").notNull().default(0),
        qualifiedBookings: integer("qualified_bookings").notNull().default(0),
        highPriorityBookings: integer("high_priority_bookings").notNull().default(0),
        spamBookingsBlocked: integer("spam_bookings_blocked").notNull().default(0),

        // Time and scheduling metrics
        averageBookingLeadTime: integer("average_booking_lead_time").notNull().default(0), // hours in advance
        averageBookingDuration: integer("average_booking_duration").notNull().default(0), // seconds to complete booking
        peakBookingHour: integer("peak_booking_hour"), // Hour of day with most bookings

        // Conversion funnel
        formViews: integer("form_views").notNull().default(0),
        formStarts: integer("form_starts").notNull().default(0),
        formCompletions: integer("form_completions").notNull().default(0),
        schedulingPageViews: integer("scheduling_page_views").notNull().default(0),

        // Revenue tracking
        totalRevenue: real("total_revenue").notNull().default(0),
        averageBookingValue: real("average_booking_value").notNull().default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqEventDate: uniqueIndex("booking_analytics_event_date_uq").on(t.eventTypeId, t.date),
        idxUser: index("booking_analytics_user_idx").on(t.userId),
        idxDate: index("booking_analytics_date_idx").on(t.date),
    })
);

/* ============================
   Relations (type-safe helpers)
   ============================ */

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
    user: one(user, { fields: [calendarConnections.userId], references: [user.id] }),
    availabilitySlots: many(availabilitySlots),
    bookings: many(bookings),
    blockedTimes: many(blockedTimes),
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
    owner: one(user, { fields: [eventTypes.userId], references: [user.id] }),
    form: one(forms, { fields: [eventTypes.formId], references: [forms.id] }),
    availabilitySlots: many(availabilitySlots),
    teamAssignments: many(teamAssignments),
    bookings: many(bookings),
    analytics: many(bookingAnalytics),
    availabilityRules: many(availabilityRules),
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
    // Self-relation for reschedule tracking
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

export const bookingAnalyticsRelations = relations(bookingAnalytics, ({ one }) => ({
    eventType: one(eventTypes, { fields: [bookingAnalytics.eventTypeId], references: [eventTypes.id] }),
    user: one(user, { fields: [bookingAnalytics.userId], references: [user.id] }),
}));