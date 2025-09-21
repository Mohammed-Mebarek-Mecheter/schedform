// lib/auth.ts
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import { organization } from "better-auth/plugins"; // Add organization import
import { polarClient } from "./payments";
import { db } from "@/db";
import * as schema from "../db/schema/auth";
import { env } from "./env";
import "dotenv/config";
import { sendOrganizationInvitation } from "./email";

export const auth = betterAuth<BetterAuthOptions>({
    database: drizzleAdapter(db, {
        provider: "pg",
        schema: schema,
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
    advanced: {
        defaultCookieAttributes: {
            sameSite: "none",
            secure: true,
            httpOnly: true,
        },
    },
    plugins: [
        // Add organization plugin first
        organization({
            teams: {
                enabled: true, // Enable teams for future agency features
            },
            dynamicAccessControl: {
                enabled: true, // Enable dynamic roles for flexible permissions
            },
            async sendInvitationEmail(data) {
                // Implement invitation email sending
                const inviteLink = `${env.BETTER_AUTH_URL}/accept-invitation/${data.id}`;
                await sendOrganizationInvitation({
                    email: data.email,
                    invitedByUsername: data.inviter.user.name || "a team member",
                    invitedByEmail: data.inviter.user.email,
                    organizationName: data.organization.name,
                    inviteLink,
                });
            },
            organizationHooks: {
                afterCreateOrganization: async ({ organization, member, user }) => {
                    // You can add post-creation logic here
                    console.log(`New organization created: ${organization.name}`);
                },
            },
        }),
        // Keep polar plugin for billing
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
                        // Handle subscription activation
                        console.log("Subscription activated:", payload);
                    },
                    onSubscriptionCanceled: async (payload) => {
                        // Handle subscription cancellation
                        console.log("Subscription canceled:", payload);
                    },
                    onOrderPaid: async (payload) => {
                        // Handle successful payment
                        console.log("Order paid:", payload);
                    },
                }),
            ],
        }),
    ],
});
