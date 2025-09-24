// src/db/schema/spamPrevention.ts
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
import { formResponses, forms } from "@/db/schema/forms";
import { bookings } from "@/db/schema/scheduling";
import { supportedLanguages } from "@/db/schema/localization";

/**
 * Enums for spam prevention and quality control
 */
export const spamRiskLevelEnum = pgEnum("spam_risk_level", [
    "very_low",
    "low",
    "medium",
    "high",
    "very_high",
    "critical",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
    "not_required",
    "pending",
    "in_progress",
    "verified",
    "failed",
    "expired",
    "skipped",
]);

export const reviewStatusEnum = pgEnum("review_status", [
    "pending",
    "approved",
    "rejected",
    "flagged",
    "escalated",
    "auto_approved",
    "requires_human",
]);

export const fraudIndicatorEnum = pgEnum("fraud_indicator", [
    "suspicious_email",
    "disposable_email",
    "vpn_usage",
    "tor_usage",
    "bot_behavior",
    "fake_phone",
    "duplicate_submission",
    "high_risk_ip",
    "suspicious_domain",
    "velocity_abuse",
    "pattern_matching",
    "ml_detection",
    "honeypot_triggered",
    "captcha_failed",
    "browser_inconsistency",
    "timezone_mismatch",
    "impossible_speed",
]);

export const blockReasonEnum = pgEnum("block_reason", [
    "manual_block",
    "spam_detected",
    "fraud_pattern",
    "velocity_limit",
    "repeated_violations",
    "high_risk_score",
    "verification_failed",
    "admin_decision",
    "legal_request",
    "abuse_report",
]);

export const verificationMethodEnum = pgEnum("verification_method", [
    "email_link",
    "email_code",
    "captcha",
    "manual_review",
]);

/**
 * Spam Detection Rules - Configurable rules (simplified)
 */
