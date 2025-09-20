// src/db/schema/business/billing.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    pgEnum,
    index,
    uniqueIndex,
    real,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { user } from "@/db/schema/auth";

/* ---------------- Enums ---------------- */
export const planTypeEnum = pgEnum("plan_type", [
    "free",
    "starter",
    "professional",
    "business"
]);

export const billingPeriodEnum = pgEnum("billing_period", ["monthly", "yearly"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
    "active",
    "past_due",
    "cancelled",
    "expired",
    "paused",
]);

/**
 * Subscriptions - Simplified for Polar integration without trials
 */
export const subscriptions = pgTable(
    "subscriptions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "restrict" }),

        planType: planTypeEnum("plan_type").notNull().default("free"),
        billingPeriod: billingPeriodEnum("billing_period"),
        status: subscriptionStatusEnum("status").notNull().default("active"),

        // Polar-specific fields
        polarCustomerId: text("polar_customer_id"),
        polarSubscriptionId: text("polar_subscription_id"),
        polarProductId: text("polar_product_id"),

        currentPeriodStart: timestamp("current_period_start", { mode: "date" }),
        currentPeriodEnd: timestamp("current_period_end", { mode: "date" }),
        cancelledAt: timestamp("cancelled_at", { mode: "date" }),
        cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false),

        pricePerMonth: real("price_per_month"),
        currency: text("currency").default("USD"),

        // Plan limits
        monthlyResponseLimit: integer("monthly_response_limit"),
        storageLimit: integer("storage_limit"),
        teamSeats: integer("team_seats").default(1),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        // Indexes
        idxUserPlan: index("subscriptions_user_plan_idx").on(
            t.userId,
            t.planType,
            t.status,
        ),
        idxStatus: index("subscriptions_status_idx").on(
            t.status,
            t.currentPeriodEnd,
        ),
        idxPolarIds: index("subscriptions_polar_ids_idx").on(
            t.polarCustomerId,
            t.polarSubscriptionId,
        ),

        // ✅ Checks
        chkPricePerMonth: sql`CHECK (${t.pricePerMonth} IS NULL OR ${t.pricePerMonth} >= 0)`,
        chkMonthlyResponseLimit: sql`CHECK (${t.monthlyResponseLimit} IS NULL OR ${t.monthlyResponseLimit} >= 0)`,
        chkStorageLimit: sql`CHECK (${t.storageLimit} IS NULL OR ${t.storageLimit} >= 0)`,
        chkTeamSeats: sql`CHECK (${t.teamSeats} >= 1)`,
    }),
);

/**
 * Usage Tracking - Enhanced with validation
 */
export const usageTracking = pgTable(
    "usage_tracking",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        month: integer("month").notNull(),
        year: integer("year").notNull(),

        // Usage metrics
        formResponses: integer("form_responses").default(0),
        fileStorageUsed: integer("file_storage_used").default(0),
        webhookCalls: integer("webhook_calls").default(0),
        aiInsightCalls: integer("ai_insight_calls").default(0),
        emailsSent: integer("emails_sent").default(0),
        smsSent: integer("sms_sent").default(0),

        // Limits
        formResponsesLimit: integer("form_responses_limit"),
        fileStorageLimit: integer("file_storage_limit"),

        // Overage
        overageCharges: real("overage_charges").default(0),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        // Indexes
        uqUserPeriod: uniqueIndex("usage_tracking_user_period_idx").on(
            t.userId,
            t.month,
            t.year,
        ),
        idxYearMonth: index("usage_tracking_year_month_idx").on(t.year, t.month),

        // ✅ Checks
        chkMonth: sql`CHECK (${t.month} >= 1 AND ${t.month} <= 12)`,
        chkYear: sql`CHECK (${t.year} >= 2024 AND ${t.year} <= 2100)`,
        chkFormResponses: sql`CHECK (${t.formResponses} >= 0)`,
        chkFileStorageUsed: sql`CHECK (${t.fileStorageUsed} >= 0)`,
        chkWebhookCalls: sql`CHECK (${t.webhookCalls} >= 0)`,
        chkAiInsightCalls: sql`CHECK (${t.aiInsightCalls} >= 0)`,
        chkEmailsSent: sql`CHECK (${t.emailsSent} >= 0)`,
        chkSmsSent: sql`CHECK (${t.smsSent} >= 0)`,
        chkFormResponsesLimit: sql`CHECK (${t.formResponsesLimit} IS NULL OR ${t.formResponsesLimit} >= 0)`,
        chkFileStorageLimit: sql`CHECK (${t.fileStorageLimit} IS NULL OR ${t.fileStorageLimit} >= 0)`,
        chkOverageCharges: sql`CHECK (${t.overageCharges} >= 0)`,
    }),
);

/* ---------------- Relations ---------------- */
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
    owner: one(user, { fields: [subscriptions.userId], references: [user.id] }),
}));

export const usageTrackingRelations = relations(usageTracking, ({ one }) => ({
    owner: one(user, { fields: [usageTracking.userId], references: [user.id] }),
}));
