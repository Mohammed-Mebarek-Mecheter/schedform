// src/db/schema/forms.ts
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

/**
 * Enums
 */
export const questionTypeEnum = pgEnum("question_type", [
    "short_text",
    "long_text",
    "multiple_choice",
    "single_choice",
    "email",
    "phone",
    "number",
    "date",
    "time",
    "file_upload",
    "yes_no",
    "rating",
    "dropdown",
    "website_url",
    "linear_scale",
    "opinion_scale",
    "meeting_preference", // New: for scheduling preferences
    "availability_check", // New: to check general availability
    "urgency_level", // New: to gauge booking urgency
]);

export const formStatusEnum = pgEnum("form_status", [
    "draft",
    "published",
    "paused",
    "archived",
]);

export const logicOperatorEnum = pgEnum("logic_operator", [
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "greater_than",
    "less_than",
    "is_empty",
    "is_not_empty",
]);

// New enum for form types
export const formTypeEnum = pgEnum("form_type", [
    "qualification_only", // Traditional form without scheduling
    "conversational_scheduling", // SchedForm's core offering
    "booking_with_intake", // Scheduling with detailed intake
]);

/**
 * Forms - Enhanced for SchedForm's integrated approach
 */
export const forms = pgTable(
    "forms",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        // Basic info
        title: text("title").notNull(),
        description: text("description"),
        slug: text("slug").notNull(),

        // SchedForm-specific: Form type determines behavior
        formType: formTypeEnum("form_type").notNull().default("conversational_scheduling"),

        // Lifecycle & status
        status: formStatusEnum("status").notNull().default("draft"),
        publishedAt: timestamp("published_at"),

        // White-labeling (comprehensive support)
        customBranding: boolean("custom_branding").notNull().default(false),
        logoUrl: text("logo_url"),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        backgroundColor: text("background_color").notNull().default("#ffffff"),
        customCss: text("custom_css"),
        customJs: text("custom_js"),
        brandingConfig: jsonb("branding_config"), // Centralized branding settings

        // Behavior
        showProgressBar: boolean("show_progress_bar").notNull().default(true),
        allowBackButton: boolean("allow_back_button").notNull().default(true),
        submitButtonText: text("submit_button_text").notNull().default("Schedule Meeting"),
        thankYouMessage: text("thank_you_message").notNull().default("Thank you! Your meeting request has been submitted."),
        redirectUrl: text("redirect_url"),

        // Controls & limits
        maxResponses: integer("max_responses"),
        requireLogin: boolean("require_login").notNull().default(false),
        collectIpAddress: boolean("collect_ip_address").notNull().default(true),
        allowMultipleSubmissions: boolean("allow_multiple_submissions").notNull().default(false),

        // Closing
        closingDate: timestamp("closing_date"),
        closingMessage: text("closing_message"),

        // Enhanced analytics counters
        totalViews: integer("total_views").notNull().default(0),
        totalStarts: integer("total_starts").notNull().default(0), // New: better funnel tracking
        totalResponses: integer("total_responses").notNull().default(0),
        totalQualifiedResponses: integer("total_qualified_responses").notNull().default(0), // New: qualified responses
        completionRate: real("completion_rate").notNull().default(0),
        qualificationRate: real("qualification_rate").notNull().default(0), // New: qualification success rate

        // AI & Intelligence settings
        enableAiAnalysis: boolean("enable_ai_analysis").notNull().default(true),
        aiPromptTemplate: text("ai_prompt_template"), // Custom AI analysis prompt
        qualificationCriteria: jsonb("qualification_criteria"), // Scoring criteria

        // Spam prevention settings
        enableSpamProtection: boolean("enable_spam_protection").notNull().default(true),
        requireEmailVerification: boolean("require_email_verification").notNull().default(true),
        requirePhoneVerification: boolean("require_phone_verification").notNull().default(false),
        spamProtectionConfig: jsonb("spam_protection_config"), // Detailed spam settings

        // Timestamps
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uniqueSlug: uniqueIndex("forms_slug_unique").on(t.slug),
        idxUser: index("forms_user_idx").on(t.userId),
        idxType: index("forms_type_idx").on(t.formType),
        idxStatus: index("forms_status_idx").on(t.status),
    })
);

