// src/db/schema/slack-integration-core.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    pgEnum,
    index,
    uniqueIndex
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations, teams, users } from "@/db/schema/auth";
import { formResponses } from "@/db/schema/forms";
import { bookings, eventTypes } from "@/db/schema/scheduling";

/* ============================
   Enums
   ============================ */

export const slackEventTypeEnum = pgEnum("slack_event_type", [
    "form_submission",
    "meeting_booked",
    "meeting_confirmed",
    "meeting_cancelled",
    "meeting_completed",
    "meeting_rescheduled",
    "meeting_reminder",
    "no_show_detected",
    "high_value_lead",
    "spam_blocked",
    "qualification_completed"
]);

export const slackMessageStatusEnum = pgEnum("slack_message_status", [
    "pending",
    "sent",
    "delivered",
    "failed",
    "rate_limited",
    "retrying"
]);

export const slackChannelTypeEnum = pgEnum("slack_channel_type", [
    "public",
    "private",
    "im",
    "mpim"
]);

export const slackNotificationPriorityEnum = pgEnum("slack_notification_priority", [
    "low",
    "normal",
    "high",
    "urgent"
]);

export const slackInteractionTypeEnum = pgEnum("slack_interaction_type", [
    "button_click",
    "slash_command",
    "shortcut",
    "modal_submission",
    "menu_selection"
]);

/* ============================
   Core Slack Connection Tables
   ============================ */

/**
 * Slack workspace connections - OAuth2 based
 */
export const slackConnections = pgTable(
    "slack_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        // Slack workspace info
        slackWorkspaceId: text("slack_workspace_id").notNull(),
        slackWorkspaceName: text("slack_workspace_name").notNull(),
        slackWorkspaceDomain: text("slack_workspace_domain"),
        slackWorkspaceUrl: text("slack_workspace_url"),

        // OAuth tokens
        botAccessToken: text("bot_access_token").notNull(),
        userAccessToken: text("user_access_token"),
        tokenScopes: jsonb("token_scopes").notNull(),
        tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),

        // Installing user info
        installingUserId: text("installing_user_id").notNull(),
        installingUserEmail: text("installing_user_email"),
        installingUserName: text("installing_user_name"),

        // App configuration
        slackAppId: text("slack_app_id").notNull(),
        slackBotId: text("slack_bot_id").notNull(),
        slackBotUserId: text("slack_bot_user_id").notNull(),

        // Connection settings
        isActive: boolean("is_active").notNull().default(true),
        isDefault: boolean("is_default").notNull().default(false),
        notificationsEnabled: boolean("notifications_enabled").notNull().default(true),

        // Feature flags
        enableInteractiveMessages: boolean("enable_interactive_messages").notNull().default(true),
        enableSlashCommands: boolean("enable_slash_commands").notNull().default(true),
        enableWorkflows: boolean("enable_workflows").notNull().default(false),
        enableAiSummaries: boolean("enable_ai_summaries").notNull().default(true),

        // Error tracking
        lastError: text("last_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),
        lastSuccessfulSync: timestamp("last_successful_sync", { mode: "date" }),

        // Webhook verification
        signingSecret: text("signing_secret"),
        verificationToken: text("verification_token"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("slack_connections_user_idx").on(t.userId),
        idxOrganization: index("slack_connections_organization_idx").on(t.organizationId),
        idxActive: index("slack_connections_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        uqWorkspaceUser: uniqueIndex("slack_connections_workspace_user_uq").on(t.slackWorkspaceId, t.userId),
        uqUserDefault: uniqueIndex("slack_connections_user_default_uq")
            .on(t.userId, t.isDefault)
            .where(sql`${t.isDefault} = true`),
    })
);

/**
 * Channel mappings - which Slack channels receive which types of notifications
 */
