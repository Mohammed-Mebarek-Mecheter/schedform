// src/db/schema/scheduling.ts
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
import { relations, sql } from "drizzle-orm";
import { users, organizations, teams } from "@/db/schema/auth";
import { formResponses, forms } from "@/db/schema/forms";
import { eventTypeTranslations, supportedLanguages } from "@/db/schema/localization";

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
 * Calendar connections - per-user calendar OAuth connections with organization context
 */
export const calendarConnections = pgTable(
    "calendar_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id")
            .references(() => teams.id, { onDelete: "set null" }),
        provider: calendarProviderEnum("provider").notNull(),
        name: text("name").notNull(),
        email: text("email").notNull(),
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),
        calendarId: text("calendar_id").notNull(),
        timeZone: text("time_zone").notNull(),
        isDefault: boolean("is_default").notNull().default(false),
        isActive: boolean("is_active").notNull().default(true),
        isPersonal: boolean("is_personal").notNull().default(false),
        lastSyncAt: timestamp("last_sync_at", { mode: "date" }),
        syncStatus: text("sync_status").notNull().default("pending"),
        syncErrors: jsonb("sync_errors"),
        totalBookings: integer("total_bookings").notNull().default(0),
        failedSyncs: integer("failed_syncs").notNull().default(0),
        permissions: jsonb("permissions"), // Access permissions for team/organization
        metadata: jsonb("metadata"), // Additional provider-specific metadata
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("calendar_connections_user_idx").on(t.userId),
        idxOrganization: index("calendar_connections_organization_idx").on(t.organizationId),
        idxTeam: index("calendar_connections_team_idx").on(t.teamId).where(sql`${t.teamId} IS NOT NULL`),
        uqUserDefault: uniqueIndex("calendar_connections_user_default_uq")
            .on(t.userId, t.isDefault)
            .where(sql`${t.isDefault} = true`),
        chkEmail: sql`CHECK (${t.email} ~ '^[^@]+@[^@]+\\.[^@]+')`,
        chkTotals: sql`CHECK (${t.totalBookings} >= 0 AND ${t.failedSyncs} >= 0)`,
    }),
);

/**
 * Event types - meeting templates with organization and team context
 */
