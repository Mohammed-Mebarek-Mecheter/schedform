// workflows.ts
import {
    pgTable,
    varchar,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    pgEnum,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "@/db/schema/auth"; // Updated import
import { forms } from "@/db/schema/forms";
import { eventTypes } from "@/db/schema/scheduling";
import { supportedLanguages } from "@/db/schema/localization";

/* ---------------- Enums ---------------- */
export const triggerTypeEnum = pgEnum("trigger_type", [
    "form_submitted",
    "form_started",
    "booking_created",
    "booking_confirmed",
    "booking_cancelled",
    "meeting_completed",
    "reminder_due",
    "no_show_detected",
    "scheduled_time",
]);

export const actionTypeEnum = pgEnum("action_type", [
    "send_email",
    "webhook_call",
    "zapier_trigger",
    "create_booking",
    "update_booking",
    "assign_team_member",
    "add_to_crm",
    "send_slack_message",
    "create_task",
    "delay",
    "conditional_branch",
]);

export const workflowStatusEnum = pgEnum("workflow_status", [
    "active",
    "paused",
    "draft",
    "archived",
]);

export const executionStatusEnum = pgEnum("execution_status", [
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "retrying",
]);

export const integrationTypeEnum = pgEnum("integration_type", [
    "zapier",
    "webhook",
    "google_calendar",
    "outlook_calendar",
    "zoom",
    "google_meet",
    "slack",
    "hubspot",
    "salesforce",
    "pipedrive",
    "notion",
    "airtable",
    "mailchimp",
    "convertkit",
    "stripe",
    "paypal",
]);

/* ---------------- Workflows ---------------- */
export const workflows = pgTable(
    "workflows",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        formId: varchar("form_id", { length: 36 }).references(() => forms.id, {
            onDelete: "cascade",
        }),
        eventTypeId: varchar("event_type_id", { length: 36 }).references(
            () => eventTypes.id,
            { onDelete: "cascade" },
        ),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        status: workflowStatusEnum("status").notNull().default("draft"),

        triggerType: triggerTypeEnum("trigger_type").notNull(),
        triggerConfig: jsonb("trigger_config").notNull(),
        triggerConditions: jsonb("trigger_conditions"),

        workflowDefinition: jsonb("workflow_definition").notNull(),

        isActive: boolean("is_active").default(false),
        maxExecutionsPerDay: integer("max_executions_per_day"),
        executionDelay: integer("execution_delay").default(0),

        totalExecutions: integer("total_executions").default(0),
        successfulExecutions: integer("successful_executions").default(0),
        failedExecutions: integer("failed_executions").default(0),
        lastExecutedAt: timestamp("last_executed_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("workflows_user_idx").on(t.userId),
        uniqueName: uniqueIndex("workflows_user_name_idx").on(t.userId, t.name),
    }),
);

/* ---------------- Workflow Executions ---------------- */
export const workflowExecutions = pgTable(
    "workflow_executions",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        workflowId: varchar("workflow_id", { length: 36 })
            .notNull()
            .references(() => workflows.id, { onDelete: "cascade" }),

        triggeredBy: varchar("triggered_by", { length: 100 }).notNull(),
        triggerData: jsonb("trigger_data"),

        status: executionStatusEnum("status").notNull().default("pending"),
        currentStep: integer("current_step").default(0),
        totalSteps: integer("total_steps").notNull(),

        executionResults: jsonb("execution_results"),
        errorMessage: text("error_message"),
        errorStep: integer("error_step"),
        retryCount: integer("retry_count").default(0),

        startedAt: timestamp("started_at"),
        completedAt: timestamp("completed_at"),
        executionDuration: integer("execution_duration"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        wfIdx: index("workflow_executions_wf_idx").on(t.workflowId),
        statusIdx: index("workflow_executions_status_idx").on(t.status),
    }),
);

/* ---------------- Integrations ---------------- */
export const integrations = pgTable(
    "integrations",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        type: integrationTypeEnum("type").notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),

        isActive: boolean("is_active").default(true),
        isConnected: boolean("is_connected").default(false),

        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at"),
        apiKey: text("api_key"),
        apiSecret: text("api_secret"),

        config: jsonb("config"),
        permissions: jsonb("permissions"),

        lastConnected: timestamp("last_connected"),
        lastError: text("last_error"),
        connectionAttempts: integer("connection_attempts").default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("integrations_user_idx").on(t.userId),
        uniqueType: uniqueIndex("integrations_user_type_idx").on(t.userId, t.type),
    }),
);

