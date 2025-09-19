// analytics.ts
import {
    pgTable, varchar, text, timestamp, integer, decimal, jsonb, index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {forms, user} from "@/db/schema";


/* ----------- Analytics ----------- */
export const analytics = pgTable("analytics", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
    formId: varchar("form_id", { length: 36 }).references(() => forms.id, { onDelete: "cascade" }),

    date: timestamp("date").notNull(),
    period: varchar("period", { length: 50 }).notNull(), // hourly, daily, weekly, monthly

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
}, t => ({
    userIdx: index("analytics_user_idx").on(t.userId),
    formIdx: index("analytics_form_idx").on(t.formId),
    dateIdx: index("analytics_date_idx").on(t.date),
}));

/* ----------- Activity Logs ----------- */
export const activityLogs = pgTable("activity_logs", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),

    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }),
    resourceId: varchar("resource_id", { length: 36 }),

    description: text("description"),
    metadata: jsonb("metadata"),

    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: text("user_agent"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
    userIdx: index("activity_logs_user_idx").on(t.userId),
    resourceIdx: index("activity_logs_resource_idx").on(t.resourceType, t.resourceId),
}));

/* ----------- Relations ----------- */
export const analyticsRelations = relations(analytics, ({ one }) => ({
    owner: one(user, { fields: [analytics.userId], references: [user.id] }),
    form: one(forms, { fields: [analytics.formId], references: [forms.id] }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
    owner: one(user, { fields: [activityLogs.userId], references: [user.id] }),
}));
