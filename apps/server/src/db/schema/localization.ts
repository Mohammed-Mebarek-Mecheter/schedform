// src/db/schema/localization.ts
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
    real,
    varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { users, organizations, teams } from "@/db/schema/auth";
import { forms, formQuestions, questionChoices } from "@/db/schema/forms";
import { eventTypes } from "@/db/schema/scheduling";
import { workflows } from "@/db/schema/workflows";

/* ---------------- Enums ---------------- */
export const languageStatusEnum = pgEnum("language_status", [
    "active",
    "inactive",
    "beta",
    "deprecated",
]);

export const translationStatusEnum = pgEnum("translation_status", [
    "draft",
    "pending_review",
    "approved",
    "published",
    "needs_update",
]);

export const regionTypeEnum = pgEnum("region_type", [
    "country",
    "territory",
    "language_group",
    "custom",
]);

/* ---------------- Supported Languages ---------------- */
export const supportedLanguages = pgTable(
    "supported_languages",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        code: text("code").notNull().unique(), // ISO 639-1 + optional region (en, en-US, es-ES)
        name: text("name").notNull(),
        nativeName: text("native_name"),
        direction: text("direction").notNull().default("ltr"), // ltr, rtl

        isDefault: boolean("is_default").notNull().default(false),
        status: languageStatusEnum("status").notNull().default("active"),
        sortOrder: integer("sort_order").notNull().default(0),

        // Regional settings
        dateFormat: text("date_format").notNull().default("YYYY-MM-DD"),
        timeFormat: text("time_format").notNull().default("HH:mm"),
        firstDayOfWeek: integer("first_day_of_week").notNull().default(1), // 1=Monday, 0=Sunday
        timezone: text("timezone"),
        currency: text("currency"),

        // Metadata
        progress: integer("progress").notNull().default(0), // Translation completion %
        lastUpdated: timestamp("last_updated", { mode: "date" }),
        maintainer: text("maintainer"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxCodeStatus: index("languages_code_status_idx").on(t.code, t.status),
        idxDefault: index("languages_default_idx").on(t.isDefault).where(sql`${t.isDefault} = true`),
        uqSortOrder: uniqueIndex("languages_sort_order_uq").on(t.sortOrder),
        idxActiveRegion: index("supported_languages_active_region_idx")
            .on(t.status, t.timezone)
            .where(sql`${t.status} = 'active'`),
        idxSortProgress: index("supported_languages_sort_progress_idx")
            .on(t.sortOrder, t.progress),

        chkProgress: sql`CHECK (${t.progress} >= 0 AND ${t.progress} <= 100)`,
        chkFirstDayOfWeek: sql`CHECK (${t.firstDayOfWeek} >= 0 AND ${t.firstDayOfWeek} <= 6)`,
        chkLanguageCode: sql`CHECK (code ~ '^[a-z]{2}(-[A-Z]{2})?$')`, // ISO 639-1 with optional region
    })
);

/* ---------------- Form Translations ---------------- */
export const formTranslations = pgTable(
    "form_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formId: text("form_id").notNull().references(() => forms.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Translated content
        title: text("title"),
        description: text("description"),
        submitButtonText: text("submit_button_text"),
        thankYouMessage: text("thank_you_message"),
        closingMessage: text("closing_message"),
        customMessages: jsonb("custom_messages"),

        // Status and metadata
        status: translationStatusEnum("status").notNull().default("draft"),
        isPublished: boolean("is_published").notNull().default(false),
        progress: integer("progress").notNull().default(0),

        translatedBy: text("translated_by").references(() => users.id, { onDelete: "set null" }),
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
        publishedAt: timestamp("published_at", { mode: "date" }),

        // Technical metadata
        version: integer("version").notNull().default(1),
        sourceVersion: integer("source_version").notNull().default(1),
        changeLog: jsonb("change_log"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqFormLanguage: uniqueIndex("form_translations_form_language_uq").on(t.formId, t.languageCode),
        idxStatus: index("form_translations_status_idx").on(t.status, t.isPublished),
        idxLanguage: index("form_translations_language_idx").on(t.languageCode),
        idxPublished: index("form_translations_published_idx")
            .on(t.formId, t.languageCode, t.isPublished)
            .where(sql`${t.isPublished} = true`),
        idxStatusProgress: index("form_translations_status_progress_idx")
            .on(t.status, t.progress, t.updatedAt),

        chkProgress: sql`CHECK (${t.progress} >= 0 AND ${t.progress} <= 100)`,
    })
);