/* ---------------- Webhooks ---------------- */
export const webhooks = pgTable(
    "webhooks",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        formId: varchar("form_id", { length: 36 }).references(() => forms.id, {
            onDelete: "cascade",
        }),
        eventTypeId: varchar("event_type_id", { length: 36 }).references(
            () => eventTypes.id,
            { onDelete: "cascade" },
        ),

        name: varchar("name", { length: 255 }).notNull(),
        url: text("url").notNull(),
        secret: text("secret"),

        triggerEvents: jsonb("trigger_events").notNull(),

        isActive: boolean("is_active").default(true),
        timeout: integer("timeout").default(30),
        retryPolicy: jsonb("retry_policy"),

        headers: jsonb("headers"),
        authType: varchar("auth_type", { length: 50 }),
        authConfig: jsonb("auth_config"),

        totalCalls: integer("total_calls").default(0),
        successfulCalls: integer("successful_calls").default(0),
        failedCalls: integer("failed_calls").default(0),
        lastCalledAt: timestamp("last_called_at"),
        lastResponse: jsonb("last_response"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("webhooks_user_idx").on(t.userId),
        uniqueUrl: uniqueIndex("webhooks_user_url_idx").on(t.userId, t.url),
    }),
);

/* ---------------- Webhook Deliveries ---------------- */
export const webhookDeliveries = pgTable(
    "webhook_deliveries",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        webhookId: varchar("webhook_id", { length: 36 })
            .notNull()
            .references(() => webhooks.id, { onDelete: "cascade" }),

        eventType: varchar("event_type", { length: 100 }).notNull(),
        payload: jsonb("payload").notNull(),

        requestHeaders: jsonb("request_headers"),
        requestBody: text("request_body"),

        status: varchar("status", { length: 50 }).notNull(),
        httpStatusCode: integer("http_status_code"),
        responseHeaders: jsonb("response_headers"),
        responseBody: text("response_body"),
        errorMessage: text("error_message"),

        attemptNumber: integer("attempt_number").default(1),
        deliveredAt: timestamp("delivered_at"),
        responseTime: integer("response_time"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        webhookIdx: index("webhook_deliveries_webhook_idx").on(t.webhookId),
        statusIdx: index("webhook_deliveries_status_idx").on(t.status),
    }),
);

/* ---------------- Email Templates ---------------- */
export const emailTemplates = pgTable(
    "email_templates",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        type: varchar("type", { length: 100 }).notNull(),

        subject: varchar("subject", { length: 255 }).notNull(),
        htmlBody: text("html_body").notNull(),
        textBody: text("text_body"),

        defaultLanguage: varchar("default_language", { length: 10 }).references(() => supportedLanguages.code, { onDelete: "set null" }),
        supportedLanguages: jsonb("supported_languages"), // Array of language codes
        autoDetectLanguage: boolean("auto_detect_language").default(true),

        variables: jsonb("variables"),

        isDefault: boolean("is_default").default(false),
        isActive: boolean("is_active").default(true),

        totalSent: integer("total_sent").default(0),
        lastUsed: timestamp("last_used"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("email_templates_user_idx").on(t.userId),
        uniqueName: uniqueIndex("email_templates_user_name_idx").on(
            t.userId,
            t.name,
        ),
    }),
);

/* ---------------- Notification Queue ---------------- */
export const notificationQueue = pgTable(
    "notification_queue",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        type: varchar("type", { length: 50 }).notNull(), // email, slack
        recipient: varchar("recipient", { length: 255 }).notNull(),
        subject: varchar("subject", { length: 255 }),
        message: text("message").notNull(),

        templateId: varchar("template_id", { length: 36 }),
        templateData: jsonb("template_data"),

        scheduledFor: timestamp("scheduled_for"),
        priority: integer("priority").default(5),

        status: varchar("status", { length: 50 }).default("pending"),
        attempts: integer("attempts").default(0),
        maxAttempts: integer("max_attempts").default(3),
        lastAttemptAt: timestamp("last_attempt_at"),
        lastError: text("last_error"),

        externalId: varchar("external_id", { length: 255 }),
        deliveryStatus: varchar("delivery_status", { length: 50 }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        processedAt: timestamp("processed_at"),
    },
    (t) => ({
        userIdx: index("notification_queue_user_idx").on(t.userId),
        statusIdx: index("notification_queue_status_idx").on(t.status),
    }),
);

