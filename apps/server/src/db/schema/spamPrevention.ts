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
import { relations } from "drizzle-orm";
import { user } from "./auth";
import { forms, formResponses } from "./forms";
import { bookings } from "./scheduling";

/**
 * Enums for spam prevention and quality control
 */
export const spamRiskLevelEnum = pgEnum("spam_risk_level", [
    "very_low",
    "low",
    "medium",
    "high",
    "very_high",
    "critical", // Extreme spam risk requiring immediate blocking
]);

export const verificationStatusEnum = pgEnum("verification_status", [
    "not_required",
    "pending",
    "in_progress",
    "verified",
    "failed",
    "expired",
    "skipped", // Verification was skipped due to low risk
]);

export const reviewStatusEnum = pgEnum("review_status", [
    "pending",
    "approved",
    "rejected",
    "flagged",
    "escalated",
    "auto_approved", // Approved by automated system
    "requires_human", // Needs human review
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
    "impossible_speed", // Geographically impossible travel speed
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
    "sms_code",
    "phone_call",
    "captcha",
    "manual_review",
]);

/**
 * Spam Detection Rules - Configurable rules for different spam patterns
 */
export const spamDetectionRules = pgTable(
    "spam_detection_rules",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),

        name: text("name").notNull(),
        description: text("description"),
        isActive: boolean("is_active").notNull().default(true),
        isGlobal: boolean("is_global").notNull().default(false), // Applies to all forms

        // Rule configuration
        ruleType: text("rule_type").notNull(), // email_pattern, ip_range, velocity, ml_model, keyword, etc.
        conditions: jsonb("conditions").notNull(), // Rule-specific conditions
        severity: integer("severity").notNull().default(5), // 1-10 severity score
        confidence: real("confidence").notNull().default(0.8), // How confident we are in this rule

        // Actions to take when rule is triggered
        blockSubmission: boolean("block_submission").notNull().default(false),
        requireVerification: boolean("require_verification").notNull().default(true),
        flagForReview: boolean("flag_for_review").notNull().default(false),
        notifyAdmin: boolean("notify_admin").notNull().default(false),
        scoreAdjustment: integer("score_adjustment").notNull().default(0), // Adjust spam score by this amount

        // Rate limiting
        maxTriggersPerHour: integer("max_triggers_per_hour").default(100),
        maxTriggersPerDay: integer("max_triggers_per_day").default(1000),

        // Performance tracking
        totalTriggers: integer("total_triggers").notNull().default(0),
        falsePositives: integer("false_positives").notNull().default(0),
        truePositives: integer("true_positives").notNull().default(0),
        accuracy: real("accuracy").notNull().default(0),
        lastTriggered: timestamp("last_triggered"),

        // Rule management
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        lastModifiedBy: text("last_modified_by").references(() => user.id, { onDelete: "set null" }),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("spam_detection_rules_user_idx").on(t.userId),
        idxForm: index("spam_detection_rules_form_idx").on(t.formId),
        idxActive: index("spam_detection_rules_active_idx").on(t.isActive),
        idxGlobal: index("spam_detection_rules_global_idx").on(t.isGlobal),
        idxRuleType: index("spam_detection_rules_type_idx").on(t.ruleType),
    })
);

/**
 * Spam Assessments - Detailed spam analysis for each form response/booking
 */
