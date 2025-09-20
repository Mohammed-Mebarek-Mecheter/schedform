// src/db/schema/business/teams.ts
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
} from "drizzle-orm/pg-core";
import {relations, sql} from "drizzle-orm";
import { user } from "@/db/schema";

/* ---------------- Enums ---------------- */
export const teamRoleEnum = pgEnum("team_role", [
    "owner",
    "admin",
    "member",
    "viewer",
]);

/* ---------------- Teams ---------------- */
export const teams = pgTable("teams", {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerId: text("owner_id")
        .notNull()
        .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug").notNull().unique(),
    logoUrl: text("logo_url"),
    website: text("website"),
    primaryColor: text("primary_color").default("#3b82f6"),
    logoDefault: text("logo_default"),
    maxMembers: integer("max_members").default(5),
    currentMembers: integer("current_members").default(1),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
}, (t) => ({
    idxOwner: index("teams_owner_idx").on(t.ownerId),
    idxSlug: index("teams_slug_idx").on(t.slug),
    chkSlug: sql`CHECK (${t.slug} ~ '^[a-z0-9-]+$')`,
    chkLogoUrl: sql`CHECK (${t.logoUrl} IS NULL OR ${t.logoUrl} ~ '^https?://')`,
    chkWebsite: sql`CHECK (${t.website} IS NULL OR ${t.website} ~ '^https?://')`,
    chkPrimaryColor: sql`CHECK (${t.primaryColor} ~ '^#[0-9A-Fa-f]{6}$')`,
    chkMaxMembers: sql`CHECK (${t.maxMembers} > 0 AND ${t.maxMembers} <= 100)`,
    chkCurrentMembers: sql`CHECK (${t.currentMembers} >= 0)`,
}));

/* ---------------- Team Members ---------------- */
export const teamMembers = pgTable(
    "team_members",
    {
        id: text("id")
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        teamId: text("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),

        userId: text("user_id")
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        role: teamRoleEnum("role").notNull().default("member"),
        permissions: jsonb("permissions"),
        isActive: boolean("is_active").default(true),

        invitedAt: timestamp("invited_at", { mode: "date" }),
        joinedAt: timestamp("joined_at", { mode: "date" }),
        lastActiveAt: timestamp("last_active_at", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        uqTeamUser: uniqueIndex("team_members_unique_idx").on(t.teamId, t.userId),
        idxTeamActive: index("team_members_team_active_idx").on(
            t.teamId,
            t.isActive,
        ),
        idxUserTeams: index("team_members_user_teams_idx").on(
            t.userId,
            t.isActive,
        ),
    }),
);

/* ---------------- Team Invitations ---------------- */
export const teamInvitations = pgTable(
    "team_invitations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        teamId: text("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        invitedBy: text("invited_by")
            .notNull()
            .references(() => user.id, { onDelete: "set null" }),
        email: text("email").notNull(),
        role: teamRoleEnum("role").notNull().default("member"),
        token: text("token").notNull().unique(),
        isAccepted: boolean("is_accepted").default(false),
        acceptedAt: timestamp("accepted_at", { mode: "date" }),
        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes
        idxTeamEmail: index("team_invitations_team_email_idx").on(t.teamId, t.email),
        idxToken: index("team_invitations_token_idx").on(t.token),
        idxExpiry: index("team_invitations_expiry_idx")
            .on(t.expiresAt, t.isAccepted)
            .where(sql`${t.isAccepted} = false`), // Only pending invitations

        // ✅ Proper CHECK constraint using t
        chkEmail: sql`CHECK (${t.email} ~ '^[^@]+@[^@]+\.[^@]+$')`,
    })
);

/* ---------------- Relations ---------------- */
export const teamsRelations = relations(teams, ({ one, many }) => ({
    owner: one(user, { fields: [teams.ownerId], references: [user.id] }),
    members: many(teamMembers),
    invitations: many(teamInvitations),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
    team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
    user: one(user, { fields: [teamMembers.userId], references: [user.id] }),
}));

export const teamInvitationsRelations = relations(
    teamInvitations,
    ({ one }) => ({
        team: one(teams, {
            fields: [teamInvitations.teamId],
            references: [teams.id],
        }),
        inviter: one(user, {
            fields: [teamInvitations.invitedBy],
            references: [user.id],
        }),
    }),
);