/* ---------------- Question Translations ---------------- */
export const questionTranslations = pgTable(
    "question_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        questionId: text("question_id").notNull().references(() => formQuestions.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        title: text("title"),
        description: text("description"),
        placeholder: text("placeholder"),
        errorMessage: text("error_message"),
        settings: jsonb("settings"), // Translated settings

        status: translationStatusEnum("status").notNull().default("draft"),
        version: integer("version").notNull().default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqQuestionLanguage: uniqueIndex("question_translations_question_language_uq").on(t.questionId, t.languageCode),
        idxFormLanguage: index("question_translations_form_language_idx")
            .on(t.questionId, t.languageCode, t.status),
    })
);

/* ---------------- Choice Translations ---------------- */
export const choiceTranslations = pgTable(
    "choice_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        choiceId: text("choice_id").notNull().references(() => questionChoices.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        label: text("label"),
        disqualificationMessage: text("disqualification_message"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqChoiceLanguage: uniqueIndex("choice_translations_choice_language_uq").on(t.choiceId, t.languageCode),
    })
);

/* ---------------- Event Type Translations ---------------- */
export const eventTypeTranslations = pgTable(
    "event_type_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        eventTypeId: text("event_type_id").notNull().references(() => eventTypes.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        title: text("title"),
        description: text("description"),
        location: text("location"),
        customMessages: jsonb("custom_messages"),

        status: translationStatusEnum("status").notNull().default("draft"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEventTypeLanguage: uniqueIndex("event_type_translations_event_language_uq").on(t.eventTypeId, t.languageCode),
    })
);

/* ---------------- Regional Settings ---------------- */
export const regionalSettings = pgTable(
    "regional_settings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        regionCode: text("region_code").notNull(), // ISO 3166-1 or custom
        regionType: regionTypeEnum("region_type").notNull().default("country"),
        regionName: text("region_name").notNull(),

        // Business rules
        businessHours: jsonb("business_hours").notNull(),
        holidays: jsonb("holidays"),
        minSchedulingNotice: integer("min_scheduling_notice"), // minutes
        maxSchedulingWindow: integer("max_scheduling_window"), // days

        // Formatting preferences
        dateFormat: text("date_format"),
        timeFormat: text("time_format"),
        timezone: text("timezone"),
        currency: text("currency"),
        numberFormat: text("number_format"),

        // Legal compliance
        dataResidency: text("data_residency"), // GDPR, etc.
        requiredConsents: jsonb("required_consents"),

        // Language-specific formatting
        defaultLanguage: text("default_language").references(() => supportedLanguages.code, { onDelete: "restrict" }),
        fallbackLanguage: text("fallback_language").references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized business rules
        localizedBusinessHours: jsonb("localized_business_hours"), // Different for each language/locale
        localizedHolidays: jsonb("localized_holidays"), // Holiday names in local language

        // Legal and compliance translations
        privacyPolicyUrls: jsonb("privacy_policy_urls"), // { "en": "url", "es": "url" }
        termsOfServiceUrls: jsonb("terms_of_service_urls"),
        consentMessages: jsonb("consent_messages"), // GDPR consent text per language

        isActive: boolean("is_active").notNull().default(true),
        isDefault: boolean("is_default").notNull().default(false),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqRegionScope: uniqueIndex("regional_settings_region_scope_uq").on(
            t.regionCode,
            t.userId,
            t.organizationId,
            t.teamId
        ).where(sql`${t.userId} IS NOT NULL OR ${t.organizationId} IS NOT NULL OR ${t.teamId} IS NOT NULL`),
        idxActive: index("regional_settings_active_idx").on(t.isActive),
    })
);

/* ---------------- User Language Preferences ---------------- */
export const userLanguagePreferences = pgTable(
    "user_language_preferences",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

        preferredLanguage: text("preferred_language").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        uiLanguage: text("ui_language").references(() => supportedLanguages.code, { onDelete: "restrict" }),
        contentLanguage: text("content_language").references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Regional preferences
        timezone: text("timezone"),
        dateFormat: text("date_format"),
        timeFormat: text("time_format"),
        firstDayOfWeek: integer("first_day_of_week"),

        // Browser/device detection
        detectedLanguage: text("detected_language"),
        detectedTimezone: text("detected_timezone"),
        acceptLanguageHeader: text("accept_language_header"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqUser: uniqueIndex("user_language_preferences_user_uq").on(t.userId),
        idxLanguage: index("user_language_preferences_language_idx").on(t.preferredLanguage),
    })
);

