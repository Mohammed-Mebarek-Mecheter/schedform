// src/db/schema/hubspot-crm-core.ts
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
    varchar
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { organizations, teams, users } from "@/db/schema/auth";
import { forms, formResponses } from "@/db/schema/forms";
import { bookings } from "@/db/schema/scheduling";

/* ============================
   Enums
   ============================ */

export const hubspotObjectTypeEnum = pgEnum("hubspot_object_type", [
    "contact",
    "company",
    "deal",
    "meeting",
    "task",
    "note",
    "email"
]);

export const hubspotSyncStatusEnum = pgEnum("hubspot_sync_status", [
    "pending",
    "in_progress",
    "completed",
    "failed",
    "partial"
]);

export const hubspotSyncDirectionEnum = pgEnum("hubspot_sync_direction", [
    "inbound",
    "outbound",
    "bidirectional"
]);

export const hubspotAssociationTypeEnum = pgEnum("hubspot_association_type", [
    "contact_to_company",
    "contact_to_deal",
    "company_to_deal",
    "deal_to_meeting",
    "contact_to_meeting",
    "company_to_meeting"
]);

/* ============================
   Core HubSpot Connection Tables
   ============================ */

/**
 * HubSpot CRM connections - OAuth2 based
 */
export const hubspotCrmConnections = pgTable(
    "hubspot_crm_connections",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),

        // OAuth2 tokens
        accessToken: text("access_token").notNull(),
        refreshToken: text("refresh_token"),
        tokenExpiresAt: timestamp("token_expires_at", { mode: "date" }),
        tokenScopes: jsonb("token_scopes").notNull(),

        // HubSpot account info
        hubspotAccountId: text("hubspot_account_id").notNull(),
        hubspotUserId: text("hubspot_user_id").notNull(),
        hubspotUserEmail: text("hubspot_user_email").notNull(),
        hubspotPortalId: integer("hubspot_portal_id").notNull(),

        // Sync configuration
        isActive: boolean("is_active").notNull().default(true),
        isDefault: boolean("is_default").notNull().default(false),
        autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(true),
        syncInterval: integer("sync_interval").default(300), // 5 minutes in seconds

        // Object type sync settings
        syncContacts: boolean("sync_contacts").notNull().default(true),
        syncCompanies: boolean("sync_companies").notNull().default(false),
        syncDeals: boolean("sync_deals").notNull().default(false),
        syncMeetings: boolean("sync_meetings").notNull().default(true),

        // Field mapping configuration
        fieldMappings: jsonb("field_mappings").notNull().default({}),
        customPropertyMappings: jsonb("custom_property_mappings"),

        // Webhook configuration
        webhookId: text("webhook_id"),
        webhookSecret: text("webhook_secret"),
        webhookExpiresAt: timestamp("webhook_expires_at", { mode: "date" }),

        // Error tracking
        lastError: text("last_error"),
        consecutiveFailures: integer("consecutive_failures").default(0),
        lastSuccessfulSync: timestamp("last_successful_sync", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("hubspot_connections_user_idx").on(t.userId),
        idxOrganization: index("hubspot_connections_organization_idx").on(t.organizationId),
        idxActive: index("hubspot_connections_active_idx").on(t.isActive).where(sql`${t.isActive} = true`),
        uqPortalUser: uniqueIndex("hubspot_connections_portal_user_uq").on(t.hubspotPortalId, t.userId),
        uqUserDefault: uniqueIndex("hubspot_connections_user_default_uq")
            .on(t.userId, t.isDefault)
            .where(sql`${t.isDefault} = true`),
    })
);

/**
 * HubSpot object sync state - tracks sync status for each object type
 */