export const slackChannelMappings = pgTable(
    "slack_channel_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Slack channel info
        slackChannelId: text("slack_channel_id").notNull(),
        slackChannelName: text("slack_channel_name").notNull(),
        channelType: slackChannelTypeEnum("channel_type").notNull(),
        isPrivate: boolean("is_private").notNull().default(false),

        // Event filtering
        eventTypes: jsonb("event_types").notNull(), // Array of slack_event_type values
        formIds: jsonb("form_ids"), // Array of form IDs to filter (null = all forms)
        eventTypeIds: jsonb("event_type_ids"), // Array of event type IDs to filter (null = all)
        teamIds: jsonb("team_ids"), // Array of team IDs to filter (null = all teams)

        // Notification settings
        isActive: boolean("is_active").notNull().default(true),
        priority: slackNotificationPriorityEnum("priority").notNull().default("normal"),
        includeFormSummary: boolean("include_form_summary").notNull().default(true),
        includeQualificationScore: boolean("include_qualification_score").notNull().default(true),
        includeAiInsights: boolean("include_ai_insights").notNull().default(true),
        enableThreadedReplies: boolean("enable_threaded_replies").notNull().default(true),

        // Message customization
        customMessageTemplate: text("custom_message_template"),
        mentionUsers: jsonb("mention_users"), // Array of user IDs to @mention
        mentionUserGroups: jsonb("mention_user_groups"), // Array of user group IDs
        emojiReactions: jsonb("emoji_reactions"), // Array of emoji to auto-react with

        // Conditions and filters
        qualificationScoreThreshold: integer("qualification_score_threshold"),
        intentScoreThreshold: integer("intent_score_threshold"),
        onlyHighValue: boolean("only_high_value").notNull().default(false),
        onlyWorkingHours: boolean("only_working_hours").notNull().default(false),
        workingHoursConfig: jsonb("working_hours_config"),

        // Statistics
        messagesSent: integer("messages_sent").notNull().default(0),
        lastMessageSentAt: timestamp("last_message_sent_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConnectionChannel: uniqueIndex("slack_channel_mappings_connection_channel_uq").on(
            t.connectionId,
            t.slackChannelId
        ),
        idxOrganization: index("slack_channel_mappings_organization_idx").on(t.organizationId),
        idxActive: index("slack_channel_mappings_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        idxPriority: index("slack_channel_mappings_priority_idx").on(t.priority),
        chkQualificationThreshold: sql`CHECK (${t.qualificationScoreThreshold} IS NULL OR (${t.qualificationScoreThreshold} >= 0 AND ${t.qualificationScoreThreshold} <= 100))`,
        chkIntentThreshold: sql`CHECK (${t.intentScoreThreshold} IS NULL OR (${t.intentScoreThreshold} >= 0 AND ${t.intentScoreThreshold} <= 100))`,
        chkMessagesSent: sql`CHECK (${t.messagesSent} >= 0)`,
    })
);

/**
 * Message templates for different notification types
 */
export const slackMessageTemplates = pgTable(
    "slack_message_templates",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Template identification
        name: text("name").notNull(),
        eventType: slackEventTypeEnum("event_type").notNull(),
        isDefault: boolean("is_default").notNull().default(false),

        // Message structure (Slack Block Kit JSON)
        messageBlocks: jsonb("message_blocks").notNull(),
        fallbackText: text("fallback_text").notNull(),

        // Interactive elements
        includeActionButtons: boolean("include_action_buttons").notNull().default(false),
        actionButtonsConfig: jsonb("action_buttons_config"),

        // Template variables and personalization
        availableVariables: jsonb("available_variables"), // What variables can be used
        personalizationRules: jsonb("personalization_rules"), // Dynamic content rules

        // Usage tracking
        usageCount: integer("usage_count").notNull().default(0),
        lastUsedAt: timestamp("last_used_at", { mode: "date" }),

        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConnectionEventTypeDefault: uniqueIndex("slack_templates_connection_event_type_default_uq")
            .on(t.connectionId, t.eventType, t.isDefault)
            .where(sql`${t.isDefault} = true`),
        idxConnectionEventType: index("slack_templates_connection_event_type_idx").on(t.connectionId, t.eventType),
        idxOrganization: index("slack_templates_organization_idx").on(t.organizationId),
        idxActive: index("slack_templates_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        chkUsageCount: sql`CHECK (${t.usageCount} >= 0)`,
    })
);

/* ============================
   Message Tracking Tables
   ============================ */

/**
 * Sent message tracking for delivery status and interactions
 */