/**
 * Form Questions - Enhanced with scheduling-specific types
 */
export const formQuestions = pgTable(
    "form_questions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        title: text("title").notNull(),
        description: text("description"),
        type: questionTypeEnum("type").notNull(),
        isRequired: boolean("is_required").notNull().default(false),

        // Ordering & grouping
        orderIndex: integer("order_index").notNull().default(0),
        groupId: text("group_id"),

        // Enhanced settings with scheduling context
        settings: jsonb("settings"),

        // AI qualification impact
        qualificationWeight: real("qualification_weight").notNull().default(1.0), // How much this question affects qualification
        aiAnalysisPrompt: text("ai_analysis_prompt"), // Specific AI prompt for this question

        // Scheduling relevance
        affectsScheduling: boolean("affects_scheduling").notNull().default(false), // Does this impact meeting scheduling?
        schedulingContext: jsonb("scheduling_context"), // How this relates to scheduling

        // File-specific
        maxFileSize: integer("max_file_size"),
        allowedFileTypes: text("allowed_file_types"),

        // Enhanced validation and logic
        validationRules: jsonb("validation_rules"),
        showConditions: jsonb("show_conditions"),
        skipConditions: jsonb("skip_conditions"), // New: conditions to skip this question

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormQuestions: index("form_questions_form_idx").on(t.formId, t.orderIndex),
        idxScheduling: index("form_questions_scheduling_idx").on(t.affectsScheduling),
    })
);

/**
 * Question Choices - Enhanced with scheduling implications
 */
export const questionChoices = pgTable(
    "question_choices",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        questionId: text("question_id")
            .notNull()
            .references(() => formQuestions.id, { onDelete: "cascade" }),

        label: text("label").notNull(),
        value: text("value").notNull(),
        orderIndex: integer("order_index").notNull().default(0),
        isDefault: boolean("is_default").notNull().default(false),

        // Enhanced branching and qualification
        jumpToQuestionId: text("jump_to_question_id").references(() => formQuestions.id, {
            onDelete: "set null",
        }),
        qualificationScore: real("qualification_score").notNull().default(0), // How this choice affects qualification
        schedulingImpact: jsonb("scheduling_impact"), // How this choice affects scheduling (duration, urgency, etc.)

        // Disqualification logic
        isDisqualifying: boolean("is_disqualifying").notNull().default(false),
        disqualificationMessage: text("disqualification_message"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqChoiceValue: uniqueIndex("question_choices_question_value_uq").on(t.questionId, t.value),
        uqChoiceOrder: uniqueIndex("question_choices_question_order_uq").on(t.questionId, t.orderIndex),
    })
);

/**
 * Form Responses - Enhanced with qualification and scheduling context
 */
