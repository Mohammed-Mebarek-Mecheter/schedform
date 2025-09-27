// src/db/schema/novu.ts
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
    real
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, organizations } from "@/db/schema/auth";
import { forms, formResponses } from "@/db/schema/forms";
import { bookings, eventTypes } from "@/db/schema/scheduling";
import { conversationalFlows } from "@/db/schema/conversationalFlow";
import { calendarConnections, externalCalendarEvents } from "@/db/schema/calendar-core";
import { videoConferenceConnections, videoMeetings } from "@/db/schema/video-conference-core";

/* ---------------- Enums ---------------- */
export const novuChannelEnum = pgEnum("novu_channel", [
    "email",
    "in_app",
    "chat",
    "webhook",
]);

export const novuProviderEnum = pgEnum("novu_provider", [
    "brevo",
    "slack",
    "discord",
    "msteams",
    "webhook",
]);

export const novuWorkflowStatusEnum = pgEnum("novu_workflow_status", [
    "active",
    "draft",
    "disabled",
]);

export const novuNotificationStatusEnum = pgEnum("novu_notification_status", [
    "sent",
    "delivered",
    "read",
    "failed",
    "pending",
    "cancelled",
]);

export const novuSubscriberPriorityEnum = pgEnum("novu_subscriber_priority", [
    "low",
    "medium",
    "high",
    "urgent",
]);

export const novuResourceTypeEnum = pgEnum("novu_resource_type", [
    // Core SchedForm resources
    "form_response",
    "booking",
    "flow_event",

    // Calendar integration resources
    "calendar_sync",
    "availability_change",
    "external_event",

    // Video conference resources
    "video_meeting_started",
    "video_meeting_ended",
    "recording_ready",
    "transcript_available",

    // System events
    "system_alert",
    "usage_limit",
]);

/* ---------------- Novu Core Configuration ---------------- */
export const novuConfigurations = pgTable(
    "novu_configurations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Novu API Configuration
        secretKey: text("secret_key").notNull(),
        serverUrl: text("server_url").default("https://api.novu.co"),
        environmentId: text("environment_id"),

        // Provider Configurations
        defaultEmailProvider: novuProviderEnum("default_email_provider"),
        defaultChatProvider: novuProviderEnum("default_chat_provider"),

        // Rate Limiting
        rateLimitEnabled: boolean("rate_limit_enabled").default(true),
        rateLimitMax: integer("rate_limit_max").default(1000),
        rateLimitWindow: integer("rate_limit_window").default(60000),

        // Webhook Configuration
        webhookUrl: text("webhook_url"),
        webhookSecret: text("webhook_secret"),
        webhookEnabled: boolean("webhook_enabled").default(false),

        // Extended integration settings
        enableCalendarNotifications: boolean("enable_calendar_notifications").default(true),
        enableVideoNotifications: boolean("enable_video_notifications").default(true),
        enableSystemAlerts: boolean("enable_system_alerts").default(true),

        // Performance Tracking
        totalNotificationsSent: integer("total_notifications_sent").default(0),
        lastNotificationAt: timestamp("last_notification_at", { mode: "date" }),
        averageDeliveryTime: integer("average_delivery_time").default(0),

        // Status
        isActive: boolean("is_active").default(true),
        isVerified: boolean("is_verified").default(false),
        lastVerifiedAt: timestamp("last_verified_at", { mode: "date" }),

        // Error Tracking
        lastError: text("last_error"),
        errorCount: integer("error_count").default(0),
        lastErrorAt: timestamp("last_error_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqOrganization: uniqueIndex("novu_configurations_organization_uq").on(t.organizationId),
        idxActive: index("novu_configurations_active_idx").on(t.isActive),
        idxVerified: index("novu_configurations_verified_idx").on(t.isVerified),
    })
);

