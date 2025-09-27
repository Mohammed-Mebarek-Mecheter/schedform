// src/db/schema/workflows.ts
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
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, organizations, teams } from "@/db/schema/auth";
import { forms } from "@/db/schema/forms";
import { eventTypes } from "@/db/schema/scheduling";
import { supportedLanguages } from "@/db/schema/localization";
import { novuWorkflows, novuTriggers } from "@/db/schema/novu";

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

// Simplified integration types - most go through Novu now
export const integrationTypeEnum = pgEnum("integration_type", [
    "zapier",
    "webhook",
    "google_calendar",
    "outlook_calendar",
    "zoom",
    "google_meet",
    "hubspot",
    "novu", // New Novu integration type
]);

/* ---------------- Workflows ---------------- */
export const workflows = pgTable(
    "workflows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        status: workflowStatusEnum("status").notNull().default("draft"),

        triggerType: triggerTypeEnum("trigger_type").notNull(),
        triggerConfig: jsonb("trigger_config").notNull(),
        triggerConditions: jsonb("trigger_conditions"),

        workflowDefinition: jsonb("workflow_definition").notNull(),

        // Novu integration
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),
        useNovu: boolean("use_novu").notNull().default(true), // Default to using Novu

        isActive: boolean("is_active").default(false),
        maxExecutionsPerDay: integer("max_executions_per_day"),
        executionDelay: integer("execution_delay").default(0),

        totalExecutions: integer("total_executions").default(0),
        successfulExecutions: integer("successful_executions").default(0),
        failedExecutions: integer("failed_executions").default(0),
        lastExecutedAt: timestamp("last_executed_at"),

        // Localization support
        defaultLanguage: text("default_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
        supportedLanguages: jsonb("supported_languages"), // Array of language codes

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("workflows_user_idx").on(t.userId),
        idxOrganization: index("workflows_organization_idx").on(t.organizationId),
        idxTeam: index("workflows_team_idx").on(t.teamId),
        idxNovuWorkflow: index("workflows_novu_workflow_idx").on(t.novuWorkflowId),
        idxActiveNovu: index("workflows_active_novu_idx").on(t.isActive, t.useNovu),
        uniqueNamePerOrg: uniqueIndex("workflows_org_name_idx").on(t.organizationId, t.name),
    }),
);

/* ---------------- Workflow Executions ---------------- */
export const workflowExecutions = pgTable(
    "workflow_executions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Link to Novu trigger if using Novu
        novuTriggerId: text("novu_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),

        triggeredBy: text("triggered_by").notNull(),
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

        // Novu-specific tracking
        novuTransactionId: text("novu_transaction_id"), // For tracking in Novu
        novuExecutionResults: jsonb("novu_execution_results"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxWorkflow: index("workflow_executions_workflow_idx").on(t.workflowId),
        idxOrganization: index("workflow_executions_organization_idx").on(t.organizationId),
        idxStatus: index("workflow_executions_status_idx").on(t.status),
        idxNovuTrigger: index("workflow_executions_novu_trigger_idx").on(t.novuTriggerId),
        idxNovuTransaction: index("workflow_executions_novu_transaction_idx").on(t.novuTransactionId),
    }),
);

/* ---------------- Integrations - Simplified for Novu-first approach ---------------- */
export const integrations = pgTable(
    "integrations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        type: integrationTypeEnum("type").notNull(),
        name: text("name").notNull(),
        description: text("description"),

        isActive: boolean("is_active").default(true),
        isConnected: boolean("is_connected").default(false),

        // For non-Novu integrations
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
        idxUser: index("integrations_user_idx").on(t.userId),
        idxOrganization: index("integrations_organization_idx").on(t.organizationId),
        idxType: index("integrations_type_idx").on(t.type, t.isActive),
        uniqueOrgType: uniqueIndex("integrations_org_type_idx").on(t.organizationId, t.type),
    }),
);

/* ---------------- Webhooks - Still needed for external systems ---------------- */
export const webhooks = pgTable(
    "webhooks",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        url: text("url").notNull(),
        secret: text("secret"),

        triggerEvents: jsonb("trigger_events").notNull(),

        isActive: boolean("is_active").default(true),
        timeout: integer("timeout").default(30),
        retryPolicy: jsonb("retry_policy"),

        headers: jsonb("headers"),
        authType: text("auth_type"),
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
        idxUser: index("webhooks_user_idx").on(t.userId),
        idxOrganization: index("webhooks_organization_idx").on(t.organizationId),
        idxActive: index("webhooks_active_idx").on(t.isActive),
        uniqueOrgUrl: uniqueIndex("webhooks_org_url_idx").on(t.organizationId, t.url),
    }),
);

