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
import { supportedLanguages, translationStatusEnum } from "@/db/schema/localization";

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
            .references(() => users.id, { onDelete: "set null" }), // Updated reference
        approvedAt: timestamp("approved_at", { mode: "date" }),

        // Email/SMS Verification for high-value bookings
        emailVerificationRequired: boolean("email_verification_required").notNull().default(false),
        emailVerificationSentAt: timestamp("email_verification_sent_at", { mode: "date" }),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),
        smsVerificationRequired: boolean("sms_verification_required").notNull().default(false),
        smsVerificationSentAt: timestamp("sms_verification_sent_at", { mode: "date" }),
        smsVerifiedAt: timestamp("sms_verified_at", { mode: "date" }),

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

        detectedLanguage: text("detected_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
        preferredLanguage: text("preferred_language").references(() => supportedLanguages.code, { onDelete: "set null" }),

        // Browser and regional context
        acceptLanguageHeader: text("accept_language_header"),
        detectedCountry: text("detected_country"),
        detectedRegion: text("detected_region"),

        // Localized AI analysis
        localizedProspectSummary: jsonb("localized_prospect_summary"), // AI summary in detected language
        localizedKeyInsights: jsonb("localized_key_insights"),
        localizedMeetingRecommendations: jsonb("localized_meeting_recommendations"),

        // Cultural context for better AI analysis
        culturalContext: jsonb("cultural_context"), // Regional business practices, communication styles
        preferredCommunicationStyle: text("preferred_communication_style"), // formal, casual, etc.

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

/* ---------------- Flow Event Translations ---------------- */
export const flowEventTranslations = pgTable(
    "flow_event_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventId: text("event_id").notNull().references(() => flowEvents.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized event descriptions
        localizedEventType: text("localized_event_type"), // Human-readable event type in local language
        localizedDescription: text("localized_description"),
        localizedEventData: jsonb("localized_event_data"), // Event data with translated strings

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEventLanguage: uniqueIndex("flow_event_translations_event_language_uq").on(t.eventId, t.languageCode),
        idxLanguage: index("flow_event_translations_language_idx").on(t.languageCode),
    })
);

/* ---------------- AI Analysis Session Translations ---------------- */
export const aiAnalysisTranslations = pgTable(
    "ai_analysis_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        analysisSessionId: text("analysis_session_id").notNull().references(() => aiAnalysisSessions.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized AI analysis results
        localizedPromptTemplate: text("localized_prompt_template"), // Prompt in target language
        localizedRawResponse: text("localized_raw_response"), // AI response in target language
        localizedParsedResults: jsonb("localized_parsed_results"), // Structured results in target language

        // Analysis metadata
        languageModelUsed: text("language_model_used"), // Which model was used for this language
        translationMethod: text("translation_method"), // "native", "translated", "hybrid"
        translationQuality: real("translation_quality"), // 0-1 confidence score

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqAnalysisLanguage: uniqueIndex("ai_analysis_translations_analysis_language_uq").on(t.analysisSessionId, t.languageCode),
        idxTranslationQuality: index("ai_analysis_translations_quality_idx").on(t.translationQuality),

        chkTranslationQuality: sql`CHECK (${t.translationQuality} IS NULL OR (${t.translationQuality} >= 0 AND ${t.translationQuality} <= 1))`,
    })
);

/* ---------------- Prospect Insights Translations ---------------- */
export const prospectInsightTranslations = pgTable(
    "prospect_insight_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        insightId: text("insight_id").notNull().references(() => prospectInsights.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized insights
        localizedNeedsAnalysis: text("localized_needs_analysis"),
        localizedPrimaryPainPoint: text("localized_primary_pain_point"),
        localizedCompanyBackground: text("localized_company_background"),
        localizedMeetingStrategy: text("localized_meeting_strategy"),

        // Localized structured data
        localizedPainPoints: jsonb("localized_pain_points"),
        localizedTalkingPoints: jsonb("localized_talking_points"),
        localizedQuestionsToAsk: jsonb("localized_questions_to_ask"),
        localizedPitfallsToAvoid: jsonb("localized_pitfalls_to_avoid"),

        // Cultural adaptations
        culturalAdaptations: jsonb("cultural_adaptations"), // Region-specific business insights
        communicationPreferences: jsonb("communication_preferences"), // Preferred styles by culture

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqInsightLanguage: uniqueIndex("prospect_insight_translations_insight_language_uq").on(t.insightId, t.languageCode),
    })
);

/* ---------------- Scheduling Recommendations Translations ---------------- */
export const schedulingRecommendationTranslations = pgTable(
    "scheduling_recommendation_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        recommendationId: text("recommendation_id").notNull().references(() => schedulingRecommendations.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized recommendations
        localizedReasonForType: text("localized_reason_for_type"),
        localizedFollowUpStrategy: text("localized_follow_up_strategy"),
        localizedNextStepsRecommendation: text("localized_next_steps_recommendation"),

        // Localized structured recommendations
        localizedTimeSlotReasons: jsonb("localized_time_slot_reasons"),
        localizedPreparationTasks: jsonb("localized_preparation_tasks"),

        // Cultural timing preferences
        culturalTimingPreferences: jsonb("cultural_timing_preferences"), // Region-specific optimal times
        localBusinessContext: jsonb("local_business_context"), // Local holidays, customs, etc.

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqRecommendationLanguage: uniqueIndex("scheduling_recommendation_translations_rec_language_uq").on(t.recommendationId, t.languageCode),
    })
);

