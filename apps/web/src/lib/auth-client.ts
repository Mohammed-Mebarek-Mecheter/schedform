// web/src/lib/auth-client.ts
import { createAuthClient } from "better-auth/react";
import {
    organizationClient,
    twoFactorClient,
    adminClient,
    emailOTPClient,
    apiKeyClient,
    multiSessionClient,
    phoneNumberClient,
    ssoClient
} from "better-auth/client/plugins";
import { cloudflareClient } from "better-auth-cloudflare/client";
import { ac, ownerRole, adminRole, memberRole, managerRole, viewerRole } from "./auth-permissions";
import {polarClient} from "@polar-sh/better-auth";

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_SERVER_URL,

    plugins: [
        // Organization management with access control
        organizationClient({
            ac,
            roles: {
                owner: ownerRole,
                admin: adminRole,
                member: memberRole,
                manager: managerRole,
                viewer: viewerRole,
            },
        }),

        // Two-factor authentication
        twoFactorClient({
            onTwoFactorRedirect() {
                // Redirect to 2FA verification page
                window.location.href = "/auth/2fa";
            },
        }),

        // Admin functionality for user management
        adminClient({
            ac,
            roles: {
                admin: adminRole,
                user: memberRole,
            },
        }),

        // Email OTP for passwordless authentication
        emailOTPClient(),

        // Phone number authentication
        phoneNumberClient(),

        // API key management
        apiKeyClient(),

        // Multi-session support
        multiSessionClient(),

        // SSO authentication
        ssoClient(),

        // Polar billing integration
        polarClient(),

        // Cloudflare integration
        cloudflareClient(),
    ],

    // Global fetch options
    fetchOptions: {
        // Handle successful responses
        onSuccess: (ctx) => {
            // Handle JWT token from set-auth-jwt header
            const authJwt = ctx.response.headers.get("set-auth-jwt");
            if (authJwt) {
                // Store JWT for API access if needed
                localStorage.setItem("auth_jwt", authJwt);
            }

            // Handle bearer token from set-auth-token header
            const authToken = ctx.response.headers.get("set-auth-token");
            if (authToken) {
                localStorage.setItem("bearer_token", authToken);
            }
        },

        // Handle errors
        onError: (ctx) => {
            console.error("Auth request error:", ctx.error);

            // Clear tokens on auth errors
            if (ctx.error?.status === 401) {
                localStorage.removeItem("auth_jwt");
                localStorage.removeItem("bearer_token");
            }
        },

        // Configure bearer token authentication
        auth: {
            type: "Bearer",
            token: () => localStorage.getItem("bearer_token") || "",
        },
    },
});

// Helper functions for common auth operations
export const authHelpers = {
    // Organization helpers
    async switchOrganization(organizationId: string) {
        return await authClient.organization.setActive({ organizationId });
    },

    async createOrganizationWithDefaults(data: {
        name: string;
        slug: string;
        website?: string;
        industry?: string;
        companySize?: string;
        timezone?: string;
    }) {
        return await authClient.organization.create(data);
    },

    // Team helpers
    async inviteTeamMember(data: {
        email: string;
        role?: string;
        teamId?: string;
        message?: string;
    }) {
        return await authClient.organization.inviteMember({
            email: data.email,
            role: "member",
            // Note: message would be handled via organization metadata or custom fields
        });
    },

    // Billing helpers
    async upgradeSubscription(plan: "starter" | "professional" | "business", billing: "monthly" | "yearly") {
        const planSlugs = {
            starter: billing === "monthly" ? "starter-monthly" : "starter-yearly",
            professional: billing === "monthly" ? "professional-monthly" : "professional-yearly",
            business: billing === "monthly" ? "business-monthly" : "business-yearly",
        };

        return await authClient.checkout({
            slug: planSlugs[plan],
        });
    },

    async openCustomerPortal() {
        return await authClient.customer.portal();
    },

    // Two-factor authentication helpers
    async enableTwoFactor(password: string) {
        return await authClient.twoFactor.enable({ password });
    },

    async verifyTwoFactor(code: string, trustDevice = false) {
        return await authClient.twoFactor.verifyTotp({
            code,
            trustDevice,
        });
    },

    // Multi-session helpers
    async switchSession(sessionToken: string) {
        return await authClient.multiSession.setActive({ sessionToken });
    },

    async listAllSessions() {
        return await authClient.multiSession.listDeviceSessions();
    },

    // API key helpers
    async createAPIKey(data: {
        name: string;
        expiresIn?: number;
        permissions?: Record<string, string[]>;
    }) {
        return await authClient.apiKey.create({
            name: data.name,
            expiresIn: data.expiresIn || 365 * 24 * 60 * 60, // 1 year default
            permissions: data.permissions,
        });
    },

    // Email OTP helpers
    async sendSignInOTP(email: string) {
        return await authClient.emailOtp.sendVerificationOtp({
            email,
            type: "sign-in",
        });
    },

    async signInWithOTP(email: string, otp: string) {
        return await authClient.signIn.emailOtp({
            email,
            otp,
        });
    },

    // Phone number helpers
    async sendPhoneOTP(phoneNumber: string) {
        return await authClient.phoneNumber.sendOtp({
            phoneNumber,
        });
    },

    async verifyPhone(phoneNumber: string, code: string) {
        return await authClient.phoneNumber.verify({
            phoneNumber,
            code,
        });
    },

    // Admin helpers
    async createUser(userData: {
        email: string;
        password: string;
        name: string;
        role?: string;
    }) {
        return await authClient.admin.createUser({
            email: userData.email,
            password: userData.password,
            name: userData.name,
            role: "user",
        });
    },

    async banUser(userId: string, reason?: string, expiresIn?: number) {
        return await authClient.admin.banUser({
            userId,
            banReason: reason,
            banExpiresIn: expiresIn,
        });
    },

    async impersonateUser(userId: string) {
        return await authClient.admin.impersonateUser({ userId });
    },

    async stopImpersonating() {
        return await authClient.admin.stopImpersonating();
    },

    // SSO helpers
    async signInWithSSO(options: {
        email?: string;
        domain?: string;
        providerId?: string;
        organizationSlug?: string;
    }) {
        return await authClient.signIn.sso({
            ...options,
            callbackURL: "/dashboard",
        });
    },

    // Utility helpers
    async signOut() {
        // Clear local storage tokens
        localStorage.removeItem("auth_jwt");
        localStorage.removeItem("bearer_token");

        return await authClient.signOut();
    },

    // Check if user has permission in current organization
    async checkPermission(permissions: Record<string, string[]>) {
        return await authClient.organization.hasPermission({ permissions });
    },
};

