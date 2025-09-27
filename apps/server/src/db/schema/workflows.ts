// src/db/schema/workflows.ts - SIMPLIFIED VERSION
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
import {relations, sql} from "drizzle-orm";
import { users, organizations, teams } from "@/db/schema/auth";
import { forms } from "@/db/schema/forms";
import { eventTypes } from "@/db/schema/scheduling";
import { novuWorkflows, novuTriggers } from "@/db/schema/novu";
import { calendarConnections, externalCalendarEvents } from "@/db/schema/calendar-core";
import { videoConferenceConnections, videoMeetings, meetingParticipants } from "@/db/schema/video-conference-core";
import { hubspotCrmConnections, hubspotContactMappings, hubspotCompanyMappings, hubspotDealMappings, hubspotMeetingMappings, hubspotWebhookEvents } from "@/db/schema/hubspot-crm-core";

/* ---------------- Enums ---------------- */
export const triggerTypeEnum = pgEnum("trigger_type", [
    // Existing triggers
    "form_submitted",
    "form_started",
    "booking_created",
    "booking_confirmed",
    "booking_cancelled",
    "meeting_completed",
    "reminder_due",
    "no_show_detected",
    "scheduled_time",

    // Calendar-specific triggers
    "calendar_sync_completed",
    "calendar_sync_failed",
    "external_event_created",
    "external_event_updated",
    "external_event_deleted",
    "availability_updated",
    "conflict_detected",
    "free_busy_updated",

    // Video conference triggers
    "video_meeting_created",
    "video_meeting_started",
    "video_meeting_ended",
    "video_meeting_joined",
    "video_meeting_left",
    "recording_ready",
    "transcript_available",
    "participant_joined",
    "participant_left",
    "waiting_room_entered",

    // HubSpot CRM triggers
    "hubspot_contact_created",
    "hubspot_contact_updated",
    "hubspot_contact_deleted",
    "hubspot_company_created",
    "hubspot_company_updated",
    "hubspot_deal_created",
    "hubspot_deal_updated",
    "hubspot_deal_stage_changed",
    "hubspot_meeting_created",
    "hubspot_meeting_updated",
    "hubspot_sync_completed",
    "hubspot_sync_failed",
    "hubspot_webhook_received",
    "hubspot_association_created",

    // System triggers
    "usage_limit_warning",
    "plan_upgraded",
    "integration_connected",
    "system_alert"
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

export const resourceTypeEnum = pgEnum("resource_type", [
    "form",
    "booking",
    "calendar",
    "video",
    "hubspot",
    "system",
    "user"
]);

// Simplified integration types - most go through Novu now
export const integrationTypeEnum = pgEnum("integration_type", [
    "zapier",
    "webhook",
    "hubspot",
    "novu",
    "crm",
    "marketing"
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

        // Integration connections
        calendarConnectionId: text("calendar_connection_id").references(() => calendarConnections.id, { onDelete: "set null" }),
        videoConnectionId: text("video_connection_id").references(() => videoConferenceConnections.id, { onDelete: "set null" }),
        hubspotConnectionId: text("hubspot_connection_id").references(() => hubspotCrmConnections.id, { onDelete: "set null" }),

        name: text("name").notNull(),
        description: text("description"),
        status: workflowStatusEnum("status").notNull().default("draft"),

        // Enhanced trigger configuration
        triggerType: triggerTypeEnum("trigger_type").notNull(),
        triggerConfig: jsonb("trigger_config").notNull(),
        triggerConditions: jsonb("trigger_conditions"),

        // Resource context for better targeting
        resourceType: resourceTypeEnum("resource_type"),
        resourceFilters: jsonb("resource_filters"),

        // Workflow categorization
        category: text("category").default("general"), // "calendar_automation", "video_followup", "hubspot_sync", "form_processing", "system_alert"
        tags: jsonb("tags"), // Array of tags for filtering

        workflowDefinition: jsonb("workflow_definition").notNull(),

        // Novu integration
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),
        useNovu: boolean("use_novu").notNull().default(true),

        // Enhanced execution controls
        isActive: boolean("is_active").default(false),
        maxExecutionsPerDay: integer("max_executions_per_day"),
        maxExecutionsPerHour: integer("max_executions_per_hour"),
        executionDelay: integer("execution_delay").default(0),

        // Timezone and business hours awareness
        timezoneAware: boolean("timezone_aware").default(true),
        businessHoursOnly: boolean("business_hours_only").default(false),
        businessHoursConfig: jsonb("business_hours_config"),

        totalExecutions: integer("total_executions").default(0),
        successfulExecutions: integer("successful_executions").default(0),
        failedExecutions: integer("failed_executions").default(0),
        lastExecutedAt: timestamp("last_executed_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("workflows_user_idx").on(t.userId),
        idxOrganization: index("workflows_organization_idx").on(t.organizationId),
        idxTeam: index("workflows_team_idx").on(t.teamId),
        idxNovuWorkflow: index("workflows_novu_workflow_idx").on(t.novuWorkflowId),
        idxActiveNovu: index("workflows_active_novu_idx").on(t.isActive, t.useNovu),
        idxCategory: index("workflows_category_idx").on(t.category),
        idxResourceType: index("workflows_resource_type_idx").on(t.resourceType),
        idxCalendarConnection: index("workflows_calendar_connection_idx").on(t.calendarConnectionId).where(sql`${t.calendarConnectionId} IS NOT NULL`),
        idxVideoConnection: index("workflows_video_connection_idx").on(t.videoConnectionId).where(sql`${t.videoConnectionId} IS NOT NULL`),
        idxHubspotConnection: index("workflows_hubspot_connection_idx").on(t.hubspotConnectionId).where(sql`${t.hubspotConnectionId} IS NOT NULL`),
        uniqueNamePerOrg: uniqueIndex("workflows_org_name_idx").on(t.organizationId, t.name),
    }),
);

/* ---------------- Calendar-Specific Workflow Configurations ---------------- */
export const calendarWorkflows = pgTable(
    "calendar_workflows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
        calendarConnectionId: text("calendar_connection_id").notNull().references(() => calendarConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Calendar-specific settings
        eventTypes: jsonb("event_types"), // Which calendar events to monitor
        watchCalendars: jsonb("watch_calendars"), // Specific calendar IDs to watch
        syncDirections: jsonb("sync_directions"), // inbound, outbound, bidirectional

        // Event matching criteria
        titlePatterns: jsonb("title_patterns"),
        organizerFilters: jsonb("organizer_filters"),
        attendeeFilters: jsonb("attendee_filters"),
        timeRangeFilters: jsonb("time_range_filters"),

        // Conflict detection settings
        monitorConflicts: boolean("monitor_conflicts").default(false),
        conflictResolutionRules: jsonb("conflict_resolution_rules"),

        // Availability monitoring
        monitorAvailability: boolean("monitor_availability").default(false),
        availabilityThresholds: jsonb("availability_thresholds"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqWorkflowCalendar: uniqueIndex("calendar_workflows_workflow_calendar_uq").on(t.workflowId, t.calendarConnectionId),
        idxOrganization: index("calendar_workflows_organization_idx").on(t.organizationId),
        idxCalendarConnection: index("calendar_workflows_calendar_connection_idx").on(t.calendarConnectionId),
    })
);

/* ---------------- Video Conference-Specific Workflow Configurations ---------------- */
export const videoWorkflows = pgTable(
    "video_workflows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
        videoConnectionId: text("video_connection_id").notNull().references(() => videoConferenceConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Video-specific settings
        meetingTypes: jsonb("meeting_types"), // which meeting types to monitor
        participantThreshold: integer("participant_threshold"),
        durationThresholds: jsonb("duration_thresholds"),

        // Recording and transcript settings
        watchRecordings: boolean("watch_recordings").default(false),
        watchTranscripts: boolean("watch_transcripts").default(false),
        recordingQualityThresholds: jsonb("recording_quality_thresholds"),

        // Participant monitoring
        monitorParticipants: boolean("monitor_participants").default(true),
        participantRoleFilters: jsonb("participant_role_filters"), // host, co-host, attendee
        participantLocationFilters: jsonb("participant_location_filters"),

        // Engagement tracking
        trackEngagement: boolean("track_engagement").default(false),
        engagementThresholds: jsonb("engagement_thresholds"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqWorkflowVideo: uniqueIndex("video_workflows_workflow_video_uq").on(t.workflowId, t.videoConnectionId),
        idxOrganization: index("video_workflows_organization_idx").on(t.organizationId),
        idxVideoConnection: index("video_workflows_video_connection_idx").on(t.videoConnectionId),
    })
);

/* ---------------- HubSpot CRM-Specific Workflow Configurations ---------------- */
export const hubspotWorkflows = pgTable(
    "hubspot_workflows",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
        hubspotConnectionId: text("hubspot_connection_id").notNull().references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // HubSpot-specific settings
        objectTypes: jsonb("object_types"), // Which HubSpot objects to monitor: ["contact", "company", "deal", "meeting"]
        propertyChangeFilters: jsonb("property_change_filters"), // Specific properties to watch for changes
        dealStageFilters: jsonb("deal_stage_filters"), // Which deal stages trigger workflows

        // Association monitoring
        monitorAssociations: boolean("monitor_associations").default(false),
        associationTypes: jsonb("association_types"), // Which association types to monitor

        // Webhook configuration
        useRealTimeWebhooks: boolean("use_real_time_webhooks").default(true),
        webhookEventTypes: jsonb("webhook_event_types"), // Specific webhook events to listen for

        // Sync monitoring
        monitorSyncOperations: boolean("monitor_sync_operations").default(false),
        syncDirectionFilters: jsonb("sync_direction_filters"), // inbound, outbound, bidirectional

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqWorkflowHubspot: uniqueIndex("hubspot_workflows_workflow_hubspot_uq").on(t.workflowId, t.hubspotConnectionId),
        idxOrganization: index("hubspot_workflows_organization_idx").on(t.organizationId),
        idxHubspotConnection: index("hubspot_workflows_hubspot_connection_idx").on(t.hubspotConnectionId),
    })
);

