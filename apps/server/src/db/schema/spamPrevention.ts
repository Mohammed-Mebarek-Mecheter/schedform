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
import { novuWorkflows, novuTriggers, novuSubscribers } from "@/db/schema/novu";

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
pgEnum("fraud_indicator", [
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

export const spamActionEnum = pgEnum("spam_action", [
    "allow",
    "block",
    "require_verification",
    "flag_for_review",
    "throttle",
    "challenge",
]);

/**
 * Spam Detection Engine Configuration
 */
export const spamEngineConfig = pgTable(
    "spam_engine_config",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),

        // Engine settings
        engineVersion: text("engine_version").notNull().default("v1.0"),
        isActive: boolean("is_active").notNull().default(true),
        confidenceThreshold: real("confidence_threshold").notNull().default(0.8),
        autoBlockThreshold: integer("auto_block_threshold").notNull().default(85),

        // Performance settings
        maxProcessingTime: integer("max_processing_time").notNull().default(100), // ms
        cacheEnabled: boolean("cache_enabled").notNull().default(true),
        cacheTtl: integer("cache_ttl").notNull().default(300), // seconds

        // Integration settings
        novuIntegrationEnabled: boolean("novu_integration_enabled").notNull().default(true),
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),
        novuVerificationWorkflowId: text("novu_verification_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),

        // Feature toggles
        mlEnabled: boolean("ml_enabled").notNull().default(true),
        reputationEnabled: boolean("reputation_enabled").notNull().default(true),
        behavioralAnalysisEnabled: boolean("behavioral_analysis_enabled").notNull().default(true),
        realTimeBlocking: boolean("real_time_blocking").notNull().default(true),

        // Notification settings
        adminAlertEnabled: boolean("admin_alert_enabled").notNull().default(true),
        adminAlertThreshold: integer("admin_alert_threshold").notNull().default(75),
        userNotificationEnabled: boolean("user_notification_enabled").notNull().default(true),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxOrgActive: index("spam_engine_config_org_active_idx").on(t.organizationId, t.isActive),
        uqOrgConfig: uniqueIndex("spam_engine_config_org_uq").on(t.organizationId).where(sql`${t.organizationId} IS NOT NULL`),

        chkConfidenceThreshold: sql`CHECK (${t.confidenceThreshold} >= 0 AND ${t.confidenceThreshold} <= 1)`,
        chkAutoBlockThreshold: sql`CHECK (${t.autoBlockThreshold} >= 0 AND ${t.autoBlockThreshold} <= 100)`,
        chkMaxProcessingTime: sql`CHECK (${t.maxProcessingTime} > 0 AND ${t.maxProcessingTime} <= 5000)`,
        chkCacheTtl: sql`CHECK (${t.cacheTtl} >= 0 AND ${t.cacheTtl} <= 3600)`,
        chkAdminAlertThreshold: sql`CHECK (${t.adminAlertThreshold} >= 0 AND ${t.adminAlertThreshold} <= 100)`,
    }),
);

