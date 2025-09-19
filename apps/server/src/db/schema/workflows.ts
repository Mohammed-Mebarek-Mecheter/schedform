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

import { user } from "./auth";
import { forms } from "./forms";
import { eventTypes } from "./scheduling";

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
    "send_sms",
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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        type: varchar("type", { length: 100 }).notNull(),

        subject: varchar("subject", { length: 255 }).notNull(),
        htmlBody: text("html_body").notNull(),
        textBody: text("text_body"),

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

/* ---------------- SMS Templates ---------------- */
export const smsTemplates = pgTable(
    "sms_templates",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        type: varchar("type", { length: 100 }).notNull(),

        message: varchar("message", { length: 1000 }).notNull(),
        variables: jsonb("variables"),

        isDefault: boolean("is_default").default(false),
        isActive: boolean("is_active").default(true),

        totalSent: integer("total_sent").default(0),
        lastUsed: timestamp("last_used"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("sms_templates_user_idx").on(t.userId),
        uniqueName: uniqueIndex("sms_templates_user_name_idx").on(
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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        type: varchar("type", { length: 50 }).notNull(), // email, sms, slack
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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

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

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
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

/* ---------------- Relations (Grouped at Bottom) ---------------- */
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
    owner: one(user, { fields: [workflows.userId], references: [user.id] }),
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
    owner: one(user, { fields: [integrations.userId], references: [user.id] }),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
    owner: one(user, { fields: [webhooks.userId], references: [user.id] }),
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

export const emailTemplatesRelations = relations(emailTemplates, ({ one }) => ({
    owner: one(user, { fields: [emailTemplates.userId], references: [user.id] }),
}));

export const smsTemplatesRelations = relations(smsTemplates, ({ one }) => ({
    owner: one(user, { fields: [smsTemplates.userId], references: [user.id] }),
}));

export const notificationQueueRelations = relations(
    notificationQueue,
    ({ one }) => ({
        owner: one(user, {
            fields: [notificationQueue.userId],
            references: [user.id],
        }),
    }),
);

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
    owner: one(user, { fields: [aiInsights.userId], references: [user.id] }),
}));

export const automationRulesRelations = relations(
    automationRules,
    ({ one }) => ({
        owner: one(user, { fields: [automationRules.userId], references: [user.id] }),
        form: one(forms, { fields: [automationRules.formId], references: [forms.id] }),
        eventType: one(eventTypes, {
            fields: [automationRules.eventTypeId],
            references: [eventTypes.id],
        }),
    }),
);
