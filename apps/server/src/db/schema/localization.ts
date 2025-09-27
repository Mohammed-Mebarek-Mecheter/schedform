// src/db/schema/localization.ts - SIMPLIFIED VERSION
import {
    pgTable,
    text,
    timestamp,
    boolean,
    integer,
    index,
    uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { organizations, users } from "@/db/schema/auth";

/* ---------------- Core Language Support ---------------- */
export const supportedLanguages = pgTable(
    "supported_languages",
    {
        code: text("code").primaryKey(), // ISO 639-1: en, es, fr, de
        name: text("name").notNull(), // "English", "Español"  (always in English - for admin interfaces)
        nativeName: text("native_name").notNull(), // "English", "Español" (in the language itself - for user-facing dropdowns)
        isActive: boolean("is_active").notNull().default(true),

        // Regional formatting
        dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
        timeFormat: text("time_format").notNull().default("h:mm A"),
        firstDayOfWeek: integer("first_day_of_week").notNull().default(0), // 0=Sunday

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxActive: index("languages_active_idx").on(t.isActive),
    })
);

/* ---------------- System Message Translations ---------------- */
// This is where you translate SchedForm's own UI text
export const systemTranslations = pgTable(
    "system_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        messageKey: text("message_key").notNull(), // "button.schedule_meeting", "error.email_required"
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code),

        message: text("message").notNull(), // The actual translated text
        context: text("context"), // Help for translators

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqKeyLang: uniqueIndex("system_translations_key_lang_uq").on(t.messageKey, t.languageCode),
        idxLang: index("system_translations_lang_idx").on(t.languageCode),
        idxKey: index("system_translations_key_idx").on(t.messageKey),
    })
);

/* ---------------- User Language Preferences ---------------- */
export const userLanguagePreferences = pgTable(
    "user_language_preferences",
    {
        userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),

        preferredLanguage: text("preferred_language").notNull().references(() => supportedLanguages.code),
        timezone: text("timezone").notNull().default("UTC"),

        // Auto-detection results (for better UX)
        detectedLanguage: text("detected_language").references(() => supportedLanguages.code),
        detectedFromBrowser: boolean("detected_from_browser").notNull().default(false),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    }
);

/* ---------------- Organization Defaults ---------------- */
export const organizationLanguageSettings = pgTable(
    "organization_language_settings",
    {
        organizationId: text("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),

        defaultLanguage: text("default_language").notNull().references(() => supportedLanguages.code).default("en"),
        timezone: text("timezone").notNull().default("UTC"),

        // Simple feature flags
        allowLanguageDetection: boolean("allow_language_detection").notNull().default(true),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    }
);

/* ---------------- Relations ---------------- */
export const supportedLanguagesRelations = relations(supportedLanguages, ({ many }) => ({
    systemTranslations: many(systemTranslations),
    userPreferences: many(userLanguagePreferences),
    organizationSettings: many(organizationLanguageSettings),
}));

export const systemTranslationsRelations = relations(systemTranslations, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [systemTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const userLanguagePreferencesRelations = relations(userLanguagePreferences, ({ one }) => ({
    user: one(users, { fields: [userLanguagePreferences.userId], references: [users.id] }),
    preferredLanguageRef: one(supportedLanguages, {
        fields: [userLanguagePreferences.preferredLanguage],
        references: [supportedLanguages.code]
    }),
    detectedLanguageRef: one(supportedLanguages, {
        fields: [userLanguagePreferences.detectedLanguage],
        references: [supportedLanguages.code]
    }),
}));

export const organizationLanguageSettingsRelations = relations(organizationLanguageSettings, ({ one }) => ({
    organization: one(organizations, {
        fields: [organizationLanguageSettings.organizationId],
        references: [organizations.id]
    }),
    defaultLanguageRef: one(supportedLanguages, {
        fields: [organizationLanguageSettings.defaultLanguage],
        references: [supportedLanguages.code]
    }),
}));