export const spamAssessments = pgTable(
    "spam_assessments",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),

        // Overall assessment
        spamScore: integer("spam_score").notNull(), // 0-100
        riskLevel: spamRiskLevelEnum("risk_level").notNull(),
        isSpam: boolean("is_spam").notNull().default(false),
        confidence: real("confidence").notNull(), // 0-1

        // Specific indicators detected
        indicators: jsonb("indicators"), // Array of fraud indicators found
        rulesTriggered: jsonb("rules_triggered"), // Which detection rules were triggered
        riskFactors: jsonb("risk_factors"), // Detailed risk factor analysis

        // Technical analysis
        ipAnalysis: jsonb("ip_analysis"), // IP reputation, location, VPN detection
        emailAnalysis: jsonb("email_analysis"), // Email domain reputation, disposable email check
        phoneAnalysis: jsonb("phone_analysis"), // Phone validation, carrier info
        deviceAnalysis: jsonb("device_analysis"), // Device fingerprinting results
        behaviorAnalysis: jsonb("behavior_analysis"), // Behavioral patterns detected
        geolocationAnalysis: jsonb("geolocation_analysis"), // Location consistency check

        // ML model results
        mlModelVersion: text("ml_model_version"),
        mlFeatures: jsonb("ml_features"), // Features used for ML prediction
        mlPrediction: real("ml_prediction"), // Raw ML model output
        mlConfidence: real("ml_confidence"), // ML model confidence

        // Third-party service results
        externalChecks: jsonb("external_checks"), // Results from external fraud services
        ipReputationScore: integer("ip_reputation_score"), // 0-100 from IP reputation services
        emailReputationScore: integer("email_reputation_score"), // 0-100 from email reputation services

        // Manual review
        requiresReview: boolean("requires_review").notNull().default(false),
        reviewStatus: reviewStatusEnum("review_status"),
        reviewPriority: integer("review_priority").default(5), // 1-10, higher = more urgent
        reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
        reviewedAt: timestamp("reviewed_at"),
        reviewNotes: text("review_notes"),
        reviewDecision: text("review_decision"), // approved, rejected, needs_verification

        // Actions taken
        actionsTaken: jsonb("actions_taken"), // What was done based on this assessment
        blocked: boolean("blocked").notNull().default(false),
        blockedReason: blockReasonEnum("blocked_reason"),
        blockedAt: timestamp("blocked_at"),

        // Challenge/verification triggered
        verificationRequired: boolean("verification_required").notNull().default(false),
        verificationMethods: jsonb("verification_methods"), // Which verification methods were triggered

        // Processing performance
        processingTime: integer("processing_time"), // Milliseconds to complete assessment
        rulesProcessed: integer("rules_processed"), // Number of rules checked

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormResponse: index("spam_assessments_form_response_idx").on(t.formResponseId),
        idxBooking: index("spam_assessments_booking_idx").on(t.bookingId),
        idxSpamScore: index("spam_assessments_spam_score_idx").on(t.spamScore),
        idxRiskLevel: index("spam_assessments_risk_level_idx").on(t.riskLevel),
        idxReview: index("spam_assessments_review_idx").on(t.requiresReview, t.reviewStatus),
        idxBlocked: index("spam_assessments_blocked_idx").on(t.blocked),
        idxCreatedAt: index("spam_assessments_created_at_idx").on(t.createdAt),
    })
);

/**
 * Email Verifications - Track email verification process
 */
export const emailVerifications = pgTable(
    "email_verifications",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        spamAssessmentId: text("spam_assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),

        email: text("email").notNull(),
        verificationToken: text("verification_token").notNull(),
        verificationCode: varchar("verification_code", { length: 10 }), // For code-based verification

        status: verificationStatusEnum("status").notNull().default("pending"),
        method: verificationMethodEnum("method").notNull().default("email_link"),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(3),

        sentAt: timestamp("sent_at"),
        verifiedAt: timestamp("verified_at"),
        expiresAt: timestamp("expires_at").notNull(),

        // Email provider analysis
        emailProvider: text("email_provider"), // gmail, outlook, yahoo, etc.
        isDisposableEmail: boolean("is_disposable_email").notNull().default(false),
        emailDomainAge: integer("email_domain_age"), // Days since domain registration
        emailDomainReputation: integer("email_domain_reputation"), // 0-100

        // Delivery tracking
        deliveryStatus: text("delivery_status"), // delivered, bounced, deferred, rejected
        deliveryError: text("delivery_error"),
        deliveryAttempts: integer("delivery_attempts").notNull().default(0),
        bounceCategory: text("bounce_category"), // hard_bounce, soft_bounce, spam_complaint

        // Security and fraud prevention
        verificationIP: varchar("verification_ip", { length: 45 }),
        verificationUserAgent: text("verification_user_agent"),
        verificationLocation: jsonb("verification_location"),
        browserFingerprint: text("browser_fingerprint"),

        // Rate limiting and abuse prevention
        dailyVerificationCount: integer("daily_verification_count").notNull().default(1),
        isRateLimited: boolean("is_rate_limited").notNull().default(false),

        // External service tracking
        emailServiceProvider: text("email_service_provider"), // brevo, sendgrid, etc.
        externalMessageId: text("external_message_id"),
        emailCost: real("email_cost"), // Cost tracking for billing

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqToken: uniqueIndex("email_verifications_token_uq").on(t.verificationToken),
        uqCode: uniqueIndex("email_verifications_code_uq").on(t.verificationCode),
        idxEmail: index("email_verifications_email_idx").on(t.email),
        idxStatus: index("email_verifications_status_idx").on(t.status),
        idxExpiry: index("email_verifications_expiry_idx").on(t.expiresAt),
        idxDeliveryStatus: index("email_verifications_delivery_idx").on(t.deliveryStatus),
        idxRateLimit: index("email_verifications_rate_limit_idx").on(t.isRateLimited),
    })
);