/* ---------------- Webhook Deliveries ---------------- */
export const webhookDeliveries = pgTable(
    "webhook_deliveries",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        eventType: text("event_type").notNull(),
        payload: jsonb("payload").notNull(),

        requestHeaders: jsonb("request_headers"),
        requestBody: text("request_body"),

        status: text("status").notNull(),
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
        idxWebhook: index("webhook_deliveries_webhook_idx").on(t.webhookId),
        idxOrganization: index("webhook_deliveries_organization_idx").on(t.organizationId),
        idxStatus: index("webhook_deliveries_status_idx").on(t.status),
    }),
);

/* ---------------- Notification Templates - Now focused on Novu templates ---------------- */
export const notificationTemplates = pgTable(
    "notification_templates",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        templateType: text("template_type").notNull(), // "email", "in_app", "chat"

        // Novu workflow reference
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),

        // Template content for different channels
        emailTemplate: jsonb("email_template"), // { subject, body, variables }
        inAppTemplate: jsonb("in_app_template"), // { title, body, avatar, cta }
        chatTemplate: jsonb("chat_template"), // { text, blocks, attachments }

        defaultLanguage: text("default_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
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
        idxUser: index("notification_templates_user_idx").on(t.userId),
        idxOrganization: index("notification_templates_organization_idx").on(t.organizationId),
        idxType: index("notification_templates_type_idx").on(t.templateType),
        idxNovuWorkflow: index("notification_templates_novu_workflow_idx").on(t.novuWorkflowId),
        uniqueOrgName: uniqueIndex("notification_templates_org_name_idx").on(t.organizationId, t.name),
    }),
);

/* ---------------- Notification Queue - Now routing through Novu ---------------- */
export const notificationQueue = pgTable(
    "notification_queue",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Notification details
        type: text("type").notNull(), // email, in_app, chat
        recipient: text("recipient").notNull(),
        subject: text("subject"),
        message: text("message").notNull(),

        templateId: text("template_id").references(() => notificationTemplates.id, { onDelete: "set null" }),
        templateData: jsonb("template_data"),

        // Novu-specific fields
        novuWorkflowId: text("novu_workflow_id"),
        novuTransactionId: text("novu_transaction_id"),
        routeThroughNovu: boolean("route_through_novu").notNull().default(true),

        scheduledFor: timestamp("scheduled_for"),
        priority: integer("priority").default(5),

        status: text("status").default("pending"),
        attempts: integer("attempts").default(0),
        maxAttempts: integer("max_attempts").default(3),
        lastAttemptAt: timestamp("last_attempt_at"),
        lastError: text("last_error"),

        externalId: text("external_id"), // Novu message ID
        deliveryStatus: text("delivery_status"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        processedAt: timestamp("processed_at"),
    },
    (t) => ({
        idxUser: index("notification_queue_user_idx").on(t.userId),
        idxOrganization: index("notification_queue_organization_idx").on(t.organizationId),
        idxStatus: index("notification_queue_status_idx").on(t.status),
        idxNovuWorkflow: index("notification_queue_novu_workflow_idx").on(t.novuWorkflowId),
        idxScheduled: index("notification_queue_scheduled_idx").on(t.scheduledFor),
    }),
);

/* ---------------- Automation Rules - Updated for Novu ---------------- */
export const automationRules = pgTable(
    "automation_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        isActive: boolean("is_active").default(true),

        triggerType: triggerTypeEnum("trigger_type").notNull(),
        conditions: jsonb("conditions").notNull(),
        actions: jsonb("actions").notNull(),

        // Novu integration for notifications
        novuWorkflowId: text("novu_workflow_id"),
        useNovu: boolean("use_novu").notNull().default(true),

        maxExecutionsPerDay: integer("max_executions_per_day"),
        cooldownMinutes: integer("cooldown_minutes"),

        totalExecutions: integer("total_executions").default(0),
        lastExecuted: timestamp("last_executed"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("automation_rules_user_idx").on(t.userId),
        idxOrganization: index("automation_rules_organization_idx").on(t.organizationId),
        idxNovuWorkflow: index("automation_rules_novu_workflow_idx").on(t.novuWorkflowId),
        uniqueOrgName: uniqueIndex("automation_rules_org_name_idx").on(t.organizationId, t.name),
    }),
);