/* ---------------- Novu Subscribers (Maps to our users) ---------------- */
export const novuSubscribers = pgTable(
    "novu_subscribers",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Novu-specific identifiers
        subscriberId: text("subscriber_id").notNull(), // Unique ID in Novu
        externalId: text("external_id"), // Optional external ID

        // Subscriber data (synced with Novu)
        email: text("email"),
        phone: text("phone"),
        firstName: text("first_name"),
        lastName: text("last_name"),
        avatar: text("avatar"),
        locale: text("locale"),
        timezone: text("timezone"),

        // Extended preferences for calendar and video notifications
        calendarNotificationsEnabled: boolean("calendar_notifications_enabled").default(true),
        videoNotificationsEnabled: boolean("video_notifications_enabled").default(true),
        systemAlertsEnabled: boolean("system_alerts_enabled").default(true),

        // Channel preferences
        emailEnabled: boolean("email_enabled").default(true),
        chatEnabled: boolean("chat_enabled").default(true),
        inAppEnabled: boolean("in_app_enabled").default(true),

        // Priority and settings
        priority: novuSubscriberPriorityEnum("priority").default("medium"),
        isOnline: boolean("is_online").default(false),
        lastOnlineAt: timestamp("last_online_at", { mode: "date" }),

        // Custom data for Novu
        customData: jsonb("custom_data"),
        preferences: jsonb("preferences"),

        // Sync status
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
        syncStatus: text("sync_status").default("synced"),
        syncError: text("sync_error"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqSubscriber: uniqueIndex("novu_subscribers_subscriber_uq").on(t.subscriberId),
        uqUserOrg: uniqueIndex("novu_subscribers_user_org_uq").on(t.userId, t.organizationId),
        idxEmail: index("novu_subscribers_email_idx").on(t.email),
        idxPhone: index("novu_subscribers_phone_idx").on(t.phone),
        idxOnline: index("novu_subscribers_online_idx").on(t.isOnline),
    })
);

/* ---------------- Novu Workflows (Notification Templates) ---------------- */
export const novuWorkflows = pgTable(
    "novu_workflows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Workflow identification
        workflowId: text("workflow_id").notNull(), // Novu workflow identifier
        name: text("name").notNull(),
        description: text("description"),
        category: text("category"), // "form", "booking", "system", "marketing", "calendar", "video"

        // Associated resources (polymorphic approach)
        resourceType: novuResourceTypeEnum("resource_type"), // Type of resource this workflow handles
        resourceConfig: jsonb("resource_config"), // Configuration for specific resource types

        // Extended resource associations
        formId: text("form_id").references(() => forms.id, { onDelete: "set null" }),
        eventTypeId: text("event_type_id").references(() => eventTypes.id, { onDelete: "set null" }),
        calendarConnectionId: text("calendar_connection_id").references(() => calendarConnections.id, { onDelete: "set null" }),
        videoConnectionId: text("video_connection_id").references(() => videoConferenceConnections.id, { onDelete: "set null" }),

        // Workflow configuration
        triggers: jsonb("triggers").notNull(), // Array of trigger events
        steps: jsonb("steps").notNull(), // Workflow steps configuration
        preferenceSettings: jsonb("preference_settings"), // Channel preferences

        // Extended notification settings
        notificationTriggers: jsonb("notification_triggers"), // Specific conditions for triggering
        escalationRules: jsonb("escalation_rules"), // Rules for escalating notifications
        timeBasedRules: jsonb("time_based_rules"), // Time-based notification rules

        // Status and activation
        status: novuWorkflowStatusEnum("status").default("active"),
        isActive: boolean("is_active").default(true),
        activationDate: timestamp("activation_date", { mode: "date" }),

        // Statistics
        totalTriggers: integer("total_triggers").default(0),
        successRate: real("success_rate").default(0),
        averageExecutionTime: integer("average_execution_time").default(0),

        // Rate limiting
        rateLimit: integer("rate_limit"),
        rateLimitWindow: integer("rate_limit_window"),

        // Versioning
        version: integer("version").default(1),
        isLatest: boolean("is_latest").default(true),
        previousVersionId: text("previous_version_id"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqWorkflow: uniqueIndex("novu_workflows_workflow_uq").on(t.workflowId),
        idxCategory: index("novu_workflows_category_idx").on(t.category),
        idxActive: index("novu_workflows_active_idx").on(t.isActive),
        idxForm: index("novu_workflows_form_idx").on(t.formId).where(sql`${t.formId} IS NOT NULL`),
        idxResourceType: index("novu_workflows_resource_type_idx").on(t.resourceType),
    })
);