/* ---------------- Organization Language Settings ---------------- */
export const organizationLanguageSettings = pgTable(
    "organization_language_settings",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

        // Organization-wide language settings
        defaultLanguage: text("default_language").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        fallbackLanguage: text("fallback_language").references(() => supportedLanguages.code, { onDelete: "restrict" }),
        supportedLanguages: jsonb("supported_languages").notNull().default([]), // Array of language codes

        // Auto-translation settings
        autoTranslateEnabled: boolean("auto_translate_enabled").default(false),
        autoTranslateProvider: text("auto_translate_provider"), // "google", "deepl", "azure"
        translationQuality: text("translation_quality").default("standard"), // "standard", "premium"

        // Regional settings for organization
        defaultTimezone: text("default_timezone").default("UTC"),
        defaultDateFormat: text("default_date_format").default("YYYY-MM-DD"),
        defaultTimeFormat: text("default_time_format").default("HH:mm"),

        // Compliance settings
        requireLanguageConsent: boolean("require_language_consent").default(false),
        trackLanguageConsent: boolean("track_language_consent").default(true),

        // UI customization per language
        localizedBranding: jsonb("localized_branding"), // { "en": { "logo": "url", "colors": {} }, "es": { ... } }

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqOrganization: uniqueIndex("organization_language_settings_org_uq").on(t.organizationId),
        idxDefaultLanguage: index("org_language_settings_default_language_idx").on(t.defaultLanguage),
    })
);

/* ---------------- Translation Template Library ---------------- */
export const translationTemplates = pgTable(
    "translation_templates",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        templateKey: text("template_key").notNull(), // "booking_confirmation_email", "reminder_email", etc.
        category: text("category").notNull(), // "email", "ui", "error", "validation" (SMS removed)

        // Default content (fallback language)
        defaultLanguage: text("default_language").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),
        defaultContent: jsonb("default_content").notNull(), // { subject, body, variables }

        // Template metadata
        description: text("description"),
        requiredVariables: jsonb("required_variables"), // Array of variable names
        isSystemTemplate: boolean("is_system_template").notNull().default(true), // vs user-created

        // Organization-specific templates
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

        // Usage tracking
        usageCount: integer("usage_count").notNull().default(0),
        lastUsed: timestamp("last_used", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTemplateKey: uniqueIndex("translation_templates_key_uq").on(t.templateKey, t.organizationId),
        idxCategory: index("translation_templates_category_idx").on(t.category),
        idxSystem: index("translation_templates_system_idx").on(t.isSystemTemplate),
        idxOrganization: index("translation_templates_organization_idx").on(t.organizationId),

        // Updated constraint to remove SMS category
        chkCategory: sql`CHECK (${t.category} IN ('email', 'ui', 'error', 'validation'))`,
    })
);

/* ---------------- Translation Template Content ---------------- */
export const translationTemplateContent = pgTable(
    "translation_template_content",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        templateId: text("template_id").notNull().references(() => translationTemplates.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Translated content
        content: jsonb("content").notNull(), // { subject, body, variables }

        // Translation status and quality
        status: translationStatusEnum("status").notNull().default("draft"),
        translatedBy: text("translated_by").references(() => users.id, { onDelete: "set null" }),
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),

        // Version control
        version: integer("version").notNull().default(1),
        sourceVersion: integer("source_version").notNull().default(1),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTemplateLanguage: uniqueIndex("translation_template_content_template_language_uq").on(t.templateId, t.languageCode),
        idxStatus: index("translation_template_content_status_idx").on(t.status),
        idxLanguage: index("translation_template_content_language_idx").on(t.languageCode),
    })
);