export const hubspotObjectSyncState = pgTable(
    "hubspot_object_sync_state",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        objectType: hubspotObjectTypeEnum("object_type").notNull(),

        // Sync state tracking
        lastSyncToken: text("last_sync_token"),
        lastFullSyncAt: timestamp("last_full_sync_at", { mode: "date" }),
        lastIncrementalSyncAt: timestamp("last_incremental_sync_at", { mode: "date" }),

        // Pagination state
        currentPageToken: text("current_page_token"),
        hasMorePages: boolean("has_more_pages").default(false),

        // Statistics
        totalSynced: integer("total_synced").default(0),
        lastSyncCount: integer("last_sync_count").default(0),

        // Error state
        syncStatus: hubspotSyncStatusEnum("sync_status").notNull().default("pending"),
        lastSyncError: text("last_sync_error"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqConnectionObject: uniqueIndex("hubspot_sync_state_connection_object_uq").on(t.connectionId, t.objectType),
        idxOrganization: index("hubspot_sync_state_organization_idx").on(t.organizationId),
        idxSyncStatus: index("hubspot_sync_state_status_idx").on(t.syncStatus),
    })
);

/* ============================
   HubSpot Object Mapping Tables
   ============================ */

/**
 * Maps SchedForm contacts to HubSpot contacts
 */
export const hubspotContactMappings = pgTable(
    "hubspot_contact_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // SchedForm reference (from form responses or bookings)
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),

        // HubSpot contact reference
        hubspotContactId: text("hubspot_contact_id").notNull(),
        hubspotProperties: jsonb("hubspot_properties"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncDirection: hubspotSyncDirectionEnum("sync_direction").notNull().default("bidirectional"),
        syncVersion: integer("sync_version").default(1),

        // Conflict resolution
        hasConflicts: boolean("has_conflicts").default(false),
        conflictDetails: jsonb("conflict_details"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqHubspotContact: uniqueIndex("hubspot_contact_mappings_contact_uq").on(t.connectionId, t.hubspotContactId),
        uqFormResponse: uniqueIndex("hubspot_contact_mappings_form_response_uq").on(t.connectionId, t.formResponseId).where(sql`${t.formResponseId} IS NOT NULL`),
        uqBooking: uniqueIndex("hubspot_contact_mappings_booking_uq").on(t.connectionId, t.bookingId).where(sql`${t.bookingId} IS NOT NULL`),
        idxOrganization: index("hubspot_contact_mappings_organization_idx").on(t.organizationId),
    })
);

/**
 * Maps SchedForm companies/organizations to HubSpot companies
 */
export const hubspotCompanyMappings = pgTable(
    "hubspot_company_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // SchedForm organization reference
        schedformOrganizationId: text("schedform_organization_id").notNull(),

        // HubSpot company reference
        hubspotCompanyId: text("hubspot_company_id").notNull(),
        hubspotProperties: jsonb("hubspot_properties"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncDirection: hubspotSyncDirectionEnum("sync_direction").notNull().default("bidirectional"),
        syncVersion: integer("sync_version").default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqHubspotCompany: uniqueIndex("hubspot_company_mappings_company_uq").on(t.connectionId, t.hubspotCompanyId),
        uqSchedformOrg: uniqueIndex("hubspot_company_mappings_schedform_org_uq").on(t.connectionId, t.schedformOrganizationId),
        idxOrganization: index("hubspot_company_mappings_organization_idx").on(t.organizationId),
    })
);

/**
 * Maps SchedForm bookings to HubSpot deals
 */
export const hubspotDealMappings = pgTable(
    "hubspot_deal_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // SchedForm booking reference
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),

        // HubSpot deal reference
        hubspotDealId: text("hubspot_deal_id").notNull(),
        hubspotProperties: jsonb("hubspot_properties"),
        dealStage: text("deal_stage"),
        dealAmount: integer("deal_amount"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncDirection: hubspotSyncDirectionEnum("sync_direction").notNull().default("bidirectional"),
        syncVersion: integer("sync_version").default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqHubspotDeal: uniqueIndex("hubspot_deal_mappings_deal_uq").on(t.connectionId, t.hubspotDealId),
        uqBooking: uniqueIndex("hubspot_deal_mappings_booking_uq").on(t.connectionId, t.bookingId),
        idxOrganization: index("hubspot_deal_mappings_organization_idx").on(t.organizationId),
    })
);

