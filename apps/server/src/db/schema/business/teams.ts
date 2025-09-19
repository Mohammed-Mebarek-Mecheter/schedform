// teams.ts
import {
    pgTable, varchar, text, timestamp, boolean, integer, jsonb, pgEnum, index, uniqueIndex
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {user} from "@/db/schema";

export const teamRoleEnum = pgEnum("team_role", ["owner", "admin", "member", "viewer"]);

/* ----------- Teams ----------- */
export const teams = pgTable("teams", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerId: varchar("owner_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
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
}, t => ({
    ownerIdx: index("teams_owner_idx").on(t.ownerId),
}));

/* ----------- Team Members ----------- */
export const teamMembers = pgTable("team_members", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: varchar("team_id", { length: 36 }).notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
    role: teamRoleEnum("role").notNull().default("member"),
    permissions: jsonb("permissions"),
    isActive: boolean("is_active").default(true),
    invitedAt: timestamp("invited_at"),
    joinedAt: timestamp("joined_at"),
    lastActiveAt: timestamp("last_active_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, t => ({
    uniqueMember: uniqueIndex("team_members_unique_idx").on(t.teamId, t.userId),
}));

/* ----------- Team Invitations ----------- */
export const teamInvitations = pgTable("team_invitations", {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    teamId: varchar("team_id", { length: 36 }).notNull().references(() => teams.id, { onDelete: "cascade" }),
    invitedBy: varchar("invited_by", { length: 36 }).notNull().references(() => user.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: teamRoleEnum("role").notNull().default("member"),
    token: varchar("token", { length: 255 }).notNull().unique(),
    isAccepted: boolean("is_accepted").default(false),
    acceptedAt: timestamp("accepted_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => ({
    teamIdx: index("team_invitations_team_idx").on(t.teamId),
}));

/* ----------- Relations ----------- */
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
    inviter: one(user, { fields: [teamInvitations.invitedBy], references: [user.id] }),
}));