/* ---------------- Workflow Executions - Enhanced with Resource Context ---------------- */
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

        // Enhanced resource context
        resourceType: resourceTypeEnum("resource_type"),
        resourceId: text("resource_id"),

        // Specific resource references
        calendarEventId: text("calendar_event_id").references(() => externalCalendarEvents.id, { onDelete: "set null" }),
        videoMeetingId: text("video_meeting_id").references(() => videoMeetings.id, { onDelete: "set null" }),
        participantId: text("participant_id").references(() => meetingParticipants.id, { onDelete: "set null" }),

        // HubSpot resource references
        hubspotContactMappingId: text("hubspot_contact_mapping_id").references(() => hubspotContactMappings.id, { onDelete: "set null" }),
        hubspotDealMappingId: text("hubspot_deal_mapping_id").references(() => hubspotDealMappings.id, { onDelete: "set null" }),
        hubspotCompanyMappingId: text("hubspot_company_mapping_id").references(() => hubspotCompanyMappings.id, { onDelete: "set null" }),
        hubspotMeetingMappingId: text("hubspot_meeting_mapping_id").references(() => hubspotMeetingMappings.id, { onDelete: "set null" }),

        // HubSpot-specific context
        hubspotWebhookEventId: text("hubspot_webhook_event_id").references(() => hubspotWebhookEvents.id, { onDelete: "set null" }),
        hubspotPropertyChanges: jsonb("hubspot_property_changes"), // Track which properties changed

        status: executionStatusEnum("status").notNull().default("pending"),
        currentStep: integer("current_step").default(0),
        totalSteps: integer("total_steps").notNull(),

        executionResults: jsonb("execution_results"),
        errorMessage: text("error_message"),
        errorStep: integer("error_step"),
        retryCount: integer("retry_count").default(0),

        // Timezone context
        executionTimezone: text("execution_timezone"),
        businessHoursRespected: boolean("business_hours_respected").default(false),

        startedAt: timestamp("started_at"),
        completedAt: timestamp("completed_at"),
        executionDuration: integer("execution_duration"),

        // Novu-specific tracking
        novuTransactionId: text("novu_transaction_id"),
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
        idxResource: index("workflow_executions_resource_idx").on(t.resourceType, t.resourceId),
        idxCalendarEvent: index("workflow_executions_calendar_event_idx").on(t.calendarEventId).where(sql`${t.calendarEventId} IS NOT NULL`),
        idxVideoMeeting: index("workflow_executions_video_meeting_idx").on(t.videoMeetingId).where(sql`${t.videoMeetingId} IS NOT NULL`),
        idxHubspotContact: index("workflow_executions_hubspot_contact_idx").on(t.hubspotContactMappingId).where(sql`${t.hubspotContactMappingId} IS NOT NULL`),
        idxHubspotDeal: index("workflow_executions_hubspot_deal_idx").on(t.hubspotDealMappingId).where(sql`${t.hubspotDealMappingId} IS NOT NULL`),
        idxHubspotWebhook: index("workflow_executions_hubspot_webhook_idx").on(t.hubspotWebhookEventId).where(sql`${t.hubspotWebhookEventId} IS NOT NULL`),
        idxStartedAt: index("workflow_executions_started_idx").on(t.startedAt),
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