/**
 * Maps SchedForm bookings to HubSpot meetings
 */
export const hubspotMeetingMappings = pgTable(
    "hubspot_meeting_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // SchedForm booking reference
        bookingId: text("booking_id")
            .notNull()
            .references(() => bookings.id, { onDelete: "cascade" }),

        // HubSpot meeting reference
        hubspotMeetingId: text("hubspot_meeting_id").notNull(),
        hubspotProperties: jsonb("hubspot_properties"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        syncDirection: hubspotSyncDirectionEnum("sync_direction").notNull().default("bidirectional"),
        syncVersion: integer("sync_version").default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqHubspotMeeting: uniqueIndex("hubspot_meeting_mappings_meeting_uq").on(t.connectionId, t.hubspotMeetingId),
        uqBooking: uniqueIndex("hubspot_meeting_mappings_booking_uq").on(t.connectionId, t.bookingId),
        idxOrganization: index("hubspot_meeting_mappings_organization_idx").on(t.organizationId),
    })
);

/* ============================
   HubSpot Association Tables
   ============================ */

/**
 * Tracks associations between HubSpot objects
 */
export const hubspotAssociations = pgTable(
    "hubspot_associations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Association definition
        associationType: hubspotAssociationTypeEnum("association_type").notNull(),
        fromObjectType: hubspotObjectTypeEnum("from_object_type").notNull(),
        fromObjectId: text("from_object_id").notNull(),
        toObjectType: hubspotObjectTypeEnum("to_object_type").notNull(),
        toObjectId: text("to_object_id").notNull(),

        // HubSpot association metadata
        hubspotAssociationId: integer("hubspot_association_id"),
        associationCategory: text("association_category").notNull().default("HUBSPOT_DEFINED"),
        associationTypeId: integer("association_type_id"),

        // Sync metadata
        lastSyncedAt: timestamp("last_synced_at", { mode: "date" }).notNull().defaultNow(),
        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqAssociation: uniqueIndex("hubspot_associations_uq").on(
            t.connectionId,
            t.fromObjectType,
            t.fromObjectId,
            t.toObjectType,
            t.toObjectId
        ),
        idxOrganization: index("hubspot_associations_organization_idx").on(t.organizationId),
        idxFromObject: index("hubspot_associations_from_idx").on(t.fromObjectType, t.fromObjectId),
        idxToObject: index("hubspot_associations_to_idx").on(t.toObjectType, t.toObjectId),
    })
);

/* ============================
   Sync Logging Tables
   ============================ */

/**
 * Detailed sync operation logs
 */
export const hubspotSyncLogs = pgTable(
    "hubspot_sync_logs",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Sync operation details
        syncType: text("sync_type").notNull(), // 'full', 'incremental', 'webhook', 'manual'
        objectType: hubspotObjectTypeEnum("object_type"),
        direction: hubspotSyncDirectionEnum("direction").notNull(),

        // Time range synced
        timeRangeStart: timestamp("time_range_start", { mode: "date" }),
        timeRangeEnd: timestamp("time_range_end", { mode: "date" }),

        // Results
        objectsProcessed: integer("objects_processed").default(0),
        objectsCreated: integer("objects_created").default(0),
        objectsUpdated: integer("objects_updated").default(0),
        objectsDeleted: integer("objects_deleted").default(0),
        associationsProcessed: integer("associations_processed").default(0),

        // Execution tracking
        startedAt: timestamp("started_at", { mode: "date" }).notNull(),
        completedAt: timestamp("completed_at", { mode: "date" }),
        status: hubspotSyncStatusEnum("status").notNull().default("pending"),
        durationMs: integer("duration_ms"),

        // Error handling
        errorCode: text("error_code"),
        errorMessage: text("error_message"),
        errorDetails: jsonb("error_details"),
        retryCount: integer("retry_count").default(0),

        // Additional context
        triggerSource: text("trigger_source"), // 'scheduled', 'webhook', 'manual', 'api'
        syncTokenBefore: text("sync_token_before"),
        syncTokenAfter: text("sync_token_after"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxConnection: index("hubspot_sync_logs_connection_idx").on(t.connectionId),
        idxStatus: index("hubspot_sync_logs_status_idx").on(t.status, t.startedAt),
        idxTimeRange: index("hubspot_sync_logs_time_range_idx").on(t.timeRangeStart, t.timeRangeEnd),
    })
);

