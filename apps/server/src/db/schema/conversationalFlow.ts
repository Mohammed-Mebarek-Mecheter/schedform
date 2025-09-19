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
import { relations } from "drizzle-orm";
import { user } from "./auth";
import { forms, formResponses } from "./forms";
import { eventTypes, bookings } from "./scheduling";

/**
 * Enums for conversational flow states
 */
export const flowStatusEnum = pgEnum("flow_status", [
    "form_started",        // User started the form
    "form_completed",      // User completed the form questions
    "qualifying",          // AI is analyzing responses for qualification
    "qualified",           // AI determined user is qualified
    "disqualified",        // AI determined user is not qualified
    "scheduling_options",  // Presenting scheduling options to qualified user
    "booking_pending",     // User selected time, booking being created
    "booking_confirmed",   // Booking successfully created
    "booking_failed",      // Booking creation failed
    "abandoned",           // User left without completing
    "spam_detected",       // Flagged as spam
]);

export const schedulingModeEnum = pgEnum("flow_scheduling_mode", [
    "instant",    // Show available slots immediately
    "curated",    // AI suggests 2-3 optimal times via email
    "approval",   // Manual approval required
]);

export const priorityLevelEnum = pgEnum("priority_level", [
    "low",
    "medium",
    "high",
    "urgent",
]);

/**
 * Conversational Flows - The heart of SchedForm's integrated experience
 * This table tracks the complete journey from form start to booking completion
 */
export const conversationalFlows = pgTable(
    "conversational_flows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        // Core relationships
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),
        formResponseId: text("form_response_id")
            .references(() => formResponses.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id")
            .references(() => eventTypes.id, { onDelete: "cascade" }),
        bookingId: text("booking_id")
            .references(() => bookings.id, { onDelete: "set null" }),

        // Flow tracking
        status: flowStatusEnum("status").notNull().default("form_started"),
        schedulingMode: schedulingModeEnum("scheduling_mode").notNull().default("instant"),

        // Respondent identification (before user account creation)
        sessionId: text("session_id").notNull(), // Track anonymous users
        respondentEmail: text("respondent_email"),
        respondentName: text("respondent_name"),
        respondentPhone: text("respondent_phone"),

        // Journey timestamps
        startedAt: timestamp("started_at").notNull().defaultNow(),
        formCompletedAt: timestamp("form_completed_at"),
        qualificationCompletedAt: timestamp("qualification_completed_at"),
        schedulingStartedAt: timestamp("scheduling_started_at"),
        bookingCompletedAt: timestamp("booking_completed_at"),
        abandonedAt: timestamp("abandoned_at"),

        // AI Analysis Results
        qualificationScore: real("qualification_score"), // 0-100
        qualificationReasons: jsonb("qualification_reasons"), // Structured reasoning
        intentScore: integer("intent_score"), // 1-100, urgency/seriousness
        priorityLevel: priorityLevelEnum("priority_level"),

        // AI-Generated Insights
        prospectSummary: text("prospect_summary"), // Concise summary for the host
        keyInsights: jsonb("key_insights"), // Structured insights about the prospect
        meetingRecommendations: jsonb("meeting_recommendations"), // AI suggestions for the meeting

        // Scheduling Intelligence
        optimalMeetingDuration: integer("optimal_meeting_duration"), // AI-suggested duration in minutes
        suggestedMeetingType: text("suggested_meeting_type"), // phone, video, in_person
        timePreferences: jsonb("time_preferences"), // Extracted or specified preferences
        timezoneDetected: text("timezone_detected"),
        timezonePreferred: text("timezone_preferred"),

        // Curated Booking Workflow (for curated mode)
        curatedSlotsGenerated: boolean("curated_slots_generated").notNull().default(false),
        curatedSlots: jsonb("curated_slots"), // AI-suggested time slots
        curatedSlotsSentAt: timestamp("curated_slots_sent_at"),
        curatedSlotsViewedAt: timestamp("curated_slots_viewed_at"),

        // Anti-spam and Quality Control
        spamScore: integer("spam_score"), // 0-100
        spamFlags: jsonb("spam_flags"), // Specific spam indicators
        requiresApproval: boolean("requires_approval").notNull().default(false),
        approvalRequiredReason: text("approval_required_reason"),
        approvedBy: text("approved_by").references(() => user.id, { onDelete: "set null" }),
        approvedAt: timestamp("approved_at"),

        // Email/SMS Verification for high-value bookings
        emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
        emailVerificationSentAt: timestamp("email_verification_sent_at"),
        emailVerifiedAt: timestamp("email_verified_at"),
        smsVerificationRequired: boolean("sms_verification_required").notNull().default(false),
        smsVerificationSentAt: timestamp("sms_verification_sent_at"),
        smsVerifiedAt: timestamp("sms_verified_at"),

        // Abandonment and Recovery
        lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
        abandonmentReason: text("abandonment_reason"), // Why the user left
        recoveryEmailSent: boolean("recovery_email_sent").notNull().default(false),
        recoveryEmailSentAt: timestamp("recovery_email_sent_at"),

        // Technical metadata
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        referrer: text("referrer"),
        utmSource: text("utm_source"),
        utmMedium: text("utm_medium"),
        utmCampaign: text("utm_campaign"),

        // Performance tracking
        totalSteps: integer("total_steps"), // Total steps in this flow
        currentStep: integer("current_step").notNull().default(1),
        completionPercentage: real("completion_percentage").notNull().default(0),
        timeToQualify: integer("time_to_qualify"), // Seconds from start to qualification
        timeToBook: integer("time_to_book"), // Seconds from start to booking

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        // Core indexes for performance
        idxFormStatus: index("conversational_flows_form_status_idx").on(t.formId, t.status),
        idxSession: index("conversational_flows_session_idx").on(t.sessionId),
        idxEmail: index("conversational_flows_email_idx").on(t.respondentEmail),

        // Analytics indexes
        idxQualification: index("conversational_flows_qualification_idx").on(t.qualificationScore),
        idxPriority: index("conversational_flows_priority_idx").on(t.priorityLevel),
        idxAbandonment: index("conversational_flows_abandonment_idx").on(t.abandonedAt),

        // Unique constraints
        uqFormResponse: uniqueIndex("conversational_flows_form_response_uq").on(t.formResponseId),
        uqBooking: uniqueIndex("conversational_flows_booking_uq").on(t.bookingId),
    })
);

