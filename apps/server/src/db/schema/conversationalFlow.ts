// src/db/schema/conversationalFlow.ts
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
    real,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { formResponses, forms } from "@/db/schema/forms";
import { bookings, eventTypes } from "@/db/schema/scheduling";
import { users, organizations } from "@/db/schema/auth";

/**
 * Enums for conversational flow states
 */
export const flowStatusEnum = pgEnum("flow_status", [
    "form_started",
    "form_completed",
    "qualifying",
    "qualified",
    "disqualified",
    "scheduling_options",
    "booking_pending",
    "booking_confirmed",
    "booking_failed",
    "abandoned",
    "spam_detected",
]);

export const flowSchedulingModeEnum = pgEnum("flow_scheduling_mode", [
    "instant",
    "curated",
    "approval",
]);

export const priorityLevelEnum = pgEnum("priority_level", [
    "low",
    "medium",
    "high",
    "urgent",
]);

/**
 * Conversational Flows - The heart of SchedForm's integrated experience
 */
export const conversationalFlows = pgTable(
    "conversational_flows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        // Core relationships - fixed cascade behavior
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "restrict" }), // Don't delete forms with active flows
        formResponseId: text("form_response_id")
            .references(() => formResponses.id, { onDelete: "set null" }),
        eventTypeId: text("event_type_id")
            .references(() => eventTypes.id, { onDelete: "set null" }),
        bookingId: text("booking_id")
            .references(() => bookings.id, { onDelete: "set null" }),

        // Organization context for multi-tenant support
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Flow tracking with proper validation
        status: flowStatusEnum("status").notNull().default("form_started"),
        schedulingMode: flowSchedulingModeEnum("scheduling_mode").notNull().default("instant"),

        // Respondent identification
        sessionId: text("session_id").notNull(),
        respondentEmail: text("respondent_email"),
        respondentName: text("respondent_name"),
        respondentPhone: text("respondent_phone"),

        // Journey timestamps
        startedAt: timestamp("started_at", { mode: "date" }).notNull().defaultNow(),
        formCompletedAt: timestamp("form_completed_at", { mode: "date" }),
        qualificationCompletedAt: timestamp("qualification_completed_at", { mode: "date" }),
        schedulingStartedAt: timestamp("scheduling_started_at", { mode: "date" }),
        bookingCompletedAt: timestamp("booking_completed_at", { mode: "date" }),
        abandonedAt: timestamp("abandoned_at", { mode: "date" }),

        // AI Analysis Results with proper constraints
        qualificationScore: real("qualification_score"),
        qualificationReasons: jsonb("qualification_reasons"),
        intentScore: integer("intent_score"),
        priorityLevel: priorityLevelEnum("priority_level"),

        // AI-Generated Insights
        prospectSummary: text("prospect_summary"),
        keyInsights: jsonb("key_insights"),
        meetingRecommendations: jsonb("meeting_recommendations"),

        // Scheduling Intelligence
        optimalMeetingDuration: integer("optimal_meeting_duration"),
        suggestedMeetingType: text("suggested_meeting_type"),
        timePreferences: jsonb("time_preferences"),
        timezoneDetected: text("timezone_detected"),
        timezonePreferred: text("timezone_preferred"),

        // Curated Booking Workflow
        curatedSlotsGenerated: boolean("curated_slots_generated").notNull().default(false),
        curatedSlots: jsonb("curated_slots"),
        curatedSlotsSentAt: timestamp("curated_slots_sent_at", { mode: "date" }),
        curatedSlotsViewedAt: timestamp("curated_slots_viewed_at", { mode: "date" }),

        // Anti-spam and Quality Control
        spamScore: integer("spam_score"),
        spamFlags: jsonb("spam_flags"),
        requiresApproval: boolean("requires_approval").notNull().default(false),
        approvalRequiredReason: text("approval_required_reason"),
        approvedBy: text("approved_by")
            .references(() => users.id, { onDelete: "set null" }),
        approvedAt: timestamp("approved_at", { mode: "date" }),

        // Email verification for high-value bookings
        emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
        emailVerificationSentAt: timestamp("email_verification_sent_at", { mode: "date" }),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),

        // Abandonment and Recovery
        lastActiveAt: timestamp("last_active_at", { mode: "date" }).notNull().defaultNow(),
        abandonmentReason: text("abandonment_reason"),
        recoveryEmailSent: boolean("recovery_email_sent").notNull().default(false),
        recoveryEmailSentAt: timestamp("recovery_email_sent_at", { mode: "date" }),

        // Technical metadata
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        referrer: text("referrer"),
        utmSource: text("utm_source"),
        utmMedium: text("utm_medium"),
        utmCampaign: text("utm_campaign"),

        // Performance tracking with validation
        totalSteps: integer("total_steps"),
        currentStep: integer("current_step").notNull().default(1),
        completionPercentage: real("completion_percentage").notNull().default(0),
        timeToQualify: integer("time_to_qualify"),
        timeToBook: integer("time_to_book"),

        // Plan-specific limits tracking
        planType: text("plan_type").default("free"), // free, starter, professional, business
        usageCount: integer("usage_count").default(0), // Track usage against monthly limits

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Reduced and optimized indexes
        idxFormStatus: index("conversational_flows_form_status_idx")
            .on(t.formId, t.status),
        idxSession: index("conversational_flows_session_idx")
            .on(t.sessionId),
        idxEmail: index("conversational_flows_email_idx")
            .on(t.respondentEmail)
            .where(sql`${t.respondentEmail} IS NOT NULL`),
        idxCreatedStatus: index("conversational_flows_created_status_idx")
            .on(t.createdAt, t.status), // For dashboard queries
        idxLastActive: index("conversational_flows_last_active_idx")
            .on(t.lastActiveAt), // For abandonment detection
        idxOrganization: index("conversational_flows_organization_idx")
            .on(t.organizationId), // Multi-tenant partitioning

        // Unique constraints
        uqFormResponse: uniqueIndex("conversational_flows_form_response_uq")
            .on(t.formResponseId)
            .where(sql`${t.formResponseId} IS NOT NULL`),
        uqBooking: uniqueIndex("conversational_flows_booking_uq")
            .on(t.bookingId)
            .where(sql`${t.bookingId} IS NOT NULL`),

        // Constraints
        chkRespondentEmail: sql`CHECK (${t.respondentEmail} IS NULL OR ${t.respondentEmail} ~ '^[^@]+@[^@]+\.[^@]+$')`,
        chkQualificationScore: sql`CHECK (${t.qualificationScore} IS NULL OR (${t.qualificationScore} >= 0 AND ${t.qualificationScore} <= 100))`,
        chkIntentScore: sql`CHECK (${t.intentScore} IS NULL OR (${t.intentScore} >= 1 AND ${t.intentScore} <= 100))`,
        chkOptimalMeetingDuration: sql`CHECK (${t.optimalMeetingDuration} IS NULL OR (${t.optimalMeetingDuration} > 0 AND ${t.optimalMeetingDuration} <= 1440))`,
        chkReferrer: sql`CHECK (${t.referrer} IS NULL OR ${t.referrer} ~ '^https?://')`,
        chkTotalSteps: sql`CHECK (${t.totalSteps} IS NULL OR ${t.totalSteps} > 0)`,
        chkCurrentStep: sql`CHECK (${t.currentStep} >= 1)`,
        chkCompletionPercentage: sql`CHECK (${t.completionPercentage} >= 0 AND ${t.completionPercentage} <= 100)`,
        chkTimeToQualify: sql`CHECK (${t.timeToQualify} IS NULL OR ${t.timeToQualify} > 0)`,
        chkTimeToBook: sql`CHECK (${t.timeToBook} IS NULL OR ${t.timeToBook} > 0)`,
        chkSpamScore: sql`CHECK (${t.spamScore} IS NULL OR (${t.spamScore} >= 0 AND ${t.spamScore} <= 100))`,
        chkUsageCount: sql`CHECK (${t.usageCount} >= 0)`,
    })
);

