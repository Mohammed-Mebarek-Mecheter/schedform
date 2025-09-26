// src/routers/slack.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '@/lib/trpc';
import { SlackServiceFactory } from '@/lib/slack/service-factory';
import { SlackError } from '@/lib/slack/error-handler';

// Validation schemas
const slackConnectionSchema = z.object({
    id: z.string(),
    slackWorkspaceName: z.string(),
    slackWorkspaceDomain: z.string(),
    isActive: z.boolean(),
    isDefault: z.boolean(),
    notificationsEnabled: z.boolean(),
    createdAt: z.date(),
});

const channelMappingSchema = z.object({
    connectionId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
    channelType: z.enum(['public', 'private', 'im', 'mpim']),
    eventTypes: z.array(z.string()),
    isActive: z.boolean(),
    includeFormSummary: z.boolean(),
    includeQualificationScore: z.boolean(),
    includeAiInsights: z.boolean(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
});

const slackEventPayloadSchema = z.object({
    type: z.string(),
    formResponseId: z.string().optional(),
    bookingId: z.string().optional(),
    eventTypeId: z.string().optional(),
    organizationId: z.string(),
    data: z.record(z.any()),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    triggerUserId: z.string().optional(),
});

export const slackRouter = createTRPCRouter({
    // OAuth and Connection Management
    initiateOAuth: protectedProcedure
        .input(z.object({
            redirectUri: z.string().url(),
            state: z.string().optional(),
        }))
        .query(({ input }) => {
            const clientId = process.env.SLACK_CLIENT_ID;
            if (!clientId) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Slack client ID not configured',
                });
            }

            const scopes = [
                'channels:read',
                'chat:write',
                'im:write',
                'users:read',
                'users:read.email',
                'commands',
                'incoming-webhook',
            ].join(',');

            const authUrl = new URL('https://slack.com/oauth/v2/authorize');
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('scope', scopes);
            authUrl.searchParams.set('redirect_uri', input.redirectUri);
            if (input.state) {
                authUrl.searchParams.set('state', input.state);
            }

            return { authUrl: authUrl.toString() };
        }),

    handleOAuthCallback: protectedProcedure
        .input(z.object({
            code: z.string(),
            state: z.string().optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            try {
                const service = await SlackServiceFactory.createIntegrationService(
                    ctx.user.organizationId,
                    ctx.user.id
                );

                const connection = await service.handleOAuthCallback(
                    input.code,
                    input.state || '',
                    ctx.user.id
                );

                return { success: true, connection };
            } catch (error) {
                if (error instanceof SlackError) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: error.message,
                        cause: error,
                    });
                }
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to complete Slack integration',
                });
            }
        }),

    // Connection Management
    getConnections: protectedProcedure
        .query(async ({ ctx }) => {
            try {
                const service = await SlackServiceFactory.createIntegrationService(
                    ctx.user.organizationId,
                    ctx.user.id
                );

                return await service.getConnections();
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to fetch Slack connections',
                });
            }
        }),

    getConnection: protectedProcedure
        .input(z.object({ connectionId: z.string() }))
        .query(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            const connection = await service.getConnection(input.connectionId);

            if (!connection) {
                throw new TRPCError({
                    code: 'NOT_FOUND',
                    message: 'Slack connection not found',
                });
            }

            return connection;
        }),

    deactivateConnection: protectedProcedure
        .input(z.object({ connectionId: z.string() }))
        .mutation(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            await service.deactivateConnection(input.connectionId);

            return { success: true };
        }),

    // Channel Management
    getChannelMappings: protectedProcedure
        .input(z.object({ connectionId: z.string().optional() }))
        .query(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            return await service.getChannelMappings(input.connectionId);
        }),

    createChannelMapping: protectedProcedure
        .input(z.object({
            connectionId: z.string(),
            channelId: z.string(),
            channelName: z.string(),
            channelType: z.enum(['public', 'private', 'im', 'mpim']),
            eventTypes: z.array(z.string()),
            config: z.object({
                includeFormSummary: z.boolean().default(true),
                includeQualificationScore: z.boolean().default(true),
                includeAiInsights: z.boolean().default(true),
                priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
                mentionUsers: z.array(z.string()).optional(),
                qualificationScoreThreshold: z.number().min(0).max(100).optional(),
                intentScoreThreshold: z.number().min(0).max(100).optional(),
                onlyHighValue: z.boolean().default(false),
                onlyWorkingHours: z.boolean().default(false),
                workingHoursConfig: z.any().optional(),
            }).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            return await service.createChannelMapping({
                connectionId: input.connectionId,
                channelId: input.channelId,
                channelName: input.channelName,
                channelType: input.channelType,
                eventTypes: input.eventTypes,
                config: input.config,
            });
        }),

    updateChannelMapping: protectedProcedure
        .input(z.object({
            mappingId: z.string(),
            updates: z.object({
                eventTypes: z.array(z.string()).optional(),
                isActive: z.boolean().optional(),
                includeFormSummary: z.boolean().optional(),
                includeQualificationScore: z.boolean().optional(),
                includeAiInsights: z.boolean().optional(),
                priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
                qualificationScoreThreshold: z.number().min(0).max(100).optional(),
                intentScoreThreshold: z.number().min(0).max(100).optional(),
                onlyHighValue: z.boolean().optional(),
                onlyWorkingHours: z.boolean().optional(),
                workingHoursConfig: z.any().optional(),
            }),
        }))
        .mutation(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            await service.updateChannelMapping(input.mappingId, input.updates);

            return { success: true };
        }),

    // Test and Send Notifications
    sendTestNotification: protectedProcedure
        .input(z.object({
            connectionId: z.string(),
            channelId: z.string(),
            eventType: z.string(),
            testData: z.record(z.any()),
        }))
        .mutation(async ({ ctx, input }) => {
            try {
                const service = await SlackServiceFactory.createIntegrationService(
                    ctx.user.organizationId,
                    ctx.user.id
                );

                const payload = {
                    type: input.eventType,
                    organizationId: ctx.user.organizationId,
                    data: input.testData,
                    priority: 'normal' as const,
                    triggerUserId: ctx.user.id,
                };

                await service.sendNotification(payload);

                return { success: true };
            } catch (error) {
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to send test notification',
                });
            }
        }),

    sendNotification: protectedProcedure
        .input(slackEventPayloadSchema)
        .mutation(async ({ ctx, input }) => {
            try {
                const service = await SlackServiceFactory.createIntegrationService(
                    input.organizationId
                );

                await service.sendNotification(input);

                return { success: true };
            } catch (error) {
                if (error instanceof SlackError) {
                    throw new TRPCError({
                        code: 'BAD_REQUEST',
                        message: error.message,
                    });
                }
                throw new TRPCError({
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to send notification',
                });
            }
        }),

    // Analytics
    getAnalytics: protectedProcedure
        .input(z.object({
            connectionId: z.string().optional(),
            startDate: z.date().optional(),
            endDate: z.date().optional(),
        }))
        .query(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            return await service.getAnalytics(
                input.connectionId,
                input.startDate,
                input.endDate
            );
        }),

    // User Mappings
    getUserMappings: protectedProcedure
        .input(z.object({ connectionId: z.string().optional() }))
        .query(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            return await service.getUserMappings(input.connectionId);
        }),

    createUserMapping: protectedProcedure
        .input(z.object({
            connectionId: z.string(),
            userId: z.string(),
            slackUserId: z.string(),
            slackUserEmail: z.string().optional(),
            slackUserName: z.string().optional(),
            config: z.object({
                receiveNotifications: z.boolean().default(true),
                receiveAssignments: z.boolean().default(true),
                receiveMentions: z.boolean().default(true),
                autoAssignLeads: z.boolean().default(false),
                assignmentWeight: z.number().min(1).default(1),
                maxAssignmentsPerDay: z.number().min(1).optional(),
                qualificationThreshold: z.number().min(0).max(100).optional(),
                workingHours: z.any().optional(),
                timeZone: z.string().optional(),
            }).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
            const service = await SlackServiceFactory.createIntegrationService(
                ctx.user.organizationId,
                ctx.user.id
            );

            await service.createUserMapping({
                connectionId: input.connectionId,
                userId: input.userId,
                slackUserId: input.slackUserId,
                slackUserEmail: input.slackUserEmail,
                slackUserName: input.slackUserName,
                config: input.config,
            });

            return { success: true };
        }),
});