/* ---------------- Notification Triggers ---------------- */
export const novuTriggers = pgTable(
    "novu_triggers",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        workflowId: text("workflow_id")
            .notNull()
            .references(() => novuWorkflows.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Trigger source with extended resource types
        resourceType: novuResourceTypeEnum("resource_type").notNull(),
        resourceId: text("resource_id").notNull(), // ID of the triggering resource

        // Polymorphic resource references (JSONB for flexibility)
        resourceReferences: jsonb("resource_references").notNull().default({}), // Contains all relevant resource IDs

        // Associated entities (direct foreign keys for common cases)
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "set null" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "set null" }),
        flowId: text("flow_id").references(() => conversationalFlows.id, { onDelete: "set null" }),
        calendarConnectionId: text("calendar_connection_id").references(() => calendarConnections.id, { onDelete: "set null" }),
        videoMeetingId: text("video_meeting_id").references(() => videoMeetings.id, { onDelete: "set null" }),
        externalEventId: text("external_event_id").references(() => externalCalendarEvents.id, { onDelete: "set null" }),

        // Trigger data
        triggerName: text("trigger_name").notNull(),
        payload: jsonb("payload").notNull(), // Data sent to Novu
        overrides: jsonb("overrides"), // Provider overrides

        // Extended context for calendar and video events
        eventContext: jsonb("event_context"), // Additional context for the event
        timingData: jsonb("timing_data"), // Time-based data for the trigger

        // Recipient information
        toSubscriberId: text("to_subscriber_id").references(() => novuSubscribers.id, { onDelete: "set null" }),
        toTopicKey: text("to_topic_key"), // For topic-based notifications
        toEmail: text("to_email"),
        toPhone: text("to_phone"),

        // Transaction tracking
        transactionId: text("transaction_id").unique(), // Novu transaction ID
        actorSubscriberId: text("actor_subscriber_id"), // Who triggered the notification

        // Execution status
        status: novuNotificationStatusEnum("status").default("pending"),
        initiatedAt: timestamp("initiated_at", { mode: "date" }).notNull().defaultNow(),
        processedAt: timestamp("processed_at", { mode: "date" }),
        completedAt: timestamp("completed_at", { mode: "date" }),

        // Error handling
        errorMessage: text("error_message"),
        retryCount: integer("retry_count").default(0),
        maxRetries: integer("max_retries").default(3),

        // Performance metrics
        processingTime: integer("processing_time"),
        novuResponse: jsonb("novu_response"), // Full response from Novu API

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxTransaction: index("novu_triggers_transaction_idx").on(t.transactionId),
        idxStatus: index("novu_triggers_status_idx").on(t.status, t.initiatedAt),
        idxResource: index("novu_triggers_resource_idx").on(t.resourceType, t.resourceId),
        idxWorkflow: index("novu_triggers_workflow_idx").on(t.workflowId),
        idxOrganization: index("novu_triggers_organization_idx").on(t.organizationId),
        idxCalendarConnection: index("novu_triggers_calendar_connection_idx").on(t.calendarConnectionId).where(sql`${t.calendarConnectionId} IS NOT NULL`),
        idxVideoMeeting: index("novu_triggers_video_meeting_idx").on(t.videoMeetingId).where(sql`${t.videoMeetingId} IS NOT NULL`),
    })
);

