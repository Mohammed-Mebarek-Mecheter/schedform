// src/db/schema/whiteLabeling.ts
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
import { relations } from "drizzle-orm";
import { user } from "./auth";
import { teams } from "./business";

/**
 * Enums for white-labeling
 */
export const brandingTierEnum = pgEnum("branding_tier", [
    "basic",        // Logo and colors only
    "professional", // Custom CSS, fonts, advanced styling
    "enterprise",   // Full white-label, custom domains, API branding
]);

export const domainStatusEnum = pgEnum("domain_status", [
    "pending",      // Domain added but not verified
    "verified",     // Domain verified and active
    "failed",       // Verification failed
    "expired",      // SSL certificate expired
    "suspended",    // Domain suspended
]);

/**
 * Brand Configurations - Centralized branding settings per user/team
 */
export const brandConfigurations = pgTable(
    "brand_configurations",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),

        name: text("name").notNull(), // Configuration name (e.g., "Main Brand", "Client Brand")
        isDefault: boolean("is_default").notNull().default(false),
        isActive: boolean("is_active").notNull().default(true),

        // Basic branding
        brandName: text("brand_name"),
        logoUrl: text("logo_url"),
        faviconUrl: text("favicon_url"),

        // Color scheme
        primaryColor: text("primary_color").notNull().default("#3b82f6"),
        secondaryColor: text("secondary_color").default("#64748b"),
        accentColor: text("accent_color").default("#f59e0b"),
        backgroundColor: text("background_color").default("#ffffff"),
        textColor: text("text_color").default("#1f2937"),

        // Advanced styling (Professional+ tier)
        customCss: text("custom_css"),
        customJs: text("custom_js"),
        fontFamily: text("font_family").default("Inter, system-ui, sans-serif"),
        fontUrl: text("font_url"), // Google Fonts or custom font URL

        // Layout and UI preferences
        layoutStyle: text("layout_style").default("modern"), // modern, classic, minimal
        buttonStyle: text("button_style").default("rounded"), // rounded, square, pill
        formStyle: text("form_style").default("card"), // card, inline, full-width

        // Email branding
        emailLogoUrl: text("email_logo_url"),
        emailHeaderColor: text("email_header_color"),
        emailSignature: text("email_signature"),

        // Social media and contact
        website: text("website"),
        supportEmail: text("support_email"),
        socialLinks: jsonb("social_links"), // { twitter, linkedin, facebook, etc. }

        // Legal and compliance
        privacyPolicyUrl: text("privacy_policy_url"),
        termsOfServiceUrl: text("terms_of_service_url"),
        companyAddress: text("company_address"),

        // Custom messaging
        welcomeMessage: text("welcome_message"),
        thankYouMessage: text("thank_you_message"),
        footerText: text("footer_text"),

        // Advanced customization (Enterprise tier)
        customDomain: text("custom_domain"),
        whitelabelComplete: boolean("whitelabel_complete").notNull().default(false),
        hideSchedFormBranding: boolean("hide_sched_form_branding").notNull().default(true), // Free tier gets this!

        // Usage and analytics
        usageCount: integer("usage_count").notNull().default(0),
        lastUsed: timestamp("last_used"),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxUser: index("brand_configurations_user_idx").on(t.userId),
        idxTeam: index("brand_configurations_team_idx").on(t.teamId),
        uqUserDefault: uniqueIndex("brand_configurations_user_default_uq").on(t.userId, t.isDefault),
        idxCustomDomain: index("brand_configurations_domain_idx").on(t.customDomain),
    })
);

/**
 * Custom Domains - Track custom domain configurations
 */
export const customDomains = pgTable(
    "custom_domains",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
        brandConfigId: text("brand_config_id").references(() => brandConfigurations.id, { onDelete: "cascade" }),

        domain: text("domain").notNull(), // e.g., "book.clientdomain.com"
        subdomain: text("subdomain"), // e.g., "book" from above
        rootDomain: text("root_domain"), // e.g., "clientdomain.com"

        status: domainStatusEnum("status").notNull().default("pending"),

        // DNS configuration
        cnameTarget: text("cname_target"), // The CNAME record they need to create
        dnsRecords: jsonb("dns_records"), // Required DNS records

        // SSL configuration
        sslCertificate: text("ssl_certificate"),
        sslPrivateKey: text("ssl_private_key"), // Encrypted
        sslExpiresAt: timestamp("ssl_expires_at"),
        autoRenewSsl: boolean("auto_renew_ssl").notNull().default(true),

        // Verification
        verificationToken: text("verification_token"),
        verifiedAt: timestamp("verified_at"),
        lastVerificationAttempt: timestamp("last_verification_attempt"),
        verificationAttempts: integer("verification_attempts").notNull().default(0),
        verificationErrors: jsonb("verification_errors"),

        // Performance and monitoring
        lastHealthCheck: timestamp("last_health_check"),
        healthStatus: text("health_status"), // healthy, warning, error
        responseTime: integer("response_time"), // Average response time in ms
        uptime: integer("uptime"), // Percentage uptime

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        uqDomain: uniqueIndex("custom_domains_domain_uq").on(t.domain),
        idxUser: index("custom_domains_user_idx").on(t.userId),
        idxStatus: index("custom_domains_status_idx").on(t.status),
    })
);