/**
 * Webhook events from HubSpot for real-time sync
 */
export const hubspotWebhookEvents = pgTable(
    "hubspot_webhook_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // Webhook payload
        hubspotEventId: text("hubspot_event_id").notNull(),
        eventType: text("event_type").notNull(), // e.g., 'contact.creation', 'contact.propertyChange'
        objectType: hubspotObjectTypeEnum("object_type").notNull(),
        objectId: text("object_id").notNull(),
        subscriptionId: integer("subscription_id").notNull(),
        occurrenceDate: timestamp("occurrence_date", { mode: "date" }).notNull(),

        // Raw webhook data
        rawPayload: jsonb("raw_payload").notNull(),
        propertyName: text("property_name"),
        propertyValue: text("property_value"),

        // Processing status
        processed: boolean("processed").notNull().default(false),
        processedAt: timestamp("processed_at", { mode: "date" }),
        processingError: text("processing_error"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEventId: uniqueIndex("hubspot_webhook_events_event_uq").on(t.hubspotEventId),
        idxConnection: index("hubspot_webhook_events_connection_idx").on(t.connectionId),
        idxProcessed: index("hubspot_webhook_events_processed_idx").on(t.processed, t.occurrenceDate),
        idxObject: index("hubspot_webhook_events_object_idx").on(t.objectType, t.objectId),
    })
);

/* ============================
   Configuration Tables
   ============================ */

/**
 * HubSpot pipeline and stage mappings
 */
export const hubspotPipelineMappings = pgTable(
    "hubspot_pipeline_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // HubSpot pipeline info
        hubspotPipelineId: text("hubspot_pipeline_id").notNull(),
        pipelineType: text("pipeline_type").notNull(), // 'deal', 'ticket'
        pipelineLabel: text("pipeline_label").notNull(),
        pipelineStages: jsonb("pipeline_stages").notNull(), // Array of stage objects

        // SchedForm mapping
        schedformEventTypeId: text("schedform_event_type_id").references(() => forms.id, { onDelete: "set null" }),
        defaultStageId: text("default_stage_id"),

        // Sync settings
        isActive: boolean("is_active").notNull().default(true),
        autoCreateDeals: boolean("auto_create_deals").notNull().default(false),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqPipeline: uniqueIndex("hubspot_pipeline_mappings_pipeline_uq").on(t.connectionId, t.hubspotPipelineId),
        idxOrganization: index("hubspot_pipeline_mappings_organization_idx").on(t.organizationId),
    })
);

/**
 * HubSpot property definitions and mappings
 */
export const hubspotPropertyMappings = pgTable(
    "hubspot_property_mappings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        connectionId: text("connection_id")
            .notNull()
            .references(() => hubspotCrmConnections.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .notNull()
            .references(() => organizations.id, { onDelete: "cascade" }),

        // HubSpot property info
        objectType: hubspotObjectTypeEnum("object_type").notNull(),
        hubspotPropertyName: text("hubspot_property_name").notNull(),
        hubspotPropertyLabel: text("hubspot_property_label").notNull(),
        hubspotPropertyType: text("hubspot_property_type").notNull(), // 'string', 'number', 'date', etc.
        hubspotPropertyDefinition: jsonb("hubspot_property_definition"),

        // SchedForm mapping
        schedformFieldPath: text("schedform_field_path").notNull(), // e.g., 'formResponse.data.email'
        transformationRule: text("transformation_rule"), // JS function string or template

        // Sync settings
        syncEnabled: boolean("sync_enabled").notNull().default(true),
        syncDirection: hubspotSyncDirectionEnum("sync_direction").notNull().default("bidirectional"),
        isRequired: boolean("is_required").default(false),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqProperty: uniqueIndex("hubspot_property_mappings_property_uq").on(
            t.connectionId,
            t.objectType,
            t.hubspotPropertyName
        ),
        idxOrganization: index("hubspot_property_mappings_organization_idx").on(t.organizationId),
    })
);