/* ---------------- Notification Messages (Novu Messages) ---------------- */
export const novuMessages = pgTable(
    "novu_messages",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        triggerId: text("trigger_id")
            .notNull()
            .references(() => novuTriggers.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Novu message identifiers
        messageId: text("message_id").notNull(), // Novu message ID
        notificationId: text("notification_id"), // Novu notification ID

        // Message details
        channel: novuChannelEnum("channel").notNull(),
        providerId: novuProviderEnum("provider_id"),
        templateId: text("template_id"),

        // Extended message context
        contextType: novuResourceTypeEnum("context_type"), // Context of the message
        contextData: jsonb("context_data"), // Additional context data

        // Content
        subject: text("subject"),
        content: text("content"),
        htmlContent: text("html_content"),
        payload: jsonb("payload"),

        // Recipient
        subscriberId: text("subscriber_id").references(() => novuSubscribers.id, { onDelete: "set null" }),
        destination: text("destination").notNull(), // email, phone, device token, etc.

        // Delivery status
        status: novuNotificationStatusEnum("status").default("pending"),
        statusDetails: jsonb("status_details"),
        sentAt: timestamp("sent_at", { mode: "date" }),
        deliveredAt: timestamp("delivered_at", { mode: "date" }),
        readAt: timestamp("read_at", { mode: "date" }),

        // Provider-specific data
        providerResponse: jsonb("provider_response"),
        providerMessageId: text("provider_message_id"),

        // Error handling
        error: text("error"),
        errorDetails: jsonb("error_details"),

        // Analytics
        clickCount: integer("click_count").default(0),
        lastClickedAt: timestamp("last_clicked_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqMessage: uniqueIndex("novu_messages_message_uq").on(t.messageId),
        idxChannelStatus: index("novu_messages_channel_status_idx").on(t.channel, t.status),
        idxSubscriber: index("novu_messages_subscriber_idx").on(t.subscriberId),
        idxTrigger: index("novu_messages_trigger_idx").on(t.triggerId),
        idxDestination: index("novu_messages_destination_idx").on(t.destination),
        idxContextType: index("novu_messages_context_type_idx").on(t.contextType),
    })
);

/* ---------------- Novu Topics (for group notifications) ---------------- */
export const novuTopics = pgTable(
    "novu_topics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Topic identification
        topicKey: text("topic_key").notNull(), // Novu topic key
        name: text("name").notNull(),
        description: text("description"),

        // Extended topic configuration
        topicType: text("topic_type"), // "team", "calendar", "video", "system"
        resourceAssociations: jsonb("resource_associations"), // Associated resources

        // Topic configuration
        isPublic: boolean("is_public").default(false),
        subscriberCount: integer("subscriber_count").default(0),

        // Associated resource
        associatedType: text("associated_type"), // "team", "form", "event_type", "calendar", "video"
        associatedId: text("associated_id"),

        // Sync status
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }),
        syncRequired: boolean("sync_required").default(false),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTopicKey: uniqueIndex("novu_topics_topic_key_uq").on(t.topicKey),
        idxOrganization: index("novu_topics_organization_idx").on(t.organizationId),
        idxAssociated: index("novu_topics_associated_idx").on(t.associatedType, t.associatedId),
        idxTopicType: index("novu_topics_topic_type_idx").on(t.topicType),
    })
);

/* ---------------- Topic Subscriptions ---------------- */
export const novuTopicSubscriptions = pgTable(
    "novu_topic_subscriptions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        topicId: text("topic_id")
            .notNull()
            .references(() => novuTopics.id, { onDelete: "cascade" }),
        subscriberId: text("subscriber_id")
            .notNull()
            .references(() => novuSubscribers.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Extended subscription preferences
        notificationTypes: jsonb("notification_types"), // Specific types of notifications to receive
        deliveryRules: jsonb("delivery_rules"), // Rules for when to deliver notifications

        // Subscription preferences
        emailEnabled: boolean("email_enabled").default(true),
        smsEnabled: boolean("sms_enabled").default(false),
        pushEnabled: boolean("push_enabled").default(false),
        inAppEnabled: boolean("in_app_enabled").default(true),

        // Subscription metadata
        subscribedAt: timestamp("subscribed_at", { mode: "date" }).notNull().defaultNow(),
        unsubscribedAt: timestamp("unsubscribed_at", { mode: "date" }),
        isActive: boolean("is_active").default(true),

        // Custom preferences
        preferences: jsonb("preferences"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTopicSubscriber: uniqueIndex("novu_topic_subscriptions_topic_subscriber_uq").on(t.topicId, t.subscriberId),
        idxActive: index("novu_topic_subscriptions_active_idx").on(t.isActive),
        idxOrganization: index("novu_topic_subscriptions_organization_idx").on(t.organizationId),
    })
);

