// business.ts
import {
    pgTable,
    varchar,
    text,
    timestamp,
    boolean,
    integer,
    jsonb,
    pgEnum,
    decimal,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

import { user } from "./auth";
import { forms } from "./forms";

/* ---------------- Enums ---------------- */
export const planTypeEnum = pgEnum("plan_type", [
    "free",
    "starter",
    "professional",
    "business",
    "enterprise",
]);

export const billingPeriodEnum = pgEnum("billing_period", ["monthly", "yearly"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
    "active",
    "past_due",
    "cancelled",
    "expired",
    "trialing",
    "paused",
]);

export const usageTypeEnum = pgEnum("usage_type", [
    "form_responses",
    "file_storage",
    "webhook_calls",
    "ai_insights",
    "team_seats",
]);

export const teamRoleEnum = pgEnum("team_role", [
    "owner",
    "admin",
    "member",
    "viewer",
]);

/* ---------------- Subscriptions ---------------- */
export const subscriptions = pgTable(
    "subscriptions",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        planType: planTypeEnum("plan_type").notNull().default("free"),
        billingPeriod: billingPeriodEnum("billing_period"),

        status: subscriptionStatusEnum("status").notNull().default("active"),
        currentPeriodStart: timestamp("current_period_start"),
        currentPeriodEnd: timestamp("current_period_end"),
        trialEndsAt: timestamp("trial_ends_at"),
        cancelledAt: timestamp("cancelled_at"),
        cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),

        pricePerMonth: decimal("price_per_month", { precision: 10, scale: 2 }),
        currency: varchar("currency", { length: 10 }).default("USD"),

        stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
        polarSubscriptionId: varchar("polar_subscription_id", { length: 255 }),

        monthlyResponseLimit: integer("monthly_response_limit"),
        storageLimit: integer("storage_limit"), // GB
        teamSeats: integer("team_seats").default(1),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("subscriptions_user_idx").on(t.userId),
        planIdx: index("subscriptions_plan_idx").on(t.planType),
    }),
);

/* ---------------- Usage Tracking ---------------- */
export const usageTracking = pgTable(
    "usage_tracking",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        month: integer("month").notNull(),
        year: integer("year").notNull(),

        formResponses: integer("form_responses").default(0),
        fileStorageUsed: integer("file_storage_used").default(0),
        webhookCalls: integer("webhook_calls").default(0),
        aiInsightCalls: integer("ai_insight_calls").default(0),
        emailsSent: integer("emails_sent").default(0),
        smsSent: integer("sms_sent").default(0),

        formResponsesLimit: integer("form_responses_limit"),
        fileStorageLimit: integer("file_storage_limit"),

        overageCharges: decimal("overage_charges", { precision: 10, scale: 2 }).default("0.00"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uniquePeriod: uniqueIndex("usage_tracking_user_period_idx").on(
            t.userId,
            t.month,
            t.year,
        ),
    }),
);

/* ---------------- Teams ---------------- */
export const teams = pgTable(
    "teams",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        ownerId: varchar("owner_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        name: varchar("name", { length: 255 }).notNull(),
        description: text("description"),
        slug: varchar("slug", { length: 100 }).notNull().unique(),

        logoUrl: varchar("logo_url", { length: 255 }),
        website: varchar("website", { length: 255 }),

        primaryColor: varchar("primary_color", { length: 20 }).default("#3b82f6"),
        logoDefault: varchar("logo_default", { length: 255 }),

        maxMembers: integer("max_members").default(5),
        currentMembers: integer("current_members").default(1),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        ownerIdx: index("teams_owner_idx").on(t.ownerId),
    }),
);

/* ---------------- Team Members ---------------- */
export const teamMembers = pgTable(
    "team_members",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        teamId: varchar("team_id", { length: 36 })
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        role: teamRoleEnum("role").notNull().default("member"),
        permissions: jsonb("permissions"),

        isActive: boolean("is_active").default(true),
        invitedAt: timestamp("invited_at"),
        joinedAt: timestamp("joined_at"),
        lastActiveAt: timestamp("last_active_at"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uniqueMember: uniqueIndex("team_members_unique_idx").on(t.teamId, t.userId),
    }),
);