/**
 * Spam Detection Rules - Enhanced with Novu integration
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

        // Primary action (our custom system)
        primaryAction: spamActionEnum("primary_action").notNull().default("require_verification"),
        blockSubmission: boolean("block_submission").notNull().default(false),
        requireVerification: boolean("require_verification").notNull().default(true),
        flagForReview: boolean("flag_for_review").notNull().default(false),

        // Novu integration actions
        novuNotificationEnabled: boolean("novu_notification_enabled").notNull().default(false),
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),
        novuNotificationTemplate: text("novu_notification_template"),
        notifyAdmin: boolean("notify_admin").notNull().default(false),
        notifyUser: boolean("notify_user").notNull().default(false),

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
        idxActiveGlobal: index("spam_detection_rules_active_global_idx")
            .on(t.isActive, t.isGlobal)
            .where(sql`${t.isActive} = true`),
        idxUserOrgForm: index("spam_detection_rules_user_org_form_idx")
            .on(t.userId, t.organizationId, t.formId)
            .where(sql`${t.userId} IS NOT NULL OR ${t.organizationId} IS NOT NULL OR ${t.formId} IS NOT NULL`),
        idxRuleType: index("spam_detection_rules_type_idx").on(t.ruleType, t.isActive),
        idxOrgActive: index("spam_detection_rules_org_active_idx").on(t.organizationId, t.isActive),

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
 * Spam Assessments - Enhanced with Novu integration tracking
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
        finalAction: spamActionEnum("final_action").notNull().default("allow"),

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

        // Novu integration tracking
        novuTriggerId: text("novu_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),
        novuVerificationTriggerId: text("novu_verification_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),
        novuSubscriberId: text("novu_subscriber_id").references(() => novuSubscribers.id, { onDelete: "set null" }),
        notificationStatus: text("notification_status").default("pending"),

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
        verificationStatus: verificationStatusEnum("verification_status").default("not_required"),

        // Processing performance
        processingTime: integer("processing_time"),
        rulesProcessed: integer("rules_processed"),
        engineVersion: text("engine_version").notNull().default("v1.0"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxFormResponse: index("spam_assessments_form_response_idx").on(t.formResponseId).where(sql`${t.formResponseId} IS NOT NULL`),
        idxBooking: index("spam_assessments_booking_idx").on(t.bookingId).where(sql`${t.bookingId} IS NOT NULL`),
        idxOrgSpamRisk: index("spam_assessments_org_spam_risk_idx").on(t.organizationId, t.spamScore, t.riskLevel, t.isSpam),
        idxReviewRequired: index("spam_assessments_review_required_idx").on(t.requiresReview, t.reviewStatus).where(sql`${t.requiresReview} = true`),
        idxCreatedScore: index("spam_assessments_created_score_idx").on(t.createdAt, t.spamScore),
        idxNovuTrigger: index("spam_assessments_novu_trigger_idx").on(t.novuTriggerId).where(sql`${t.novuTriggerId} IS NOT NULL`),

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
 * Email Verifications - Enhanced with Novu integration
 */