export const eventTypes = pgTable(
    "event_types",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "restrict" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id")
            .references(() => teams.id, { onDelete: "set null" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
        title: text("title").notNull(),
        description: text("description"),
        slug: text("slug").notNull(),
        regionalSettings: jsonb("regional_settings"),
        defaultLanguage: text("default_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
        supportedLanguages: jsonb("supported_languages"), // Array of language codes
        autoDetectLanguage: boolean("auto_detect_language").notNull().default(true),
        localizedConfirmationTemplates: jsonb("localized_confirmation_templates"), // Per language
        localizedReminderTemplates: jsonb("localized_reminder_templates"),
        localizedCancellationTemplates: jsonb("localized_cancellation_templates"),
        duration: integer("duration").notNull(),
        bufferTimeBefore: integer("buffer_time_before").notNull().default(0),
        bufferTimeAfter: integer("buffer_time_after").notNull().default(0),
        minimumNotice: integer("minimum_notice").notNull().default(60),
        maximumDaysOut: integer("maximum_days_out").notNull().default(30),
        meetingType: meetingTypeEnum("meeting_type").notNull().default("video"),
        location: text("location"),
        meetingUrl: text("meeting_url"),
        schedulingMode: schedulingModeEnum("scheduling_mode").notNull().default("instant"),
        requiresApproval: boolean("requires_approval").notNull().default(false),
        maxBookingsPerDay: integer("max_bookings_per_day"),
        maxBookingsPerWeek: integer("max_bookings_per_week"),
        maxBookingsPerMonth: integer("max_bookings_per_month"),
        bookingFrequencyLimit: integer("booking_frequency_limit"),
        dynamicDuration: boolean("dynamic_duration").notNull().default(false),
        singleUseLinks: boolean("single_use_links").notNull().default(false),
        enableAiOptimization: boolean("enable_ai_optimization").notNull().default(true),
        requireEmailVerification: boolean("require_email_verification").notNull().default(true),
        requireSmsVerification: boolean("require_sms_verification").notNull().default(false),
        highValueThreshold: integer("high_value_threshold"),
        customBranding: boolean("custom_branding").notNull().default(false),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        logoUrl: text("logo_url"),
        brandingConfig: jsonb("branding_config"),
        minimumQualificationScore: real("minimum_qualification_score"),
        requiresManualReview: boolean("requires_manual_review").notNull().default(false),
        qualificationCriteria: jsonb("qualification_criteria"),
        price: real("price"),
        currency: text("currency").default("USD"),
        paymentRequired: boolean("payment_required").notNull().default(false),
        totalBookings: integer("total_bookings").notNull().default(0),
        completedBookings: integer("completed_bookings").notNull().default(0),
        noShowRate: real("no_show_rate").notNull().default(0),
        averageQualificationScore: real("average_qualification_score").notNull().default(0),
        isActive: boolean("is_active").notNull().default(true),
        isTemplate: boolean("is_template").notNull().default(false),
        visibility: text("visibility").notNull().default("private"), // private, team, organization, public
        permissions: jsonb("permissions"), // Fine-grained access control
        metadata: jsonb("metadata"),
        archivedAt: timestamp("archived_at", { mode: "date" }),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqSlug: uniqueIndex("event_types_slug_uq").on(t.slug),
        idxUserActive: index("event_types_user_active_idx").on(t.userId, t.isActive),
        idxOrganization: index("event_types_organization_idx").on(t.organizationId),
        idxTeam: index("event_types_team_idx").on(t.teamId).where(sql`${t.teamId} IS NOT NULL`),
        idxForm: index("event_types_form_idx").on(t.formId).where(sql`${t.formId} IS NOT NULL`),

        // ✅ move checks here
        chkDuration: sql`CHECK (${t.duration} > 0 AND ${t.duration} <= 1440)`,
        chkBufferBefore: sql`CHECK (${t.bufferTimeBefore} >= 0 AND ${t.bufferTimeBefore} <= 240)`,
        chkBufferAfter: sql`CHECK (${t.bufferTimeAfter} >= 0 AND ${t.bufferTimeAfter} <= 240)`,
        chkMinimumNotice: sql`CHECK (${t.minimumNotice} >= 0)`,
        chkMaximumDaysOut: sql`CHECK (${t.maximumDaysOut} > 0 AND ${t.maximumDaysOut} <= 365)`,
        chkMeetingUrl: sql`CHECK (${t.meetingUrl} IS NULL OR ${t.meetingUrl} ~ '^https?://')`,
        chkPrimaryColor: sql`CHECK (${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$')`,
        chkHighValue: sql`CHECK (${t.highValueThreshold} IS NULL OR (${t.highValueThreshold} >= 0 AND ${t.highValueThreshold} <= 100))`,
        chkMinQual: sql`CHECK (${t.minimumQualificationScore} IS NULL OR (${t.minimumQualificationScore} >= 0 AND ${t.minimumQualificationScore} <= 100))`,
        chkPrice: sql`CHECK (${t.price} IS NULL OR ${t.price} >= 0)`,
        chkTotals: sql`CHECK (${t.totalBookings} >= 0 AND ${t.completedBookings} >= 0)`,
        chkNoShowRate: sql`CHECK (${t.noShowRate} >= 0 AND ${t.noShowRate} <= 100)`,
        chkAvgQualScore: sql`CHECK (${t.averageQualificationScore} >= 0 AND ${t.averageQualificationScore} <= 100)`,
        chkVisibility: sql`CHECK (${t.visibility} IN ('private', 'team', 'organization', 'public'))`,
    }),
);

/**
 * Availability slots - optimized indexing with organization context
 */
export const availabilitySlots = pgTable(
    "availability_slots",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id")
            .notNull()
            .references(() => eventTypes.id, { onDelete: "cascade" }),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),

        isAvailable: boolean("is_available").notNull().default(true),
        isBlocked: boolean("is_blocked").notNull().default(false),

        optimalityScore: integer("optimality_score"),
        aiRecommendationReason: text("ai_recommendation_reason"),

        maxBookings: integer("max_bookings").default(1),
        currentBookings: integer("current_bookings").default(0),

        metadata: jsonb("metadata"), // Additional slot metadata
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxEventTimeAvailable: index("availability_slots_event_time_available_idx")
            .on(t.eventTypeId, t.startTime, t.isAvailable),
        idxCalendarTime: index("availability_slots_calendar_time_idx").on(
            t.calendarConnectionId,
            t.startTime,
        ),
        idxOrganization: index("availability_slots_organization_idx").on(t.organizationId),
        uqCalendarSlot: uniqueIndex("availability_slots_calendar_time_uq").on(
            t.calendarConnectionId,
            t.startTime,
        ),
        chkOptimality: sql`CHECK (${t.optimalityScore} IS NULL OR (${t.optimalityScore} >= 0 AND ${t.optimalityScore} <= 100))`,
        chkMaxBookings: sql`CHECK (${t.maxBookings} > 0)`,
        chkCurrentBookings: sql`CHECK (${t.currentBookings} >= 0)`,
    }),
);

/**
 * Availability rules - simplified indexing with organization context
 */