/* ---------------- Language-Aware Flow Templates ---------------- */
export const flowTemplates = pgTable(
    "flow_templates",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        templateName: text("template_name").notNull(),
        templateType: text("template_type").notNull(), // "qualification", "intake", "survey", "booking"
        category: text("category"), // "sales", "consulting", "recruiting", etc.

        // Multi-language support
        defaultLanguage: text("default_language").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        supportedLanguages: jsonb("supported_languages"), // Array of supported language codes

        // Template configuration
        templateDefinition: jsonb("template_definition").notNull(), // Default template structure
        requiredFields: jsonb("required_fields"), // Fields that must be present
        optionalFields: jsonb("optional_fields"), // Fields that can be customized

        // AI and automation settings
        aiPromptTemplates: jsonb("ai_prompt_templates"), // Per-language AI prompts
        automationRules: jsonb("automation_rules"), // Default automation for this template

        // Usage and metadata
        isPublic: boolean("is_public").notNull().default(false),
        usageCount: integer("usage_count").notNull().default(0),
        averageRating: real("average_rating").notNull().default(0),

        createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }), // Updated reference
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),
        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxTemplateType: index("flow_templates_type_idx").on(t.templateType, t.category),
        idxPublic: index("flow_templates_public_idx").on(t.isPublic, t.isActive),
        idxUsage: index("flow_templates_usage_idx").on(t.usageCount, t.averageRating),
        idxOrganization: index("flow_templates_organization_idx").on(t.organizationId),

        chkUsageCount: sql`CHECK (${t.usageCount} >= 0)`,
        chkAverageRating: sql`CHECK (${t.averageRating} >= 0 AND ${t.averageRating} <= 5)`,
    })
);

/* ---------------- Flow Template Translations ---------------- */
export const flowTemplateTranslations = pgTable(
    "flow_template_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        templateId: text("template_id").notNull().references(() => flowTemplates.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized template content
        templateName: text("template_name"),
        description: text("description"),
        localizedTemplateDefinition: jsonb("localized_template_definition"), // Template with translated strings

        // Localized AI prompts and automation
        localizedAiPrompts: jsonb("localized_ai_prompts"),
        localizedAutomationRules: jsonb("localized_automation_rules"),

        // Translation metadata
        status: translationStatusEnum("status").notNull().default("draft"),
        translatedBy: text("translated_by").references(() => users.id, { onDelete: "set null" }), // Updated reference
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }), // Updated reference

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTemplateLanguage: uniqueIndex("flow_template_translations_template_language_uq").on(t.templateId, t.languageCode),
        idxStatus: index("flow_template_translations_status_idx").on(t.status),
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
    approver: one(users, { fields: [conversationalFlows.approvedBy], references: [users.id] }), // Updated reference
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

export const flowEventTranslationsRelations = relations(flowEventTranslations, ({ one }) => ({
    event: one(flowEvents, {
        fields: [flowEventTranslations.eventId],
        references: [flowEvents.id]
    }),
    language: one(supportedLanguages, {
        fields: [flowEventTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const aiAnalysisTranslationsRelations = relations(aiAnalysisTranslations, ({ one }) => ({
    analysisSession: one(aiAnalysisSessions, {
        fields: [aiAnalysisTranslations.analysisSessionId],
        references: [aiAnalysisSessions.id]
    }),
    language: one(supportedLanguages, {
        fields: [aiAnalysisTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const prospectInsightTranslationsRelations = relations(prospectInsightTranslations, ({ one }) => ({
    insight: one(prospectInsights, {
        fields: [prospectInsightTranslations.insightId],
        references: [prospectInsights.id]
    }),
    language: one(supportedLanguages, {
        fields: [prospectInsightTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const schedulingRecommendationTranslationsRelations = relations(schedulingRecommendationTranslations, ({ one }) => ({
    recommendation: one(schedulingRecommendations, {
        fields: [schedulingRecommendationTranslations.recommendationId],
        references: [schedulingRecommendations.id]
    }),
    language: one(supportedLanguages, {
        fields: [schedulingRecommendationTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const flowTemplatesRelations = relations(flowTemplates, ({ one, many }) => ({
    creator: one(users, {
        fields: [flowTemplates.createdBy],
        references: [users.id]
    }),
    organization: one(organizations, {
        fields: [flowTemplates.organizationId],
        references: [organizations.id]
    }),
    defaultLanguageRef: one(supportedLanguages, {
        fields: [flowTemplates.defaultLanguage],
        references: [supportedLanguages.code]
    }),
    translations: many(flowTemplateTranslations),
}));

export const flowTemplateTranslationsRelations = relations(flowTemplateTranslations, ({ one }) => ({
    template: one(flowTemplates, {
        fields: [flowTemplateTranslations.templateId],
        references: [flowTemplates.id]
    }),
    translator: one(users, {
        fields: [flowTemplateTranslations.translatedBy],
        references: [users.id]
    }),
    reviewer: one(users, {
        fields: [flowTemplateTranslations.reviewedBy],
        references: [users.id]
    }),
    language: one(supportedLanguages, {
        fields: [flowTemplateTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));
