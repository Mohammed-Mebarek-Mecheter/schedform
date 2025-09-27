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
import { relations, sql } from "drizzle-orm";
import { users, organizations } from "@/db/schema/auth";

/* ---------------- Enums ---------------- */
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
    "meeting_preference",
    "availability_check",
    "urgency_level",
]);

export const formStatusEnum = pgEnum("form_status", [
    "draft",
    "published",
    "paused",
    "archived",
]);

export const formTypeEnum = pgEnum("form_type", [
    "qualification_only",
    "conversational_scheduling",
    "booking_with_intake",
]);

/* ---------------- Forms ---------------- */
export const forms = pgTable(
    "forms",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Basic info
        title: text("title").notNull(),
        description: text("description"),
        slug: text("slug").notNull(),

        // Type & lifecycle
        formType: formTypeEnum("form_type").notNull().default("conversational_scheduling"),
        status: formStatusEnum("status").notNull().default("draft"),
        publishedAt: timestamp("published_at", { mode: "date" }),

        // White-labeling & branding
        customBranding: boolean("custom_branding").notNull().default(false),
        logoUrl: text("logo_url"),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        backgroundColor: text("background_color").notNull().default("#ffffff"),
        customCss: text("custom_css"),
        customJs: text("custom_js"),
        brandingConfig: jsonb("branding_config"),

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
        closingDate: timestamp("closing_date", { mode: "date" }),
        closingMessage: text("closing_message"),

        // Analytics counters
        totalViews: integer("total_views").notNull().default(0),
        totalStarts: integer("total_starts").notNull().default(0),
        totalResponses: integer("total_responses").notNull().default(0),
        totalQualifiedResponses: integer("total_qualified_responses").notNull().default(0),
        completionRate: real("completion_rate").notNull().default(0),
        qualificationRate: real("qualification_rate").notNull().default(0),

        // AI & Intelligence settings
        enableAiAnalysis: boolean("enable_ai_analysis").notNull().default(true),
        aiPromptTemplate: text("ai_prompt_template"),
        qualificationCriteria: jsonb("qualification_criteria"),

        // Spam prevention
        enableSpamProtection: boolean("enable_spam_protection").notNull().default(true),
        requireEmailVerification: boolean("require_email_verification").notNull().default(true),
        requirePhoneVerification: boolean("require_phone_verification").notNull().default(false),
        spamProtectionConfig: jsonb("spam_protection_config"),

        // Access control for team members
        visibility: text("visibility").notNull().default("private"), // private, team, public
        allowedTeamIds: jsonb("allowed_team_ids"), // Array of team IDs that can access this form
        permissions: jsonb("permissions"), // Fine-grained permissions for team members

        // Timestamps
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes & unique constraints
        uniqueSlug: uniqueIndex("forms_slug_unique").on(t.slug),
        idxUserStatus: index("forms_user_status_idx").on(t.userId, t.status),
        idxOrgStatus: index("forms_org_status_idx").on(t.organizationId, t.status),
        idxPublishedActive: index("forms_published_active_idx").on(t.publishedAt).where(sql`${t.status} = 'published'`),

        // CHECK constraints
        ck_logo_url: sql`CHECK (${t.logoUrl} IS NULL OR ${t.logoUrl} ~ '^https?://')`,
        ck_primary_color: sql`CHECK (${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$')`,
        ck_background_color: sql`CHECK (${t.backgroundColor} ~ '^#[0-9A-Fa-f]{6}$')`,
        ck_redirect_url: sql`CHECK (${t.redirectUrl} IS NULL OR ${t.redirectUrl} ~ '^https?://')`,
        ck_max_responses: sql`CHECK (${t.maxResponses} IS NULL OR ${t.maxResponses} > 0)`,

        ck_total_views: sql`CHECK (${t.totalViews} >= 0)`,
        ck_total_starts: sql`CHECK (${t.totalStarts} >= 0)`,
        ck_total_responses: sql`CHECK (${t.totalResponses} >= 0)`,
        ck_total_qualified_responses: sql`CHECK (${t.totalQualifiedResponses} >= 0)`,
        ck_completion_rate: sql`CHECK (${t.completionRate} >= 0 AND ${t.completionRate} <= 100)`,
        ck_qualification_rate: sql`CHECK (${t.qualificationRate} >= 0 AND ${t.qualificationRate} <= 100)`,

        ck_visibility: sql`CHECK (${t.visibility} IN ('private', 'team', 'public'))`,
    })
);