export const availabilityRules = pgTable(
    "availability_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, {
            onDelete: "cascade",
        }),

        name: text("name").notNull(),
        dayOfWeek: integer("day_of_week").notNull(),
        startTime: text("start_time").notNull(), // HH:MM
        endTime: text("end_time").notNull(), // HH:MM
        timeZone: text("time_zone").notNull(),

        validFrom: timestamp("valid_from", { mode: "date" }),
        validUntil: timestamp("valid_until", { mode: "date" }),
        maxBookingsPerSlot: integer("max_bookings_per_slot").default(1),

        recurringPattern: jsonb("recurring_pattern"),
        exceptions: jsonb("exceptions"),

        isActive: boolean("is_active").notNull().default(true),
        priority: integer("priority").default(1), // Rule priority for conflict resolution

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUserActive: index("availability_rules_user_active_idx").on(
            t.userId,
            t.isActive,
        ),
        idxOrganization: index("availability_rules_organization_idx").on(t.organizationId),
        idxEventType: index("availability_rules_event_type_idx")
            .on(t.eventTypeId)
            .where(sql`${t.eventTypeId} IS NOT NULL`),
        idxDayTime: index("availability_rules_day_time_idx").on(
            t.dayOfWeek,
            t.startTime,
        ),
        chkDayOfWeek: sql`CHECK (${t.dayOfWeek} >= 0 AND ${t.dayOfWeek} <= 6)`,
        chkMaxBookingsPerSlot: sql`CHECK (${t.maxBookingsPerSlot} > 0)`,
        chkPriority: sql`CHECK (${t.priority} >= 1 AND ${t.priority} <= 10)`,
    }),
);

/**
 * Blocked times - optimized with organization context
 */
export const blockedTimes = pgTable(
    "blocked_times",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        calendarConnectionId: text("calendar_connection_id").references(
            () => calendarConnections.id,
            { onDelete: "cascade" },
        ),

        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),

        title: text("title").notNull(),
        description: text("description"),
        isAllDay: boolean("is_all_day").notNull().default(false),

        externalEventId: text("external_event_id"),
        isRecurring: boolean("is_recurring").notNull().default(false),

        blockType: text("block_type").default("busy"),
        blockPriority: integer("block_priority").default(1),

        isSyncedFromExternal: boolean("is_synced_from_external")
            .notNull()
            .default(false),
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),

        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUserTimeRange: index("blocked_times_user_time_range_idx").on(
            t.userId,
            t.startTime,
            t.endTime,
        ),
        idxOrganization: index("blocked_times_organization_idx").on(t.organizationId),
        idxCalendarTime: index("blocked_times_calendar_time_idx")
            .on(t.calendarConnectionId, t.startTime)
            .where(sql`${t.calendarConnectionId} IS NOT NULL`),
        chkBlockPriority: sql`CHECK (${t.blockPriority} >= 1 AND ${t.blockPriority} <= 5)`,
    }),
);

/**
 * Bookings - comprehensive with proper validation and organization context
 */
