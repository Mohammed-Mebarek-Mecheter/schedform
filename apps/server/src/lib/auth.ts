// lib/auth.ts
import { betterAuth, type BetterAuthOptions } from "better-auth";
import {schema, withCloudflare} from "better-auth-cloudflare";
import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import {
    organization,
    bearer,
    jwt,
    twoFactor,
    admin as adminPlugin,
    emailOTP,
    haveIBeenPwned,
    captcha,
    apiKey,
    multiSession,
    phoneNumber
} from "better-auth/plugins";
import { polarClient } from "./payments";
import { createDbWithHyperdrive, db as defaultDb } from "@/db";
import { env } from "./env";
import "dotenv/config";
import { sendOrganizationInvitation, sendEmailOTP, sendWelcomeEmail } from "./email";
import { createAccessControl } from "better-auth/plugins/access";

// Additional plugin imports
import { localization } from "better-auth-localization";
import { validator } from "validation-better-auth";
import { emailHarmony, phoneHarmony } from "better-auth-harmony";
import { z } from "zod";
import {drizzleAdapter} from "better-auth/adapters/drizzle";

// Create access control for SchedForm's permissions
const schedFormStatement = {
    // Core business objects
    organization: ["create", "read", "update", "delete"],
    member: ["create", "read", "update", "delete"],
    invitation: ["create", "read", "cancel", "delete"],

    // Form management
    form: ["create", "read", "update", "delete", "publish", "archive"],
    form_response: ["read", "export", "delete"],

    // Scheduling
    event_type: ["create", "read", "update", "delete", "publish"],
    booking: ["create", "read", "update", "cancel", "reschedule"],
    calendar: ["connect", "read", "update", "disconnect"],

    // Team features
    team: ["create", "read", "update", "delete", "assign_members"],
    team_member: ["add", "remove", "update_role"],

    // Workflows and automation
    workflow: ["create", "read", "update", "delete", "activate", "deactivate"],
    integration: ["create", "read", "update", "delete", "connect"],

    // Analytics and insights
    analytics: ["read", "export"],
    ai_insights: ["read", "generate"],

    // Billing and subscription
    subscription: ["read", "update", "cancel"],
    billing: ["read", "update"],

    // White-labeling
    branding: ["read", "update"],
    custom_domain: ["create", "read", "update", "delete"],

    // Access control (for dynamic roles)
    ac: ["create", "read", "update", "delete"],
} as const;

const ac = createAccessControl(schedFormStatement);

// Define roles with appropriate permissions
const memberRole = ac.newRole({
    // Basic form management
    form: ["create", "read", "update"],
    form_response: ["read"],

    // Basic scheduling
    event_type: ["create", "read", "update"],
    booking: ["read", "update", "cancel"],
    calendar: ["connect", "read", "update"],

    // Limited team access
    team: ["read"],
    team_member: ["add", "remove", "update_role"],

    // Basic workflows
    workflow: ["create", "read", "update"],
    integration: ["read"],

    // Analytics viewing
    analytics: ["read"],
    ai_insights: ["read"],

    // Basic branding
    branding: ["read"],
});

const adminRole = ac.newRole({
    // Full form management
    form: ["create", "read", "update", "delete", "publish", "archive"],
    form_response: ["read", "export", "delete"],

    // Full scheduling
    event_type: ["create", "read", "update", "delete", "publish"],
    booking: ["create", "read", "update", "cancel", "reschedule"],
    calendar: ["connect", "read", "update", "disconnect"],

    // Team management
    team: ["create", "read", "update", "delete", "assign_members"],
    team_member: ["add", "remove", "update_role"],

    // Full workflow management
    workflow: ["create", "read", "update", "delete", "activate", "deactivate"],
    integration: ["create", "read", "update", "delete", "connect"],

    // Full analytics access
    analytics: ["read", "export"],
    ai_insights: ["read", "generate"],

    // Member management
    member: ["create", "read", "update", "delete"],
    invitation: ["create", "read", "cancel", "delete"],

    // Organization management (but not delete)
    organization: ["read", "update"],

    // Advanced branding
    branding: ["read", "update"],
    custom_domain: ["create", "read", "update", "delete"],

    // Dynamic access control
    ac: ["create", "read", "update", "delete"],
});