/* ---------------- Novu Webhook Events ---------------- */
export const novuWebhookEvents = pgTable(
    "novu_webhook_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Extended webhook data
        eventType: text("event_type").notNull(), // "notification.sent", "notification.delivered", etc.
        eventCategory: text("event_category"), // "calendar", "video", "system", "form", "booking"
        payload: jsonb("payload").notNull(),
        signature: text("signature"),
        source: text("source").default("novu"),

        // Associated notification with extended context
        messageId: text("message_id").references(() => novuMessages.messageId, { onDelete: "set null" }),
        transactionId: text("transaction_id"),
        resourceType: novuResourceTypeEnum("resource_type"), // Type of resource that triggered the webhook

        // Processing status
        processed: boolean("processed").default(false),
        processedAt: timestamp("processed_at", { mode: "date" }),
        processingError: text("processing_error"),

        // Retry logic
        retryCount: integer("retry_count").default(0),
        nextRetryAt: timestamp("next_retry_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxEventType: index("novu_webhook_events_event_type_idx").on(t.eventType, t.createdAt),
        idxProcessed: index("novu_webhook_events_processed_idx").on(t.processed, t.createdAt),
        idxOrganization: index("novu_webhook_events_organization_idx").on(t.organizationId),
        idxResourceType: index("novu_webhook_events_resource_type_idx").on(t.resourceType),
        idxEventCategory: index("novu_webhook_events_event_category_idx").on(t.eventCategory),
    })
);

/* ---------------- Novu Analytics ---------------- */
export const novuAnalytics = pgTable(
    "novu_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Time period
        date: timestamp("date", { mode: "date" }).notNull(),
        period: text("period").notNull(), // "daily", "weekly", "monthly"

        // Extended analytics by resource type
        resourceTypeBreakdown: jsonb("resource_type_breakdown"), // Notifications by resource type
        categoryBreakdown: jsonb("category_breakdown"), // Notifications by category

        // Channel statistics
        emailSent: integer("email_sent").default(0),
        emailDelivered: integer("email_delivered").default(0),
        emailOpened: integer("email_opened").default(0),
        emailClicked: integer("email_clicked").default(0),
        emailBounced: integer("email_bounced").default(0),
        emailComplained: integer("email_complained").default(0),

        chatSent: integer("chat_sent").default(0),
        chatDelivered: integer("chat_delivered").default(0),
        chatOpened: integer("chat_opened").default(0),
        chatClicked: integer("chat_clicked").default(0),
        chatBounced: integer("chat_bounced").default(0),
        chatComplained: integer("chat_complained").default(0),

        inAppSent: integer("in_app_sent").default(0),
        inAppRead: integer("in_app_read").default(0),

        // Workflow statistics with extended breakdown
        workflowTriggers: jsonb("workflow_triggers"), // {workflowId: count}
        topWorkflows: jsonb("top_workflows"), // Most triggered workflows
        resourceTypePerformance: jsonb("resource_type_performance"), // Performance by resource type

        // Performance metrics
        averageDeliveryTime: integer("average_delivery_time").default(0),
        successRate: real("success_rate").default(0),

        // Cost tracking (if applicable)
        estimatedCost: real("estimated_cost").default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqDatePeriod: uniqueIndex("novu_analytics_date_period_uq").on(t.date, t.period, t.organizationId),
        idxDate: index("novu_analytics_date_idx").on(t.date),
        idxOrganization: index("novu_analytics_organization_idx").on(t.organizationId),
    })
);

/* ---------------- Relations ---------------- */
export const novuConfigurationsRelations = relations(novuConfigurations, ({ one, many }) => ({
    organization: one(organizations, {
        fields: [novuConfigurations.organizationId],
        references: [organizations.id],
    }),
    workflows: many(novuWorkflows),
    subscribers: many(novuSubscribers),
}));

export const novuSubscribersRelations = relations(novuSubscribers, ({ one, many }) => ({
    user: one(users, {
        fields: [novuSubscribers.userId],
        references: [users.id],
    }),
    organization: one(organizations, {
        fields: [novuSubscribers.organizationId],
        references: [organizations.id],
    }),
    triggers: many(novuTriggers),
    messages: many(novuMessages),
    topicSubscriptions: many(novuTopicSubscriptions),
}));