/**
 * SMS Verifications - Track SMS verification process
 */
export const smsVerifications = pgTable(
    "sms_verifications",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        spamAssessmentId: text("spam_assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),

        phone: text("phone").notNull(),
        normalizedPhone: text("normalized_phone").notNull(), // E.164 format
        verificationCode: varchar("verification_code", { length: 10 }).notNull(),

        status: verificationStatusEnum("status").notNull().default("pending"),
        method: verificationMethodEnum("method").notNull().default("sms_code"),
        attempts: integer("attempts").notNull().default(0),
        maxAttempts: integer("max_attempts").notNull().default(3),

        sentAt: timestamp("sent_at"),
        verifiedAt: timestamp("verified_at"),
        expiresAt: timestamp("expires_at").notNull(),

        // Phone analysis and validation
        phoneCarrier: text("phone_carrier"),
        phoneType: text("phone_type"), // mobile, landline, voip, toll_free
        phoneCountry: varchar("phone_country", { length: 2 }),
        phoneRegion: text("phone_region"),
        isValidPhone: boolean("is_valid_phone").notNull().default(true),
        isRiskyPhone: boolean("is_risky_phone").notNull().default(false),
        phoneReputationScore: integer("phone_reputation_score"), // 0-100

        // Delivery tracking
        smsProvider: text("sms_provider"), // twilio, etc.
        deliveryStatus: text("delivery_status"), // delivered, failed, undelivered
        deliveryError: text("delivery_error"),
        deliveryAttempts: integer("delivery_attempts").notNull().default(0),
        smsCost: real("sms_cost"), // Cost tracking

        // Security and fraud prevention
        verificationIP: varchar("verification_ip", { length: 45 }),
        verificationUserAgent: text("verification_user_agent"),
        verificationLocation: jsonb("verification_location"),

        // Rate limiting and abuse prevention
        dailyVerificationCount: integer("daily_verification_count").notNull().default(1),
        isRateLimited: boolean("is_rate_limited").notNull().default(false),

        // External service tracking
        externalMessageId: text("external_message_id"),
        messageSegments: integer("message_segments").default(1),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxPhone: index("sms_verifications_phone_idx").on(t.normalizedPhone),
        idxStatus: index("sms_verifications_status_idx").on(t.status),
        idxExpiry: index("sms_verifications_expiry_idx").on(t.expiresAt),
        idxCarrier: index("sms_verifications_carrier_idx").on(t.phoneCarrier),
        idxCountry: index("sms_verifications_country_idx").on(t.phoneCountry),
        idxRateLimit: index("sms_verifications_rate_limit_idx").on(t.isRateLimited),
    })
);

/**
 * Blocked Entities - Track IPs, emails, phones that should be blocked
 */
