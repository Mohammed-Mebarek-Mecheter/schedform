// billing.ts
import {
    pgTable, varchar, timestamp, boolean, integer, decimal, pgEnum, index, uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {user} from "@/db/schema";

/* ----------- Enums ----------- */
export const planTypeEnum = pgEnum("plan_type", ["free", "starter", "professional", "business", "enterprise"]);
export const billingPeriodEnum = pgEnum("billing_period", ["monthly", "yearly"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["active", "past_due", "cancelled", "expired", "trialing", "paused"]);

/* ----------- Subscriptions ----------- */
export const subscriptions = pgTable("subscriptions", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
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
    storageLimit: integer("storage_limit"),
    teamSeats: integer("team_seats").default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
    userIdx: index("subscriptions_user_idx").on(t.userId),
    planIdx: index("subscriptions_plan_idx").on(t.planType),
}));

/* ----------- Usage Tracking ----------- */
export const usageTracking = pgTable("usage_tracking", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
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
}, t => ({
    uniquePeriod: uniqueIndex("usage_tracking_user_period_idx").on(t.userId, t.month, t.year),
}));

/* ----------- Relations ----------- */
export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
    owner: one(user, { fields: [subscriptions.userId], references: [user.id] }),
}));

export const usageTrackingRelations = relations(usageTracking, ({ one }) => ({
    owner: one(user, { fields: [usageTracking.userId], references: [user.id] }),
}));