/* ---------------- Team Invitations ---------------- */
export const teamInvitations = pgTable(
    "team_invitations",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        teamId: varchar("team_id", { length: 36 })
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        invitedBy: varchar("invited_by", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        email: varchar("email", { length: 255 }).notNull(),
        role: teamRoleEnum("role").notNull().default("member"),
        token: varchar("token", { length: 255 }).notNull().unique(),

        isAccepted: boolean("is_accepted").default(false),
        acceptedAt: timestamp("accepted_at"),
        expiresAt: timestamp("expires_at").notNull(),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        teamIdx: index("team_invitations_team_idx").on(t.teamId),
    }),
);

/* ---------------- Analytics ---------------- */
export const analytics = pgTable("analytics", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 36 })
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    formId: varchar("form_id", { length: 36 }).references(() => forms.id, {
        onDelete: "cascade",
    }),

    date: timestamp("date").notNull(),
    period: varchar("period", { length: 20 }).notNull(),

    formViews: integer("form_views").default(0),
    formStarts: integer("form_starts").default(0),
    formCompletions: integer("form_completions").default(0),
    conversionRate: decimal("conversion_rate", { precision: 5, scale: 2 }).default("0.00"),

    bookingRequests: integer("booking_requests").default(0),
    bookingsConfirmed: integer("bookings_confirmed").default(0),
    bookingsCancelled: integer("bookings_cancelled").default(0),
    noShows: integer("no_shows").default(0),

    avgQualityScore: decimal("avg_quality_score", { precision: 5, scale: 2 }).default("0.00"),
    avgTimeToComplete: integer("avg_time_to_complete").default(0),
    spamDetected: integer("spam_detected").default(0),

    trafficSources: jsonb("traffic_sources"),
    deviceTypes: jsonb("device_types"),
    geoData: jsonb("geo_data"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
});

/* ---------------- Activity Logs ---------------- */
export const activityLogs = pgTable(
    "activity_logs",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        action: varchar("action", { length: 100 }).notNull(),
        resourceType: varchar("resource_type", { length: 50 }),
        resourceId: varchar("resource_id", { length: 36 }),

        description: text("description"),
        metadata: jsonb("metadata"),

        ipAddress: varchar("ip_address", { length: 50 }),
        userAgent: text("user_agent"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        userIdx: index("activity_logs_user_idx").on(t.userId),
    }),
);

/* ---------------- Feature Flags ---------------- */
export const featureFlags = pgTable(
    "feature_flags",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        name: varchar("name", { length: 100 }).notNull().unique(),
        description: text("description"),
        isActive: boolean("is_active").default(false),

        rolloutPercentage: integer("rollout_percentage").default(0),
        targetUsers: jsonb("target_users"),
        targetPlans: jsonb("target_plans"),
        conditions: jsonb("conditions"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        activeIdx: index("feature_flags_active_idx").on(t.isActive),
    }),
);

/* ---------------- User Feature Flags ---------------- */
export const userFeatureFlags = pgTable(
    "user_feature_flags",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        featureFlagId: varchar("feature_flag_id", { length: 36 })
            .notNull()
            .references(() => featureFlags.id, { onDelete: "cascade" }),

        isEnabled: boolean("is_enabled").notNull(),
        assignedAt: timestamp("assigned_at").notNull().defaultNow(),

        firstUsed: timestamp("first_used"),
        lastUsed: timestamp("last_used"),
        usageCount: integer("usage_count").default(0),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uniqueAssignment: uniqueIndex("user_feature_flags_unique_idx").on(
            t.userId,
            t.featureFlagId,
        ),
    }),
);