/**
 * Flow Events - Detailed tracking of every action in the conversational flow
 */
export const flowEvents = pgTable(
    "flow_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        eventType: text("event_type").notNull(), // form_started, question_answered, ai_analysis_completed, etc.
        eventData: jsonb("event_data"), // Structured event details

        // State tracking
        previousStatus: flowStatusEnum("previous_status"),
        newStatus: flowStatusEnum("new_status"),

        // Performance metrics
        processingTime: integer("processing_time"), // Milliseconds for this event

        // Technical details
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFlow: index("flow_events_flow_idx").on(t.flowId),
        idxEventType: index("flow_events_type_idx").on(t.eventType),
        idxTimestamp: index("flow_events_timestamp_idx").on(t.createdAt),
    })
);

/**
 * AI Analysis Sessions - Track detailed AI processing for qualification and insights
 */
export const aiAnalysisSessions = pgTable(
    "ai_analysis_sessions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        flowId: text("flow_id")
            .notNull()
            .references(() => conversationalFlows.id, { onDelete: "cascade" }),

        analysisType: text("analysis_type").notNull(), // qualification, intent, sentiment, scheduling_optimization
        modelVersion: text("model_version"), // Track which AI model was used
        promptTemplate: text("prompt_template"), // The prompt used for analysis

        // Input data
        inputData: jsonb("input_data").notNull(), // Form responses and context sent to AI

        // AI Response
        rawResponse: text("raw_response"), // Raw AI response
        parsedResults: jsonb("parsed_results"), // Structured results
        confidence: real("confidence"), // 0-1, AI's confidence in the analysis

        // Performance metrics
        processingTime: integer("processing_time"), // Milliseconds
        tokensUsed: integer("tokens_used"), // For cost tracking

        // Quality control
        wasSuccessful: boolean("was_successful").notNull().default(true),
        errorMessage: text("error_message"),
        retryCount: integer("retry_count").notNull().default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFlow: index("ai_analysis_sessions_flow_idx").on(t.flowId),
        idxType: index("ai_analysis_sessions_type_idx").on(t.analysisType),
        idxSuccess: index("ai_analysis_sessions_success_idx").on(t.wasSuccessful),
    })
);

/**
 * Prospect Insights - Structured insights about prospects for better meeting preparation
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
        decisionMaker: boolean("decision_maker"), // Are they the decision maker?

        // Pain points and needs
        primaryPainPoint: text("primary_pain_point"),
        painPoints: jsonb("pain_points"), // Array of identified pain points
        needsAnalysis: text("needs_analysis"), // Detailed analysis of their needs

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
        recentCompanyNews: jsonb("recent_company_news"), // If we can enrich from external sources

        // Red flags and cautions
        redFlags: jsonb("red_flags"), // Things to be cautious about
        competitorUser: boolean("competitor_user").notNull().default(false),

        // AI-generated recommendations
        meetingStrategy: text("meeting_strategy"), // How to approach the meeting
        talkingPoints: jsonb("talking_points"), // Key points to discuss
        questionsToAsk: jsonb("questions_to_ask"), // Recommended questions
        pitfallsToAvoid: jsonb("pitfalls_to_avoid"), // Things not to do/say

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFlow: index("prospect_insights_flow_idx").on(t.flowId),
        idxIndustry: index("prospect_insights_industry_idx").on(t.industry),
        idxBudget: index("prospect_insights_budget_idx").on(t.budgetRange),
        idxTimeline: index("prospect_insights_timeline_idx").on(t.timeline),
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

        // Meeting optimization
        recommendedDuration: integer("recommended_duration"), // minutes
        recommendedType: text("recommended_type"), // phone, video, in_person
        reasonForType: text("reason_for_type"), // Why this type was recommended

        // Timing intelligence
        optimalTimeSlots: jsonb("optimal_time_slots"), // AI-ranked time suggestions
        timeSlotReasons: jsonb("time_slot_reasons"), // Why these times are optimal

        // Preparation recommendations
        preparationTime: integer("preparation_time"), // Minutes host should prepare
        preparationTasks: jsonb("preparation_tasks"), // What the host should prepare

        // Follow-up strategy
        followUpStrategy: text("follow_up_strategy"),
        nextStepsRecommendation: text("next_steps_recommendation"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFlow: index("scheduling_recommendations_flow_idx").on(t.flowId),
        idxDuration: index("scheduling_recommendations_duration_idx").on(t.recommendedDuration),
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
    approver: one(user, { fields: [conversationalFlows.approvedBy], references: [user.id] }),

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
    flow: one(conversationalFlows, { fields: [schedulingRecommendations.flowId], references: [schedulingRecommendations.id] }),
}));