export const bookings = pgTable(
    "bookings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id")
            .notNull()
            .references(() => eventTypes.id, { onDelete: "restrict" }),
        formResponseId: text("form_response_id").references(() => formResponses.id, {
            onDelete: "set null",
        }),
        calendarConnectionId: text("calendar_connection_id")
            .notNull()
            .references(() => calendarConnections.id, { onDelete: "restrict" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        startTime: timestamp("start_time", { mode: "date" }).notNull(),
        endTime: timestamp("end_time", { mode: "date" }).notNull(),
        timeZone: text("time_zone").notNull(),

        guestName: text("guest_name").notNull(),
        guestEmail: text("guest_email").notNull(),
        guestPhone: varchar("guest_phone", { length: 64 }),
        guestCompany: text("guest_company"),
        guestTitle: text("guest_title"),

        meetingType: meetingTypeEnum("meeting_type").notNull(),
        location: text("location"),
        meetingUrl: text("meeting_url"),
        meetingId: text("meeting_id"),
        meetingPassword: text("meeting_password"),
        dialInNumber: text("dial_in_number"),

        status: bookingStatusEnum("status").notNull().default("draft"),
        statusHistory: jsonb("status_history"),
        confirmationCode: text("confirmation_code"),

        cancellationReason: text("cancellation_reason"),
        cancelledAt: timestamp("cancelled_at", { mode: "date" }),
        cancelledBy: text("cancelled_by"),
        rescheduleCount: integer("reschedule_count").notNull().default(0),
        originalBookingId: text("original_booking_id"),

        qualificationScore: real("qualification_score"),
        qualificationSummary: text("qualification_summary"),
        priorityScore: integer("priority_score"),
        intentScore: integer("intent_score"),

        prospectInsights: jsonb("prospect_insights"),
        meetingPreparation: jsonb("meeting_preparation"),
        expectedOutcome: text("expected_outcome"),

        emailVerified: boolean("email_verified").notNull().default(false),
        emailVerificationToken: text("email_verification_token"),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),

        smsVerified: boolean("sms_verified").notNull().default(false),
        smsVerificationToken: text("sms_verification_token"),
        smsVerifiedAt: timestamp("sms_verified_at", { mode: "date" }),

        externalCalendarEventId: text("external_calendar_event_id"),
        calendarEventCreated: boolean("calendar_event_created")
            .notNull()
            .default(false),
        calendarEventError: text("calendar_event_error"),

        noShowReason: noShowReasonEnum("no_show_reason"),
        noShowDetectedAt: timestamp("no_show_detected_at", { mode: "date" }),
        noShowFollowUpSent: boolean("no_show_follow_up_sent")
            .notNull()
            .default(false),

        price: real("price"),
        currency: text("currency"),
        paymentStatus: text("payment_status"),
        paymentIntentId: text("payment_intent_id"),

        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),
        utmSource: varchar("utm_source", { length: 128 }),
        utmMedium: varchar("utm_medium", { length: 128 }),
        utmCampaign: varchar("utm_campaign", { length: 128 }),
        referrer: text("referrer"),

        bookingDuration: integer("booking_duration"),
        conversionSource: text("conversion_source"),

        detectedLanguage: text("detected_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
        preferredLanguage: text("preferred_language").references(() => supportedLanguages.code, { onDelete: "set null" }),

        // Timezone and locale preferences
        detectedTimezone: text("detected_timezone"),
        preferredDateFormat: text("preferred_date_format"),
        preferredTimeFormat: text("preferred_time_format"),

        // Localized meeting details
        localizedMeetingDetails: jsonb("localized_meeting_details"), // Meeting info in guest's language
        localizedPreparationTips: jsonb("localized_preparation_tips"),

        // Organization and team context
        assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
        permissions: jsonb("permissions"), // Booking-specific permissions
        metadata: jsonb("metadata"), // Additional booking metadata

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConfirmationCode: uniqueIndex("bookings_confirmation_code_uq")
            .on(t.confirmationCode)
            .where(sql`${t.confirmationCode} IS NOT NULL`),
        idxEventStartStatus: index("bookings_event_start_status_idx").on(
            t.eventTypeId,
            t.startTime,
            t.status,
        ),
        idxOrganization: index("bookings_organization_idx").on(t.organizationId),
        idxTeam: index("bookings_team_idx").on(t.teamId).where(sql`${t.teamId} IS NOT NULL`),
        idxGuestEmail: index("bookings_guest_email_idx").on(t.guestEmail),
        idxStartTime: index("bookings_start_time_idx").on(t.startTime),
        idxCreated: index("bookings_created_idx").on(t.createdAt),
        idxAssignedUser: index("bookings_assigned_user_idx").on(t.assignedUserId).where(sql`${t.assignedUserId} IS NOT NULL`),

        chkGuestEmail: sql`CHECK (${t.guestEmail} ~ '^[^@]+@[^@]+\\.[^@]+')`,
        chkMeetingUrl: sql`CHECK (${t.meetingUrl} IS NULL OR ${t.meetingUrl} ~ '^https?://')`,
        chkRescheduleCount: sql`CHECK (${t.rescheduleCount} >= 0)`,
        chkQualificationScore: sql`CHECK (${t.qualificationScore} IS NULL OR (${t.qualificationScore} >= 0 AND ${t.qualificationScore} <= 100))`,
        chkPriorityScore: sql`CHECK (${t.priorityScore} IS NULL OR (${t.priorityScore} >= 1 AND ${t.priorityScore} <= 100))`,
        chkIntentScore: sql`CHECK (${t.intentScore} IS NULL OR (${t.intentScore} >= 1 AND ${t.intentScore} <= 100))`,
        chkPrice: sql`CHECK (${t.price} IS NULL OR ${t.price} >= 0)`,
        chkBookingDuration: sql`CHECK (${t.bookingDuration} IS NULL OR ${t.bookingDuration} > 0)`,
    }),
);

/**
 * Booking reminders - simplified with organization context
 */
export const bookingReminders = pgTable(
    "booking_reminders",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        type: text("type").notNull(), // 'email' | 'sms' | 'both' | 'push'
        triggerMinutes: integer("trigger_minutes").notNull(), // Minutes before meeting

        // Configuration
        reminderTemplate: text("reminder_template"),
        customMessage: text("custom_message"),
        includeQualificationSummary: boolean("include_qualification_summary")
            .notNull()
            .default(false),
        includePreparationTips: boolean("include_preparation_tips")
            .notNull()
            .default(false),

        status: reminderStatusEnum("status").notNull().default("pending"),
        sentAt: timestamp("sent_at", { mode: "date" }),
        deliveredAt: timestamp("delivered_at", { mode: "date" }),
        failureReason: text("failure_reason"),

        subject: text("subject"),
        message: text("message"),

        // Delivery tracking
        externalId: text("external_id"),
        deliveryStatus: text("delivery_status"),

        metadata: jsonb("metadata"),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxBookingTrigger: index("booking_reminders_booking_trigger_idx").on(
            t.bookingId,
            t.triggerMinutes,
        ),
        idxOrganization: index("booking_reminders_organization_idx").on(t.organizationId),
        idxStatusPending: index("booking_reminders_status_pending_idx")
            .on(t.status, t.sentAt)
            .where(sql`${t.status} = 'pending'`),
        chkTriggerMinutes: sql`CHECK (${t.triggerMinutes} > 0)`,
    }),
);