/**
 * Flow Events - Detailed tracking of every action (simplified)
 */
export const flowEvents = pgTable(
    "flow_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        eventType: text("event_type").notNull(), // form_started, question_answered, ai_analysis_completed, etc.
        eventData: jsonb("event_data"),

        // State tracking
        previousStatus: flowStatusEnum("previous_status"),
        newStatus: flowStatusEnum("new_status"),

        // Performance metrics
        processingTime: integer("processing_time"),

        // Technical details
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFlowCreated: index("flow_events_flow_created_idx")
            .on(t.flowId, t.createdAt), // For event timeline
        idxEventType: index("flow_events_type_idx")
            .on(t.eventType, t.createdAt), // For analytics by event type

        // Constraints
        chkProcessingTime: sql`CHECK (${t.processingTime} IS NULL OR ${t.processingTime} >= 0)`,
    })
);

/**
 * AI Analysis Sessions - Track detailed AI processing
 */
export const aiAnalysisSessions = pgTable(
    "ai_analysis_sessions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        analysisType: text("analysis_type").notNull(), // qualification, intent, sentiment, scheduling_optimization
        modelVersion: text("model_version"),
        promptTemplate: text("prompt_template"),

        // Input data
        inputData: jsonb("input_data").notNull(),

        // AI Response
        rawResponse: text("raw_response"),
        parsedResults: jsonb("parsed_results"),
        confidence: real("confidence"),

        // Performance metrics
        processingTime: integer("processing_time"),
        tokensUsed: integer("tokens_used"),

        // Quality control
        wasSuccessful: boolean("was_successful").notNull().default(true),
        errorMessage: text("error_message"),
        retryCount: integer("retry_count").notNull().default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFlowType: index("ai_analysis_sessions_flow_type_idx")
            .on(t.flowId, t.analysisType),
        idxSuccess: index("ai_analysis_sessions_success_idx")
            .on(t.wasSuccessful, t.createdAt), // For error tracking
        idxTokensUsed: index("ai_analysis_sessions_tokens_idx")
            .on(t.tokensUsed, t.createdAt) // For cost analysis
            .where(sql`${t.tokensUsed} IS NOT NULL`),

        // Constraints
        chkConfidence: sql`CHECK (${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1))`,
        chkProcessingTime: sql`CHECK (${t.processingTime} IS NULL OR ${t.processingTime} >= 0)`,
        chkTokensUsed: sql`CHECK (${t.tokensUsed} IS NULL OR ${t.tokensUsed} >= 0)`,
        chkRetryCount: sql`CHECK (${t.retryCount} >= 0)`,
    })
);

