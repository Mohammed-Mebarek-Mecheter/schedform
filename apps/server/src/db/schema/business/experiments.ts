// experiments.ts
import {
    pgTable, varchar, text, timestamp, boolean, integer, decimal, jsonb, index
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {user} from "@/db/schema";

/* ----------- Experiments ----------- */
export const experiments = pgTable("experiments", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

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

/* ----------- Experiment Assignments ----------- */
export const experimentAssignments = pgTable("experiment_assignments", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    experimentId: varchar("experiment_id", { length: 36 }).notNull().references(() => experiments.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 36 }).references(() => user.id, { onDelete: "cascade" }),

    variant: varchar("variant", { length: 100 }).notNull(),
    sessionId: varchar("session_id", { length: 255 }),

    hasConverted: boolean("has_converted").default(false),
    convertedAt: timestamp("converted_at"),
    conversionValue: decimal("conversion_value", { precision: 10, scale: 2 }),

    createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
    expIdx: index("experiment_assignments_exp_idx").on(t.experimentId),
    userIdx: index("experiment_assignments_user_idx").on(t.userId),
}));

/* ----------- Relations ----------- */
export const experimentsRelations = relations(experiments, ({ many }) => ({
    assignments: many(experimentAssignments),
}));

export const experimentAssignmentsRelations = relations(experimentAssignments, ({ one }) => ({
    experiment: one(experiments, { fields: [experimentAssignments.experimentId], references: [experiments.id] }),
    user: one(user, { fields: [experimentAssignments.userId], references: [user.id] }),
}));