export const slackMessages = pgTable(
    "slack_messages",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Source references
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "set null" }),

        // Slack message info
        slackChannelId: text("slack_channel_id").notNull(),
        slackMessageId: text("slack_message_id"),
        slackThreadId: text("slack_thread_id"),

        // Message details
        eventType: slackEventTypeEnum("event_type").notNull(),
        messageTemplateId: text("message_template_id").references(() => slackMessageTemplates.id, { onDelete: "set null" }),
        priority: slackNotificationPriorityEnum("priority").notNull().default("normal"),

        // Content
        messageText: text("message_text"),
        messageBlocks: jsonb("message_blocks"),
        attachments: jsonb("attachments"),

        // Delivery tracking
        status: slackMessageStatusEnum("status").notNull().default("pending"),
        sentAt: timestamp("sent_at", { mode: "date" }),
        deliveredAt: timestamp("delivered_at", { mode: "date" }),
        failureReason: text("failure_reason"),
        retryCount: integer("retry_count").notNull().default(0),
        maxRetries: integer("max_retries").notNull().default(3),

        // Engagement tracking
        reactionsCount: integer("reactions_count").notNull().default(0),
        repliesCount: integer("replies_count").notNull().default(0),
        viewsCount: integer("views_count").notNull().default(0),
        clicksCount: integer("clicks_count").notNull().default(0),

        // Context data for personalization
        contextData: jsonb("context_data"), // Original data used to generate message
        recipientUserId: text("recipient_user_id"), // If DM
        triggerUserId: text("trigger_user_id").references(() => users.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqSlackMessage: uniqueIndex("slack_messages_slack_message_uq")
            .on(t.slackChannelId, t.slackMessageId)
            .where(sql`${t.slackMessageId} IS NOT NULL`),
        idxConnection: index("slack_messages_connection_idx").on(t.connectionId),
        idxOrganization: index("slack_messages_organization_idx").on(t.organizationId),
        idxFormResponse: index("slack_messages_form_response_idx").on(t.formResponseId).where(sql`${t.formResponseId} IS NOT NULL`),
        idxBooking: index("slack_messages_booking_idx").on(t.bookingId).where(sql`${t.bookingId} IS NOT NULL`),
        idxStatus: index("slack_messages_status_idx").on(t.status, t.createdAt),
        idxEventType: index("slack_messages_event_type_idx").on(t.eventType, t.createdAt),
        chkRetryCount: sql`CHECK (${t.retryCount} >= 0 AND ${t.retryCount} <= ${t.maxRetries})`,
        chkMaxRetries: sql`CHECK (${t.maxRetries} >= 0)`,
        chkEngagementCounts: sql`CHECK (${t.reactionsCount} >= 0 AND ${t.repliesCount} >= 0 AND ${t.viewsCount} >= 0 AND ${t.clicksCount} >= 0)`,
    })
);

/**
 * Interactive message responses and button clicks
 */
export const slackInteractions = pgTable(
    "slack_interactions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        messageId: text("message_id")
            .notNull()
            .references(() => slackMessages.id, { onDelete: "cascade" }),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Slack interaction info
        slackUserId: text("slack_user_id").notNull(),
        slackUserEmail: text("slack_user_email"),
        slackUserName: text("slack_user_name"),
        slackTeamId: text("slack_team_id").notNull(),

        // Interaction details
        interactionType: slackInteractionTypeEnum("interaction_type").notNull(),
        actionId: text("action_id"),
        actionValue: text("action_value"),
        callbackId: text("callback_id"),
        triggerId: text("trigger_id"),

        // Response handling
        responseUrl: text("response_url"),
        responseHandled: boolean("response_handled").notNull().default(false),
        responseMessage: text("response_message"),
        responseStatus: text("response_status"),

        // Context and routing
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "set null" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "set null" }),
        assignedUserId: text("assigned_user_id").references(() => users.id, { onDelete: "set null" }),

        // Payload data
        rawPayload: jsonb("raw_payload").notNull(),
        processedData: jsonb("processed_data"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxMessage: index("slack_interactions_message_idx").on(t.messageId),
        idxConnection: index("slack_interactions_connection_idx").on(t.connectionId),
        idxSlackUser: index("slack_interactions_slack_user_idx").on(t.slackUserId),
        idxActionType: index("slack_interactions_action_type_idx").on(t.interactionType, t.actionId),
        idxFormResponse: index("slack_interactions_form_response_idx").on(t.formResponseId).where(sql`${t.formResponseId} IS NOT NULL`),
        idxBooking: index("slack_interactions_booking_idx").on(t.bookingId).where(sql`${t.bookingId} IS NOT NULL`),
        idxOrganization: index("slack_interactions_organization_idx").on(t.organizationId),
    })
);

/**
 * Slack command usage tracking
 */