/* ---------------- Feedback ---------------- */
export const feedback = pgTable("feedback", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 36 }).references(() => user.id, {
        onDelete: "set null",
    }),

    type: varchar("type", { length: 50 }).notNull(),
    category: varchar("category", { length: 50 }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),

    priority: varchar("priority", { length: 20 }).default("medium"),
    status: varchar("status", { length: 20 }).default("open"),

    page: varchar("page", { length: 255 }),
    userAgent: text("user_agent"),
    screenshotUrl: varchar("screenshot_url", { length: 255 }),

    assignedTo: varchar("assigned_to", { length: 36 }).references(() => user.id, {
        onDelete: "set null",
    }),
    internalNotes: text("internal_notes"),
    resolution: text("resolution"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
});

/* ---------------- Experiments ---------------- */
export const experiments = pgTable("experiments", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),

    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    hypothesis: text("hypothesis"),

    isActive: boolean("is_active").default(false),
    trafficPercentage: integer("traffic_percentage").default(10),

    variants: jsonb("variants").notNull(),

    primaryMetric: varchar("primary_metric", { length: 100 }).notNull(),
    secondaryMetrics: jsonb("secondary_metrics"),

    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),

    results: jsonb("results"),
    winner: varchar("winner", { length: 100 }),
    confidence: decimal("confidence", { precision: 5, scale: 2 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ---------------- Experiment Assignments ---------------- */
export const experimentAssignments = pgTable(
    "experiment_assignments",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        experimentId: varchar("experiment_id", { length: 36 })
            .notNull()
            .references(() => experiments.id, { onDelete: "cascade" }),
        userId: varchar("user_id", { length: 36 }).references(() => user.id, {
            onDelete: "cascade",
        }),

        variant: varchar("variant", { length: 100 }).notNull(),
        sessionId: varchar("session_id", { length: 100 }),

        hasConverted: boolean("has_converted").default(false),
        convertedAt: timestamp("converted_at"),
        conversionValue: decimal("conversion_value", { precision: 10, scale: 2 }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        expIdx: index("experiment_assignments_exp_idx").on(t.experimentId),
    }),
);

/* ---------------- Relations (Grouped at Bottom) ---------------- */
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
    owner: one(user, { fields: [subscriptions.userId], references: [user.id] }),
}));

export const usageTrackingRelations = relations(usageTracking, ({ one }) => ({
    owner: one(user, { fields: [usageTracking.userId], references: [user.id] }),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
    owner: one(user, { fields: [teams.ownerId], references: [user.id] }),
    members: many(teamMembers),
    invitations: many(teamInvitations),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
    team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
    user: one(user, { fields: [teamMembers.userId], references: [user.id] }),
}));

export const teamInvitationsRelations = relations(teamInvitations, ({ one }) => ({
    team: one(teams, { fields: [teamInvitations.teamId], references: [teams.id] }),
    inviter: one(user, {
        fields: [teamInvitations.invitedBy],
        references: [user.id],
    }),
}));

export const analyticsRelations = relations(analytics, ({ one }) => ({
    owner: one(user, { fields: [analytics.userId], references: [user.id] }),
    form: one(forms, { fields: [analytics.formId], references: [forms.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
    owner: one(user, { fields: [activityLogs.userId], references: [user.id] }),
}));

export const userFeatureFlagsRelations = relations(userFeatureFlags, ({ one }) => ({
    owner: one(user, { fields: [userFeatureFlags.userId], references: [user.id] }),
    flag: one(featureFlags, {
        fields: [userFeatureFlags.featureFlagId],
        references: [featureFlags.id],
    }),
}));

export const feedbackRelations = relations(feedback, ({ one }) => ({
    reporter: one(user, { fields: [feedback.userId], references: [user.id] }),
    assignee: one(user, { fields: [feedback.assignedTo], references: [user.id] }),
}));

export const experimentsRelations = relations(experiments, ({ many }) => ({
    assignments: many(experimentAssignments),
}));

export const experimentAssignmentsRelations = relations(
    experimentAssignments,
    ({ one }) => ({
        experiment: one(experiments, {
            fields: [experimentAssignments.experimentId],
            references: [experiments.id],
        }),
        user: one(user, {
            fields: [experimentAssignments.userId],
            references: [user.id],
        }),
    }),
);