/**
 * Meeting feedback - enhanced tracking with organization context
 */
export const meetingFeedback = pgTable(
    "meeting_feedback",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Ratings
        hostRating: integer("host_rating"),
        guestRating: integer("guest_rating"),
        overallSatisfaction: integer("overall_satisfaction"),

        // Outcomes
        outcome: text("outcome"),
        notes: text("notes"),
        nextSteps: text("next_steps"),

        // Enhanced tracking
        wasNoShow: boolean("was_no_show").notNull().default(false),
        wasSpam: boolean("was_spam").notNull().default(false),
        wasQualified: boolean("was_qualified"),
        qualityScore: integer("quality_score"),

        // Follow-up
        followUpRequired: boolean("follow_up_required").notNull().default(false),
        followUpCompleted: boolean("follow_up_completed").notNull().default(false),
        followUpDate: timestamp("follow_up_date", { mode: "date" }),

        // Business impact
        estimatedValue: real("estimated_value"),
        closeProbability: integer("close_probability"),
        timeToClose: integer("time_to_close"),

        // AI analysis
        aiMeetingSummary: text("ai_meeting_summary"),
        aiNextStepsRecommendation: text("ai_next_steps_recommendation"),

        // Organization context
        reviewerUserId: text("reviewer_user_id").references(() => users.id, { onDelete: "set null" }),
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqBooking: uniqueIndex("meeting_feedback_booking_uq").on(t.bookingId),
        idxOrganization: index("meeting_feedback_organization_idx").on(t.organizationId),
        idxOutcome: index("meeting_feedback_outcome_idx")
            .on(t.outcome)
            .where(sql`${t.outcome} IS NOT NULL`),

        chkHostRating: sql`CHECK (${t.hostRating} IS NULL OR (${t.hostRating} >= 1 AND ${t.hostRating} <= 5))`,
        chkGuestRating: sql`CHECK (${t.guestRating} IS NULL OR (${t.guestRating} >= 1 AND ${t.guestRating} <= 5))`,
        chkOverallSatisfaction: sql`CHECK (${t.overallSatisfaction} IS NULL OR (${t.overallSatisfaction} >= 1 AND ${t.overallSatisfaction} <= 5))`,
        chkQualityScore: sql`CHECK (${t.qualityScore} IS NULL OR (${t.qualityScore} >= 1 AND ${t.qualityScore} <= 100))`,
        chkEstimatedValue: sql`CHECK (${t.estimatedValue} IS NULL OR ${t.estimatedValue} >= 0)`,
        chkCloseProbability: sql`CHECK (${t.closeProbability} IS NULL OR (${t.closeProbability} >= 0 AND ${t.closeProbability} <= 100))`,
        chkTimeToClose: sql`CHECK (${t.timeToClose} IS NULL OR ${t.timeToClose} > 0)`,
    }),
);

/**
 * Team assignments - simplified for performance with organization context
 */
export const teamAssignments = pgTable(
    "team_assignments",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id")
            .notNull()
            .references(() => eventTypes.id, { onDelete: "cascade" }),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        // Assignment configuration
        weight: integer("weight").notNull().default(1),
        isActive: boolean("is_active").notNull().default(true),

        // Limits
        maxBookingsPerDay: integer("max_bookings_per_day"),
        maxBookingsPerWeek: integer("max_bookings_per_week"),
        maxBookingsPerMonth: integer("max_bookings_per_month"),

        // Configuration
        assignmentRules: jsonb("assignment_rules"),
        qualificationRequirements: jsonb("qualification_requirements"),
        availabilityOverrides: jsonb("availability_overrides"),
        timeZonePreferences: jsonb("time_zone_preferences"),

        // Performance tracking
        totalAssignments: integer("total_assignments").notNull().default(0),
        completedMeetings: integer("completed_meetings").notNull().default(0),
        noShows: integer("no_shows").notNull().default(0),
        averageRating: real("average_rating").notNull().default(0),
        lastAssignedAt: timestamp("last_assigned_at", { mode: "date" }),

        // Permissions and metadata
        permissions: jsonb("permissions"),
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEventUser: uniqueIndex("team_assignments_event_user_uq").on(
            t.eventTypeId,
            t.userId,
        ),
        idxOrganization: index("team_assignments_organization_idx").on(t.organizationId),
        idxActive: index("team_assignments_active_idx")
            .on(t.isActive, t.weight)
            .where(sql`${t.isActive} = true`),

        chkWeight: sql`CHECK (${t.weight} > 0 AND ${t.weight} <= 100)`,
        chkMaxPerDay: sql`CHECK (${t.maxBookingsPerDay} IS NULL OR ${t.maxBookingsPerDay} > 0)`,
        chkMaxPerWeek: sql`CHECK (${t.maxBookingsPerWeek} IS NULL OR ${t.maxBookingsPerWeek} > 0)`,
        chkMaxPerMonth: sql`CHECK (${t.maxBookingsPerMonth} IS NULL OR ${t.maxBookingsPerMonth} > 0)`,
        chkTotals: sql`CHECK (${t.totalAssignments} >= 0 AND ${t.completedMeetings} >= 0 AND ${t.noShows} >= 0)`,
        chkAverageRating: sql`CHECK (${t.averageRating} >= 0 AND ${t.averageRating} <= 5)`,
    }),
);