export const slackCommands = pgTable(
    "slack_commands",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Slack command info
        command: text("command").notNull(), // "/schedform"
        subCommand: text("sub_command"), // "stats", "assign", "schedule"
        commandText: text("command_text"),

        // User info
        slackUserId: text("slack_user_id").notNull(),
        slackUserEmail: text("slack_user_email"),
        slackUserName: text("slack_user_name"),
        slackChannelId: text("slack_channel_id").notNull(),
        slackChannelName: text("slack_channel_name"),

        // Execution details
        responseType: text("response_type").notNull().default("ephemeral"), // ephemeral, in_channel
        responseMessage: text("response_message"),
        executionTimeMs: integer("execution_time_ms"),

        // Status
        status: text("status").notNull().default("completed"), // completed, failed, timeout
        errorMessage: text("error_message"),

        // Context
        triggerId: text("trigger_id"),
        responseUrl: text("response_url"),
        rawPayload: jsonb("raw_payload").notNull(),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("slack_commands_connection_idx").on(t.connectionId),
        idxCommand: index("slack_commands_command_idx").on(t.command, t.subCommand),
        idxUser: index("slack_commands_user_idx").on(t.slackUserId),
        idxStatus: index("slack_commands_status_idx").on(t.status, t.createdAt),
        idxOrganization: index("slack_commands_organization_idx").on(t.organizationId),
        chkExecutionTime: sql`CHECK (${t.executionTimeMs} IS NULL OR ${t.executionTimeMs} >= 0)`,
    })
);

/* ============================
   User and Team Mapping Tables
   ============================ */

/**
 * Map SchedForm users to Slack users for mentions and assignments
 */
export const slackUserMappings = pgTable(
    "slack_user_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // SchedForm user
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        // Slack user info
        slackUserId: text("slack_user_id").notNull(),
        slackUserEmail: text("slack_user_email"),
        slackUserName: text("slack_user_name"),
        slackDisplayName: text("slack_display_name"),

        // Configuration
        receiveNotifications: boolean("receive_notifications").notNull().default(true),
        receiveAssignments: boolean("receive_assignments").notNull().default(true),
        receiveMentions: boolean("receive_mentions").notNull().default(true),
        autoAssignLeads: boolean("auto_assign_leads").notNull().default(false),

        // Assignment rules
        assignmentWeight: integer("assignment_weight").notNull().default(1),
        maxAssignmentsPerDay: integer("max_assignments_per_day"),
        qualificationThreshold: integer("qualification_threshold"),
        workingHours: jsonb("working_hours"),
        timeZone: text("time_zone"),

        // Statistics
        totalAssignments: integer("total_assignments").notNull().default(0),
        lastAssignedAt: timestamp("last_assigned_at", { mode: "date" }),
        averageResponseTime: integer("average_response_time"), // in minutes

        isActive: boolean("is_active").notNull().default(true),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConnectionUser: uniqueIndex("slack_user_mappings_connection_user_uq").on(t.connectionId, t.userId),
        uqConnectionSlackUser: uniqueIndex("slack_user_mappings_connection_slack_user_uq").on(t.connectionId, t.slackUserId),
        idxOrganization: index("slack_user_mappings_organization_idx").on(t.organizationId),
        idxSlackUser: index("slack_user_mappings_slack_user_idx").on(t.slackUserId),
        idxActive: index("slack_user_mappings_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        chkAssignmentWeight: sql`CHECK (${t.assignmentWeight} > 0)`,
        chkMaxAssignments: sql`CHECK (${t.maxAssignmentsPerDay} IS NULL OR ${t.maxAssignmentsPerDay} > 0)`,
        chkQualificationThreshold: sql`CHECK (${t.qualificationThreshold} IS NULL OR (${t.qualificationThreshold} >= 0 AND ${t.qualificationThreshold} <= 100))`,
        chkTotalAssignments: sql`CHECK (${t.totalAssignments} >= 0)`,
        chkAvgResponseTime: sql`CHECK (${t.averageResponseTime} IS NULL OR ${t.averageResponseTime} >= 0)`,
    })
);

/**
 * Webhook event tracking for reliability and debugging
 */