/**
 * Prospect Insights - Structured insights about prospects
 */
export const prospectInsights = pgTable(
    "prospect_insights",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        // Core insights
        businessSize: text("business_size"), // startup, small, medium, enterprise
        industry: text("industry"),
        role: text("role"), // CEO, manager, developer, etc.
        decisionMaker: boolean("decision_maker"),

        // Pain points and needs
        primaryPainPoint: text("primary_pain_point"),
        painPoints: jsonb("pain_points"),
        needsAnalysis: text("needs_analysis"),

        // Opportunity assessment
        budgetRange: text("budget_range"), // low, medium, high, enterprise
        timeline: text("timeline"), // immediate, 1-3_months, 3-6_months, 6+_months
        competitorsMentioned: jsonb("competitors_mentioned"),

        // Communication preferences
        communicationStyle: text("communication_style"), // formal, casual, technical, high-level
        preferredMeetingFormat: text("preferred_meeting_format"), // demo, consultation, discovery, presentation

        // Relationship building
        personalInterests: jsonb("personal_interests"),
        companyBackground: text("company_background"),
        recentCompanyNews: jsonb("recent_company_news"),

        // Red flags and cautions
        redFlags: jsonb("red_flags"),
        competitorUser: boolean("competitor_user").notNull().default(false),

        // AI-generated recommendations
        meetingStrategy: text("meeting_strategy"),
        talkingPoints: jsonb("talking_points"),
        questionsToAsk: jsonb("questions_to_ask"),
        pitfallsToAvoid: jsonb("pitfalls_to_avoid"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFlow: uniqueIndex("prospect_insights_flow_uq").on(t.flowId), // One insight per flow
        idxIndustryBudget: index("prospect_insights_industry_budget_idx")
            .on(t.industry, t.budgetRange)
            .where(sql`${t.industry} IS NOT NULL AND ${t.budgetRange} IS NOT NULL`),
        idxDecisionMaker: index("prospect_insights_decision_maker_idx")
            .on(t.decisionMaker, t.budgetRange)
            .where(sql`${t.decisionMaker} = true`),
    })
);