export const formResponses = pgTable(
    "form_responses",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        // Respondent info
        respondentUserId: text("respondent_user_id").references(() => user.id, { onDelete: "set null" }),
        respondentId: text("respondent_id"),
        respondentEmail: text("respondent_email"),
        respondentName: text("respondent_name"),
        respondentPhone: text("respondent_phone"),

        // Technical metadata
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        sessionId: text("session_id"),

        // Enhanced progress tracking
        isCompleted: boolean("is_completed").notNull().default(false),
        completedAt: timestamp("completed_at"),
        timeToComplete: integer("time_to_complete"),

        // Resume functionality
        resumeToken: text("resume_token"),
        lastQuestionId: text("last_question_id").references(() => formQuestions.id, { onDelete: "set null" }),

        // Location tracking
        country: text("country"),
        city: text("city"),
        timezone: text("timezone"), // New: important for scheduling

        // Enhanced AI analysis and qualification
        qualityScore: integer("quality_score"), // 0-100
        spamScore: integer("spam_score"), // 0-100
        qualificationScore: real("qualification_score"), // 0-100, core SchedForm metric
        intentScore: integer("intent_score"), // 0-100, urgency/seriousness of intent

        // AI-generated insights
        aiSummary: text("ai_summary"), // AI-generated summary of the response
        aiRecommendations: jsonb("ai_recommendations"), // AI suggestions for handling this prospect
        qualificationReasons: jsonb("qualification_reasons"), // Why was this scored as qualified/unqualified

        // Scheduling preferences extracted from responses
        preferredMeetingType: text("preferred_meeting_type"), // phone, video, in-person
        urgencyLevel: text("urgency_level"), // high, medium, low
        estimatedDuration: integer("estimated_duration"), // minutes, AI-estimated optimal meeting duration
        preferredTimeframe: jsonb("preferred_timeframe"), // When they prefer to meet

        // Verification status
        emailVerified: boolean("email_verified").notNull().default(false),
        emailVerifiedAt: timestamp("email_verified_at"),
        phoneVerified: boolean("phone_verified").notNull().default(false),
        phoneVerifiedAt: timestamp("phone_verified_at"),

        // Anti-spam tracking
        spamFlags: jsonb("spam_flags"), // Specific spam indicators detected
        spamPreventionActions: jsonb("spam_prevention_actions"), // Actions taken to prevent spam
        manualReview: boolean("manual_review").notNull().default(false),
        reviewedAt: timestamp("reviewed_at"),
        reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormCompleted: index("form_responses_form_completed_idx").on(t.formId, t.isCompleted),
        uqResumeToken: uniqueIndex("form_responses_resume_token_uq").on(t.resumeToken),
        idxRespondentUser: index("form_responses_respondent_user_idx").on(t.respondentUserId),
        idxQualification: index("form_responses_qualification_idx").on(t.qualificationScore),
        idxSpam: index("form_responses_spam_idx").on(t.spamScore),
        idxIntent: index("form_responses_intent_idx").on(t.intentScore),
        idxEmailPhone: index("form_responses_email_phone_idx").on(t.respondentEmail, t.respondentPhone),
    })
);

/**
 * Form Answers - Enhanced with qualification context
 */
export const formAnswers = pgTable(
    "form_answers",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        responseId: text("response_id")
            .notNull()
            .references(() => formResponses.id, { onDelete: "cascade" }),
        questionId: text("question_id")
            .notNull()
            .references(() => formQuestions.id, { onDelete: "cascade" }),

        // Various typed columns
        textValue: text("text_value"),
        numberValue: integer("number_value"),
        dateValue: timestamp("date_value"),
        booleanValue: boolean("boolean_value"),
        jsonValue: jsonb("json_value"),

        // File metadata
        fileUrl: text("file_url"),
        fileName: text("file_name"),
        fileSize: integer("file_size"),
        fileMimeType: text("file_mime_type"),

        // Enhanced qualification tracking
        qualificationContribution: real("qualification_contribution"), // How this answer contributed to overall score
        aiAnalysis: text("ai_analysis"), // AI analysis of this specific answer
        extractedInsights: jsonb("extracted_insights"), // Structured insights from this answer

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqResponseQuestion: uniqueIndex("form_answers_response_question_uq").on(t.responseId, t.questionId),
        idxQuestion: index("form_answers_question_idx").on(t.questionId),
    })
);

/**
 * Form Analytics - Enhanced for SchedForm metrics
 */