export const slackWebhookEvents = pgTable(
    "slack_webhook_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Webhook details
        eventType: text("event_type").notNull(), // url_verification, event_callback, etc.
        eventId: text("event_id"),
        eventTime: timestamp("event_time", { mode: "date" }),

        // Request info
        requestMethod: text("request_method").notNull(),
        requestHeaders: jsonb("request_headers"),
        requestBody: jsonb("request_body").notNull(),
        sourceIp: text("source_ip"),

        // Verification
        isVerified: boolean("is_verified").notNull().default(false),
        verificationError: text("verification_error"),
        signatureValid: boolean("signature_valid").notNull().default(false),

        // Processing
        processed: boolean("processed").notNull().default(false),
        processedAt: timestamp("processed_at", { mode: "date" }),
        processingError: text("processing_error"),
        responseStatus: integer("response_status"),
        responseTime: integer("response_time"), // in milliseconds

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("slack_webhook_events_connection_idx").on(t.connectionId),
        idxEventType: index("slack_webhook_events_event_type_idx").on(t.eventType, t.createdAt),
        idxProcessed: index("slack_webhook_events_processed_idx").on(t.processed, t.processedAt),
        idxVerified: index("slack_webhook_events_verified_idx").on(t.isVerified, t.signatureValid),
        idxOrganization: index("slack_webhook_events_organization_idx").on(t.organizationId),
        chkResponseStatus: sql`CHECK (${t.responseStatus} IS NULL OR (${t.responseStatus} >= 100 AND ${t.responseStatus} < 600))`,
        chkResponseTime: sql`CHECK (${t.responseTime} IS NULL OR ${t.responseTime} >= 0)`,
    })
);

/* ============================
   Analytics Tables
   ============================ */

/**
 * Daily analytics for Slack integration performance
 */
export const slackAnalytics = pgTable(
    "slack_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => slackConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        date: timestamp("date", { mode: "date" }).notNull(),

        // Message metrics
        messagesSent: integer("messages_sent").notNull().default(0),
        messagesDelivered: integer("messages_delivered").notNull().default(0),
        messagesFailed: integer("messages_failed").notNull().default(0),
        averageDeliveryTime: integer("average_delivery_time").notNull().default(0), // in seconds

        // Engagement metrics
        totalReactions: integer("total_reactions").notNull().default(0),
        totalReplies: integer("total_replies").notNull().default(0),
        totalViews: integer("total_views").notNull().default(0),
        totalClicks: integer("total_clicks").notNull().default(0),
        uniqueActiveUsers: integer("unique_active_users").notNull().default(0),

        // Interaction metrics
        buttonClicks: integer("button_clicks").notNull().default(0),
        slashCommandUses: integer("slash_command_uses").notNull().default(0),
        leadsAssigned: integer("leads_assigned").notNull().default(0),
        averageResponseTime: integer("average_response_time").notNull().default(0), // in minutes

        // Event breakdown
        formSubmissionNotifications: integer("form_submission_notifications").notNull().default(0),
        meetingBookedNotifications: integer("meeting_booked_notifications").notNull().default(0),
        highValueLeadAlerts: integer("high_value_lead_alerts").notNull().default(0),
        spamBlockedAlerts: integer("spam_blocked_alerts").notNull().default(0),

        // Channel breakdown
        channelMetrics: jsonb("channel_metrics"), // Per-channel stats
        userMetrics: jsonb("user_metrics"), // Per-user stats

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConnectionDate: uniqueIndex("slack_analytics_connection_date_uq").on(t.connectionId, t.date),
        idxDate: index("slack_analytics_date_idx").on(t.date),
        idxOrganization: index("slack_analytics_organization_idx").on(t.organizationId),
        chkMessageMetrics: sql`CHECK (${t.messagesSent} >= 0 AND ${t.messagesDelivered} >= 0 AND ${t.messagesFailed} >= 0)`,
        chkEngagementMetrics: sql`CHECK (${t.totalReactions} >= 0 AND ${t.totalReplies} >= 0 AND ${t.totalViews} >= 0 AND ${t.totalClicks} >= 0)`,
        chkInteractionMetrics: sql`CHECK (${t.buttonClicks} >= 0 AND ${t.slashCommandUses} >= 0 AND ${t.leadsAssigned} >= 0)`,
        chkTimeMetrics: sql`CHECK (${t.averageDeliveryTime} >= 0 AND ${t.averageResponseTime} >= 0)`,
        chkNotificationMetrics: sql`CHECK (${t.formSubmissionNotifications} >= 0 AND ${t.meetingBookedNotifications} >= 0 AND ${t.highValueLeadAlerts} >= 0 AND ${t.spamBlockedAlerts} >= 0)`,
    })
);

/* ============================
   Relations
   ============================ */

export const slackConnectionsRelations = relations(slackConnections, ({ one, many }) => ({
    user: one(users, {
        fields: [slackConnections.userId],
        references: [users.id]
    }),
    organization: one(organizations, {
        fields: [slackConnections.organizationId],
        references: [organizations.id]
    }),
    team: one(teams, {
        fields: [slackConnections.teamId],
        references: [teams.id]
    }),
    channelMappings: many(slackChannelMappings),
    messageTemplates: many(slackMessageTemplates),
    messages: many(slackMessages),
    interactions: many(slackInteractions),
    commands: many(slackCommands),
    userMappings: many(slackUserMappings),
    webhookEvents: many(slackWebhookEvents),
    analytics: many(slackAnalytics),
}));

