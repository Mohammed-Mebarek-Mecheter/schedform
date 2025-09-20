// src/db/schema/business/analytics.ts
import {
    pgTable,
    varchar,
    text,
    timestamp,
    integer,
    real,
    jsonb,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { forms } from "@/db/schema/forms";
import { user } from "@/db/schema/auth";

/**
 * Analytics - Simplified for performance
 */
export const analytics = pgTable(
    "analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, {
            onDelete: "cascade",
        }),

        date: timestamp("date", { mode: "date" }).notNull(),
        period: text("period").notNull(), // hourly, daily, weekly, monthly

        // Core metrics
        formViews: integer("form_views").default(0),
        formStarts: integer("form_starts").default(0),
        formCompletions: integer("form_completions").default(0),
        conversionRate: real("conversion_rate").default(0),

        // Booking metrics
        bookingRequests: integer("booking_requests").default(0),
        bookingsConfirmed: integer("bookings_confirmed").default(0),
        bookingsCancelled: integer("bookings_cancelled").default(0),
        noShows: integer("no_shows").default(0),

        // Quality metrics
        avgQualityScore: real("avg_quality_score").default(0),
        avgTimeToComplete: integer("avg_time_to_complete").default(0),
        spamDetected: integer("spam_detected").default(0),

        // Aggregated insights
        trafficSources: jsonb("traffic_sources"),
        deviceTypes: jsonb("device_types"),
        geoData: jsonb("geo_data"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes
        uqUserFormDatePeriod: uniqueIndex("analytics_user_form_date_period_idx")
            .on(t.userId, t.formId, t.date, t.period)
            .where(sql`${t.formId} IS NOT NULL`),
        uqUserDatePeriod: uniqueIndex("analytics_user_date_period_idx")
            .on(t.userId, t.date, t.period)
            .where(sql`${t.formId} IS NULL`), // For user-level analytics
        idxDatePeriod: index("analytics_date_period_idx").on(t.date, t.period),

        // ✅ Checks (all constraints via t)
        chkFormViews: sql`CHECK (${t.formViews} >= 0)`,
        chkFormStarts: sql`CHECK (${t.formStarts} >= 0)`,
        chkFormCompletions: sql`CHECK (${t.formCompletions} >= 0)`,
        chkConversionRate: sql`CHECK (${t.conversionRate} >= 0 AND ${t.conversionRate} <= 100)`,
        chkBookingRequests: sql`CHECK (${t.bookingRequests} >= 0)`,
        chkBookingsConfirmed: sql`CHECK (${t.bookingsConfirmed} >= 0)`,
        chkBookingsCancelled: sql`CHECK (${t.bookingsCancelled} >= 0)`,
        chkNoShows: sql`CHECK (${t.noShows} >= 0)`,
        chkAvgQualityScore: sql`CHECK (${t.avgQualityScore} >= 0 AND ${t.avgQualityScore} <= 100)`,
        chkAvgTimeToComplete: sql`CHECK (${t.avgTimeToComplete} >= 0)`,
        chkSpamDetected: sql`CHECK (${t.spamDetected} >= 0)`,
    }),
);

/**
 * Activity Logs - Simplified tracking
 */
export const activityLogs = pgTable(
    "activity_logs",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        action: text("action").notNull(),
        resourceType: text("resource_type"),
        resourceId: text("resource_id"),

        description: text("description"),
        metadata: jsonb("metadata"),

        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxUserAction: index("activity_logs_user_action_idx").on(
            t.userId,
            t.action,
            t.createdAt,
        ),
        idxResource: index("activity_logs_resource_idx")
            .on(t.resourceType, t.resourceId, t.createdAt)
            .where(
                sql`${t.resourceType} IS NOT NULL AND ${t.resourceId} IS NOT NULL`,
            ),
        idxCreated: index("activity_logs_created_idx").on(t.createdAt), // For cleanup jobs
    }),
);

/* ---------------- Relations ---------------- */
export const analyticsRelations = relations(analytics, ({ one }) => ({
    owner: one(user, { fields: [analytics.userId], references: [user.id] }),
    form: one(forms, { fields: [analytics.formId], references: [forms.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
    owner: one(user, { fields: [activityLogs.userId], references: [user.id] }),
}));