/* ---------------- Form Questions ---------------- */
export const formQuestions = pgTable(
    "form_questions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),

        title: text("title").notNull(),
        description: text("description"),
        type: questionTypeEnum("type").notNull(),
        isRequired: boolean("is_required").notNull().default(false),

        orderIndex: integer("order_index").notNull().default(0),
        groupId: text("group_id"),

        settings: jsonb("settings"),
        qualificationWeight: real("qualification_weight").notNull().default(1.0),
        aiAnalysisPrompt: text("ai_analysis_prompt"),

        affectsScheduling: boolean("affects_scheduling").notNull().default(false),
        schedulingContext: jsonb("scheduling_context"),

        maxFileSize: integer("max_file_size"),
        allowedFileTypes: text("allowed_file_types"),

        validationRules: jsonb("validation_rules"),
        showConditions: jsonb("show_conditions"),
        skipConditions: jsonb("skip_conditions"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFormOrder: index("form_questions_form_order_idx").on(t.formId, t.orderIndex),
        uqFormOrder: uniqueIndex("form_questions_form_order_uq").on(t.formId, t.orderIndex),

        // checks
        ck_order_index_nonnegative: sql`CHECK (${t.orderIndex} >= 0)`,
        ck_qualification_weight_range: sql`CHECK (${t.qualificationWeight} >= 0 AND ${t.qualificationWeight} <= 10)`,
        ck_max_file_size_null_or_positive: sql`CHECK (${t.maxFileSize} IS NULL OR ${t.maxFileSize} > 0)`,
    })
);

/* ---------------- Question Choices ---------------- */
export const questionChoices = pgTable(
    "question_choices",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        questionId: text("question_id").notNull().references(() => formQuestions.id, { onDelete: "cascade" }),

        label: text("label").notNull(),
        value: text("value").notNull(),
        orderIndex: integer("order_index").notNull().default(0),
        isDefault: boolean("is_default").notNull().default(false),

        jumpToQuestionId: text("jump_to_question_id").references(() => formQuestions.id, { onDelete: "set null" }),
        qualificationScore: real("qualification_score").notNull().default(0),
        schedulingImpact: jsonb("scheduling_impact"),

        isDisqualifying: boolean("is_disqualifying").notNull().default(false),
        disqualificationMessage: text("disqualification_message"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqQuestionOrder: uniqueIndex("question_choices_question_order_uq").on(t.questionId, t.orderIndex),
        idxQuestion: index("question_choices_question_idx").on(t.questionId),

        ck_order_index_nonnegative: sql`CHECK (${t.orderIndex} >= 0)`,
        ck_qualification_score_range: sql`CHECK (${t.qualificationScore} >= -100 AND ${t.qualificationScore} <= 100)`,
    })
);