/**
 * Brand Assets - Manage uploaded assets for branding
 */
export const brandAssets = pgTable(
    "brand_assets",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        brandConfigId: text("brand_config_id").notNull().references(() => brandConfigurations.id, { onDelete: "cascade" }),
        userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),

        assetType: text("asset_type").notNull(), // logo, favicon, background, font, icon
        fileName: text("file_name").notNull(),
        originalFileName: text("original_file_name"),
        fileUrl: text("file_url").notNull(),
        fileSize: integer("file_size"), // bytes
        mimeType: text("mime_type"),

        // Image-specific metadata
        width: integer("width"),
        height: integer("height"),
        altText: text("alt_text"),

        // Usage context
        usageContext: jsonb("usage_context"), // Where this asset is used
        isActive: boolean("is_active").notNull().default(true),

        // CDN and optimization
        cdnUrl: text("cdn_url"),
        optimizedVersions: jsonb("optimized_versions"), // Different sizes/formats

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxBrandConfig: index("brand_assets_brand_config_idx").on(t.brandConfigId),
        idxUser: index("brand_assets_user_idx").on(t.userId),
        idxAssetType: index("brand_assets_asset_type_idx").on(t.assetType),
    })
);

/**
 * White Label Templates - Pre-built branding templates
 */
export const whiteLabelTemplates = pgTable(
    "white_label_templates",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),

        name: text("name").notNull(),
        description: text("description"),
        category: text("category"), // business, creative, professional, minimal

        // Template configuration
        isPublic: boolean("is_public").notNull().default(true),
        isPremium: boolean("is_premium").notNull().default(false),
        requiredTier: brandingTierEnum("required_tier").default("basic"),

        // Branding settings (similar to brandConfigurations)
        templateData: jsonb("template_data").notNull(),

        // Assets included with template
        includedAssets: jsonb("included_assets"),

        // Usage and popularity
        usageCount: integer("usage_count").notNull().default(0),
        rating: integer("rating"), // Average rating 1-5
        ratingCount: integer("rating_count").notNull().default(0),

        // Template management
        createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
        isActive: boolean("is_active").notNull().default(true),

        createdAt: timestamp("created_at").notNull().defaultNow(),
        updatedAt: timestamp("updated_at").notNull().defaultNow(),
    },
    (t) => ({
        idxCategory: index("white_label_templates_category_idx").on(t.category),
        idxPublic: index("white_label_templates_public_idx").on(t.isPublic),
        idxRating: index("white_label_templates_rating_idx").on(t.rating),
    })
);

/**
 * Branding Usage Analytics - Track how branding is used
 */
export const brandingAnalytics = pgTable(
    "branding_analytics",
    {
        id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
        brandConfigId: text("brand_config_id").notNull().references(() => brandConfigurations.id, { onDelete: "cascade" }),

        date: timestamp("date").notNull(),

        // Page views with this branding
        pageViews: integer("page_views").notNull().default(0),
        uniqueVisitors: integer("unique_visitors").notNull().default(0),

        // Form interactions
        formViews: integer("form_views").notNull().default(0),
        formCompletions: integer("form_completions").notNull().default(0),

        // Booking interactions
        bookingPageViews: integer("booking_page_views").notNull().default(0),
        successfulBookings: integer("successful_bookings").notNull().default(0),

        // Custom domain performance (if applicable)
        domainPageViews: integer("domain_page_views").notNull().default(0),
        domainResponseTime: integer("domain_response_time"), // Average response time

        // Asset performance
        assetLoads: jsonb("asset_loads"), // Which assets were loaded and how often

        createdAt: timestamp("created_at").notNull().defaultNow(),
    },
    (t) => ({
        uqBrandDate: uniqueIndex("branding_analytics_brand_date_uq").on(t.brandConfigId, t.date),
        idxDate: index("branding_analytics_date_idx").on(t.date),
    })
);

/* ============================
   Relations
   ============================ */

export const brandConfigurationsRelations = relations(brandConfigurations, ({ one, many }) => ({
    owner: one(user, { fields: [brandConfigurations.userId], references: [user.id] }),
    team: one(teams, { fields: [brandConfigurations.teamId], references: [teams.id] }),

    customDomains: many(customDomains),
    brandAssets: many(brandAssets),
    analytics: many(brandingAnalytics),
}));

export const customDomainsRelations = relations(customDomains, ({ one }) => ({
    owner: one(user, { fields: [customDomains.userId], references: [user.id] }),
    brandConfig: one(brandConfigurations, { fields: [customDomains.brandConfigId], references: [brandConfigurations.id] }),
}));

export const brandAssetsRelations = relations(brandAssets, ({ one }) => ({
    brandConfig: one(brandConfigurations, { fields: [brandAssets.brandConfigId], references: [brandConfigurations.id] }),
    owner: one(user, { fields: [brandAssets.userId], references: [user.id] }),
}));

export const whiteLabelTemplatesRelations = relations(whiteLabelTemplates, ({ one }) => ({
    creator: one(user, { fields: [whiteLabelTemplates.createdBy], references: [user.id] }),
}));

export const brandingAnalyticsRelations = relations(brandingAnalytics, ({ one }) => ({
    brandConfig: one(brandConfigurations, { fields: [brandingAnalytics.brandConfigId], references: [brandConfigurations.id] }),
}));