/**
 * Booking analytics - daily aggregates for performance with organization context
 */
export const bookingAnalytics = pgTable(
    "booking_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id")
            .notNull()
            .references(() => eventTypes.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => users.id, {
            onDelete: "cascade",
        }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        date: timestamp("date", { mode: "date" }).notNull(),

        // Core metrics
        totalBookings: integer("total_bookings").notNull().default(0),
        confirmedBookings: integer("confirmed_bookings").notNull().default(0),
        completedMeetings: integer("completed_meetings").notNull().default(0),
        cancelledBookings: integer("cancelled_bookings").notNull().default(0),
        noShows: integer("no_shows").notNull().default(0),
        rescheduledBookings: integer("rescheduled_bookings").notNull().default(0),

        // Quality metrics
        averageQualificationScore: real("average_qualification_score")
            .notNull()
            .default(0),
        qualifiedBookings: integer("qualified_bookings").notNull().default(0),
        highPriorityBookings: integer("high_priority_bookings")
            .notNull()
            .default(0),
        spamBookingsBlocked: integer("spam_bookings_blocked").notNull().default(0),

        // Time metrics
        averageBookingLeadTime: integer("average_booking_lead_time")
            .notNull()
            .default(0),
        averageBookingDuration: integer("average_booking_duration")
            .notNull()
            .default(0),
        peakBookingHour: integer("peak_booking_hour"),

        // Funnel metrics
        formViews: integer("form_views").notNull().default(0),
        formStarts: integer("form_starts").notNull().default(0),
        formCompletions: integer("form_completions").notNull().default(0),
        schedulingPageViews: integer("scheduling_page_views")
            .notNull()
            .default(0),

        // Revenue tracking
        totalRevenue: real("total_revenue").notNull().default(0),
        averageBookingValue: real("average_booking_value").notNull().default(0),

        // Organization context
        metadata: jsonb("metadata"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEventDate: uniqueIndex("booking_analytics_event_date_uq").on(
            t.eventTypeId,
            t.date,
        ),
        idxDate: index("booking_analytics_date_idx").on(t.date),
        idxOrganization: index("booking_analytics_organization_idx").on(t.organizationId),
        idxUser: index("booking_analytics_user_idx")
            .on(t.userId)
            .where(sql`${t.userId} IS NOT NULL`),

        chkTotals: sql`CHECK (${t.totalBookings} >= 0 AND ${t.confirmedBookings} >= 0 AND ${t.completedMeetings} >= 0 AND ${t.cancelledBookings} >= 0 AND ${t.noShows} >= 0 AND ${t.rescheduledBookings} >= 0)`,
        chkAvgQual: sql`CHECK (${t.averageQualificationScore} >= 0 AND ${t.averageQualificationScore} <= 100)`,
        chkQualifiedBookings: sql`CHECK (${t.qualifiedBookings} >= 0 AND ${t.highPriorityBookings} >= 0 AND ${t.spamBookingsBlocked} >= 0)`,
        chkTimeMetrics: sql`CHECK (${t.averageBookingLeadTime} >= 0 AND ${t.averageBookingDuration} >= 0)`,
        chkPeakHour: sql`CHECK (${t.peakBookingHour} IS NULL OR (${t.peakBookingHour} >= 0 AND ${t.peakBookingHour} <= 23))`,
        chkFunnels: sql`CHECK (${t.formViews} >= 0 AND ${t.formStarts} >= 0 AND ${t.formCompletions} >= 0 AND ${t.schedulingPageViews} >= 0)`,
        chkRevenue: sql`CHECK (${t.totalRevenue} >= 0 AND ${t.averageBookingValue} >= 0)`,
    }),
);