const ownerRole = ac.newRole({
    // All admin permissions
    ...adminRole.statements,

    // Additional owner permissions
    subscription: ["read", "update", "cancel"],
    billing: ["read", "update"],
});

// Custom roles for specific use cases
const viewerRole = ac.newRole({
    // Read-only access to most resources
    form: ["read"],
    form_response: ["read"],
    event_type: ["read"],
    booking: ["read"],
    team: ["read"],
    team_member: ["add", "remove", "update_role"],
    analytics: ["read"],
    member: ["read"],
});

const managerRole = ac.newRole({
    // Between admin and member - can manage workflows and teams but not billing
    ...adminRole.statements,
    // Override sensitive permissions
    subscription: [], // No billing access
    billing: [], // No billing access
});

// Validation schemas for endpoints
const SignupSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    image: z.url().optional(),
});

const SignInSchema = z.object({
    email: z.email("Invalid email address"),
    password: z.string().min(1, "Password is required"),
    callbackURL: z.url().optional(),
});

const ForgotPasswordSchema = z.object({
    email: z.email("Invalid email address"),
    redirectTo: z.url().optional(),
});

const ResetPasswordSchema = z.object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    token: z.string().min(1, "Reset token is required"),
});

const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

const UpdateUserSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    image: z.url().optional(),
});

const EmailOTPSchema = z.object({
    email: z.email("Invalid email address"),
});

const VerifyEmailOTPSchema = z.object({
    email: z.email("Invalid email address"),
    otp: z.string().length(6, "OTP must be 6 digits"),
});

const PhoneOTPSchema = z.object({
    phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
});

const VerifyPhoneOTPSchema = z.object({
    phoneNumber: z.string().min(10, "Phone number must be at least 10 digits"),
    otp: z.string().length(6, "OTP must be 6 digits"),
});

// Helper functions for organization management
interface SubscriptionData {
    planType: "free" | "starter" | "professional" | "business";
}

async function getOrganizationSubscription(organizationId: string): Promise<SubscriptionData | null> {
    // Implementation would query your subscriptions table
    // Return subscription data including planType
    return null;
}

async function createDefaultBrandConfiguration(organizationId: string, userId: string): Promise<void> {
    // Create default brand configuration for the organization
    console.log("Creating default brand configuration");
}

async function createDefaultTeam(organizationId: string, userId: string): Promise<void> {
    // Create a default "General" team
    console.log("Creating default team");
}

async function createDefaultEmailTemplates(organizationId: string, userId: string): Promise<void> {
    // Create default email templates for bookings, reminders, etc.
    console.log("Creating default email templates");
}

async function initializeOrganizationAnalytics(organizationId: string): Promise<void> {
    // Set up analytics tracking for the organization
    console.log("Initializing analytics");
}

async function logOrganizationEvent(organizationId: string, event: string, data: any): Promise<void> {
    // Log events for analytics and auditing
    console.log(`Organization ${organizationId}: ${event}`, data);
}

async function backupOrganizationData(organizationId: string): Promise<void> {
    // Backup organization data before deletion
    console.log("Backing up organization data");
}

async function cancelOrganizationSubscriptions(organizationId: string): Promise<void> {
    // Cancel any active subscriptions
    console.log("Cancelling subscriptions");
}

async function cleanupExternalIntegrations(organizationId: string): Promise<void> {
    // Clean up integrations with external services
    console.log("Cleaning up integrations");
}

async function cleanupExternalServices(organizationId: string): Promise<void> {
    // Final cleanup of external services
    console.log("Final cleanup");
}

async function getOrganizationMemberCount(organizationId: string): Promise<number> {
    // Get current member count
    return 0;
}