/**
 * Scheduling Recommendations - AI-generated optimal scheduling suggestions
 */
export const schedulingRecommendations = pgTable(
    "scheduling_recommendations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        // Meeting optimization with validation
        recommendedDuration: integer("recommended_duration"),
        recommendedType: text("recommended_type"), // phone, video, in_person
        reasonForType: text("reason_for_type"),

        // Timing intelligence
        optimalTimeSlots: jsonb("optimal_time_slots"),
        timeSlotReasons: jsonb("time_slot_reasons"),

        // Preparation recommendations
        preparationTime: integer("preparation_time"),
        preparationTasks: jsonb("preparation_tasks"),

        // Follow-up strategy
        followUpStrategy: text("follow_up_strategy"),
        nextStepsRecommendation: text("next_steps_recommendation"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFlow: uniqueIndex("scheduling_recommendations_flow_uq").on(t.flowId), // One recommendation per flow
        idxDurationType: index("scheduling_recommendations_duration_type_idx")
            .on(t.recommendedDuration, t.recommendedType)
            .where(sql`${t.recommendedDuration} IS NOT NULL`),

        // Constraints
        chkRecommendedDuration: sql`CHECK (${t.recommendedDuration} IS NULL OR (${t.recommendedDuration} > 0 AND ${t.recommendedDuration} <= 1440))`,
        chkPreparationTime: sql`CHECK (${t.preparationTime} IS NULL OR ${t.preparationTime} >= 0)`,
    })
);

/**
 * Relations for the conversational flow tables
 */
export const conversationalFlowsRelations = relations(conversationalFlows, ({ one, many }) => ({
    form: one(forms, { fields: [conversationalFlows.formId], references: [forms.id] }),
    formResponse: one(formResponses, { fields: [conversationalFlows.formResponseId], references: [formResponses.id] }),
    eventType: one(eventTypes, { fields: [conversationalFlows.eventTypeId], references: [eventTypes.id] }),
    booking: one(bookings, { fields: [conversationalFlows.bookingId], references: [bookings.id] }),
    approver: one(users, { fields: [conversationalFlows.approvedBy], references: [users.id] }),
    organization: one(organizations, { fields: [conversationalFlows.organizationId], references: [organizations.id] }),

    // Child tables
    events: many(flowEvents),
    aiSessions: many(aiAnalysisSessions),
    prospectInsights: many(prospectInsights),
    schedulingRecommendations: many(schedulingRecommendations),
}));

export const flowEventsRelations = relations(flowEvents, ({ one }) => ({
    flow: one(conversationalFlows, { fields: [flowEvents.flowId], references: [conversationalFlows.id] }),
}));

export const aiAnalysisSessionsRelations = relations(aiAnalysisSessions, ({ one }) => ({
    flow: one(conversationalFlows, { fields: [aiAnalysisSessions.flowId], references: [conversationalFlows.id] }),
}));

export const prospectInsightsRelations = relations(prospectInsights, ({ one }) => ({
    flow: one(conversationalFlows, { fields: [prospectInsights.flowId], references: [conversationalFlows.id] }),
}));

export const schedulingRecommendationsRelations = relations(schedulingRecommendations, ({ one }) => ({
    flow: one(conversationalFlows, { fields: [schedulingRecommendations.flowId], references: [conversationalFlows.id] }),
}));