/* ---------------- Booking Reminder Translations ---------------- */
export const bookingReminderTranslations = pgTable(
    "booking_reminder_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        reminderId: text("reminder_id").notNull().references(() => bookingReminders.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Localized reminder content
        subject: text("subject"),
        message: text("message"),
        customMessage: text("custom_message"),

        // Localized template reference
        reminderTemplate: text("reminder_template"), // Reference to localized template

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqReminderLanguage: uniqueIndex("booking_reminder_translations_reminder_language_uq").on(t.reminderId, t.languageCode),
        idxLanguage: index("booking_reminder_translations_language_idx").on(t.languageCode),
        idxOrganization: index("booking_reminder_translations_organization_idx").on(t.organizationId),
    })
);

/* ---------------- Localized Meeting Feedback ---------------- */
export const meetingFeedbackTranslations = pgTable(
    "meeting_feedback_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        feedbackId: text("feedback_id").notNull().references(() => meetingFeedback.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Localized feedback content
        notes: text("notes"),
        nextSteps: text("next_steps"),
        outcome: text("outcome"),

        // AI-generated content in local language
        aiMeetingSummary: text("ai_meeting_summary"),
        aiNextStepsRecommendation: text("ai_next_steps_recommendation"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFeedbackLanguage: uniqueIndex("meeting_feedback_translations_feedback_language_uq").on(t.feedbackId, t.languageCode),
        idxOrganization: index("meeting_feedback_translations_organization_idx").on(t.organizationId),
    })
);

/* ---------------- Localized Booking Status Messages ---------------- */
export const bookingStatusMessages = pgTable(
    "booking_status_messages",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        statusKey: text("status_key").notNull(), // "confirmed", "cancelled", "no_show", etc.
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Different message types for each status
        emailSubject: text("email_subject"),
        emailBody: text("email_body"),
        smsMessage: text("sms_message"),
        inAppMessage: text("in_app_message"),

        // Context-specific variables
        availableVariables: jsonb("available_variables"), // What variables can be used in this status

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqStatusLanguage: uniqueIndex("booking_status_messages_status_language_uq").on(t.statusKey, t.languageCode),
        idxStatus: index("booking_status_messages_status_idx").on(t.statusKey),
        idxLanguage: index("booking_status_messages_language_idx").on(t.languageCode),
        idxOrganization: index("booking_status_messages_organization_idx").on(t.organizationId),
    })
);

/* ---------------- Time Zone Translation Helpers ---------------- */
export const timezoneTranslations = pgTable(
    "timezone_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .references(() => organizations.id, { onDelete: "cascade" }),

        timezoneId: text("timezone_id").notNull(), // "America/New_York", "Europe/London", etc.
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        displayName: text("display_name").notNull(), // "Eastern Standard Time", "Hora del Este", etc.
        shortName: text("short_name"), // "EST", "GMT", etc.
        description: text("description"), // Human-friendly description

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTimezoneLanguage: uniqueIndex("timezone_translations_timezone_language_uq").on(t.timezoneId, t.languageCode),
        idxTimezone: index("timezone_translations_timezone_idx").on(t.timezoneId),
        idxLanguage: index("timezone_translations_language_idx").on(t.languageCode),
        idxOrganization: index("timezone_translations_organization_idx").on(t.organizationId).where(sql`${t.organizationId} IS NOT NULL`),
    })
);

/* ============================
   Relations (type-safe helpers)
   ============================ */