export const blockedEntities = pgTable(
    "blocked_entities",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        entityType: text("entity_type").notNull(), // ip, email, phone, domain, user_agent
        entityValue: text("entity_value").notNull(),
        entityHash: text("entity_hash"), // Hashed version for privacy

        // Block configuration
        blockType: text("block_type").notNull(), // manual, automatic, temporary, permanent
        blockReason: blockReasonEnum("block_reason").notNull(),
        severity: integer("severity").notNull(), // 1-10
        description: text("description"),

        // Automatic blocking criteria
        isAutomatic: boolean("is_automatic").notNull().default(false),
        autoBlockRule: text("auto_block_rule"), // Which rule triggered the block
        triggerThreshold: integer("trigger_threshold"), // Threshold that was exceeded

        // Time-based blocking
        isTemporary: boolean("is_temporary").notNull().default(false),
        expiresAt: timestamp("expires_at"),
        autoUnblockAt: timestamp("auto_unblock_at"),

        // Geographic and network info (for IPs)
        country: varchar("country", { length: 2 }),
        region: text("region"),
        city: text("city"),
        isp: text("isp"),
        asn: integer("asn"), // Autonomous System Number
        isVpn: boolean("is_vpn").notNull().default(false),
        isProxy: boolean("is_proxy").notNull().default(false),
        isTor: boolean("is_tor").notNull().default(false),
        isHosting: boolean("is_hosting").notNull().default(false),

        // Usage and impact tracking
        totalAttempts: integer("total_attempts").notNull().default(0),
        blockedAttempts: integer("blocked_attempts").notNull().default(0),
        lastAttempt: timestamp("last_attempt"),
        lastBlocked: timestamp("last_blocked"),

        // Appeal and review process
        appealSubmitted: boolean("appeal_submitted").notNull().default(false),
        appealedAt: timestamp("appealed_at"),
        appealReason: text("appeal_reason"),
        appealStatus: text("appeal_status"), // pending, approved, rejected
        reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),

        // Management
        blockedBy: text("blocked_by").references(() => user.id, { onDelete: "set null" }),
        isActive: boolean("is_active").notNull().default(true),

        // External data sources
        externalSources: jsonb("external_sources"), // Which external services flagged this
        lastExternalUpdate: timestamp("last_external_update"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqEntityTypeValue: uniqueIndex("blocked_entities_type_value_uq").on(t.entityType, t.entityValue),
        idxEntityType: index("blocked_entities_type_idx").on(t.entityType),
        idxCountry: index("blocked_entities_country_idx").on(t.country),
        idxActive: index("blocked_entities_active_idx").on(t.isActive),
        idxExpiry: index("blocked_entities_expiry_idx").on(t.expiresAt),
        idxSeverity: index("blocked_entities_severity_idx").on(t.severity),
    })
);

/**
 * Quality Scores - Historical quality scoring for continuous improvement and ML training
 */
export const qualityScores = pgTable(
    "quality_scores",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        formResponseId: text("form_response_id").references(() => formResponses.id, { onDelete: "cascade" }),
        bookingId: text("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
        spamAssessmentId: text("spam_assessment_id").references(() => spamAssessments.id, { onDelete: "cascade" }),

        // Overall quality score
        overallScore: integer("overall_score").notNull(), // 0-100

        // Score breakdown by category
        completenessScore: integer("completeness_score"), // How complete was the submission
        consistencyScore: integer("consistency_score"), // How consistent were the answers
        relevanceScore: integer("relevance_score"), // How relevant to the business
        urgencyScore: integer("urgency_score"), // How urgent is their need
        budgetScore: integer("budget_score"), // Budget fit assessment
        authorityScore: integer("authority_score"), // Decision-making authority
        needScore: integer("need_score"), // How much they need the solution
        timelineScore: integer("timeline_score"), // Realistic timeline assessment

        // AI analysis details
        aiAnalysisVersion: text("ai_analysis_version"),
        aiModelVersion: text("ai_model_version"),
        aiConfidence: real("ai_confidence"), // 0-1
        aiReasoningSteps: jsonb("ai_reasoning_steps"), // Step-by-step AI reasoning
        aiFeatures: jsonb("ai_features"), // Features used in scoring

        // Qualification criteria matching
        qualificationCriteriaMet: jsonb("qualification_criteria_met"), // Which criteria were met
        qualificationGaps: jsonb("qualification_gaps"), // What was missing
        improvementSuggestions: jsonb("improvement_suggestions"),

        // Manual overrides and validation
        manualOverride: boolean("manual_override").notNull().default(false),
        originalScore: integer("original_score"), // Score before manual override
        overrideReason: text("override_reason"),
        overrideBy: text("override_by").references(() => user.id, { onDelete: "set null" }),
        overrideAt: timestamp("override_at"),

        // Outcome validation (for training feedback loops)
        actualOutcome: text("actual_outcome"), // What actually happened in the meeting
        outcomeRecorded: boolean("outcome_recorded").notNull().default(false),
        outcomeRecordedAt: timestamp("outcome_recorded_at"),
        predictionAccuracy: real("prediction_accuracy"), // How accurate was our scoring (0-1)

        // Business impact tracking
        dealValue: real("deal_value"), // Actual or potential deal value
        dealClosed: boolean("deal_closed").notNull().default(false),
        timeToClose: integer("time_to_close"), // Days from first contact to close
        customerLifetimeValue: real("customer_lifetime_value"),

        // Learning and improvement
        usedForTraining: boolean("used_for_training").notNull().default(false),
        trainingWeight: real("training_weight").default(1.0), // Weight in ML training
        dataQualityScore: integer("data_quality_score"), // Quality of the data for training

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxFormResponse: index("quality_scores_form_response_idx").on(t.formResponseId),
        idxBooking: index("quality_scores_booking_idx").on(t.bookingId),
        idxOverallScore: index("quality_scores_overall_idx").on(t.overallScore),
        idxManualOverride: index("quality_scores_override_idx").on(t.manualOverride),
        idxOutcome: index("quality_scores_outcome_idx").on(t.actualOutcome),
        idxTraining: index("quality_scores_training_idx").on(t.usedForTraining),
        idxAccuracy: index("quality_scores_accuracy_idx").on(t.predictionAccuracy),
    })
);