export const novuWorkflowsRelations = relations(novuWorkflows, ({ one, many }) => ({
    organization: one(organizations, {
        fields: [novuWorkflows.organizationId],
        references: [organizations.id],
    }),
    form: one(forms, {
        fields: [novuWorkflows.formId],
        references: [forms.id],
    }),
    eventType: one(eventTypes, {
        fields: [novuWorkflows.eventTypeId],
        references: [eventTypes.id],
    }),
    calendarConnection: one(calendarConnections, {
        fields: [novuWorkflows.calendarConnectionId],
        references: [calendarConnections.id],
    }),
    videoConnection: one(videoConferenceConnections, {
        fields: [novuWorkflows.videoConnectionId],
        references: [videoConferenceConnections.id],
    }),
    triggers: many(novuTriggers),
}));

export const novuTriggersRelations = relations(novuTriggers, ({ one, many }) => ({
    workflow: one(novuWorkflows, {
        fields: [novuTriggers.workflowId],
        references: [novuWorkflows.id],
    }),
    organization: one(organizations, {
        fields: [novuTriggers.organizationId],
        references: [organizations.id],
    }),
    formResponse: one(formResponses, {
        fields: [novuTriggers.formResponseId],
        references: [formResponses.id],
    }),
    booking: one(bookings, {
        fields: [novuTriggers.bookingId],
        references: [bookings.id],
    }),
    flow: one(conversationalFlows, {
        fields: [novuTriggers.flowId],
        references: [conversationalFlows.id],
    }),
    calendarConnection: one(calendarConnections, {
        fields: [novuTriggers.calendarConnectionId],
        references: [calendarConnections.id],
    }),
    videoMeeting: one(videoMeetings, {
        fields: [novuTriggers.videoMeetingId],
        references: [videoMeetings.id],
    }),
    externalEvent: one(externalCalendarEvents, {
        fields: [novuTriggers.externalEventId],
        references: [externalCalendarEvents.id],
    }),
    subscriber: one(novuSubscribers, {
        fields: [novuTriggers.toSubscriberId],
        references: [novuSubscribers.id],
    }),
    messages: many(novuMessages),
}));

export const novuMessagesRelations = relations(novuMessages, ({ one }) => ({
    trigger: one(novuTriggers, {
        fields: [novuMessages.triggerId],
        references: [novuTriggers.id],
    }),
    organization: one(organizations, {
        fields: [novuMessages.organizationId],
        references: [organizations.id],
    }),
    subscriber: one(novuSubscribers, {
        fields: [novuMessages.subscriberId],
        references: [novuSubscribers.id],
    }),
}));

export const novuTopicsRelations = relations(novuTopics, ({ one, many }) => ({
    organization: one(organizations, {
        fields: [novuTopics.organizationId],
        references: [organizations.id],
    }),
    subscriptions: many(novuTopicSubscriptions),
}));

export const novuTopicSubscriptionsRelations = relations(novuTopicSubscriptions, ({ one }) => ({
    topic: one(novuTopics, {
        fields: [novuTopicSubscriptions.topicId],
        references: [novuTopics.id],
    }),
    subscriber: one(novuSubscribers, {
        fields: [novuTopicSubscriptions.subscriberId],
        references: [novuSubscribers.id],
    }),
    organization: one(organizations, {
        fields: [novuTopicSubscriptions.organizationId],
        references: [organizations.id],
    }),
}));

export const novuWebhookEventsRelations = relations(novuWebhookEvents, ({ one }) => ({
    organization: one(organizations, {
        fields: [novuWebhookEvents.organizationId],
        references: [organizations.id],
    }),
    message: one(novuMessages, {
        fields: [novuWebhookEvents.messageId],
        references: [novuMessages.messageId],
    }),
}));

export const novuAnalyticsRelations = relations(novuAnalytics, ({ one }) => ({
    organization: one(organizations, {
        fields: [novuAnalytics.organizationId],
        references: [organizations.id],
    }),
}));