/* ---------------- System Message Translations ---------------- */
export const systemMessageTranslations = pgTable(
    "system_message_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        messageKey: text("message_key").notNull(), // "validation.email_required", "error.booking_conflict"
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        message: text("message").notNull(),
        context: text("context"), // Additional context for translators

        // Pluralization support
        pluralForms: jsonb("plural_forms"), // { one: "1 booking", other: "{count} bookings" }

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqMessageLanguage: uniqueIndex("system_message_translations_message_language_uq").on(t.messageKey, t.languageCode),
        idxMessageKey: index("system_message_translations_key_idx").on(t.messageKey),
        idxLanguage: index("system_message_translations_language_idx").on(t.languageCode),
    })
);

/* ---------------- Workflow Translation Support ---------------- */
export const workflowTranslations = pgTable(
    "workflow_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        workflowId: text("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        name: text("name"),
        description: text("description"),

        // Translated workflow definition with localized messages (SMS actions removed)
        workflowDefinition: jsonb("workflow_definition"),

        status: translationStatusEnum("status").notNull().default("draft"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqWorkflowLanguage: uniqueIndex("workflow_translations_workflow_language_uq").on(t.workflowId, t.languageCode),
    })
);

/* ---------------- Translation Cache for Performance ---------------- */
export const translationCache = pgTable(
    "translation_cache",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        // Cache key components
        cacheKey: text("cache_key").notNull().unique(), // hash of entity_type:entity_id:language_code
        entityType: text("entity_type").notNull(), // "form", "question", "email_template", etc.
        entityId: text("entity_id").notNull(),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "cascade" }),

        // Cached translation data
        translatedContent: jsonb("translated_content").notNull(),

        // Cache metadata
        sourceVersion: integer("source_version").notNull(), // Version of source content when cached
        isStale: boolean("is_stale").notNull().default(false),
        hitCount: integer("hit_count").notNull().default(0),
        lastAccessed: timestamp("last_accessed", { mode: "date" }).notNull().defaultNow(),

        // Cache management
        expiresAt: timestamp("expires_at", { mode: "date" }),
        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxEntityLanguage: index("translation_cache_entity_language_idx").on(t.entityType, t.entityId, t.languageCode),
        idxExpiry: index("translation_cache_expiry_idx").on(t.expiresAt).where(sql`${t.expiresAt} IS NOT NULL`),
        idxStale: index("translation_cache_stale_idx").on(t.isStale, t.lastAccessed).where(sql`${t.isStale} = true`),
        idxHitCount: index("translation_cache_hit_count_idx").on(t.hitCount, t.lastAccessed), // For cache eviction

        chkHitCount: sql`CHECK (${t.hitCount} >= 0)`,
        chkSourceVersion: sql`CHECK (${t.sourceVersion} > 0)`,
    })
);