export const emailVerifications = pgTable(
    "email_verifications",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        spamAssessmentId: text("spam_assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),

        // Novu integration
        novuTriggerId: text("novu_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),
        novuMessageId: text("novu_message_id"),
        novuWorkflowId: text("novu_workflow_id").references(() => novuWorkflows.id, { onDelete: "set null" }),

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
        culturalContext: jsonb("cultural_context"),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqToken: uniqueIndex("email_verifications_token_uq").on(t.verificationToken),
        uqCode: uniqueIndex("email_verifications_code_uq").on(t.verificationCode).where(sql`${t.verificationCode} IS NOT NULL`),
        idxEmail: index("email_verifications_email_idx").on(t.email),
        idxStatusExpiry: index("email_verifications_status_expiry_idx").on(t.status, t.expiresAt),
        idxDeliveryStatus: index("email_verifications_delivery_idx").on(t.deliveryStatus, t.createdAt),
        idxOrgStatus: index("email_verifications_org_status_idx").on(t.organizationId, t.status),
        idxNovuTrigger: index("email_verifications_novu_trigger_idx").on(t.novuTriggerId).where(sql`${t.novuTriggerId} IS NOT NULL`),

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
 * Spam Prevention Events - Track all spam-related events for analytics
 */
export const spamPreventionEvents = pgTable(
    "spam_prevention_events",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
        assessmentId: text("assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),

        eventType: text("event_type").notNull(), // submission, verification, block, review, etc.
        eventSubtype: text("event_subtype"),
        severity: text("severity").notNull().default("info"),

        // Source information
        ipAddress: text("ip_address"),
        userAgent: text("user_agent"),
        country: text("country"),
        source: text("source").notNull().default("spam_engine"),

        // Event data
        payload: jsonb("payload"),
        metadata: jsonb("metadata"),

        // Novu integration
        novuTriggerId: text("novu_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),
        notificationSent: boolean("notification_sent").notNull().default(false),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        idxOrgEventType: index("spam_prevention_events_org_event_type_idx").on(t.organizationId, t.eventType, t.createdAt),
        idxFormCreated: index("spam_prevention_events_form_created_idx").on(t.formId, t.createdAt),
        idxSeverity: index("spam_prevention_events_severity_idx").on(t.severity, t.createdAt),
        idxAssessment: index("spam_prevention_events_assessment_idx").on(t.assessmentId).where(sql`${t.assessmentId} IS NOT NULL`),
    })
);

/**
 * Blocked Entities - Enhanced tracking
 */
export const blockedEntities = pgTable(
    "blocked_entities",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        entityType: text("entity_type").notNull(), // ip, email, phone, domain, user_agent
        entityValue: text("entity_value").notNull(),
        entityHash: text("entity_hash"),

        // Block configuration
        blockType: text("block_type").notNull(), // manual, automatic, temporary, permanent
        blockReason: blockReasonEnum("block_reason").notNull(),
        severity: integer("severity").notNull(),

        // Automatic blocking
        isAutomatic: boolean("is_automatic").notNull().default(false),
        autoBlockRule: text("auto_block_rule"),
        triggerThreshold: integer("trigger_threshold"),

        // Time-based blocking
        isTemporary: boolean("is_temporary").notNull().default(false),
        expiresAt: timestamp("expires_at", { mode: "date" }),
        autoUnblockAt: timestamp("auto_unblock_at", { mode: "date" }),

        // Geographic info
        country: varchar("country", { length: 2 }),
        region: text("region"),
        city: text("city"),
        isp: text("isp"),
        asn: integer("asn"),
        isVpn: boolean("is_vpn").notNull().default(false),
        isProxy: boolean("is_proxy").notNull().default(false),
        isTor: boolean("is_tor").notNull().default(false),
        isHosting: boolean("is_hosting").notNull().default(false),

        // Usage tracking
        totalAttempts: integer("total_attempts").notNull().default(0),
        blockedAttempts: integer("blocked_attempts").notNull().default(0),
        lastAttempt: timestamp("last_attempt", { mode: "date" }),
        lastBlocked: timestamp("last_blocked", { mode: "date" }),

        // Appeal process
        appealSubmitted: boolean("appeal_submitted").notNull().default(false),
        appealedAt: timestamp("appealed_at", { mode: "date" }),
        appealReason: text("appeal_reason"),
        appealStatus: text("appeal_status"),

        // Novu integration for appeal notifications
        novuAppealTriggerId: text("novu_appeal_trigger_id").references(() => novuTriggers.id, { onDelete: "set null" }),
        appealNotificationSent: boolean("appeal_notification_sent").notNull().default(false),

        reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
        blockedBy: text("blocked_by").references(() => users.id, { onDelete: "set null" }),
        isActive: boolean("is_active").notNull().default(true),

        // External data
        externalSources: jsonb("external_sources"),
        lastExternalUpdate: timestamp("last_external_update", { mode: "date" }),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
        updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqEntityTypeValue: uniqueIndex("blocked_entities_type_value_uq").on(t.entityType, t.entityValue),
        idxActiveType: index("blocked_entities_active_type_idx").on(t.isActive, t.entityType).where(sql`${t.isActive} = true`),
        idxExpiryActive: index("blocked_entities_expiry_active_idx").on(t.expiresAt, t.isActive).where(sql`${t.expiresAt} IS NOT NULL AND ${t.isActive} = true`),
        idxCountrySeverity: index("blocked_entities_country_severity_idx").on(t.country, t.severity).where(sql`${t.country} IS NOT NULL`),
        idxOrgTeam: index("blocked_entities_org_team_idx").on(t.organizationId, t.teamId),

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
        userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
        organizationId: text("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),

        // Core submission counts
        totalSubmissions: integer("total_submissions").notNull().default(0),
        legitimateSubmissions: integer("legitimate_submissions").notNull().default(0),
        spamSubmissions: integer("spam_submissions").notNull().default(0),
        blockedSubmissions: integer("blocked_submissions").notNull().default(0),
        flaggedSubmissions: integer("flagged_submissions").notNull().default(0),

        // Email verification statistics
        emailVerificationsRequested: integer("email_verifications_requested").notNull().default(0),
        emailVerificationsCompleted: integer("email_verifications_completed").notNull().default(0),

        // Novu integration metrics
        novuNotificationsSent: integer("novu_notifications_sent").notNull().default(0),
        novuVerificationsSent: integer("novu_verifications_sent").notNull().default(0),
        novuAdminAlertsSent: integer("novu_admin_alerts_sent").notNull().default(0),

        // Quality scores
        averageSpamScore: real("average_spam_score").notNull().default(0),
        averageQualityScore: real("average_quality_score").notNull().default(0),
        spamDetectionAccuracy: real("spam_detection_accuracy").notNull().default(0),
        falsePositiveRate: real("false_positive_rate").notNull().default(0),
        falseNegativeRate: real("false_negative_rate").notNull().default(0),

        // Performance metrics
        averageProcessingTime: integer("average_processing_time"),
        systemUptime: real("system_uptime").notNull().default(100),

        // Cost tracking
        verificationCosts: real("verification_costs").notNull().default(0),
        externalServiceCosts: real("external_service_costs").notNull().default(0),
        novuServiceCosts: real("novu_service_costs").notNull().default(0),

        createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    },
    (t) => ({
        uqDateOrg: uniqueIndex("spam_prevention_analytics_date_org_uq").on(t.date, t.organizationId).where(sql`${t.organizationId} IS NOT NULL`),
        uqDateForm: uniqueIndex("spam_prevention_analytics_date_form_uq").on(t.date, t.formId).where(sql`${t.formId} IS NOT NULL`),
        idxDate: index("spam_prevention_analytics_date_idx").on(t.date),
        idxAccuracy: index("spam_prevention_analytics_accuracy_idx").on(t.spamDetectionAccuracy, t.date),
        idxOrgDate: index("spam_prevention_analytics_org_date_idx").on(t.organizationId, t.date),

        chkTotalSubmissions: sql`CHECK (${t.totalSubmissions} >= 0)`,
        chkLegitimateSubmissions: sql`CHECK (${t.legitimateSubmissions} >= 0)`,
        chkSpamSubmissions: sql`CHECK (${t.spamSubmissions} >= 0)`,
        chkBlockedSubmissions: sql`CHECK (${t.blockedSubmissions} >= 0)`,
        chkFlaggedSubmissions: sql`CHECK (${t.flaggedSubmissions} >= 0)`,
        chkEmailVerificationsRequested: sql`CHECK (${t.emailVerificationsRequested} >= 0)`,
        chkEmailVerificationsCompleted: sql`CHECK (${t.emailVerificationsCompleted} >= 0)`,
        chkNovuMetrics: sql`CHECK (${t.novuNotificationsSent} >= 0 AND ${t.novuVerificationsSent} >= 0 AND ${t.novuAdminAlertsSent} >= 0)`,
        chkAverageSpamScore: sql`CHECK (${t.averageSpamScore} >= 0 AND ${t.averageSpamScore} <= 100)`,
        chkAverageQualityScore: sql`CHECK (${t.averageQualityScore} >= 0 AND ${t.averageQualityScore} <= 100)`,
        chkSpamDetectionAccuracy: sql`CHECK (${t.spamDetectionAccuracy} >= 0 AND ${t.spamDetectionAccuracy} <= 100)`,
        chkFalsePositiveRate: sql`CHECK (${t.falsePositiveRate} >= 0 AND ${t.falsePositiveRate} <= 100)`,
        chkFalseNegativeRate: sql`CHECK (${t.falseNegativeRate} >= 0 AND ${t.falseNegativeRate} <= 100)`,
        chkSystemUptime: sql`CHECK (${t.systemUptime} >= 0 AND ${t.systemUptime} <= 100)`,
        chkAverageProcessingTime: sql`CHECK (${t.averageProcessingTime} IS NULL OR ${t.averageProcessingTime} >= 0)`,
        chkCosts: sql`CHECK (${t.verificationCosts} >= 0 AND ${t.externalServiceCosts} >= 0 AND ${t.novuServiceCosts} >= 0)`,
    })
);

/* ============================
   Relations
   ============================ */

export const spamEngineConfigRelations = relations(spamEngineConfig, ({ one }) => ({
    organization: one(organizations, {
        fields: [spamEngineConfig.organizationId],
        references: [organizations.id],
        relationName: "spam_engine_config_organization"
    }),
    user: one(users, {
        fields: [spamEngineConfig.userId],
        references: [users.id],
        relationName: "spam_engine_config_user"
    }),
    novuWorkflow: one(novuWorkflows, {
        fields: [spamEngineConfig.novuWorkflowId],
        references: [novuWorkflows.id],
        relationName: "spam_engine_novu_workflow"
    }),
    novuVerificationWorkflow: one(novuWorkflows, {
        fields: [spamEngineConfig.novuVerificationWorkflowId],
        references: [novuWorkflows.id],
        relationName: "spam_engine_novu_verification_workflow"
    }),
}));

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
    novuWorkflow: one(novuWorkflows, {
        fields: [spamDetectionRules.novuWorkflowId],
        references: [novuWorkflows.id],
        relationName: "spam_detection_rule_novu_workflow"
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
    novuTrigger: one(novuTriggers, {
        fields: [spamAssessments.novuTriggerId],
        references: [novuTriggers.id],
        relationName: "spam_assessment_novu_trigger"
    }),
    novuVerificationTrigger: one(novuTriggers, {
        fields: [spamAssessments.novuVerificationTriggerId],
        references: [novuTriggers.id],
        relationName: "spam_assessment_novu_verification_trigger"
    }),
    novuSubscriber: one(novuSubscribers, {
        fields: [spamAssessments.novuSubscriberId],
        references: [novuSubscribers.id],
        relationName: "spam_assessment_novu_subscriber"
    }),
    emailVerifications: many(emailVerifications, {
        relationName: "spam_assessment_email_verifications"
    }),
    events: many(spamPreventionEvents, {
        relationName: "spam_assessment_events"
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
    novuTrigger: one(novuTriggers, {
        fields: [emailVerifications.novuTriggerId],
        references: [novuTriggers.id],
        relationName: "email_verification_novu_trigger"
    }),
    novuWorkflow: one(novuWorkflows, {
        fields: [emailVerifications.novuWorkflowId],
        references: [novuWorkflows.id],
        relationName: "email_verification_novu_workflow"
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

export const spamPreventionEventsRelations = relations(spamPreventionEvents, ({ one }) => ({
    organization: one(organizations, {
        fields: [spamPreventionEvents.organizationId],
        references: [organizations.id],
        relationName: "spam_prevention_event_organization"
    }),
    form: one(forms, {
        fields: [spamPreventionEvents.formId],
        references: [forms.id],
        relationName: "spam_prevention_event_form"
    }),
    assessment: one(spamAssessments, {
        fields: [spamPreventionEvents.assessmentId],
        references: [spamAssessments.id],
        relationName: "spam_prevention_event_assessment"
    }),
    novuTrigger: one(novuTriggers, {
        fields: [spamPreventionEvents.novuTriggerId],
        references: [novuTriggers.id],
        relationName: "spam_prevention_event_novu_trigger"
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
    novuAppealTrigger: one(novuTriggers, {
        fields: [blockedEntities.novuAppealTriggerId],
        references: [novuTriggers.id],
        relationName: "blocked_entity_novu_appeal_trigger"
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