export const formAnalytics = pgTable(
    "form_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        date: timestamp("date").notNull(),
        views: integer("views").notNull().default(0),
        starts: integer("starts").notNull().default(0),
        completions: integer("completions").notNull().default(0),

        // SchedForm-specific metrics
        qualifiedLeads: integer("qualified_leads").notNull().default(0),
        bookingRequests: integer("booking_requests").notNull().default(0),
        successfulBookings: integer("successful_bookings").notNull().default(0),
        spamBlocked: integer("spam_blocked").notNull().default(0),

        // Quality metrics
        averageQualificationScore: real("average_qualification_score").notNull().default(0),
        averageIntentScore: real("average_intent_score").notNull().default(0),
        averageTimeToComplete: integer("average_time_to_complete").notNull().default(0),

        // Detailed breakdowns
        questionDropoffs: jsonb("question_dropoffs"),
        deviceStats: jsonb("device_stats"),
        browserStats: jsonb("browser_stats"),
        countryStats: jsonb("country_stats"),
        trafficSources: jsonb("traffic_sources"), // UTM tracking
        conversionFunnel: jsonb("conversion_funnel"), // Step-by-step conversion data

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqFormDate: uniqueIndex("form_analytics_form_date_uq").on(t.formId, t.date),
        idxFormDate: index("form_analytics_form_date_idx").on(t.formId, t.date),
    })
);

/**
 * Form Integrations - Enhanced with more providers
 */
export const formIntegrations = pgTable(
    "form_integrations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        type: text("type").notNull(), // webhook, zapier, email, crm, calendar
        provider: text("provider"), // specific provider name (hubspot, salesforce, etc.)
        name: text("name").notNull(),
        isActive: boolean("is_active").notNull().default(true),

        config: jsonb("config").notNull(),

        // Enhanced execution tracking
        lastExecuted: timestamp("last_executed"),
        lastStatus: text("last_status"), // success|failed|pending
        executionCount: integer("execution_count").notNull().default(0),
        failureCount: integer("failure_count").notNull().default(0),
        lastError: text("last_error"),

        // Filtering and conditions
        executionConditions: jsonb("execution_conditions"), // When to execute this integration
        fieldMappings: jsonb("field_mappings"), // How form fields map to integration fields

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormIntegrationType: index("form_integrations_form_type_idx").on(t.formId, t.type),
        idxProvider: index("form_integrations_provider_idx").on(t.provider),
    })
);

/**
 * Relations (type-safe helpers)
 */
export const formsRelations = relations(forms, ({ many, one }) => ({
    owner: one(user, { fields: [forms.userId], references: [user.id] }),
    questions: many(formQuestions),
    responses: many(formResponses),
    analytics: many(formAnalytics),
    integrations: many(formIntegrations),
}));

export const formQuestionsRelations = relations(formQuestions, ({ many, one }) => ({
    form: one(forms, { fields: [formQuestions.formId], references: [forms.id] }),
    choices: many(questionChoices),
    answers: many(formAnswers),
}));

export const questionChoicesRelations = relations(questionChoices, ({ one }) => ({
    question: one(formQuestions, { fields: [questionChoices.questionId], references: [formQuestions.id] }),
}));

export const formResponsesRelations = relations(formResponses, ({ one, many }) => ({
    form: one(forms, { fields: [formResponses.formId], references: [forms.id] }),
    user: one(user, { fields: [formResponses.respondentUserId], references: [user.id] }),
    reviewer: one(user, { fields: [formResponses.reviewedBy], references: [user.id] }),
    answers: many(formAnswers),
}));

export const formAnswersRelations = relations(formAnswers, ({ one }) => ({
    response: one(formResponses, { fields: [formAnswers.responseId], references: [formResponses.id] }),
    question: one(formQuestions, { fields: [formAnswers.questionId], references: [formQuestions.id] }),
}));

export const formAnalyticsRelations = relations(formAnalytics, ({ one }) => ({
    form: one(forms, { fields: [formAnalytics.formId], references: [forms.id] }),
}));

export const formIntegrationsRelations = relations(formIntegrations, ({ one }) => ({
    form: one(forms, { fields: [formIntegrations.formId], references: [forms.id] }),
}));