/* ---------------- Language Detection Cache ---------------- */
export const languageDetectionCache = pgTable(
    "language_detection_cache",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        // Detection inputs
        contentHash: text("content_hash").notNull().unique(), // Hash of text content being analyzed
        acceptLanguageHeader: text("accept_language_header"),
        userAgent: text("user_agent"),
        ipAddress: varchar("ip_address", { length: 45 }),

        // Detection results
        detectedLanguage: text("detected_language").notNull().references(() => supportedLanguages.code, { onDelete: "cascade" }),
        confidence: real("confidence").notNull(),
        fallbackLanguage: text("fallback_language").references(() => supportedLanguages.code, { onDelete: "cascade" }),

        // Detection metadata
        detectionMethod: text("detection_method").notNull(), // "browser_header", "content_analysis", "ip_geolocation", "hybrid"
        detectionTime: integer("detection_time"), // Milliseconds taken to detect

        // Cache management
        hitCount: integer("hit_count").notNull().default(0),
        lastUsed: timestamp("last_used", { mode: "date" }).notNull().defaultNow(),
        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxDetectedLanguage: index("language_detection_cache_detected_idx").on(t.detectedLanguage, t.confidence),
        idxExpiry: index("language_detection_cache_expiry_idx").on(t.expiresAt),
        idxUsage: index("language_detection_cache_usage_idx").on(t.hitCount, t.lastUsed),

        chkConfidence: sql`CHECK (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
        chkHitCount: sql`CHECK (${t.hitCount} >= 0)`,
        chkDetectionTime: sql`CHECK (${t.detectionTime} IS NULL OR ${t.detectionTime} >= 0)`,
    })
);

/* ---------------- Translation Statistics for Analytics ---------------- */
export const translationStatistics = pgTable(
    "translation_statistics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        date: timestamp("date", { mode: "date" }).notNull(),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

        // Usage statistics
        totalRequests: integer("total_requests").notNull().default(0),
        cacheHits: integer("cache_hits").notNull().default(0),
        cacheMisses: integer("cache_misses").notNull().default(0),
        detectionRequests: integer("detection_requests").notNull().default(0),

        // Content statistics (SMS templates removed)
        formsTranslated: integer("forms_translated").notNull().default(0),
        questionsTranslated: integer("questions_translated").notNull().default(0),
        emailTemplatesTranslated: integer("email_templates_translated").notNull().default(0),

        // Performance metrics
        averageDetectionTime: integer("average_detection_time"), // Milliseconds
        averageTranslationTime: integer("average_translation_time"), // Milliseconds

        // Quality metrics
        translationErrors: integer("translation_errors").notNull().default(0),
        fallbackUsage: integer("fallback_usage").notNull().default(0), // Times fallback language was used

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqDateLanguageOrg: uniqueIndex("translation_statistics_date_language_org_uq").on(t.date, t.languageCode, t.organizationId),
        idxLanguageDate: index("translation_statistics_language_date_idx").on(t.languageCode, t.date),
        idxPerformance: index("translation_statistics_performance_idx").on(t.averageDetectionTime, t.averageTranslationTime),
        idxOrganization: index("translation_statistics_organization_idx").on(t.organizationId, t.date),

        chkTotalRequests: sql`CHECK (${t.totalRequests} >= 0)`,
        chkCacheHits: sql`CHECK (${t.cacheHits} >= 0)`,
        chkCacheMisses: sql`CHECK (${t.cacheMisses} >= 0)`,
        chkDetectionRequests: sql`CHECK (${t.detectionRequests} >= 0)`,
        chkFormsTranslated: sql`CHECK (${t.formsTranslated} >= 0)`,
        chkQuestionsTranslated: sql`CHECK (${t.questionsTranslated} >= 0)`,
        chkEmailTemplatesTranslated: sql`CHECK (${t.emailTemplatesTranslated} >= 0)`,
        chkAverageDetectionTime: sql`CHECK (${t.averageDetectionTime} IS NULL OR ${t.averageDetectionTime} >= 0)`,
        chkAverageTranslationTime: sql`CHECK (${t.averageTranslationTime} IS NULL OR ${t.averageTranslationTime} >= 0)`,
        chkTranslationErrors: sql`CHECK (${t.translationErrors} >= 0)`,
        chkFallbackUsage: sql`CHECK (${t.fallbackUsage} >= 0)`,
    })
);

/* ---------------- Relations ---------------- */
export const supportedLanguagesRelations = relations(supportedLanguages, ({ many }) => ({
    formTranslations: many(formTranslations),
    questionTranslations: many(questionTranslations),
    choiceTranslations: many(choiceTranslations),
    eventTypeTranslations: many(eventTypeTranslations),
    userPreferences: many(userLanguagePreferences),
    organizationSettings: many(organizationLanguageSettings),
    translationTemplates: many(translationTemplates),
    translationTemplateContent: many(translationTemplateContent),
    systemMessageTranslations: many(systemMessageTranslations),
    workflowTranslations: many(workflowTranslations),
}));

export const formTranslationsRelations = relations(formTranslations, ({ one }) => ({
    form: one(forms, { fields: [formTranslations.formId], references: [forms.id] }),
    language: one(supportedLanguages, { fields: [formTranslations.languageCode], references: [supportedLanguages.code] }),
    translator: one(users, { fields: [formTranslations.translatedBy], references: [users.id] }),
    reviewer: one(users, { fields: [formTranslations.reviewedBy], references: [users.id] }),
}));

export const questionTranslationsRelations = relations(questionTranslations, ({ one }) => ({
    question: one(formQuestions, { fields: [questionTranslations.questionId], references: [formQuestions.id] }),
    language: one(supportedLanguages, { fields: [questionTranslations.languageCode], references: [supportedLanguages.code] }),
}));

export const choiceTranslationsRelations = relations(choiceTranslations, ({ one }) => ({
    choice: one(questionChoices, { fields: [choiceTranslations.choiceId], references: [questionChoices.id] }),
    language: one(supportedLanguages, { fields: [choiceTranslations.languageCode], references: [supportedLanguages.code] }),
}));

export const eventTypeTranslationsRelations = relations(eventTypeTranslations, ({ one }) => ({
    eventType: one(eventTypes, { fields: [eventTypeTranslations.eventTypeId], references: [eventTypes.id] }),
    language: one(supportedLanguages, { fields: [eventTypeTranslations.languageCode], references: [supportedLanguages.code] }),
}));

export const regionalSettingsRelations = relations(regionalSettings, ({ one }) => ({
    user: one(users, { fields: [regionalSettings.userId], references: [users.id] }),
    organization: one(organizations, { fields: [regionalSettings.organizationId], references: [organizations.id] }),
    team: one(teams, { fields: [regionalSettings.teamId], references: [teams.id] }),
    defaultLanguage: one(supportedLanguages, { fields: [regionalSettings.defaultLanguage], references: [supportedLanguages.code] }),
    fallbackLanguage: one(supportedLanguages, { fields: [regionalSettings.fallbackLanguage], references: [supportedLanguages.code] }),
}));

export const userLanguagePreferencesRelations = relations(userLanguagePreferences, ({ one }) => ({
    user: one(users, { fields: [userLanguagePreferences.userId], references: [users.id] }),
    preferredLanguage: one(supportedLanguages, { fields: [userLanguagePreferences.preferredLanguage], references: [supportedLanguages.code] }),
    uiLanguage: one(supportedLanguages, { fields: [userLanguagePreferences.uiLanguage], references: [supportedLanguages.code] }),
    contentLanguage: one(supportedLanguages, { fields: [userLanguagePreferences.contentLanguage], references: [supportedLanguages.code] }),
}));

export const organizationLanguageSettingsRelations = relations(organizationLanguageSettings, ({ one }) => ({
    organization: one(organizations, { fields: [organizationLanguageSettings.organizationId], references: [organizations.id] }),
    defaultLanguage: one(supportedLanguages, { fields: [organizationLanguageSettings.defaultLanguage], references: [supportedLanguages.code] }),
    fallbackLanguage: one(supportedLanguages, { fields: [organizationLanguageSettings.fallbackLanguage], references: [supportedLanguages.code] }),
}));

export const translationTemplatesRelations = relations(translationTemplates, ({ one, many }) => ({
    defaultLanguageRef: one(supportedLanguages, {
        fields: [translationTemplates.defaultLanguage],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [translationTemplates.organizationId],
        references: [organizations.id]
    }),
    translations: many(translationTemplateContent),
}));

export const translationTemplateContentRelations = relations(translationTemplateContent, ({ one }) => ({
    template: one(translationTemplates, {
        fields: [translationTemplateContent.templateId],
        references: [translationTemplates.id]
    }),
    language: one(supportedLanguages, {
        fields: [translationTemplateContent.languageCode],
        references: [supportedLanguages.code]
    }),
    translator: one(users, {
        fields: [translationTemplateContent.translatedBy],
        references: [users.id]
    }),
    reviewer: one(users, {
        fields: [translationTemplateContent.reviewedBy],
        references: [users.id]
    }),
}));

export const systemMessageTranslationsRelations = relations(systemMessageTranslations, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [systemMessageTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const workflowTranslationsRelations = relations(workflowTranslations, ({ one }) => ({
    workflow: one(workflows, {
        fields: [workflowTranslations.workflowId],
        references: [workflows.id]
    }),
    language: one(supportedLanguages, {
        fields: [workflowTranslations.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const translationCacheRelations = relations(translationCache, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [translationCache.languageCode],
        references: [supportedLanguages.code]
    }),
}));

export const languageDetectionCacheRelations = relations(languageDetectionCache, ({ one }) => ({
    detectedLanguageRef: one(supportedLanguages, {
        fields: [languageDetectionCache.detectedLanguage],
        references: [supportedLanguages.code]
    }),
    fallbackLanguageRef: one(supportedLanguages, {
        fields: [languageDetectionCache.fallbackLanguage],
        references: [supportedLanguages.code]
    }),
}));

export const translationStatisticsRelations = relations(translationStatistics, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [translationStatistics.languageCode],
        references: [supportedLanguages.code]
    }),
    organization: one(organizations, {
        fields: [translationStatistics.organizationId],
        references: [organizations.id]
    }),
}));