/**
 * Fraud Patterns - Track and learn from fraud patterns for ML and rule improvement
 */
export const fraudPatterns = pgTable(
    "fraud_patterns",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        patternType: text("pattern_type").notNull(), // email, phone, behavior, timing, content, network
        patternName: text("pattern_name").notNull(),
        patternData: jsonb("pattern_data").notNull(), // The actual pattern definition
        patternHash: text("pattern_hash").notNull(), // Hash of pattern for deduplication

        // Pattern effectiveness metrics
        confidence: real("confidence").notNull(), // 0-1, how confident we are this indicates fraud
        accuracy: real("accuracy").notNull().default(0), // Historical accuracy rate
        precision: real("precision").notNull().default(0), // Precision rate (true positives / all positives)
        recall: real("recall").notNull().default(0), // Recall rate (true positives / all actual fraud)
        f1Score: real("f1_score").notNull().default(0), // F1 score for balanced evaluation

        // Usage statistics
        totalMatches: integer("total_matches").notNull().default(0),
        truePositives: integer("true_positives").notNull().default(0),
        falsePositives: integer("false_positives").notNull().default(0),
        falseNegatives: integer("false_negatives").notNull().default(0),

        // Time-based tracking
        firstSeen: timestamp("first_seen").notNull().defaultNow(),
        lastSeen: timestamp("last_seen").notNull().defaultNow(),
        lastEvaluated: timestamp("last_evaluated"),

        // Pattern lifecycle
        isActive: boolean("is_active").notNull().default(true),
        isDeprecated: boolean("is_deprecated").notNull().default(false),
        deprecationReason: text("deprecation_reason"),
        severity: integer("severity").notNull().default(5), // 1-10
        riskWeight: real("risk_weight").notNull().default(1.0),

        // Machine learning integration
        learnedFromData: boolean("learned_from_data").notNull().default(true),
        mlModelGenerated: boolean("ml_model_generated").notNull().default(false),
        humanValidated: boolean("human_validated").notNull().default(false),
        validatedBy: text("validated_by").references(() => user.id, { onDelete: "set null" }),
        validatedAt: timestamp("validated_at"),

        // Pattern evolution
        parentPatternId: text("parent_pattern_id").references(() => fraudPatterns.id, { onDelete: "set null" }),
        evolutionGeneration: integer("evolution_generation").default(1),

        // External validation
        externalValidation: jsonb("external_validation"), // Validation from external sources
        industryRelevance: jsonb("industry_relevance"), // Which industries this applies to

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqPatternHash: uniqueIndex("fraud_patterns_hash_uq").on(t.patternHash),
        idxPatternType: index("fraud_patterns_type_idx").on(t.patternType),
        idxConfidence: index("fraud_patterns_confidence_idx").on(t.confidence),
        idxAccuracy: index("fraud_patterns_accuracy_idx").on(t.accuracy),
        idxActive: index("fraud_patterns_active_idx").on(t.isActive),
        idxSeverity: index("fraud_patterns_severity_idx").on(t.severity),
        idxParent: index("fraud_patterns_parent_idx").on(t.parentPatternId),
    })
);

/**
 * Spam Prevention Analytics - Track spam prevention performance and trends
 */
