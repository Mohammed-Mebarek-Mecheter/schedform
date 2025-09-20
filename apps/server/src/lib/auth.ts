import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import { polarClient } from "./payments";
import { db } from "@/db";
import * as schema from "../db/schema/auth";
import { env } from "cloudflare:workers";

export const auth = betterAuth<BetterAuthOptions>({
	database: drizzleAdapter(db, {
		provider: "pg",

		schema: schema,
	}),
	trustedOrigins: [env.CORS_ORIGIN],
	emailAndPassword: {
		enabled: true,
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
                    successUrl: `${env.BETTER_AUTH_URL}/success?session_id={CHECKOUT_ID}`,
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