/* ---------------- Relations ---------------- */
export const workflowsRelations = relations(workflows, ({ one, many }) => ({
    owner: one(users, { fields: [workflows.userId], references: [users.id] }),
    organization: one(organizations, { fields: [workflows.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [workflows.teamId], references: [teams.id] }),
    form: one(forms, { fields: [workflows.formId], references: [forms.id] }),
    eventType: one(eventTypes, { fields: [workflows.eventTypeId], references: [eventTypes.id] }),
    calendarConnection: one(calendarConnections, { fields: [workflows.calendarConnectionId], references: [calendarConnections.id] }),
    videoConnection: one(videoConferenceConnections, { fields: [workflows.videoConnectionId], references: [videoConferenceConnections.id] }),
    hubspotConnection: one(hubspotCrmConnections, { fields: [workflows.hubspotConnectionId], references: [hubspotCrmConnections.id] }),
    novuWorkflow: one(novuWorkflows, { fields: [workflows.novuWorkflowId], references: [novuWorkflows.id] }),
    executions: many(workflowExecutions),
    calendarWorkflows: many(calendarWorkflows),
    videoWorkflows: many(videoWorkflows),
    hubspotWorkflows: many(hubspotWorkflows),
}));

export const calendarWorkflowsRelations = relations(calendarWorkflows, ({ one }) => ({
    workflow: one(workflows, { fields: [calendarWorkflows.workflowId], references: [workflows.id] }),
    calendarConnection: one(calendarConnections, { fields: [calendarWorkflows.calendarConnectionId], references: [calendarConnections.id] }),
    organization: one(organizations, { fields: [calendarWorkflows.organizationId], references: [organizations.id] }),
}));

export const videoWorkflowsRelations = relations(videoWorkflows, ({ one }) => ({
    workflow: one(workflows, { fields: [videoWorkflows.workflowId], references: [workflows.id] }),
    videoConnection: one(videoConferenceConnections, { fields: [videoWorkflows.videoConnectionId], references: [videoConferenceConnections.id] }),
    organization: one(organizations, { fields: [videoWorkflows.organizationId], references: [organizations.id] }),
}));

export const hubspotWorkflowsRelations = relations(hubspotWorkflows, ({ one }) => ({
    workflow: one(workflows, { fields: [hubspotWorkflows.workflowId], references: [workflows.id] }),
    hubspotConnection: one(hubspotCrmConnections, { fields: [hubspotWorkflows.hubspotConnectionId], references: [hubspotCrmConnections.id] }),
    organization: one(organizations, { fields: [hubspotWorkflows.organizationId], references: [organizations.id] }),
}));

export const workflowExecutionsRelations = relations(workflowExecutions, ({ one }) => ({
    workflow: one(workflows, { fields: [workflowExecutions.workflowId], references: [workflows.id] }),
    organization: one(organizations, { fields: [workflowExecutions.organizationId], references: [organizations.id] }),
    novuTrigger: one(novuTriggers, { fields: [workflowExecutions.novuTriggerId], references: [novuTriggers.id] }),
    calendarEvent: one(externalCalendarEvents, { fields: [workflowExecutions.calendarEventId], references: [externalCalendarEvents.id] }),
    videoMeeting: one(videoMeetings, { fields: [workflowExecutions.videoMeetingId], references: [videoMeetings.id] }),
    participant: one(meetingParticipants, { fields: [workflowExecutions.participantId], references: [meetingParticipants.id] }),
    hubspotContactMapping: one(hubspotContactMappings, { fields: [workflowExecutions.hubspotContactMappingId], references: [hubspotContactMappings.id] }),
    hubspotCompanyMapping: one(hubspotCompanyMappings, { fields: [workflowExecutions.hubspotCompanyMappingId], references: [hubspotCompanyMappings.id] }),
    hubspotDealMapping: one(hubspotDealMappings, { fields: [workflowExecutions.hubspotDealMappingId], references: [hubspotDealMappings.id] }),
    hubspotMeetingMapping: one(hubspotMeetingMappings, { fields: [workflowExecutions.hubspotMeetingMappingId], references: [hubspotMeetingMappings.id] }),
    hubspotWebhookEvent: one(hubspotWebhookEvents, { fields: [workflowExecutions.hubspotWebhookEventId], references: [hubspotWebhookEvents.id] }),
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

export const automationRulesRelations = relations(automationRules, ({ one }) => ({
    owner: one(users, { fields: [automationRules.userId], references: [users.id] }),
    organization: one(organizations, { fields: [automationRules.organizationId], references: [organizations.id] }),
    form: one(forms, { fields: [automationRules.formId], references: [forms.id] }),
    eventType: one(eventTypes, { fields: [automationRules.eventTypeId], references: [eventTypes.id] }),
}));