/* ---------------- AI Insights ---------------- */
export const aiInsights = pgTable(
    "ai_insights",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        relatedType: varchar("related_type", { length: 50 }).notNull(),
        relatedId: varchar("related_id", { length: 36 }).notNull(),

        insightType: varchar("insight_type", { length: 100 }).notNull(),
        confidence: integer("confidence"),

        summary: text("summary"),
        details: jsonb("details"),
        recommendations: jsonb("recommendations"),

        modelVersion: varchar("model_version", { length: 50 }),
        processingTime: integer("processing_time"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("ai_insights_user_idx").on(t.userId),
        relatedIdx: index("ai_insights_related_idx").on(t.relatedType, t.relatedId),
    }),
);

/* ---------------- Automation Rules ---------------- */
export const automationRules = pgTable(
    "automation_rules",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id") // Changed to text to match new auth schema
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        formId: varchar("form_id", { length: 36 }).references(() => forms.id, {
            onDelete: "cascade",
        }),
        eventTypeId: varchar("event_type_id", { length: 36 }).references(
            () => eventTypes.id,
            { onDelete: "cascade" },
        ),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        isActive: boolean("is_active").default(true),

        triggerType: triggerTypeEnum("trigger_type").notNull(),
        conditions: jsonb("conditions").notNull(),
        actions: jsonb("actions").notNull(),

        maxExecutionsPerDay: integer("max_executions_per_day"),
        cooldownMinutes: integer("cooldown_minutes"),

        totalExecutions: integer("total_executions").default(0),
        lastExecuted: timestamp("last_executed"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("automation_rules_user_idx").on(t.userId),
        uniqueName: uniqueIndex("automation_rules_user_name_idx").on(
            t.userId,
            t.name,
        ),
    }),
);

/* ---------------- Email Template Translations ---------------- */
export const emailTemplateTranslations = pgTable(
    "email_template_translations",
    {
        id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
        templateId: varchar("template_id", { length: 36 }).notNull().references(() => emailTemplates.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        subject: varchar("subject", { length: 255 }),
        htmlBody: text("html_body"),
        textBody: text("text_body"),

        // Localized variables and their descriptions
        localizedVariables: jsonb("localized_variables"), // Variable names and descriptions in this language

        status: text("status").notNull().default("draft"), // draft, published, archived
        translatedBy: text("translated_by").references(() => users.id, { onDelete: "set null" }), // Changed to text
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }), // Changed to text

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqTemplateLanguage: uniqueIndex("email_template_translations_template_language_uq").on(t.templateId, t.languageCode),
        idxLanguage: index("email_template_translations_language_idx").on(t.languageCode),
        idxStatus: index("email_template_translations_status_idx").on(t.status),
    })
);

/* ---------------- Automation Rule Translations ---------------- */
export const automationRuleTranslations = pgTable(
    "automation_rule_translations",
    {
        id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
        ruleId: varchar("rule_id", { length: 36 }).notNull().references(() => automationRules.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        name: varchar("name", { length: 255 }),
        description: text("description"),

        // Localized actions (e.g., notification messages, email content)
        localizedActions: jsonb("localized_actions"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqRuleLanguage: uniqueIndex("automation_rule_translations_rule_language_uq").on(t.ruleId, t.languageCode),
    })
);

/* ---------------- Localized Notification Queue ---------------- */
export const localizedNotificationQueue = pgTable(
    "localized_notification_queue",
    {
        id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
        notificationId: varchar("notification_id", { length: 36 }).notNull().references(() => notificationQueue.id, { onDelete: "cascade" }),

        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized content
        localizedSubject: varchar("localized_subject", { length: 255 }),
        localizedMessage: text("localized_message"),
        localizedTemplateData: jsonb("localized_template_data"),

        // Regional delivery preferences
        timezoneAdjusted: boolean("timezone_adjusted").default(true),
        culturalSensitivityCheck: boolean("cultural_sensitivity_check").default(false),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqNotificationLanguage: uniqueIndex("localized_notification_queue_notification_language_uq").on(t.notificationId, t.languageCode),
        idxLanguage: index("localized_notification_queue_language_idx").on(t.languageCode),
    })
);

