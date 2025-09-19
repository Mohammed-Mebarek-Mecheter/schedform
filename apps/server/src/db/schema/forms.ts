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
 * - Keep enums centralized here for easy updates.
 * - These are pg enums created in the DB by migrations generated from drizzle-kit.
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

/**
 * Forms
 * - Main table for a conversational form flow.
 * - Slug is unique for public sharing.
 * - completionRate kept as real (floating number), to allow decimals like 83.5.
 */
export const forms = pgTable(
    "forms",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        // Basic
        title: text("title").notNull(),
        description: text("description"),
        slug: text("slug").notNull(),

        // Lifecycle & status
        status: formStatusEnum("status").notNull().default("draft"),
        publishedAt: timestamp("published_at"),

        // Branding & customization
        customBranding: boolean("custom_branding").notNull().default(false),
        logoUrl: text("logo_url"),
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        backgroundColor: text("background_color").notNull().default("#ffffff"),
        customCss: text("custom_css"),
        customJs: text("custom_js"),

        // Behavior
        showProgressBar: boolean("show_progress_bar").notNull().default(true),
        allowBackButton: boolean("allow_back_button").notNull().default(true),
        submitButtonText: text("submit_button_text").notNull().default("Submit"),
        thankYouMessage: text("thank_you_message").notNull().default("Thank you for your submission!"),
        redirectUrl: text("redirect_url"),

        // Controls & limits
        maxResponses: integer("max_responses"),
        requireLogin: boolean("require_login").notNull().default(false),
        collectIpAddress: boolean("collect_ip_address").notNull().default(true),
        allowMultipleSubmissions: boolean("allow_multiple_submissions").notNull().default(false),

        // Closing
        closingDate: timestamp("closing_date"),
        closingMessage: text("closing_message"),

        // Analytics counters and ratio
        totalViews: integer("total_views").notNull().default(0),
        totalResponses: integer("total_responses").notNull().default(0),
        completionRate: real("completion_rate").notNull().default(0), // 0.0 - 100.0

        // Timestamps
        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        // Unique slug per user would allow same slug under different users if desired;
        // Here we enforce global uniqueness — modify to include userId if you want per-user slugs.
        uniqueSlug: uniqueIndex("forms_slug_unique").on(t.slug),
        // Querying forms for a user is common
        idxUser: index("forms_user_idx").on(t.userId),
    })
);

/**
 * Form Questions
 * - A question is a single "step"/field in the conversational flow.
 * - `settings` holds question-specific config (choices, placeholders, validation params).
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
        groupId: text("group_id"), // optional grouping/section id

        // Flexible settings: choice options, validation, UI hints
        settings: jsonb("settings"),

        // File-specific
        maxFileSize: integer("max_file_size"), // bytes
        allowedFileTypes: text("allowed_file_types"), // comma separated mime-types

        // Conditional logic & validation
        validationRules: jsonb("validation_rules"),
        showConditions: jsonb("show_conditions"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormQuestions: index("form_questions_form_idx").on(t.formId, t.orderIndex),
    })
);

/**
 * Question Choices
 * - For multiple choice, dropdowns, etc.
 * - Value uniqueness per question is enforced.
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

        // For branching flows (jump to another question)
        jumpToQuestionId: text("jump_to_question_id").references(() => formQuestions.id, {
            onDelete: "set null",
        }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqChoiceValue: uniqueIndex("question_choices_question_value_uq").on(t.questionId, t.value),
        uqChoiceOrder: uniqueIndex("question_choices_question_order_uq").on(t.questionId, t.orderIndex),
    })
);

/**
 * Form Responses
 * - Each time someone interacts with a form (partial or complete) we create a response.
 * - resumeToken is unique and used for "resume later" functionality.
 */
export const formResponses = pgTable(
    "form_responses",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        // If respondent is registered, we can store the userId; otherwise anonymous
        respondentUserId: text("respondent_user_id").references(() => user.id, { onDelete: "set null" }),
        respondentId: text("respondent_id"), // session / anon id for tracking
        respondentEmail: text("respondent_email"),
        respondentName: text("respondent_name"),

        // Technical metadata
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        sessionId: text("session_id"),

        // Progress & completion
        isCompleted: boolean("is_completed").notNull().default(false),
        completedAt: timestamp("completed_at"),
        timeToComplete: integer("time_to_complete"), // seconds

        // Resume and dedupe helpers
        resumeToken: text("resume_token"),
        lastQuestionId: text("last_question_id").references(() => formQuestions.id, { onDelete: "set null" }),

        // Location (optional)
        country: text("country"),
        city: text("city"),

        // Quality & spam scoring (AI)
        qualityScore: integer("quality_score"), // 0-100
        spamScore: integer("spam_score"), // 0-100

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormCompleted: index("form_responses_form_completed_idx").on(t.formId, t.isCompleted),
        uqResumeToken: uniqueIndex("form_responses_resume_token_uq").on(t.resumeToken),
        idxRespondentUser: index("form_responses_respondent_user_idx").on(t.respondentUserId),
    })
);

/**
 * Form Answers
 * - A single answer per question per response is expected — enforce uniqueness.
 * - jsonValue can contain arrays (multiple-choice), or structured file metadata, etc.
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

        // Various typed columns for convenience — only one will typically be populated.
        textValue: text("text_value"),
        numberValue: integer("number_value"),
        dateValue: timestamp("date_value"),
        booleanValue: boolean("boolean_value"),
        jsonValue: jsonb("json_value"),

        // File metadata (if file upload)
        fileUrl: text("file_url"),
        fileName: text("file_name"),
        fileSize: integer("file_size"),
        fileMimeType: text("file_mime_type"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqResponseQuestion: uniqueIndex("form_answers_response_question_uq").on(t.responseId, t.questionId),
        idxQuestion: index("form_answers_question_idx").on(t.questionId),
        // If you plan to query jsonValue content often, consider adding a GIN index in migrations:
        // CREATE INDEX form_answers_json_value_gin ON form_answers USING gin (json_value jsonb_path_ops);
    })
);

/**
 * Form Analytics (daily aggregates)
 * - One row per (formId, date).
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

        questionDropoffs: jsonb("question_dropoffs"), // { questionId: count }
        deviceStats: jsonb("device_stats"),
        browserStats: jsonb("browser_stats"),
        countryStats: jsonb("country_stats"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqFormDate: uniqueIndex("form_analytics_form_date_uq").on(t.formId, t.date),
        idxFormDate: index("form_analytics_form_date_idx").on(t.formId, t.date),
    })
);

/**
 * Form Integrations
 * - Webhooks, Zapier, email connectors, etc.
 * - config json stores provider-specific payload (url, headers, mappings).
 */
export const formIntegrations = pgTable(
    "form_integrations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id")
            .notNull()
            .references(() => forms.id, { onDelete: "cascade" }),

        type: text("type").notNull(), // e.g., 'webhook', 'zapier', 'email'
        name: text("name").notNull(),
        isActive: boolean("is_active").notNull().default(true),

        config: jsonb("config").notNull(),

        lastExecuted: timestamp("last_executed"),
        lastStatus: text("last_status"), // success|failed|pending
        executionCount: integer("execution_count").notNull().default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormIntegrationType: index("form_integrations_form_type_idx").on(t.formId, t.type),
    })
);

/* ---------------------------
   RELATIONS (type-safe helpers)
   ---------------------------
   These allow using Drizzle's `relations()` helpers to do typed joins such as:
   db.select().from(forms).leftJoin(formQuestions, ...). You can also use db.query.* when configured.
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