export const slackChannelMappingsRelations = relations(slackChannelMappings, ({ one, many }) => ({
    connection: one(slackConnections, {
        fields: [slackChannelMappings.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackChannelMappings.organizationId],
        references: [organizations.id],
    }),
    messages: many(slackMessages),
}));

export const slackMessageTemplatesRelations = relations(slackMessageTemplates, ({ one, many }) => ({
    connection: one(slackConnections, {
        fields: [slackMessageTemplates.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackMessageTemplates.organizationId],
        references: [organizations.id],
    }),
    messages: many(slackMessages),
}));

export const slackMessagesRelations = relations(slackMessages, ({ one, many }) => ({
    connection: one(slackConnections, {
        fields: [slackMessages.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackMessages.organizationId],
        references: [organizations.id],
    }),
    formResponse: one(formResponses, {
        fields: [slackMessages.formResponseId],
        references: [formResponses.id],
    }),
    booking: one(bookings, {
        fields: [slackMessages.bookingId],
        references: [bookings.id],
    }),
    eventType: one(eventTypes, {
        fields: [slackMessages.eventTypeId],
        references: [eventTypes.id],
    }),
    messageTemplate: one(slackMessageTemplates, {
        fields: [slackMessages.messageTemplateId],
        references: [slackMessageTemplates.id],
    }),
    triggerUser: one(users, {
        fields: [slackMessages.triggerUserId],
        references: [users.id],
    }),
    interactions: many(slackInteractions),
}));

export const slackInteractionsRelations = relations(slackInteractions, ({ one }) => ({
    message: one(slackMessages, {
        fields: [slackInteractions.messageId],
        references: [slackMessages.id],
    }),
    connection: one(slackConnections, {
        fields: [slackInteractions.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackInteractions.organizationId],
        references: [organizations.id],
    }),
    formResponse: one(formResponses, {
        fields: [slackInteractions.formResponseId],
        references: [formResponses.id],
    }),
    booking: one(bookings, {
        fields: [slackInteractions.bookingId],
        references: [bookings.id],
    }),
    assignedUser: one(users, {
        fields: [slackInteractions.assignedUserId],
        references: [users.id],
    }),
}));

export const slackCommandsRelations = relations(slackCommands, ({ one }) => ({
    connection: one(slackConnections, {
        fields: [slackCommands.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackCommands.organizationId],
        references: [organizations.id],
    }),
}));

export const slackUserMappingsRelations = relations(slackUserMappings, ({ one }) => ({
    connection: one(slackConnections, {
        fields: [slackUserMappings.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackUserMappings.organizationId],
        references: [organizations.id],
    }),
    user: one(users, {
        fields: [slackUserMappings.userId],
        references: [users.id],
    }),
}));

export const slackWebhookEventsRelations = relations(slackWebhookEvents, ({ one }) => ({
    connection: one(slackConnections, {
        fields: [slackWebhookEvents.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackWebhookEvents.organizationId],
        references: [organizations.id],
    }),
}));

export const slackAnalyticsRelations = relations(slackAnalytics, ({ one }) => ({
    connection: one(slackConnections, {
        fields: [slackAnalytics.connectionId],
        references: [slackConnections.id],
    }),
    organization: one(organizations, {
        fields: [slackAnalytics.organizationId],
        references: [organizations.id],
    }),
}));

/* ============================
   Additional Helper Types
   ============================ */

// Export types for use in application code
export type SlackConnection = typeof slackConnections.$inferSelect;
export type NewSlackConnection = typeof slackConnections.$inferInsert;
export type SlackChannelMapping = typeof slackChannelMappings.$inferSelect;
export type NewSlackChannelMapping = typeof slackChannelMappings.$inferInsert;
export type SlackMessage = typeof slackMessages.$inferSelect;
export type NewSlackMessage = typeof slackMessages.$inferInsert;
export type SlackInteraction = typeof slackInteractions.$inferSelect;
export type NewSlackInteraction = typeof slackInteractions.$inferInsert;
export type SlackUserMapping = typeof slackUserMappings.$inferSelect;
export type NewSlackUserMapping = typeof slackUserMappings.$inferInsert;