export const spamPreventionAnalytics = pgTable(
    "spam_prevention_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        date: timestamp("date").notNull(),
        userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),

        // Submission counts
        totalSubmissions: integer("total_submissions").notNull().default(0),
        legitimateSubmissions: integer("legitimate_submissions").notNull().default(0),
        spamSubmissions: integer("spam_submissions").notNull().default(0),
        blockedSubmissions: integer("blocked_submissions").notNull().default(0),
        flaggedSubmissions: integer("flagged_submissions").notNull().default(0),

        // Verification statistics
        emailVerificationsRequested: integer("email_verifications_requested").notNull().default(0),
        emailVerificationsCompleted: integer("email_verifications_completed").notNull().default(0),
        smsVerificationsRequested: integer("sms_verifications_requested").notNull().default(0),
        smsVerificationsCompleted: integer("sms_verifications_completed").notNull().default(0),

        // Quality scores
        averageSpamScore: real("average_spam_score").notNull().default(0),
        averageQualityScore: real("average_quality_score").notNull().default(0),
        spamDetectionAccuracy: real("spam_detection_accuracy").notNull().default(0),
        falsePositiveRate: real("false_positive_rate").notNull().default(0),
        falseNegativeRate: real("false_negative_rate").notNull().default(0),

        // Rule performance
        rulesTriggered: jsonb("rules_triggered"), // Which rules fired and how often
        topFraudIndicators: jsonb("top_fraud_indicators"), // Most common indicators

        // Geographic and network insights
        topSpamCountries: jsonb("top_spam_countries"),
        topSpamIsps: jsonb("top_spam_isps"),
        vpnTrafficPercentage: real("vpn_traffic_percentage").notNull().default(0),

        // Manual review workload
        manualReviewsRequired: integer("manual_reviews_required").notNull().default(0),
        manualReviewsCompleted: integer("manual_reviews_completed").notNull().default(0),
        averageReviewTime: integer("average_review_time"), // Minutes per review

        // Cost tracking
        verificationCosts: real("verification_costs").notNull().default(0), // SMS/email costs
        externalServiceCosts: real("external_service_costs").notNull().default(0), // Third-party API costs

        // Performance metrics
        averageProcessingTime: integer("average_processing_time"), // Milliseconds
        systemUptime: real("system_uptime").notNull().default(100), // Percentage

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqDateUser: uniqueIndex("spam_prevention_analytics_date_user_uq").on(t.date, t.userId),
        uqDateForm: uniqueIndex("spam_prevention_analytics_date_form_uq").on(t.date, t.formId),
        idxDate: index("spam_prevention_analytics_date_idx").on(t.date),
        idxAccuracy: index("spam_prevention_analytics_accuracy_idx").on(t.spamDetectionAccuracy),
    })
);

/**
 * Verification Attempts - Track all verification attempts for rate limiting and abuse detection
 */
export const verificationAttempts = pgTable(
    "verification_attempts",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        // What was being verified
        entityType: text("entity_type").notNull(), // email, phone
        entityValue: text("entity_value").notNull(), // The email or phone
        entityHash: text("entity_hash"), // Hashed version for privacy

        // Attempt details
        verificationType: verificationMethodEnum("verification_type").notNull(),
        attemptResult: text("attempt_result").notNull(), // sent, failed, verified, expired

        // Rate limiting context
        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),
        sessionId: text("session_id"),

        // Timing for rate limiting
        attemptWindow: timestamp("attempt_window").notNull(), // Rounded to hour for rate limiting
        dailyAttemptCount: integer("daily_attempt_count").notNull().default(1),
        hourlyAttemptCount: integer("hourly_attempt_count").notNull().default(1),

        // Cost and resource tracking
        processingCost: real("processing_cost"), // Cost of this attempt
        externalServiceUsed: text("external_service_used"), // Which service was used

        // Abuse detection
        suspiciousActivity: boolean("suspicious_activity").notNull().default(false),
        abuseScore: integer("abuse_score").default(0), // 0-100

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxEntityType: index("verification_attempts_entity_type_idx").on(t.entityType, t.entityValue),
        idxIP: index("verification_attempts_ip_idx").on(t.ipAddress),
        idxWindow: index("verification_attempts_window_idx").on(t.attemptWindow),
        idxSuspicious: index("verification_attempts_suspicious_idx").on(t.suspiciousActivity),
    })
);

/**
 * Honeypot Fields - Track honeypot field interactions for bot detection
 */