/* ---------------- Form Responses ---------------- */
export const formResponses = pgTable(
    "form_responses",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "restrict" }),

        respondentUserId: text("respondent_user_id").references(() => users.id, { onDelete: "set null" }),
        respondentId: text("respondent_id"),
        respondentEmail: text("respondent_email"),
        respondentName: text("respondent_name"),
        respondentPhone: text("respondent_phone"),

        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        sessionId: text("session_id"),

        isCompleted: boolean("is_completed").notNull().default(false),
        completedAt: timestamp("completed_at", { mode: "date" }),
        timeToComplete: integer("time_to_complete"),

        resumeToken: text("resume_token"),
        lastQuestionId: text("last_question_id").references(() => formQuestions.id, { onDelete: "set null" }),

        country: text("country"),
        city: text("city"),
        timezone: text("timezone"),

        qualityScore: integer("quality_score"),
        spamScore: integer("spam_score"),
        qualificationScore: real("qualification_score"),
        intentScore: integer("intent_score"),

        aiSummary: text("ai_summary"),
        aiRecommendations: jsonb("ai_recommendations"),
        qualificationReasons: jsonb("qualification_reasons"),

        preferredMeetingType: text("preferred_meeting_type"),
        urgencyLevel: text("urgency_level"),
        estimatedDuration: integer("estimated_duration"),
        preferredTimeframe: jsonb("preferred_timeframe"),

        emailVerified: boolean("email_verified").notNull().default(false),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),
        phoneVerified: boolean("phone_verified").notNull().default(false),
        phoneVerifiedAt: timestamp("phone_verified_at", { mode: "date" }),

        spamFlags: jsonb("spam_flags"),
        spamPreventionActions: jsonb("spam_prevention_actions"),
        manualReview: boolean("manual_review").notNull().default(false),
        reviewedAt: timestamp("reviewed_at", { mode: "date" }),
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFormCreated: index("form_responses_form_created_idx").on(t.formId, t.createdAt),
        idxCompleted: index("form_responses_completed_idx").on(t.isCompleted, t.completedAt).where(sql`${t.isCompleted} = true`),
        uqResumeToken: uniqueIndex("form_responses_resume_token_uq").on(t.resumeToken).where(sql`${t.resumeToken} IS NOT NULL`),
        idxEmail: index("form_responses_email_idx").on(t.respondentEmail).where(sql`${t.respondentEmail} IS NOT NULL`),

        // checks
        ck_time_to_complete_null_or_positive: sql`CHECK (${t.timeToComplete} IS NULL OR ${t.timeToComplete} > 0)`,
        ck_quality_score_range: sql`CHECK (${t.qualityScore} IS NULL OR (${t.qualityScore} >= 0 AND ${t.qualityScore} <= 100))`,
        ck_spam_score_range: sql`CHECK (${t.spamScore} IS NULL OR (${t.spamScore} >= 0 AND ${t.spamScore} <= 100))`,
        ck_qualification_score_range: sql`CHECK (${t.qualificationScore} IS NULL OR (${t.qualificationScore} >= 0 AND ${t.qualificationScore} <= 100))`,
        ck_intent_score_range: sql`CHECK (${t.intentScore} IS NULL OR (${t.intentScore} >= 0 AND ${t.intentScore} <= 100))`,
        ck_estimated_duration_null_or_positive: sql`CHECK (${t.estimatedDuration} IS NULL OR ${t.estimatedDuration} > 0)`,
        ck_respondent_email_format: sql`CHECK (${t.respondentEmail} IS NULL OR ${t.respondentEmail} ~ '^[^@]+@[^@]+\\.[^@]+$')`,
    })
);

/* ---------------- Form Answers ---------------- */
export const formAnswers = pgTable(
    "form_answers",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        responseId: text("response_id").notNull().references(() => formResponses.id, { onDelete: "cascade" }),
        questionId: text("question_id").notNull().references(() => formQuestions.id, { onDelete: "restrict" }),

        textValue: text("text_value"),
        numberValue: integer("number_value"),
        dateValue: timestamp("date_value", { mode: "date" }),
        booleanValue: boolean("boolean_value"),
        jsonValue: jsonb("json_value"),

        fileUrl: text("file_url"),
        fileName: text("file_name"),
        fileSize: integer("file_size"),
        fileMimeType: text("file_mime_type"),

        qualificationContribution: real("qualification_contribution"),
        aiAnalysis: text("ai_analysis"),
        extractedInsights: jsonb("extracted_insights"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqResponseQuestion: uniqueIndex("form_answers_response_question_uq").on(t.responseId, t.questionId),
        idxResponse: index("form_answers_response_idx").on(t.responseId),

        ck_file_url_format: sql`CHECK (${t.fileUrl} IS NULL OR ${t.fileUrl} ~ '^https?://')`,
        ck_file_size_null_or_positive: sql`CHECK (${t.fileSize} IS NULL OR ${t.fileSize} > 0)`,
    })
);