export const calendarConnectionsRelations = relations(calendarConnections, ({ one, many }) => ({
    user: one(users, { fields: [calendarConnections.userId], references: [users.id] }),
    organization: one(organizations, { fields: [calendarConnections.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [calendarConnections.teamId], references: [teams.id] }),
    availabilitySlots: many(availabilitySlots),
    bookings: many(bookings),
    blockedTimes: many(blockedTimes),
}));

export const eventTypesRelations = relations(eventTypes, ({ one, many }) => ({
    owner: one(users, { fields: [eventTypes.userId], references: [users.id] }),
    organization: one(organizations, { fields: [eventTypes.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [eventTypes.teamId], references: [teams.id] }),
    form: one(forms, { fields: [eventTypes.formId], references: [forms.id] }),
    availabilitySlots: many(availabilitySlots),
    teamAssignments: many(teamAssignments),
    bookings: many(bookings),
    analytics: many(bookingAnalytics),
    availabilityRules: many(availabilityRules),
    translations: many(eventTypeTranslations),
    defaultLanguageRef: one(supportedLanguages, {
        fields: [eventTypes.defaultLanguage],
        references: [supportedLanguages.code],
    }),
}));

export const availabilitySlotsRelations = relations(availabilitySlots, ({ one }) => ({
    eventType: one(eventTypes, { fields: [availabilitySlots.eventTypeId], references: [eventTypes.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [availabilitySlots.calendarConnectionId],
        references: [calendarConnections.id],
    }),
    organization: one(organizations, { fields: [availabilitySlots.organizationId], references: [organizations.id] }),
}));

export const availabilityRulesRelations = relations(availabilityRules, ({ one }) => ({
    user: one(users, { fields: [availabilityRules.userId], references: [users.id] }),
    organization: one(organizations, { fields: [availabilityRules.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [availabilityRules.teamId], references: [teams.id] }),
    eventType: one(eventTypes, { fields: [availabilityRules.eventTypeId], references: [eventTypes.id] }),
}));

export const blockedTimesRelations = relations(blockedTimes, ({ one }) => ({
    user: one(users, { fields: [blockedTimes.userId], references: [users.id] }),
    organization: one(organizations, { fields: [blockedTimes.organizationId], references: [organizations.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [blockedTimes.calendarConnectionId],
        references: [calendarConnections.id],
    }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
    eventType: one(eventTypes, { fields: [bookings.eventTypeId], references: [eventTypes.id] }),
    organization: one(organizations, { fields: [bookings.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [bookings.teamId], references: [teams.id] }),
    formResponse: one(formResponses, { fields: [bookings.formResponseId], references: [formResponses.id] }),
    calendarConnection: one(calendarConnections, {
        fields: [bookings.calendarConnectionId],
        references: [calendarConnections.id],
    }),
    assignedUser: one(users, { fields: [bookings.assignedUserId], references: [users.id] }),
    reminders: many(bookingReminders),
    feedback: many(meetingFeedback),
    // Self-relation for reschedule tracking
    originalBooking: one(bookings, {
        fields: [bookings.originalBookingId],
        references: [bookings.id],
    }),
    detectedLanguageRef: one(supportedLanguages, {
        fields: [bookings.detectedLanguage],
        references: [supportedLanguages.code],
    }),
    preferredLanguageRef: one(supportedLanguages, {
        fields: [bookings.preferredLanguage],
        references: [supportedLanguages.code],
    }),
}));

export const bookingRemindersRelations = relations(bookingReminders, ({ one, many }) => ({
    booking: one(bookings, { fields: [bookingReminders.bookingId], references: [bookings.id] }),
    organization: one(organizations, { fields: [bookingReminders.organizationId], references: [organizations.id] }),
    translations: many(bookingReminderTranslations),
}));

export const meetingFeedbackRelations = relations(meetingFeedback, ({ one, many }) => ({
    booking: one(bookings, { fields: [meetingFeedback.bookingId], references: [bookings.id] }),
    organization: one(organizations, { fields: [meetingFeedback.organizationId], references: [organizations.id] }),
    reviewerUser: one(users, { fields: [meetingFeedback.reviewerUserId], references: [users.id] }),
    translations: many(meetingFeedbackTranslations),
}));

export const teamAssignmentsRelations = relations(teamAssignments, ({ one }) => ({
    eventType: one(eventTypes, { fields: [teamAssignments.eventTypeId], references: [eventTypes.id] }),
    user: one(users, { fields: [teamAssignments.userId], references: [users.id] }),
    organization: one(organizations, { fields: [teamAssignments.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [teamAssignments.teamId], references: [teams.id] }),
}));

export const bookingAnalyticsRelations = relations(bookingAnalytics, ({ one }) => ({
    eventType: one(eventTypes, { fields: [bookingAnalytics.eventTypeId], references: [eventTypes.id] }),
    user: one(users, { fields: [bookingAnalytics.userId], references: [users.id] }),
    organization: one(organizations, { fields: [bookingAnalytics.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [bookingAnalytics.teamId], references: [teams.id] }),
}));

export const bookingReminderTranslationsRelations = relations(bookingReminderTranslations, ({ one }) => ({
    reminder: one(bookingReminders, {
        fields: [bookingReminderTranslations.reminderId],
        references: [bookingReminders.id]
    }),
    language: one(supportedLanguages, {
        fields: [bookingReminderTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [bookingReminderTranslations.organizationId],
        references: [organizations.id]
    }),
}));

export const meetingFeedbackTranslationsRelations = relations(meetingFeedbackTranslations, ({ one }) => ({
    feedback: one(meetingFeedback, {
        fields: [meetingFeedbackTranslations.feedbackId],
        references: [meetingFeedback.id]
    }),
    language: one(supportedLanguages, {
        fields: [meetingFeedbackTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [meetingFeedbackTranslations.organizationId],
        references: [organizations.id]
    }),
}));

export const bookingStatusMessagesRelations = relations(bookingStatusMessages, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [bookingStatusMessages.languageCode],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [bookingStatusMessages.organizationId],
        references: [organizations.id]
    }),
}));

export const timezoneTranslationsRelations = relations(timezoneTranslations, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [timezoneTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [timezoneTranslations.organizationId],
        references: [organizations.id]
    }),
}));
