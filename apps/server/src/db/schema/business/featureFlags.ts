// featureFlags.ts
import {
    pgTable, varchar, text, timestamp, boolean, integer, jsonb, uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {user} from "@/db/schema";

/* ----------- Feature Flags ----------- */
export const featureFlags = pgTable("feature_flags", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    name: varchar("name", { length: 100 }).notNull().unique(),
    description: text("description"),
    isActive: boolean("is_active").default(false),

    rolloutPercentage: integer("rollout_percentage").default(0),
    targetUsers: jsonb("target_users"),
    targetPlans: jsonb("target_plans"),
    conditions: jsonb("conditions"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/* ----------- User Feature Flags ----------- */
export const userFeatureFlags = pgTable("user_feature_flags", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
    featureFlagId: varchar("feature_flag_id", { length: 36 }).notNull().references(() => featureFlags.id, { onDelete: "cascade" }),

    isEnabled: boolean("is_enabled").notNull(),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
    firstUsed: timestamp("first_used"),
    lastUsed: timestamp("last_used"),
    usageCount: integer("usage_count").default(0),

    createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
    uniqueAssignment: uniqueIndex("user_feature_flags_unique_idx").on(t.userId, t.featureFlagId),
}));

/* ----------- Relations ----------- */
export const featureFlagsRelations = relations(featureFlags, ({ many }) => ({
    assignments: many(userFeatureFlags),
}));

export const userFeatureFlagsRelations = relations(userFeatureFlags, ({ one }) => ({
    user: one(user, { fields: [userFeatureFlags.userId], references: [user.id] }),
    flag: one(featureFlags, { fields: [userFeatureFlags.featureFlagId], references: [featureFlags.id] }),
}));