function getMemberLimitForPlan(planType: string): number {
    switch (planType) {
        case "free": return 1;
        case "starter": return 3;
        case "professional": return 10;
        case "business": return 50;
        default: return 1;
    }
}

async function createDefaultUserPreferences(userId: string, organizationId: string): Promise<void> {
    // Create default user preferences
    console.log("Creating user preferences");
}

async function updateOrganizationMemberCount(organizationId: string): Promise<void> {
    // Update cached member count
    console.log("Updating member count cache");
}

async function backupMemberData(memberId: string, organizationId: string): Promise<void> {
    // Backup member data before removal
    console.log("Backing up member data");
}

async function reassignMemberResources(memberId: string, organizationId: string): Promise<void> {
    // Reassign resources owned by departing member
    console.log("Reassigning member resources");
}

async function revokeUserAccess(userId: string, organizationId: string): Promise<void> {
    // Revoke user access to organization resources
    console.log("Revoking user access");
}

async function cleanupUserOrganizationData(userId: string, organizationId: string): Promise<void> {
    // Clean up user-specific organization data
    console.log("Cleaning up user data");
}

async function validateRoleChange(member: any, newRole: string, organization: any): Promise<void> {
    // Validate that the role change is allowed
    console.log("Validating role change");
}

async function updateUserPermissionsCache(userId: string, organizationId: string): Promise<void> {
    // Update cached user permissions
    console.log("Updating permissions cache");
}

async function notifyRoleChange(user: any, organization: any, previousRole: string, newRole: string): Promise<void> {
    // Send notification about role change
    console.log("Sending role change notification");
}

async function getPendingInvitationCount(organizationId: string): Promise<number> {
    // Get count of pending invitations
    return 0;
}

function getInvitationLimitForPlan(planType: string): number {
    switch (planType) {
        case "free": return 5;
        case "starter": return 25;
        case "professional": return 100;
        case "business": return 500;
        default: return 5;
    }
}

async function updatePendingInvitationCount(organizationId: string): Promise<void> {
    // Update cached pending invitation count
    console.log("Updating invitation count cache");
}

async function createDefaultTeamResources(teamId: string, organizationId: string): Promise<void> {
    // Create default resources for new team
    console.log("Creating default team resources");
}