/* ---------------- Relations (Grouped at Bottom) ---------------- */
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
    owner: one(users, { fields: [workflows.userId], references: [users.id] }), // Updated to users
    form: one(forms, { fields: [workflows.formId], references: [forms.id] }),
    eventType: one(eventTypes, {
        fields: [workflows.eventTypeId],
        references: [eventTypes.id],
    }),
    executions: many(workflowExecutions),
}));

export const workflowExecutionsRelations = relations(
    workflowExecutions,
    ({ one }) => ({
        workflow: one(workflows, {
            fields: [workflowExecutions.workflowId],
            references: [workflows.id],
        }),
    }),
);

export const integrationsRelations = relations(integrations, ({ one }) => ({
    owner: one(users, { fields: [integrations.userId], references: [users.id] }), // Updated to users
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
    owner: one(users, { fields: [webhooks.userId], references: [users.id] }), // Updated to users
    form: one(forms, { fields: [webhooks.formId], references: [forms.id] }),
    eventType: one(eventTypes, {
        fields: [webhooks.eventTypeId],
        references: [eventTypes.id],
    }),
    deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(
    webhookDeliveries,
    ({ one }) => ({
        webhook: one(webhooks, {
            fields: [webhookDeliveries.webhookId],
            references: [webhooks.id],
        }),
    }),
);

export const emailTemplatesRelations = relations(emailTemplates, ({ one, many }) => ({
    owner: one(users, { fields: [emailTemplates.userId], references: [users.id] }), // Updated to users
    translations: many(emailTemplateTranslations),
    defaultLanguageRef: one(supportedLanguages, {
        fields: [emailTemplates.defaultLanguage],
        references: [supportedLanguages.code],
    }),
}));

export const notificationQueueRelations = relations(
    notificationQueue,
    ({ one }) => ({
        owner: one(users, { // Updated to users
            fields: [notificationQueue.userId],
            references: [users.id],
        }),
    }),
);

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
    owner: one(users, { fields: [aiInsights.userId], references: [users.id] }), // Updated to users
}));

export const automationRulesRelations = relations(
    automationRules,
    ({ one }) => ({
        owner: one(users, { fields: [automationRules.userId], references: [users.id] }), // Updated to users
        form: one(forms, { fields: [automationRules.formId], references: [forms.id] }),
        eventType: one(eventTypes, {
            fields: [automationRules.eventTypeId],
            references: [eventTypes.id],
        }),
    }),
);

export const emailTemplateTranslationsRelations = relations(emailTemplateTranslations, ({ one }) => ({
    template: one(emailTemplates, {
        fields: [emailTemplateTranslations.templateId],
        references: [emailTemplates.id]
    }),
    language: one(supportedLanguages, {
        fields: [emailTemplateTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
    translator: one(users, { // Updated to users
        fields: [emailTemplateTranslations.translatedBy],
        references: [users.id]
    }),
    reviewer: one(users, { // Updated to users
        fields: [emailTemplateTranslations.reviewedBy],
        references: [users.id]
    }),
}));

export const automationRuleTranslationsRelations = relations(automationRuleTranslations, ({ one }) => ({
    rule: one(automationRules, {
        fields: [automationRuleTranslations.ruleId],
        references: [automationRules.id]
    }),
    language: one(supportedLanguages, {
        fields: [automationRuleTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const localizedNotificationQueueRelations = relations(localizedNotificationQueue, ({ one }) => ({
    notification: one(notificationQueue, {
        fields: [localizedNotificationQueue.notificationId],
        references: [notificationQueue.id]
    }),
    language: one(supportedLanguages, {
        fields: [localizedNotificationQueue.languageCode],
        references: [supportedLanguages.code]
    }),
}));