/* ============================
   Relations
   ============================ */

export const hubspotCrmConnectionsRelations = relations(hubspotCrmConnections, ({ one, many }) => ({
    user: one(users, {
        fields: [hubspotCrmConnections.userId],
        references: [users.id]
    }),
    organization: one(organizations, {
        fields: [hubspotCrmConnections.organizationId],
        references: [organizations.id]
    }),
    team: one(teams, {
        fields: [hubspotCrmConnections.teamId],
        references: [teams.id]
    }),
    syncStates: many(hubspotObjectSyncState),
    contactMappings: many(hubspotContactMappings),
    companyMappings: many(hubspotCompanyMappings),
    dealMappings: many(hubspotDealMappings),
    meetingMappings: many(hubspotMeetingMappings),
    associations: many(hubspotAssociations),
    syncLogs: many(hubspotSyncLogs),
    webhookEvents: many(hubspotWebhookEvents),
    pipelineMappings: many(hubspotPipelineMappings),
    propertyMappings: many(hubspotPropertyMappings),
}));

export const hubspotObjectSyncStateRelations = relations(hubspotObjectSyncState, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotObjectSyncState.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotObjectSyncState.organizationId],
        references: [organizations.id],
    }),
}));

export const hubspotContactMappingsRelations = relations(hubspotContactMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotContactMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotContactMappings.organizationId],
        references: [organizations.id],
    }),
    formResponse: one(formResponses, {
        fields: [hubspotContactMappings.formResponseId],
        references: [formResponses.id],
    }),
    booking: one(bookings, {
        fields: [hubspotContactMappings.bookingId],
        references: [bookings.id],
    }),
}));

export const hubspotCompanyMappingsRelations = relations(hubspotCompanyMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotCompanyMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotCompanyMappings.organizationId],
        references: [organizations.id],
    }),
}));

export const hubspotDealMappingsRelations = relations(hubspotDealMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotDealMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotDealMappings.organizationId],
        references: [organizations.id],
    }),
    booking: one(bookings, {
        fields: [hubspotDealMappings.bookingId],
        references: [bookings.id],
    }),
}));

export const hubspotMeetingMappingsRelations = relations(hubspotMeetingMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotMeetingMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotMeetingMappings.organizationId],
        references: [organizations.id],
    }),
    booking: one(bookings, {
        fields: [hubspotMeetingMappings.bookingId],
        references: [bookings.id],
    }),
}));

export const hubspotAssociationsRelations = relations(hubspotAssociations, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotAssociations.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotAssociations.organizationId],
        references: [organizations.id],
    }),
}));

export const hubspotSyncLogsRelations = relations(hubspotSyncLogs, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotSyncLogs.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotSyncLogs.organizationId],
        references: [organizations.id],
    }),
}));

export const hubspotWebhookEventsRelations = relations(hubspotWebhookEvents, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotWebhookEvents.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotWebhookEvents.organizationId],
        references: [organizations.id],
    }),
}));

export const hubspotPipelineMappingsRelations = relations(hubspotPipelineMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotPipelineMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotPipelineMappings.organizationId],
        references: [organizations.id],
    }),
    eventType: one(forms, {
        fields: [hubspotPipelineMappings.schedformEventTypeId],
        references: [forms.id],
    }),
}));

export const hubspotPropertyMappingsRelations = relations(hubspotPropertyMappings, ({ one }) => ({
    connection: one(hubspotCrmConnections, {
        fields: [hubspotPropertyMappings.connectionId],
        references: [hubspotCrmConnections.id],
    }),
    organization: one(organizations, {
        fields: [hubspotPropertyMappings.organizationId],
        references: [organizations.id],
    }),
}));
