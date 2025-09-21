// lib/auth.ts
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { polar, checkout, portal, webhooks } from "@polar-sh/better-auth";
import {
    organization,
    bearer,
    jwt,
    twoFactor,
    admin,
    emailOTP,
    haveIBeenPwned,
    captcha,
    apiKey,
    multiSession,
    phoneNumber
} from "better-auth/plugins";
import { polarClient } from "./payments";
import { createDbWithHyperdrive } from "@/db";
import { env } from "./env";
import "dotenv/config";
import { sendOrganizationInvitation, sendEmailOTP } from "./email";

// Additional plugin imports
import { localization } from "better-auth-localization";
import { validator } from "validation-better-auth";
import { emailHarmony, phoneHarmony } from "better-auth-harmony";
import { z } from "zod";

// Validation schemas for your endpoints
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

// Main auth creation function for Cloudflare Workers
export function createAuth(
    bindings?: Cloudflare.Env | null,
    cf?: any // Use any to handle different CF property types
) {
    // Create database instance based on environment
    const db = bindings?.HYPERDRIVE ? createDbWithHyperdrive(bindings.HYPERDRIVE) : undefined;

    const baseAuthConfig: BetterAuthOptions = {
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
                defaultLocale: "fr-FR",
                fallbackLocale: "default",
                // Add custom translations if needed
                translations: {
                    "es": {
                        USER_NOT_FOUND: "Usuario no encontrado",
                        INVALID_PASSWORD: "Contraseña inválida",
                        INVALID_EMAIL: "Email inválido",
                        SESSION_EXPIRED: "Sesión expirada",
                        WEAK_PASSWORD: "La contraseña es demasiado débil",
                        PASSWORD_TOO_SHORT: "La contraseña es demasiado corta",
                        EMAIL_ALREADY_EXISTS: "El email ya está registrado",
                    },
                    "pt-BR": {
                        USER_NOT_FOUND: "Usuário não encontrado",
                        INVALID_PASSWORD: "Senha inválida",
                        INVALID_EMAIL: "Email inválido",
                        SESSION_EXPIRED: "Sessão expirada",
                        WEAK_PASSWORD: "A senha é muito fraca",
                        PASSWORD_TOO_SHORT: "A senha é muito curta",
                        EMAIL_ALREADY_EXISTS: "O email já está cadastrado",
                    },
                    "fr-FR": {
                        USER_NOT_FOUND: "Utilisateur non trouvé",
                        INVALID_PASSWORD: "Mot de passe invalide",
                        INVALID_EMAIL: "Email invalide",
                        SESSION_EXPIRED: "Session expirée",
                        WEAK_PASSWORD: "Le mot de passe est trop faible",
                        PASSWORD_TOO_SHORT: "Le mot de passe est trop court",
                        EMAIL_ALREADY_EXISTS: "L'email est déjà enregistré",
                    },
                },
            }),

            // Email normalization and validation plugin
            emailHarmony({
                // Optional: Allow logging in with any version of the unnormalized email
                // allowNormalizedSignin: true,
                // Optional: Customize when to run email validation and normalization
                // matchers: [{ method: "POST", endpoint: "/sign-up/email" }]
            }),

            // Phone number plugin for phone-based authentication
            phoneNumber({
                async sendOTP({ phoneNumber, code }, request) {
                    // Implement sending OTP code via SMS
                    // Example: await sendSMS(phoneNumber, `Your verification code is: ${code}`);
                    console.log(`Sending OTP ${code} to ${phoneNumber}`);
                },
                // Optional: Automatically sign up users on phone verification
                // signUpOnVerification: {
                //     getTempEmail: (phoneNumber) => {
                //         return `temp-${phoneNumber.replace(/[^0-9]/g, '')}@temp.schedform.com`;
                //     }
                // },
                // Optional: Require phone number verification before sign-in
                // requireVerification: true,
                otpLength: 6,
                expiresIn: 300, // 5 minutes
                allowedAttempts: 3,
            }),

            // Phone number normalization and validation plugin
            phoneHarmony({
                // Optional: Default country for non-international numbers
                // defaultCountry: "US",
                // Optional: Customize when to run phone number validation
                // matchers: [{ method: "POST", endpoint: "/phone/send-otp" }]
            }),

            // Validation plugin for request validation
            validator([
                {
                    path: "/sign-up/email",
                    schema: SignupSchema,
                    before: (ctx) => {
                        console.log('Validating signup request:', ctx.body);
                    },
                    after: (ctx) => {
                        console.log('Signup validation passed');
                    }
                },
                {
                    path: "/sign-in/email",
                    schema: SignInSchema,
                    before: (ctx) => {
                        console.log('Validating signin request');
                    },
                    after: (ctx) => {
                        console.log('Signin validation passed');
                    }
                },
                {
                    path: "/forget-password",
                    schema: ForgotPasswordSchema,
                    before: (ctx) => {
                        console.log('Validating forgot password request');
                    }
                },
                {
                    path: "/reset-password",
                    schema: ResetPasswordSchema,
                    before: (ctx) => {
                        console.log('Validating reset password request');
                    }
                },
                {
                    path: "/change-password",
                    schema: ChangePasswordSchema,
                    before: (ctx) => {
                        console.log('Validating change password request');
                    }
                },
                {
                    path: "/update-user",
                    schema: UpdateUserSchema,
                    before: (ctx) => {
                        console.log('Validating user update request');
                    }
                },
                {
                    path: "/send-verification-otp",
                    schema: EmailOTPSchema,
                    before: (ctx) => {
                        console.log('Validating email OTP send request');
                    }
                },
                {
                    path: "/verify-email",
                    schema: VerifyEmailOTPSchema,
                    before: (ctx) => {
                        console.log('Validating email verification request');
                    }
                },
                {
                    path: "/phone/send-otp",
                    schema: PhoneOTPSchema,
                    before: (ctx) => {
                        console.log('Validating phone OTP send request');
                    }
                },
                {
                    path: "/phone/verify",
                    schema: VerifyPhoneOTPSchema,
                    before: (ctx) => {
                        console.log('Validating phone verification request');
                    }
                }
            ]),

            // Organization plugin for multi-tenant functionality
            organization({
                teams: {
                    enabled: true,
                },
                dynamicAccessControl: {
                    enabled: true,
                },
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
                organizationHooks: {
                    afterCreateOrganization: async ({ organization, member, user }) => {
                        console.log(`New organization created: ${organization.name} by ${user.email}`);
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
                    async sendOTP({ user, otp }, request) {
                        await sendEmailOTP({
                            email: user.email,
                            otp,
                            type: "two-factor",
                            userName: user.name,
                        });
                    },
                    period: 5, // 5 minutes expiry
                },
            }),

            // Admin functionality for user management
            admin({
                adminUserIds: [], // Add specific admin user IDs here
                defaultRole: "user",
                adminRoles: ["admin", "super-admin"],
                impersonationSessionDuration: 60 * 60, // 1 hour
                bannedUserMessage: "Your account has been suspended. Please contact support for assistance.",
            }),

            // Email OTP for passwordless authentication
            emailOTP({
                async sendVerificationOTP({ email, otp, type }) {
                    await sendEmailOTP({
                        email,
                        otp,
                        type,
                        userName: email.split("@")[0], // Simple name fallback
                    });
                },
                otpLength: 6,
                expiresIn: 300, // 5 minutes
                sendVerificationOnSignUp: true,
                allowedAttempts: 3,
            }),

            // Password breach detection
            haveIBeenPwned({
                customPasswordCompromisedMessage: "This password has been compromised in a data breach. Please choose a different password for your security.",
            }),

            // CAPTCHA protection for forms
            captcha({
                provider: "cloudflare-turnstile", // or "google-recaptcha", "hcaptcha"
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
                    defaultExpiresIn: 365 * 24 * 60 * 60 * 1000, // 1 year
                    minExpiresIn: 1,
                    maxExpiresIn: 365,
                },
                rateLimit: {
                    enabled: true,
                    timeWindow: 60 * 1000, // 1 minute
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
                            // Handle subscription activation logic here
                            // e.g., unlock premium features, update user role
                        },
                        onSubscriptionCanceled: async (payload) => {
                            console.log("Subscription canceled:", payload);
                            // Handle subscription cancellation logic here
                            // e.g., downgrade features, send retention email
                        },
                        onOrderPaid: async (payload) => {
                            console.log("Order paid:", payload);
                            // Handle one-time payment logic here
                        },
                    }),
                ],
            }),
        ],

        // Rate limiting configuration
        rateLimit: {
            enabled: true,
            window: 60, // 1 minute
            max: 100, // 100 requests per minute
            storage: "memory", // Consider using "database" for production
        },

        // Session configuration
        session: {
            expiresIn: 60 * 60 * 24 * 7, // 7 days
            updateAge: 60 * 60 * 24, // 1 day
            cookieCache: {
                enabled: true,
                maxAge: 5 * 60 * 1000, // 5 minutes
            },
        },

        // User configuration
        user: {
            additionalFields: {
                role: {
                    type: "string",
                    defaultValue: "user",
                    input: false, // Don't allow setting via API
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
    };

    // Apply Cloudflare wrapper if bindings are available
    if (bindings) {
        return betterAuth(withCloudflare({
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: cf || {},
            postgres: db ? {
                db,
                options: {
                    usePlural: true,
                    debugLogs: true,
                },
            } : undefined,
            kv: bindings.KV,
        }, baseAuthConfig));
    }

    // Fallback for CLI and development
    return betterAuth(baseAuthConfig);
}

// Export for CLI schema generation
export const auth = createAuth();