/* ---------------- Form Analytics ---------------- */
export const formAnalytics = pgTable(
    "form_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),

        date: timestamp("date", { mode: "date" }).notNull(),
        views: integer("views").notNull().default(0),
        starts: integer("starts").notNull().default(0),
        completions: integer("completions").notNull().default(0),

        qualifiedLeads: integer("qualified_leads").notNull().default(0),
        bookingRequests: integer("booking_requests").notNull().default(0),
        successfulBookings: integer("successful_bookings").notNull().default(0),
        spamBlocked: integer("spam_blocked").notNull().default(0),

        averageQualificationScore: real("average_qualification_score").notNull().default(0),
        averageIntentScore: real("average_intent_score").notNull().default(0),
        averageTimeToComplete: integer("average_time_to_complete").notNull().default(0),

        questionDropoffs: jsonb("question_dropoffs"),
        deviceStats: jsonb("device_stats"),
        browserStats: jsonb("browser_stats"),
        countryStats: jsonb("country_stats"),
        trafficSources: jsonb("traffic_sources"),
        conversionFunnel: jsonb("conversion_funnel"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFormDate: uniqueIndex("form_analytics_form_date_uq").on(t.formId, t.date),

        ck_views_nonnegative: sql`CHECK (${t.views} >= 0)`,
        ck_starts_nonnegative: sql`CHECK (${t.starts} >= 0)`,
        ck_completions_nonnegative: sql`CHECK (${t.completions} >= 0)`,
        ck_qualified_leads_nonnegative: sql`CHECK (${t.qualifiedLeads} >= 0)`,
        ck_booking_requests_nonnegative: sql`CHECK (${t.bookingRequests} >= 0)`,
        ck_successful_bookings_nonnegative: sql`CHECK (${t.successfulBookings} >= 0)`,
        ck_spam_blocked_nonnegative: sql`CHECK (${t.spamBlocked} >= 0)`,
        ck_avg_qualification_score_range: sql`CHECK (${t.averageQualificationScore} >= 0 AND ${t.averageQualificationScore} <= 100)`,
        ck_avg_intent_score_range: sql`CHECK (${t.averageIntentScore} >= 0 AND ${t.averageIntentScore} <= 100)`,
        ck_avg_time_to_complete_nonnegative: sql`CHECK (${t.averageTimeToComplete} >= 0)`,
    })
);

/* ---------------- Form Integrations ---------------- */
export const formIntegrations = pgTable(
    "form_integrations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),

        type: text("type").notNull(),
        provider: text("provider"),
        name: text("name").notNull(),
        isActive: boolean("is_active").notNull().default(true),

        config: jsonb("config").notNull(),

        lastExecuted: timestamp("last_executed", { mode: "date" }),
        lastStatus: text("last_status"),
        executionCount: integer("execution_count").notNull().default(0),
        failureCount: integer("failure_count").notNull().default(0),
        lastError: text("last_error"),

        executionConditions: jsonb("execution_conditions"),
        fieldMappings: jsonb("field_mappings"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFormType: index("form_integrations_form_type_idx").on(t.formId, t.type),
        idxActive: index("form_integrations_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),

        ck_execution_count_nonnegative: sql`CHECK (${t.executionCount} >= 0)`,
        ck_failure_count_nonnegative: sql`CHECK (${t.failureCount} >= 0)`,
    })
);

/* ---------------- Form Team Access ---------------- */
export const formTeamAccess = pgTable(
    "form_team_access",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
        teamId: text("team_id").notNull(), // References teams table from auth schema

        permissions: jsonb("permissions").notNull(), // Specific permissions for this team
        canEdit: boolean("can_edit").notNull().default(false),
        canViewResponses: boolean("can_view_responses").notNull().default(true),
        canManageIntegrations: boolean("can_manage_integrations").notNull().default(false),

        grantedAt: timestamp("granted_at", { mode: "date" }).notNull().defaultNow(),
        grantedBy: text("granted_by").notNull().references(() => users.id, { onDelete: "cascade" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFormTeam: uniqueIndex("form_team_access_form_team_uq").on(t.formId, t.teamId),
        idxTeam: index("form_team_access_team_idx").on(t.teamId),
    })
);

/* ---------------- Relations ---------------- */
export const formsRelations = relations(forms, ({ many, one }) => ({
    owner: one(users, { fields: [forms.userId], references: [users.id] }),
    organization: one(organizations, { fields: [forms.organizationId], references: [organizations.id] }),
    questions: many(formQuestions),
    responses: many(formResponses),
    analytics: many(formAnalytics),
    integrations: many(formIntegrations),
    teamAccess: many(formTeamAccess),
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
    user: one(users, { fields: [formResponses.respondentUserId], references: [users.id] }),
    reviewer: one(users, { fields: [formResponses.reviewedBy], references: [users.id] }),
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

export const formTeamAccessRelations = relations(formTeamAccess, ({ one }) => ({
    form: one(forms, { fields: [formTeamAccess.formId], references: [forms.id] }),
    grantedByUser: one(users, { fields: [formTeamAccess.grantedBy], references: [users.id] }),
}));