export const spamDetectionRules = pgTable(
    "spam_detection_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        isActive: boolean("is_active").notNull().default(true),
        isGlobal: boolean("is_global").notNull().default(false),

        // Rule configuration
        ruleType: text("rule_type").notNull(), // email_pattern, ip_range, velocity, ml_model, keyword, etc.
        conditions: jsonb("conditions").notNull(),
        severity: integer("severity").notNull().default(5),
        confidence: real("confidence").notNull().default(0.8),

        // Actions
        blockSubmission: boolean("block_submission").notNull().default(false),
        requireVerification: boolean("require_verification").notNull().default(true),
        flagForReview: boolean("flag_for_review").notNull().default(false),
        notifyAdmin: boolean("notify_admin").notNull().default(false),
        scoreAdjustment: integer("score_adjustment").notNull().default(0),

        // Rate limiting
        maxTriggersPerHour: integer("max_triggers_per_hour").default(100),
        maxTriggersPerDay: integer("max_triggers_per_day").default(1000),

        // Performance tracking
        totalTriggers: integer("total_triggers").notNull().default(0),
        falsePositives: integer("false_positives").notNull().default(0),
        truePositives: integer("true_positives").notNull().default(0),
        accuracy: real("accuracy").notNull().default(0),
        lastTriggered: timestamp("last_triggered", { mode: "date" }),

        // Management
        createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
        lastModifiedBy: text("last_modified_by").references(() => users.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes
        idxActiveGlobal: index("spam_detection_rules_active_global_idx")
            .on(t.isActive, t.isGlobal)
            .where(sql`${t.isActive} = true`),
        idxUserOrgForm: index("spam_detection_rules_user_org_form_idx")
            .on(t.userId, t.organizationId, t.formId)
            .where(sql`${t.userId} IS NOT NULL OR ${t.organizationId} IS NOT NULL OR ${t.formId} IS NOT NULL`),
        idxRuleType: index("spam_detection_rules_type_idx").on(t.ruleType, t.isActive),
        idxOrgActive: index("spam_detection_rules_org_active_idx").on(t.organizationId, t.isActive),

        // Constraints
        chkSeverity: sql`CHECK (${t.severity} >= 1 AND ${t.severity} <= 10)`,
        chkConfidence: sql`CHECK (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
        chkScoreAdjustment: sql`CHECK (${t.scoreAdjustment} >= -100 AND ${t.scoreAdjustment} <= 100)`,
        chkMaxTriggersPerHour: sql`CHECK (${t.maxTriggersPerHour} IS NULL OR ${t.maxTriggersPerHour} > 0)`,
        chkMaxTriggersPerDay: sql`CHECK (${t.maxTriggersPerDay} IS NULL OR ${t.maxTriggersPerDay} > 0)`,
        chkPerformance: sql`CHECK (${t.totalTriggers} >= 0 AND ${t.falsePositives} >= 0 AND ${t.truePositives} >= 0)`,
        chkAccuracy: sql`CHECK (${t.accuracy} >= 0 AND ${t.accuracy} <= 1)`,
    }),
);

/**
 * Spam Assessments - Detailed analysis (simplified)
 */
export const spamAssessments = pgTable(
    "spam_assessments",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

        // Overall assessment
        spamScore: integer("spam_score").notNull(),
        riskLevel: spamRiskLevelEnum("risk_level").notNull(),
        isSpam: boolean("is_spam").notNull().default(false),
        confidence: real("confidence").notNull(),

        // Detection results
        indicators: jsonb("indicators"),
        rulesTriggered: jsonb("rules_triggered"),
        riskFactors: jsonb("risk_factors"),

        // Technical analysis
        ipAnalysis: jsonb("ip_analysis"),
        emailAnalysis: jsonb("email_analysis"),
        phoneAnalysis: jsonb("phone_analysis"),
        deviceAnalysis: jsonb("device_analysis"),
        behaviorAnalysis: jsonb("behavior_analysis"),
        geolocationAnalysis: jsonb("geolocation_analysis"),

        // ML model results
        mlModelVersion: text("ml_model_version"),
        mlFeatures: jsonb("ml_features"),
        mlPrediction: real("ml_prediction"),
        mlConfidence: real("ml_confidence"),

        // External service results
        externalChecks: jsonb("external_checks"),
        ipReputationScore: integer("ip_reputation_score"),
        emailReputationScore: integer("email_reputation_score"),

        // Manual review
        requiresReview: boolean("requires_review").notNull().default(false),
        reviewStatus: reviewStatusEnum("review_status"),
        reviewPriority: integer("review_priority").default(5),
        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
        reviewedAt: timestamp("reviewed_at", { mode: "date" }),
        reviewNotes: text("review_notes"),
        reviewDecision: text("review_decision"),

        // Actions taken
        actionsTaken: jsonb("actions_taken"),
        blocked: boolean("blocked").notNull().default(false),
        blockedReason: blockReasonEnum("blocked_reason"),
        blockedAt: timestamp("blocked_at", { mode: "date" }),

        // Verification triggered
        verificationRequired: boolean("verification_required").notNull().default(false),
        verificationMethods: jsonb("verification_methods"),

        // Processing performance
        processingTime: integer("processing_time"),
        rulesProcessed: integer("rules_processed"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes
        idxFormResponse: index("spam_assessments_form_response_idx").on(t.formResponseId).where(sql`${t.formResponseId} IS NOT NULL`),
        idxBooking: index("spam_assessments_booking_idx").on(t.bookingId).where(sql`${t.bookingId} IS NOT NULL`),
        idxOrgSpamRisk: index("spam_assessments_org_spam_risk_idx").on(t.organizationId, t.spamScore, t.riskLevel, t.isSpam),
        idxReviewRequired: index("spam_assessments_review_required_idx").on(t.requiresReview, t.reviewStatus).where(sql`${t.requiresReview} = true`),
        idxCreatedScore: index("spam_assessments_created_score_idx").on(t.createdAt, t.spamScore),

        // Constraints
        chkSpamScore: sql`CHECK (${t.spamScore} >= 0 AND ${t.spamScore} <= 100)`,
        chkConfidence: sql`CHECK (${t.confidence} >= 0 AND ${t.confidence} <= 1)`,
        chkMlPrediction: sql`CHECK (${t.mlPrediction} IS NULL OR (${t.mlPrediction} >= 0 AND ${t.mlPrediction} <= 1))`,
        chkMlConfidence: sql`CHECK (${t.mlConfidence} IS NULL OR (${t.mlConfidence} >= 0 AND ${t.mlConfidence} <= 1))`,
        chkIpReputation: sql`CHECK (${t.ipReputationScore} IS NULL OR (${t.ipReputationScore} >= 0 AND ${t.ipReputationScore} <= 100))`,
        chkEmailReputation: sql`CHECK (${t.emailReputationScore} IS NULL OR (${t.emailReputationScore} >= 0 AND ${t.emailReputationScore} <= 100))`,
        chkReviewPriority: sql`CHECK (${t.reviewPriority} >= 1 AND ${t.reviewPriority} <= 10)`,
        chkProcessingTime: sql`CHECK (${t.processingTime} IS NULL OR ${t.processingTime} >= 0)`,
        chkRulesProcessed: sql`CHECK (${t.rulesProcessed} IS NULL OR ${t.rulesProcessed} >= 0)`,
    }),
);

/**
 * Email Verifications - Enhanced tracking
 */
export const emailVerifications = pgTable(
    "email_verifications",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        spamAssessmentId: text("spam_assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

        email: text("email").notNull(),
        verificationToken: text("verification_token").notNull(),
        verificationCode: varchar("verification_code", { length: 10 }),

        status: verificationStatusEnum("status").notNull().default("pending"),
        method: verificationMethodEnum("method").notNull().default("email_link"),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(3),

        sentAt: timestamp("sent_at", { mode: "date" }),
        verifiedAt: timestamp("verified_at", { mode: "date" }),
        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),

        // Email provider analysis
        emailProvider: text("email_provider"),
        isDisposableEmail: boolean("is_disposable_email").notNull().default(false),
        emailDomainAge: integer("email_domain_age"),
        emailDomainReputation: integer("email_domain_reputation"),

        // Delivery tracking
        deliveryStatus: text("delivery_status"),
        deliveryError: text("delivery_error"),
        deliveryAttempts: integer("delivery_attempts").notNull().default(0),
        bounceCategory: text("bounce_category"),

        // Security tracking
        verificationIP: varchar("verification_ip", { length: 45 }),
        verificationUserAgent: text("verification_user_agent"),
        verificationLocation: jsonb("verification_location"),
        browserFingerprint: text("browser_fingerprint"),

        // Rate limiting
        dailyVerificationCount: integer("daily_verification_count").notNull().default(1),
        isRateLimited: boolean("is_rate_limited").notNull().default(false),

        // External service tracking
        emailServiceProvider: text("email_service_provider"),
        externalMessageId: text("external_message_id"),
        emailCost: real("email_cost"),

        detectedLanguage: text("detected_language").references(() => supportedLanguages.code, { onDelete: "set null" }),
        preferredLanguage: text("preferred_language").references(() => supportedLanguages.code, { onDelete: "set null" }),

        // Localized verification content
        localizedSubject: text("localized_subject"),
        localizedMessage: text("localized_message"),
        localizedInstructions: text("localized_instructions"),

        // Cultural context for verification
        culturalContext: jsonb("cultural_context"), // Region-specific verification preferences

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        // Indexes
        uqToken: uniqueIndex("email_verifications_token_uq").on(t.verificationToken),
        uqCode: uniqueIndex("email_verifications_code_uq").on(t.verificationCode).where(sql`${t.verificationCode} IS NOT NULL`),
        idxEmail: index("email_verifications_email_idx").on(t.email),
        idxStatusExpiry: index("email_verifications_status_expiry_idx").on(t.status, t.expiresAt),
        idxDeliveryStatus: index("email_verifications_delivery_idx").on(t.deliveryStatus, t.createdAt),
        idxOrgStatus: index("email_verifications_org_status_idx").on(t.organizationId, t.status),

        // Constraints
        chkEmailFormat: sql`CHECK (${t.email} ~ '^[^@]+@[^@]+\\.[^@]+')`,
        chkAttempts: sql`CHECK (${t.attempts} >= 0)`,
        chkMaxAttempts: sql`CHECK (${t.maxAttempts} > 0)`,
        chkEmailDomainAge: sql`CHECK (${t.emailDomainAge} IS NULL OR ${t.emailDomainAge} >= 0)`,
        chkEmailDomainReputation: sql`CHECK (${t.emailDomainReputation} IS NULL OR (${t.emailDomainReputation} >= 0 AND ${t.emailDomainReputation} <= 100))`,
        chkDeliveryAttempts: sql`CHECK (${t.deliveryAttempts} >= 0)`,
        chkDailyVerificationCount: sql`CHECK (${t.dailyVerificationCount} >= 1)`,
        chkEmailCost: sql`CHECK (${t.emailCost} IS NULL OR ${t.emailCost} >= 0)`,
    }),
);

/**
 * Blocked Entities - Enhanced tracking (essential fields only)
 */
export const blockedEntities = pgTable(
    "blocked_entities",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        entityType: text("entity_type").notNull(), // ip, email, phone, domain, user_agent
        entityValue: text("entity_value").notNull(),
        entityHash: text("entity_hash"), // Hashed version for privacy

        // Block configuration
        blockType: text("block_type").notNull(), // manual, automatic, temporary, permanent
        blockReason: blockReasonEnum("block_reason").notNull(),
        severity: integer("severity").notNull(),
        description: text("description"),

        // Automatic blocking
        isAutomatic: boolean("is_automatic").notNull().default(false),
        autoBlockRule: text("auto_block_rule"),
        triggerThreshold: integer("trigger_threshold"),

        // Time-based blocking
        isTemporary: boolean("is_temporary").notNull().default(false),
        expiresAt: timestamp("expires_at", { mode: "date" }),
        autoUnblockAt: timestamp("auto_unblock_at", { mode: "date" }),

        // Geographic info (for IPs only)
        country: varchar("country", { length: 2 }),
        region: text("region"),
        city: text("city"),
        isp: text("isp"),
        asn: integer("asn"), // Autonomous System Number
        isVpn: boolean("is_vpn").notNull().default(false),
        isProxy: boolean("is_proxy").notNull().default(false),
        isTor: boolean("is_tor").notNull().default(false),
        isHosting: boolean("is_hosting").notNull().default(false),

        // Usage tracking
        totalAttempts: integer("total_attempts").notNull().default(0),
        blockedAttempts: integer("blocked_attempts").notNull().default(0),
        lastAttempt: timestamp("last_attempt", { mode: "date" }),
        lastBlocked: timestamp("last_blocked", { mode: "date" }),

        // Appeal process (simplified)
        appealSubmitted: boolean("appeal_submitted").notNull().default(false),
        appealedAt: timestamp("appealed_at", { mode: "date" }),
        appealReason: text("appeal_reason"),
        appealStatus: text("appeal_status"), // pending, approved, rejected
        reviewedBy: text("reviewed_by")
            .references(() => users.id, { onDelete: "set null" }),

        // Management
        blockedBy: text("blocked_by")
            .references(() => users.id, { onDelete: "set null" }),
        isActive: boolean("is_active").notNull().default(true),

        // External data
        externalSources: jsonb("external_sources"),
        lastExternalUpdate: timestamp("last_external_update", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEntityTypeValue: uniqueIndex("blocked_entities_type_value_uq")
            .on(t.entityType, t.entityValue),
        idxActiveType: index("blocked_entities_active_type_idx")
            .on(t.isActive, t.entityType)
            .where(sql`${t.isActive} = true`),
        idxExpiryActive: index("blocked_entities_expiry_active_idx")
            .on(t.expiresAt, t.isActive)
            .where(sql`${t.expiresAt} IS NOT NULL AND ${t.isActive} = true`),
        idxCountrySeverity: index("blocked_entities_country_severity_idx")
            .on(t.country, t.severity)
            .where(sql`${t.country} IS NOT NULL`),
        idxOrgTeam: index("blocked_entities_org_team_idx").on(t.organizationId, t.teamId),

        // Constraints
        chkSeverity: sql`CHECK (${t.severity} >= 1 AND ${t.severity} <= 10)`,
        chkTriggerThreshold: sql`CHECK (${t.triggerThreshold} IS NULL OR ${t.triggerThreshold} > 0)`,
        chkTotalAttempts: sql`CHECK (${t.totalAttempts} >= 0)`,
        chkBlockedAttempts: sql`CHECK (${t.blockedAttempts} >= 0)`,
    })
);

/**
 * Simplified Analytics for Spam Prevention
 */
export const spamPreventionAnalytics = pgTable(
    "spam_prevention_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        date: timestamp("date", { mode: "date" }).notNull(),
        userId: text("user_id")
            .references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id")
            .references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id")
            .references(() => forms.id, { onDelete: "cascade" }),

        // Core submission counts
        totalSubmissions: integer("total_submissions").notNull().default(0),
        legitimateSubmissions: integer("legitimate_submissions").notNull().default(0),
        spamSubmissions: integer("spam_submissions").notNull().default(0),
        blockedSubmissions: integer("blocked_submissions").notNull().default(0),
        flaggedSubmissions: integer("flagged_submissions").notNull().default(0),

        // Email verification statistics only
        emailVerificationsRequested: integer("email_verifications_requested").notNull().default(0),
        emailVerificationsCompleted: integer("email_verifications_completed").notNull().default(0),

        // Quality scores with validation
        averageSpamScore: real("average_spam_score").notNull().default(0),
        averageQualityScore: real("average_quality_score").notNull().default(0),
        spamDetectionAccuracy: real("spam_detection_accuracy").notNull().default(0),
        falsePositiveRate: real("false_positive_rate").notNull().default(0),
        falseNegativeRate: real("false_negative_rate").notNull().default(0),

        // Aggregated insights
        rulesTriggered: jsonb("rules_triggered"),
        topFraudIndicators: jsonb("top_fraud_indicators"),
        topSpamCountries: jsonb("top_spam_countries"),
        topSpamIsps: jsonb("top_spam_isps"),
        vpnTrafficPercentage: real("vpn_traffic_percentage").notNull().default(0),

        // Manual review workload
        manualReviewsRequired: integer("manual_reviews_required").notNull().default(0),
        manualReviewsCompleted: integer("manual_reviews_completed").notNull().default(0),
        averageReviewTime: integer("average_review_time"),

        // Cost tracking (email only)
        verificationCosts: real("verification_costs").notNull().default(0),
        externalServiceCosts: real("external_service_costs").notNull().default(0),

        // Performance metrics
        averageProcessingTime: integer("average_processing_time"),
        systemUptime: real("system_uptime").notNull().default(100),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqDateOrg: uniqueIndex("spam_prevention_analytics_date_org_uq")
            .on(t.date, t.organizationId)
            .where(sql`${t.organizationId} IS NOT NULL`),
        uqDateForm: uniqueIndex("spam_prevention_analytics_date_form_uq")
            .on(t.date, t.formId)
            .where(sql`${t.formId} IS NOT NULL`),
        idxDate: index("spam_prevention_analytics_date_idx")
            .on(t.date),
        idxAccuracy: index("spam_prevention_analytics_accuracy_idx")
            .on(t.spamDetectionAccuracy, t.date),
        idxOrgDate: index("spam_prevention_analytics_org_date_idx").on(t.organizationId, t.date),

        // Constraints
        chkTotalSubmissions: sql`CHECK (${t.totalSubmissions} >= 0)`,
        chkLegitimateSubmissions: sql`CHECK (${t.legitimateSubmissions} >= 0)`,
        chkSpamSubmissions: sql`CHECK (${t.spamSubmissions} >= 0)`,
        chkBlockedSubmissions: sql`CHECK (${t.blockedSubmissions} >= 0)`,
        chkFlaggedSubmissions: sql`CHECK (${t.flaggedSubmissions} >= 0)`,
        chkEmailVerificationsRequested: sql`CHECK (${t.emailVerificationsRequested} >= 0)`,
        chkEmailVerificationsCompleted: sql`CHECK (${t.emailVerificationsCompleted} >= 0)`,
        chkAverageSpamScore: sql`CHECK (${t.averageSpamScore} >= 0 AND ${t.averageSpamScore} <= 100)`,
        chkAverageQualityScore: sql`CHECK (${t.averageQualityScore} >= 0 AND ${t.averageQualityScore} <= 100)`,
        chkSpamDetectionAccuracy: sql`CHECK (${t.spamDetectionAccuracy} >= 0 AND ${t.spamDetectionAccuracy} <= 100)`,
        chkFalsePositiveRate: sql`CHECK (${t.falsePositiveRate} >= 0 AND ${t.falsePositiveRate} <= 100)`,
        chkFalseNegativeRate: sql`CHECK (${t.falseNegativeRate} >= 0 AND ${t.falseNegativeRate} <= 100)`,
        chkVpnTrafficPercentage: sql`CHECK (${t.vpnTrafficPercentage} >= 0 AND ${t.vpnTrafficPercentage} <= 100)`,
        chkManualReviewsRequired: sql`CHECK (${t.manualReviewsRequired} >= 0)`,
        chkManualReviewsCompleted: sql`CHECK (${t.manualReviewsCompleted} >= 0)`,
        chkAverageReviewTime: sql`CHECK (${t.averageReviewTime} IS NULL OR ${t.averageReviewTime} > 0)`,
        chkVerificationCosts: sql`CHECK (${t.verificationCosts} >= 0)`,
        chkExternalServiceCosts: sql`CHECK (${t.externalServiceCosts} >= 0)`,
        chkAverageProcessingTime: sql`CHECK (${t.averageProcessingTime} IS NULL OR ${t.averageProcessingTime} >= 0)`,
        chkSystemUptime: sql`CHECK (${t.systemUptime} >= 0 AND ${t.systemUptime} <= 100)`,
    })
);

/* ---------------- Localized Verification Messages ---------------- */
export const verificationMessageTranslations = pgTable(
    "verification_message_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        messageType: text("message_type").notNull(), // "email_verification", "blocked_entity"
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Email verification messages only
        emailSubject: text("email_subject"),
        emailBody: text("email_body"),

        // Blocked entity messages
        blockedMessage: text("blocked_message"),
        appealInstructions: text("appeal_instructions"),

        // General verification instructions
        verificationInstructions: text("verification_instructions"),
        resendInstructions: text("resend_instructions"),

        // Error messages
        errorMessages: jsonb("error_messages"), // { expired, invalid_code, max_attempts, etc. }

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqTypeLanguage: uniqueIndex("verification_message_translations_type_language_uq").on(t.messageType, t.languageCode),
        idxMessageType: index("verification_message_translations_type_idx").on(t.messageType),
        idxLanguage: index("verification_message_translations_language_idx").on(t.languageCode),
    })
);

/* ---------------- Localized Spam Assessment Messages ---------------- */
export const spamAssessmentTranslations = pgTable(
    "spam_assessment_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        assessmentId: text("assessment_id").notNull().references(() => spamAssessments.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized review messages
        reviewNotes: text("review_notes"),
        reviewDecision: text("review_decision"),

        // Localized risk factor explanations
        localizedRiskFactors: jsonb("localized_risk_factors"),
        localizedRecommendations: jsonb("localized_recommendations"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqAssessmentLanguage: uniqueIndex("spam_assessment_translations_assessment_language_uq").on(t.assessmentId, t.languageCode),
    })
);

/* ---------------- Localized Blocked Entity Messages ---------------- */
export const blockedEntityTranslations = pgTable(
    "blocked_entity_translations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        blockedEntityId: text("blocked_entity_id").notNull().references(() => blockedEntities.id, { onDelete: "cascade" }),
        languageCode: text("language_code").notNull().references(() => supportedLanguages.code, { onDelete: "restrict" }),

        // Localized block information
        description: text("description"),
        appealReason: text("appeal_reason"),

        // Localized user-facing messages
        userMessage: text("user_message"), // What the user sees when blocked
        appealInstructions: text("appeal_instructions"),
        contactInstructions: text("contact_instructions"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEntityLanguage: uniqueIndex("blocked_entity_translations_entity_language_uq").on(t.blockedEntityId, t.languageCode),
    })
);

/* ---------------- Regional Spam Detection Rules ---------------- */
export const regionalSpamRules = pgTable(
    "regional_spam_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        ruleId: text("rule_id").notNull().references(() => spamDetectionRules.id, { onDelete: "cascade" }),

        // Regional targeting
        regions: jsonb("regions").notNull(), // Array of region codes this rule applies to
        languages: jsonb("languages").notNull(), // Array of language codes

        // Region-specific rule configuration
        regionalConditions: jsonb("regional_conditions"), // Conditions that vary by region
        culturalAdjustments: jsonb("cultural_adjustments"), // Cultural sensitivity adjustments

        // Localized rule descriptions
        localizedDescriptions: jsonb("localized_descriptions"), // Per-language descriptions

        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxRule: index("regional_spam_rules_rule_idx").on(t.ruleId),
        idxActive: index("regional_spam_rules_active_idx").on(t.isActive),
    })
);

/* ============================
   Relations
   ============================ */

export const spamDetectionRulesRelations = relations(spamDetectionRules, ({ one, many }) => ({
    owner: one(users, {
        fields: [spamDetectionRules.userId],
        references: [users.id],
        relationName: "spam_detection_rule_owner"
    }),
    organization: one(organizations, {
        fields: [spamDetectionRules.organizationId],
        references: [organizations.id],
        relationName: "spam_detection_rule_organization"
    }),
    form: one(forms, {
        fields: [spamDetectionRules.formId],
        references: [forms.id],
        relationName: "spam_detection_rule_form"
    }),
    creator: one(users, {
        fields: [spamDetectionRules.createdBy],
        references: [users.id],
        relationName: "spam_detection_rule_creator"
    }),
    lastModifier: one(users, {
        fields: [spamDetectionRules.lastModifiedBy],
        references: [users.id],
        relationName: "spam_detection_rule_modifier"
    }),
    regionalRules: many(regionalSpamRules, {
        relationName: "spam_detection_rule_regional_rules"
    }),
}));

export const spamAssessmentsRelations = relations(spamAssessments, ({ one, many }) => ({
    formResponse: one(formResponses, {
        fields: [spamAssessments.formResponseId],
        references: [formResponses.id],
        relationName: "spam_assessment_form_response"
    }),
    booking: one(bookings, {
        fields: [spamAssessments.bookingId],
        references: [bookings.id],
        relationName: "spam_assessment_booking"
    }),
    organization: one(organizations, {
        fields: [spamAssessments.organizationId],
        references: [organizations.id],
        relationName: "spam_assessment_organization"
    }),
    reviewer: one(users, {
        fields: [spamAssessments.reviewedBy],
        references: [users.id],
        relationName: "spam_assessment_reviewer"
    }),
    translations: many(spamAssessmentTranslations, {
        relationName: "spam_assessment_translations"
    }),
    // Only email verifications now
    emailVerifications: many(emailVerifications, {
        relationName: "spam_assessment_email_verifications"
    }),
}));

export const emailVerificationsRelations = relations(emailVerifications, ({ one }) => ({
    formResponse: one(formResponses, {
        fields: [emailVerifications.formResponseId],
        references: [formResponses.id],
        relationName: "email_verification_form_response"
    }),
    booking: one(bookings, {
        fields: [emailVerifications.bookingId],
        references: [bookings.id],
        relationName: "email_verification_booking"
    }),
    spamAssessment: one(spamAssessments, {
        fields: [emailVerifications.spamAssessmentId],
        references: [spamAssessments.id],
        relationName: "email_verification_spam_assessment"
    }),
    organization: one(organizations, {
        fields: [emailVerifications.organizationId],
        references: [organizations.id],
        relationName: "email_verification_organization"
    }),
    detectedLanguageRef: one(supportedLanguages, {
        fields: [emailVerifications.detectedLanguage],
        references: [supportedLanguages.code],
        relationName: "email_verification_detected_language"
    }),
    preferredLanguageRef: one(supportedLanguages, {
        fields: [emailVerifications.preferredLanguage],
        references: [supportedLanguages.code],
        relationName: "email_verification_preferred_language"
    }),
}));

export const blockedEntitiesRelations = relations(blockedEntities, ({ one, many }) => ({
    organization: one(organizations, {
        fields: [blockedEntities.organizationId],
        references: [organizations.id],
        relationName: "blocked_entity_organization"
    }),
    team: one(teams, {
        fields: [blockedEntities.teamId],
        references: [teams.id],
        relationName: "blocked_entity_team"
    }),
    blockedBy: one(users, {
        fields: [blockedEntities.blockedBy],
        references: [users.id],
        relationName: "blocked_entity_blocked_by"
    }),
    reviewedBy: one(users, {
        fields: [blockedEntities.reviewedBy],
        references: [users.id],
        relationName: "blocked_entity_reviewed_by"
    }),
    translations: many(blockedEntityTranslations, {
        relationName: "blocked_entity_translations"
    }),
}));

export const spamPreventionAnalyticsRelations = relations(spamPreventionAnalytics, ({ one }) => ({
    user: one(users, {
        fields: [spamPreventionAnalytics.userId],
        references: [users.id],
        relationName: "spam_analytics_user"
    }),
    organization: one(organizations, {
        fields: [spamPreventionAnalytics.organizationId],
        references: [organizations.id],
        relationName: "spam_analytics_organization"
    }),
    form: one(forms, {
        fields: [spamPreventionAnalytics.formId],
        references: [forms.id],
        relationName: "spam_analytics_form"
    }),
}));

// Relations for translation tables
export const verificationMessageTranslationsRelations = relations(verificationMessageTranslations, ({ one }) => ({
    language: one(supportedLanguages, {
        fields: [verificationMessageTranslations.languageCode],
        references: [supportedLanguages.code],
        relationName: "verification_message_language"
    }),
}));

export const spamAssessmentTranslationsRelations = relations(spamAssessmentTranslations, ({ one }) => ({
    assessment: one(spamAssessments, {
        fields: [spamAssessmentTranslations.assessmentId],
        references: [spamAssessments.id],
        relationName: "spam_assessment_translation_assessment"
    }),
    language: one(supportedLanguages, {
        fields: [spamAssessmentTranslations.languageCode],
        references: [supportedLanguages.code],
        relationName: "spam_assessment_translation_language"
    }),
}));

export const blockedEntityTranslationsRelations = relations(blockedEntityTranslations, ({ one }) => ({
    blockedEntity: one(blockedEntities, {
        fields: [blockedEntityTranslations.blockedEntityId],
        references: [blockedEntities.id],
        relationName: "blocked_entity_translation_entity"
    }),
    language: one(supportedLanguages, {
        fields: [blockedEntityTranslations.languageCode],
        references: [supportedLanguages.code],
        relationName: "blocked_entity_translation_language"
    }),
}));

export const regionalSpamRulesRelations = relations(regionalSpamRules, ({ one }) => ({
    rule: one(spamDetectionRules, {
        fields: [regionalSpamRules.ruleId],
        references: [spamDetectionRules.id],
        relationName: "regional_spam_rule_parent"
    }),
}));