export const honeypotInteractions = pgTable(
    "honeypot_interactions",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        formId: text("form_id").references(() => forms.id, { onDelete: "cascade" }),
        sessionId: text("session_id").notNull(),

        // Honeypot field details
        fieldName: text("field_name").notNull(), // Name of the honeypot field
        fieldValue: text("field_value"), // What the bot filled in
        fieldType: text("field_type").notNull(), // hidden, invisible, time_trap

        // Bot behavior indicators
        fillTime: integer("fill_time"), // How quickly field was filled (milliseconds)
        interactionCount: integer("interaction_count").default(1),

        // Technical details
        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),
        referrer: text("referrer"),

        // Browser behavior analysis
        mouseMovements: integer("mouse_movements").default(0),
        keyboardEvents: integer("keyboard_events").default(0),
        scrollEvents: integer("scroll_events").default(0),

        // Bot detection confidence
        botConfidence: real("bot_confidence").notNull().default(1.0), // 0-1
        botIndicators: jsonb("bot_indicators"), // Specific bot indicators detected

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        idxForm: index("honeypot_interactions_form_idx").on(t.formId),
        idxSession: index("honeypot_interactions_session_idx").on(t.sessionId),
        idxIP: index("honeypot_interactions_ip_idx").on(t.ipAddress),
        idxConfidence: index("honeypot_interactions_confidence_idx").on(t.botConfidence),
    })
);

/* ============================
   Relations
   ============================ */

export const spamDetectionRulesRelations = relations(spamDetectionRules, ({ one }) => ({
    owner: one(user, { fields: [spamDetectionRules.userId], references: [user.id] }),
    form: one(forms, { fields: [spamDetectionRules.formId], references: [forms.id] }),
    creator: one(user, { fields: [spamDetectionRules.createdBy], references: [user.id] }),
    lastModifier: one(user, { fields: [spamDetectionRules.lastModifiedBy], references: [user.id] }),
}));

export const spamAssessmentsRelations = relations(spamAssessments, ({ one }) => ({
    formResponse: one(formResponses, { fields: [spamAssessments.formResponseId], references: [formResponses.id] }),
    booking: one(bookings, { fields: [spamAssessments.bookingId], references: [bookings.id] }),
    reviewer: one(user, { fields: [spamAssessments.reviewedBy], references: [user.id] }),
}));

export const emailVerificationsRelations = relations(emailVerifications, ({ one }) => ({
    formResponse: one(formResponses, { fields: [emailVerifications.formResponseId], references: [formResponses.id] }),
    booking: one(bookings, { fields: [emailVerifications.bookingId], references: [bookings.id] }),
    spamAssessment: one(spamAssessments, { fields: [emailVerifications.spamAssessmentId], references: [spamAssessments.id] }),
}));

export const smsVerificationsRelations = relations(smsVerifications, ({ one }) => ({
    formResponse: one(formResponses, { fields: [smsVerifications.formResponseId], references: [formResponses.id] }),
    booking: one(bookings, { fields: [smsVerifications.bookingId], references: [bookings.id] }),
    spamAssessment: one(spamAssessments, { fields: [smsVerifications.spamAssessmentId], references: [spamAssessments.id] }),
}));

export const blockedEntitiesRelations = relations(blockedEntities, ({ one }) => ({
    blockedBy: one(user, { fields: [blockedEntities.blockedBy], references: [user.id] }),
    reviewedBy: one(user, { fields: [blockedEntities.reviewedBy], references: [user.id] }),
}));

export const qualityScoresRelations = relations(qualityScores, ({ one }) => ({
    formResponse: one(formResponses, { fields: [qualityScores.formResponseId], references: [formResponses.id] }),
    booking: one(bookings, { fields: [qualityScores.bookingId], references: [bookings.id] }),
    spamAssessment: one(spamAssessments, { fields: [qualityScores.spamAssessmentId], references: [spamAssessments.id] }),
    overrideBy: one(user, { fields: [qualityScores.overrideBy], references: [user.id] }),
}));

export const fraudPatternsRelations = relations(fraudPatterns, ({ one, many }) => ({
    validator: one(user, { fields: [fraudPatterns.validatedBy], references: [user.id] }),
    parentPattern: one(fraudPatterns, { fields: [fraudPatterns.parentPatternId], references: [fraudPatterns.id] }),
    childPatterns: many(fraudPatterns),
}));

export const spamPreventionAnalyticsRelations = relations(spamPreventionAnalytics, ({ one }) => ({
    user: one(user, { fields: [spamPreventionAnalytics.userId], references: [user.id] }),
    form: one(forms, { fields: [spamPreventionAnalytics.formId], references: [forms.id] }),
}));

export const verificationAttemptsRelations = relations(verificationAttempts, ({ }) => ({
    // No direct relations, this is primarily for analytics and rate limiting
}));

export const honeypotInteractionsRelations = relations(honeypotInteractions, ({ one }) => ({
    form: one(forms, { fields: [honeypotInteractions.formId], references: [forms.id] }),
}));