// Main auth creation function for Cloudflare Workers
const baseAuthConfig: BetterAuthOptions = {
    // Always provide a database adapter for CLI schema generation
    database: drizzleAdapter(defaultDb, {
        provider: "pg",
        schema: schema,
        usePlural: true,
        debugLogs: true,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
        enabled: true,
        autoSignIn: true,
    },
    socialProviders: {
        facebook: {
            clientId: env.FACEBOOK_CLIENT_ID,
            clientSecret: env.FACEBOOK_CLIENT_SECRET,
        },
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
        linkedin: {
            clientId: env.LINKEDIN_CLIENT_ID,
            clientSecret: env.LINKEDIN_CLIENT_SECRET,
        },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    appName: "SchedForm",
    advanced: {
        defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
            httpOnly: true,
        },
    },
    plugins: [
        // Localization plugin for multi-language error messages
        localization({
            defaultLocale: "default",
            fallbackLocale: "fr-FR",
            translations: {
                "es": {
                    USER_NOT_FOUND: "Usuario no encontrado",
                    INVALID_PASSWORD: "ContraseÃ±a invÃ¡lida",
                    INVALID_EMAIL: "Email invÃ¡lido",
                    SESSION_EXPIRED: "SesiÃ³n expirada",
                    WEAK_PASSWORD: "La contraseÃ±a es demasiado dÃ©bil",
                    PASSWORD_TOO_SHORT: "La contraseÃ±a es demasiado corta",
                    EMAIL_ALREADY_EXISTS: "El email ya estÃ¡ registrado",
                },
                "pt-BR": {
                    USER_NOT_FOUND: "UsuÃ¡rio nÃ£o encontrado",
                    INVALID_PASSWORD: "Senha invÃ¡lida",
                    INVALID_EMAIL: "Email invÃ¡lido",
                    SESSION_EXPIRED: "SessÃ£o expirada",
                    WEAK_PASSWORD: "A senha Ã© muito fraca",
                    PASSWORD_TOO_SHORT: "A senha Ã© muito curta",
                    EMAIL_ALREADY_EXISTS: "O email jÃ¡ estÃ¡ cadastrado",
                },
                "fr-FR": {
                    USER_NOT_FOUND: "Utilisateur non trouvÃ©",
                    INVALID_PASSWORD: "Mot de passe invalide",
                    INVALID_EMAIL: "Email invalide",
                    SESSION_EXPIRED: "Session expirÃ©e",
                    WEAK_PASSWORD: "Le mot de passe est trop faible",
                    PASSWORD_TOO_SHORT: "Le mot de passe est trop court",
                    EMAIL_ALREADY_EXISTS: "L'email est dÃ©jÃ  enregistrÃ©",
                },
            },
        }),

        // Email normalization and validation plugin
        emailHarmony(),

        // Phone number plugin for phone-based authentication
        phoneNumber({
            async sendOTP({ phoneNumber, code }) {
                // Implement sending OTP code via SMS
                console.log(`Sending OTP ${code} to ${phoneNumber}`);
            },
            otpLength: 6,
            expiresIn: 300, // 5 minutes
            allowedAttempts: 3,
        }),

        // Phone number normalization and validation plugin
        phoneHarmony(),

        // Validation plugin for request validation
        validator([
            {
                path: "/sign-up/email",
                schema: SignupSchema,
                before: (ctx) => {
                    console.log('Validating signup request:', ctx.body);
                },
                after: () => {
                    console.log('Signup validation passed');
                }
            },
            {
                path: "/sign-in/email",
                schema: SignInSchema,
                before: () => {
                    console.log('Validating signin request');
                },
                after: () => {
                    console.log('Signin validation passed');
                }
            },
        ]),

        // Organization plugin for multi-tenant functionality
        organization({
            // Core organization settings
            allowUserToCreateOrganization: true,
            organizationLimit: 5,
            creatorRole: "owner",
            membershipLimit: 100,

            // Invitation settings
            invitationExpiresIn: 48 * 60 * 60, // 48 hours
            cancelPendingInvitationsOnReInvite: true,
            invitationLimit: 50,
            requireEmailVerificationOnInvitation: true,

            // Email integration
            async sendInvitationEmail(data) {
                const inviteLink = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
                await sendOrganizationInvitation({
                    email: data.email,
                    invitedByUsername: data.inviter.user.name || "a team member",
                    invitedByEmail: data.inviter.user.email,
                    organizationName: data.organization.name,
                    inviteLink,
                });
            },

            // Teams configuration for SchedForm
            teams: {
                enabled: true,
                maximumTeams: async ({ organizationId }) => {
                    const subscription = await getOrganizationSubscription(organizationId);
                    switch (subscription?.planType) {
                        case "free": return 1;
                        case "starter": return 3;
                        case "professional": return 10;
                        case "business": return 50;
                        default: return 1;
                    }
                },
                maximumMembersPerTeam: async ({ organizationId }) => {
                    const subscription = await getOrganizationSubscription(organizationId);
                    switch (subscription?.planType) {
                        case "free": return 3;
                        case "starter": return 10;
                        case "professional": return 25;
                        case "business": return 100;
                        default: return 3;
                    }
                },
                allowRemovingAllTeams: false,
            },

            // Dynamic access control for enterprise customers
            dynamicAccessControl: {
                enabled: true,
                maximumRolesPerOrganization: async (organizationId) => {
                    const subscription = await getOrganizationSubscription(organizationId);
                    switch (subscription?.planType) {
                        case "free": return 0;
                        case "starter": return 2;
                        case "professional": return 10;
                        case "business": return 50;
                        default: return 0;
                    }
                },
            },

            // Access control configuration
            ac,
            roles: {
                owner: ownerRole,
                admin: adminRole,
                member: memberRole,
                manager: managerRole,
                viewer: viewerRole,
            },

            // Comprehensive organization hooks for SchedForm workflows
            organizationHooks: {
                beforeCreateOrganization: async ({ organization, user }) => {
                    console.log(`Creating organization "${organization.name}" for user ${user.email}`);

                    return {
                        data: {
                            ...organization,
                            metadata: {
                                ...organization.metadata,
                                createdBy: user.id,
                                createdAt: new Date().toISOString(),
                                plan: "free",
                                features: {
                                    customBranding: false,
                                    advancedAnalytics: false,
                                    apiAccess: false,
                                    whiteLabeling: false,
                                },
                                limits: {
                                    monthlyResponses: 100,
                                    activeForms: 1,
                                    teamMembers: 1,
                                    integrations: 0,
                                },
                            },
                        },
                    };
                },

                afterCreateOrganization: async ({ organization, user }) => {
                    console.log(`Organization ${organization.name} created successfully`);

                    // Create default resources for SchedForm
                    await Promise.all([
                        createDefaultBrandConfiguration(organization.id, user.id),
                        createDefaultTeam(organization.id, user.id),
                        createDefaultEmailTemplates(organization.id, user.id),
                        initializeOrganizationAnalytics(organization.id),
                        sendWelcomeEmail({
                            email: user.email,
                            userName: user.name || user.email,
                            isNewOrganization: true,
                        }),
                        logOrganizationEvent(organization.id, "organization_created", {
                            createdBy: user.id,
                            planType: "free",
                        }),
                    ]);
                },

                beforeUpdateOrganization: async ({ organization, user }) => {
                    console.log(`Updating organization ${organization.id}`);

                    return {
                        data: {
                            ...organization,
                            metadata: {
                                ...organization.metadata,
                                lastUpdatedBy: user.id,
                                lastUpdatedAt: new Date().toISOString(),
                            },
                        },
                    };
                },

                afterUpdateOrganization: async ({ organization, user }) => {
                    if (!organization) {
                        throw new Error('Organization is required to update an organization');
                    }
                    if (!user) {
                        throw new Error('User is required to update an organization');
                    }
                    await logOrganizationEvent(organization.id, "organization_updated", {
                        updatedBy: user.id,
                        changes: ["name", "logo"],
                    });
                },

                beforeDeleteOrganization: async ({ organization, user }) => {
                    console.log(`Preparing to delete organization ${organization.id}`);

                    await backupOrganizationData(organization.id);
                    await cancelOrganizationSubscriptions(organization.id);
                    await cleanupExternalIntegrations(organization.id);
                },

                afterDeleteOrganization: async ({ organization, user }) => {
                    console.log(`Organization ${organization.id} deleted successfully`);

                    await Promise.all([
                        cleanupExternalServices(organization.id),
                        logOrganizationEvent(organization.id, "organization_deleted", {
                            deletedBy: user.id,
                            deletedAt: new Date().toISOString(),
                        }),
                    ]);
                },

                beforeAddMember: async ({ member, user, organization }) => {
                    console.log(`Adding member ${user.email} to ${organization.name}`);

                    const subscription = await getOrganizationSubscription(organization.id);
                    const currentMemberCount = await getOrganizationMemberCount(organization.id);
                    const memberLimit = getMemberLimitForPlan(subscription?.planType || "free");

                    if (currentMemberCount >= memberLimit) {
                        throw new Error(`Organization has reached its member limit of ${memberLimit}. Please upgrade your plan.`);
                    }

                    return {
                        data: {
                            ...member,
                            metadata: {
                                joinedAt: new Date().toISOString(),
                                invitedBy: member.inviterId,
                                initialRole: member.role,
                            },
                        },
                    };
                },

                afterAddMember: async ({ member, user, organization }) => {
                    await Promise.all([
                        sendWelcomeEmail({
                            email: user.email,
                            userName: user.name || user.email,
                            isNewOrganization: false,
                        }),
                        createDefaultUserPreferences(user.id, organization.id),
                        logOrganizationEvent(organization.id, "member_added", {
                            memberId: member.id,
                            userId: user.id,
                            role: member.role,
                        }),
                        updateOrganizationMemberCount(organization.id),
                    ]);
                },

                beforeRemoveMember: async ({ member, user, organization }) => {
                    console.log(`Removing member ${user.email} from ${organization.name}`);

                    await backupMemberData(member.id, organization.id);
                    await reassignMemberResources(member.id, organization.id);
                },

                afterRemoveMember: async ({ member, user, organization }) => {
                    await Promise.all([
                        revokeUserAccess(user.id, organization.id),
                        logOrganizationEvent(organization.id, "member_removed", {
                            memberId: member.id,
                            userId: user.id,
                            removedAt: new Date().toISOString(),
                        }),
                        updateOrganizationMemberCount(organization.id),
                        cleanupUserOrganizationData(user.id, organization.id),
                    ]);
                },

                beforeUpdateMemberRole: async ({ member, newRole, user, organization }) => {
                    console.log(`Updating role for ${user.email} to ${newRole}`);

                    await validateRoleChange(member, newRole, organization);

                    return {
                        data: {
                            role: newRole,
                            metadata: {
                                ...member.metadata,
                                roleUpdatedAt: new Date().toISOString(),
                                previousRole: member.role,
                            },
                        },
                    };
                },

                afterUpdateMemberRole: async ({ member, previousRole, user, organization }) => {
                    await Promise.all([
                        updateUserPermissionsCache(user.id, organization.id),
                        logOrganizationEvent(organization.id, "member_role_updated", {
                            memberId: member.id,
                            userId: user.id,
                            previousRole,
                            newRole: member.role,
                        }),
                        notifyRoleChange(user, organization, previousRole, member.role),
                    ]);
                },

                beforeCreateInvitation: async ({ invitation, inviter, organization }) => {
                    console.log(`Creating invitation for ${invitation.email} to ${organization.name}`);

                    const subscription = await getOrganizationSubscription(organization.id);
                    const pendingInvitations = await getPendingInvitationCount(organization.id);
                    const invitationLimit = getInvitationLimitForPlan(subscription?.planType || "free");

                    if (pendingInvitations >= invitationLimit) {
                        throw new Error(`Organization has reached its invitation limit of ${invitationLimit}.`);
                    }

                    const customExpiration = new Date();
                    customExpiration.setHours(customExpiration.getHours() + 48);

                    return {
                        data: {
                            ...invitation,
                            expiresAt: customExpiration,
                            metadata: {
                                invitedBy: inviter.userId,
                                organizationPlan: subscription?.planType || "free",
                            },
                        },
                    };
                },

                afterCreateInvitation: async ({ invitation, inviter, organization }) => {
                    await Promise.all([
                        logOrganizationEvent(organization.id, "invitation_created", {
                            invitationId: invitation.id,
                            invitedEmail: invitation.email,
                            invitedBy: inviter.userId,
                            role: invitation.role,
                        }),
                        updatePendingInvitationCount(organization.id),
                    ]);
                },

                afterAcceptInvitation: async ({ invitation, member, user, organization }) => {
                    await Promise.all([
                        logOrganizationEvent(organization.id, "invitation_accepted", {
                            invitationId: invitation.id,
                            userId: user.id,
                            acceptedAt: new Date().toISOString(),
                        }),
                        updatePendingInvitationCount(organization.id),
                    ]);
                },

                beforeCreateTeam: async ({ team, user, organization }) => {
                    if (!organization) {
                        throw new Error('Organization is required to create a team');
                    }
                    if (!user) {
                        throw new Error('User is required to create a team');
                    }

                    console.log(`Creating team "${team.name}" in ${organization.name}`);

                    return {
                        data: {
                            ...team,
                            name: team.name.trim(),
                            metadata: {
                                createdBy: user.id,
                                createdAt: new Date().toISOString(),
                            },
                        },
                    };
                },

                afterCreateTeam: async ({ team, user, organization }) => {
                    if (!organization) {
                        throw new Error('Organization is required to create a team');
                    }
                    if (!user) {
                        throw new Error('User is required to create a team');
                    }

                    await Promise.all([
                        createDefaultTeamResources(team.id, organization.id),
                        logOrganizationEvent(organization.id, "team_created", {
                            teamId: team.id,
                            teamName: team.name,
                            createdBy: user.id,
                        }),
                    ]);
                },
            },

            // Database schema customization for SchedForm
            schema: {
                organization: {
                    fields: {
                        name: "name",
                        slug: "slug",
                        logo: "logo",
                    },
                    additionalFields: {
                        website: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        industry: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        companySize: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        timezone: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        billingEmail: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        subscriptionStatus: {
                            type: "string",
                            required: false,
                            input: false,
                            defaultValue: "free",
                        },
                        planType: {
                            type: "string",
                            required: false,
                            input: false,
                            defaultValue: "free",
                        },
                        polarCustomerId: {
                            type: "string",
                            required: false,
                            input: false,
                        },
                        subscriptionId: {
                            type: "string",
                            required: false,
                            input: false,
                        },
                        currentPeriodEnd: {
                            type: "date",
                            required: false,
                            input: false,
                        },
                        monthlyResponseLimit: {
                            type: "number",
                            required: false,
                            input: false,
                            defaultValue: 100,
                        },
                        customBrandingEnabled: {
                            type: "boolean",
                            required: false,
                            input: false,
                            defaultValue: false,
                        },
                        whitelabelEnabled: {
                            type: "boolean",
                            required: false,
                            input: false,
                            defaultValue: false,
                        },
                        apiAccessEnabled: {
                            type: "boolean",
                            required: false,
                            input: false,
                            defaultValue: false,
                        },
                        settings: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        features: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        limits: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        onboardingCompleted: {
                            type: "boolean",
                            required: false,
                            input: false,
                            defaultValue: false,
                        },
                        lastActiveAt: {
                            type: "date",
                            required: false,
                            input: false,
                        },
                    },
                },
                member: {
                    additionalFields: {
                        title: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        department: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        permissions: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        preferences: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        lastActiveAt: {
                            type: "date",
                            required: false,
                            input: false,
                        },
                        invitationMetadata: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                    },
                },
                invitation: {
                    additionalFields: {
                        message: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        metadata: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                    },
                },
                team: {
                    additionalFields: {
                        description: {
                            type: "string",
                            required: false,
                            input: true,
                        },
                        color: {
                            type: "string",
                            required: false,
                            input: true,
                            defaultValue: "#3b82f6",
                        },
                        settings: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                        metadata: {
                            type: "json",
                            required: false,
                            input: false,
                        },
                    },
                },
            },
        }),

        // Bearer token authentication for API access
        bearer(),

        // JWT plugin for token-based authentication
        jwt({
            jwt: {
                definePayload: ({ user }) => ({
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                }),
                issuer: env.BETTER_AUTH_URL,
                audience: env.BETTER_AUTH_URL,
                expirationTime: "30m",
            },
            jwks: {
                keyPairConfig: {
                    alg: "EdDSA",
                    crv: "Ed25519",
                },
            },
        }),

        // Two-factor authentication
        twoFactor({
            issuer: "SchedForm",
            otpOptions: {
                async sendOTP({ user, otp }) {
                    await sendEmailOTP({
                        email: user.email,
                        otp,
                        type: "two-factor",
                        userName: user.name || user.email,
                    });
                },
                period: 5,
            },
        }),

        // Admin functionality for user management
        adminPlugin({
            adminUserIds: [],
            defaultRole: "user",
            adminRoles: ["admin", "super-admin"],
            impersonationSessionDuration: 60 * 60,
            bannedUserMessage: "Your account has been suspended. Please contact support for assistance.",
        }),

        // Email OTP for passwordless authentication
        emailOTP({
            async sendVerificationOTP({ email, otp, type }) {
                await sendEmailOTP({
                    email,
                    otp,
                    type: type as "sign-in" | "email-verification" | "forget-password" | "two-factor",
                    userName: email.split("@")[0],
                });
            },
            otpLength: 6,
            expiresIn: 300,
            sendVerificationOnSignUp: true,
            allowedAttempts: 3,
        }),

        // Password breach detection
        haveIBeenPwned({
            customPasswordCompromisedMessage: "This password has been compromised in a data breach. Please choose a different password for your security.",
        }),

        // CAPTCHA protection for forms
        captcha({
            provider: "cloudflare-turnstile",
            secretKey: env.TURNSTILE_SECRET_KEY,
        }),

        // API key management for programmatic access
        apiKey({
            apiKeyHeaders: ["x-api-key", "x-schedform-key"],
            defaultKeyLength: 64,
            defaultPrefix: "sk_",
            requireName: true,
            enableMetadata: true,
            keyExpiration: {
                defaultExpiresIn: 365 * 24 * 60 * 60 * 1000,
                minExpiresIn: 1,
                maxExpiresIn: 365,
            },
            rateLimit: {
                enabled: true,
                timeWindow: 60 * 1000,
                maxRequests: 100,
            },
            permissions: {
                defaultPermissions: {
                    forms: ["read"],
                    bookings: ["read"],
                },
            },
        }),

        // Multi-session support for team switching
        multiSession({
            maximumSessions: 5,
        }),

        // Polar billing integration
        polar({
            client: polarClient,
            createCustomerOnSignUp: true,
            enableCustomerPortal: true,
            use: [
                checkout({
                    products: [
                        {
                            productId: env.POLAR_STARTER_PRODUCT_ID,
                            slug: "starter",
                        },
                        {
                            productId: env.POLAR_PRO_PRODUCT_ID,
                            slug: "professional",
                        },
                        {
                            productId: env.POLAR_BUSINESS_PRODUCT_ID,
                            slug: "business",
                        },
                    ],
                    successUrl: `${env.POLAR_SUCCESS_URL}/success?session_id={CHECKOUT_ID}`,
                    authenticatedUsersOnly: true,
                }),
                portal(),
                webhooks({
                    secret: env.POLAR_WEBHOOK_SECRET,
                    onSubscriptionActive: async (payload) => {
                        console.log("Subscription activated:", payload);
                    },
                    onSubscriptionCanceled: async (payload) => {
                        console.log("Subscription canceled:", payload);
                    },
                    onOrderPaid: async (payload) => {
                        console.log("Order paid:", payload);
                    },
                }),
            ],
        }),
    ],

    // Rate limiting configuration
    rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        storage: "memory",
    },

    // Session configuration
    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60 * 1000,
        },
    },

    // User configuration
    user: {
        additionalFields: {
            role: {
                type: "string",
                defaultValue: "user",
                input: false,
            },
            subscription: {
                type: "string",
                defaultValue: "free",
                input: false,
            },
            subscriptionStatus: {
                type: "string",
                defaultValue: "inactive",
                input: false,
            },
        },
    },
}

// Main auth creation function for Cloudflare Workers
export function createAuth(
    bindings?: Cloudflare.Env | null,
    cf?: any
) {
    // If we have Cloudflare bindings, use the Cloudflare wrapper
    if (bindings) {
        // Create database instance with Hyperdrive if available
        const db = bindings.HYPERDRIVE ? createDbWithHyperdrive(bindings.HYPERDRIVE) : defaultDb;

        return betterAuth(withCloudflare({
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: cf || {},
            postgres: {
                db,
                options: {
                    usePlural: true,
                    debugLogs: true,
                },
            },
            kv: bindings.KV,
        }, {
            // Override the base config with runtime-specific settings
            ...baseAuthConfig,
            // Remove the base database adapter since Cloudflare plugin handles it
            database: undefined,
        }));
    }

    // For CLI and development, use the base configuration
    return betterAuth(baseAuthConfig);
}
