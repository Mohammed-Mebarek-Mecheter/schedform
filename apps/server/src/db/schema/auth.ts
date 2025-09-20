// src/db/schema/auth.ts
import {
    pgTable,
    text,
    timestamp,
    boolean,
    index,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ---------------- Users ---------------- */
export const user = pgTable(
    "user",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        name: varchar("name", { length: 255 }).notNull(),

        email: varchar("email", { length: 255 }).notNull(),

        emailVerified: boolean("email_verified").notNull().default(false),

        image: text("image"),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        emailIdx: uniqueIndex("users_email_idx").on(t.email),
        emailFormatCheck: sql`CHECK (${t.email} ~ '^[^@]+@[^@]+\\.[^@]+$')`,
        imageUrlCheck: sql`CHECK (${t.image} IS NULL OR ${t.image} ~ '^https?://')`,
    }),
);

/* ---------------- Sessions ---------------- */
export const sessions = pgTable(
    "sessions",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

        token: varchar("token", { length: 255 }).notNull(),

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),

        ipAddress: varchar("ip_address", { length: 45 }), // IPv4/IPv6
        userAgent: text("user_agent"),

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),
    },
    (t) => ({
        tokenIdx: uniqueIndex("sessions_token_idx").on(t.token),
        userIdx: index("sessions_user_idx").on(t.userId),
    }),
);

/* ---------------- Accounts ---------------- */
export const accounts = pgTable(
    "accounts",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        accountId: varchar("account_id", { length: 255 }).notNull(),
        providerId: varchar("provider_id", { length: 100 }).notNull(),

        userId: varchar("user_id", { length: 36 })
            .notNull()
            .references(() => user.id, { onDelete: "cascade" }),

        accessToken: text("access_token"),
        refreshToken: text("refresh_token"),
        idToken: text("id_token"),

        accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date" }),
        refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date" }),

        scope: text("scope"),
        password: text("password"), // hashed password

        createdAt: timestamp("created_at", { mode: "date" })
            .notNull()
            .defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" })
            .notNull()
            .defaultNow(),
    },
    (t) => ({
        providerIdx: index("accounts_provider_idx").on(t.providerId, t.accountId),
        userIdx: index("accounts_user_idx").on(t.userId),
    }),
);

/* ---------------- Verifications ---------------- */
export const verifications = pgTable(
    "verifications",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),

        identifier: varchar("identifier", { length: 255 }).notNull(),
        value: varchar("value", { length: 255 }).notNull(),

        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

        createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
    },
    (t) => ({
        identifierIdx: index("verifications_identifier_idx").on(t.identifier),
    }),
);
