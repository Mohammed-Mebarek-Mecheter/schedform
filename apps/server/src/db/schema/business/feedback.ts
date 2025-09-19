// feedback.ts
import {
    pgTable, varchar, text, timestamp
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {user} from "@/db/schema";

/* ----------- Feedback ----------- */
export const feedback = pgTable("feedback", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

    userId: varchar("user_id", { length: 36 }).references(() => user.id, { onDelete: "set null" }),

    type: varchar("type", { length: 50 }).notNull(),
    category: varchar("category", { length: 100 }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),

    priority: varchar("priority", { length: 50 }).default("medium"),
    status: varchar("status", { length: 50 }).default("open"),

    page: varchar("page", { length: 255 }),
    userAgent: text("user_agent"),
    screenshotUrl: varchar("screenshot_url", { length: 255 }),

    assignedTo: varchar("assigned_to", { length: 36 }).references(() => user.id, { onDelete: "set null" }),
    internalNotes: text("internal_notes"),
    resolution: text("resolution"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
});

/* ----------- Relations ----------- */
export const feedbackRelations = relations(feedback, ({ one }) => ({
    submitter: one(user, { fields: [feedback.userId], references: [user.id] }),
    assignee: one(user, { fields: [feedback.assignedTo], references: [user.id] }),
}));