/* ---------------- Template Translations ---------------- */
export const notificationTemplateTranslations = pgTable(
    "notification_template_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        templateId: text("template_id").notNull().references(() => notificationTemplates.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Translated templates for each channel
        emailTemplate: jsonb("email_template"),
        inAppTemplate: jsonb("in_app_template"),
        chatTemplate: jsonb("chat_template"),

        // Localized variables and their descriptions
        localizedVariables: jsonb("localized_variables"),

        status: text("status").notNull().default("draft"), // draft, published, archived
        translatedBy: text("translated_by").references(() => users.id, { onDelete: "set null" }),
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqTemplateLanguage: uniqueIndex("notification_template_translations_template_language_uq").on(t.templateId, t.languageCode),
        idxLanguage: index("notification_template_translations_language_idx").on(t.languageCode),
        idxStatus: index("notification_template_translations_status_idx").on(t.status),
    })
);

/* ---------------- Automation Rule Translations ---------------- */
export const automationRuleTranslations = pgTable(
    "automation_rule_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        ruleId: text("rule_id").notNull().references(() => automationRules.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        name: text("name"),
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

/* ---------------- Relations ---------------- */
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
    owner: one(users, { fields: [workflows.userId], references: [users.id] }),
    organization: one(organizations, { fields: [workflows.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [workflows.teamId], references: [teams.id] }),
    form: one(forms, { fields: [workflows.formId], references: [forms.id] }),
    eventType: one(eventTypes, { fields: [workflows.eventTypeId], references: [eventTypes.id] }),
    novuWorkflow: one(novuWorkflows, { fields: [workflows.novuWorkflowId], references: [novuWorkflows.id] }),
    executions: many(workflowExecutions),
    defaultLanguageRef: one(supportedLanguages, { fields: [workflows.defaultLanguage], references: [supportedLanguages.code] }),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
    workflow: one(workflows, { fields: [workflowExecutions.workflowId], references: [workflows.id] }),
    organization: one(organizations, { fields: [workflowExecutions.organizationId], references: [organizations.id] }),
    novuTrigger: one(novuTriggers, { fields: [workflowExecutions.novuTriggerId], references: [novuTriggers.id] }),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
    owner: one(users, { fields: [integrations.userId], references: [users.id] }),
    organization: one(organizations, { fields: [integrations.organizationId], references: [organizations.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
    owner: one(users, { fields: [webhooks.userId], references: [users.id] }),
    organization: one(organizations, { fields: [webhooks.organizationId], references: [organizations.id] }),
    form: one(forms, { fields: [webhooks.formId], references: [forms.id] }),
    eventType: one(eventTypes, { fields: [webhooks.eventTypeId], references: [eventTypes.id] }),
    deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
    webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
    organization: one(organizations, { fields: [webhookDeliveries.organizationId], references: [organizations.id] }),
}));

export const notificationTemplatesRelations = relations(notificationTemplates, ({ one, many }) => ({
    owner: one(users, { fields: [notificationTemplates.userId], references: [users.id] }),
    organization: one(organizations, { fields: [notificationTemplates.organizationId], references: [organizations.id] }),
    novuWorkflow: one(novuWorkflows, { fields: [notificationTemplates.novuWorkflowId], references: [novuWorkflows.id] }),
    translations: many(notificationTemplateTranslations),
    defaultLanguageRef: one(supportedLanguages, { fields: [notificationTemplates.defaultLanguage], references: [supportedLanguages.code] }),
}));

export const notificationQueueRelations = relations(notificationQueue, ({ one }) => ({
    owner: one(users, { fields: [notificationQueue.userId], references: [users.id] }),
    organization: one(organizations, { fields: [notificationQueue.organizationId], references: [organizations.id] }),
    template: one(notificationTemplates, { fields: [notificationQueue.templateId], references: [notificationTemplates.id] }),
}));

export const automationRulesRelations = relations(automationRules, ({ one, many }) => ({
    owner: one(users, { fields: [automationRules.userId], references: [users.id] }),
    organization: one(organizations, { fields: [automationRules.organizationId], references: [organizations.id] }),
    form: one(forms, { fields: [automationRules.formId], references: [forms.id] }),
    eventType: one(eventTypes, { fields: [automationRules.eventTypeId], references: [eventTypes.id] }),
    translations: many(automationRuleTranslations),
}));

export const notificationTemplateTranslationsRelations = relations(notificationTemplateTranslations, ({ one }) => ({
    template: one(notificationTemplates, {
        fields: [notificationTemplateTranslations.templateId],
        references: [notificationTemplates.id]
    }),
    language: one(supportedLanguages, {
        fields: [notificationTemplateTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
    translator: one(users, {
        fields: [notificationTemplateTranslations.translatedBy],
        references: [users.id]
    }),
    reviewer: one(users, {
        fields: [notificationTemplateTranslations.reviewedBy],
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
