// src/lib/slack/slack-integration-service.ts
import { DrizzleD1Database } from 'drizzle-orm/d1';
import {and, eq, desc, inArray, gte, lte, sql} from 'drizzle-orm';
import {
    slackConnections,
    slackChannelMappings,
    slackMessages,
    slackUserMappings,
    slackMessageTemplates,
    slackAnalytics,
    type SlackConnection,
    type SlackChannelMapping,
    type SlackMessage,
    type NewSlackConnection,
    type NewSlackChannelMapping,
    type NewSlackMessage
} from '@/db/schema/slack-integration-core';
import { users, organizations } from '@/db/schema/auth';
import {formResponses, forms} from '@/db/schema/forms';
import {bookings, eventTypes} from '@/db/schema/scheduling';
import { SlackApiClient } from './slack-api-client';
import { SlackMessageBuilder } from './message-builder';
import { SlackError, handleSlackApiError } from './error-handler';
import type {
    SlackOAuthResponse,
    SlackEventPayload,
    SlackNotificationConfig
} from './types';

export class SlackIntegrationService {
    constructor(
        private db: DrizzleD1Database,
        private organizationId: string,
        private userId?: string
    ) {}

    // OAuth and Connection Management
    async handleOAuthCallback(
        code: string,
        state: string,
        userId: string
    ): Promise<SlackConnection> {
        try {
            // Exchange code for tokens
            const tokenResponse = await this.exchangeOAuthCode(code);

            if (!tokenResponse.ok) {
                throw new SlackError('OAuth exchange failed', 'OAUTH_FAILED');
            }

            // Create connection record
            const connectionData: NewSlackConnection = {
                userId,
                organizationId: this.organizationId,
                slackWorkspaceId: tokenResponse.team.id,
                slackWorkspaceName: tokenResponse.team.name,
                slackWorkspaceDomain: tokenResponse.team.domain,
                slackWorkspaceUrl: `https://${tokenResponse.team.domain}.slack.com`,
                botAccessToken: tokenResponse.access_token,
                userAccessToken: tokenResponse.authed_user?.access_token || null,
                tokenScopes: tokenResponse.scope.split(','),
                installingUserId: tokenResponse.authed_user.id,
                installingUserEmail: null, // Will be fetched separately
                installingUserName: null,   // Will be fetched separately
                slackAppId: tokenResponse.app_id,
                slackBotId: tokenResponse.bot_user_id,
                slackBotUserId: tokenResponse.bot_user_id,
            };

            // Insert connection
            const [connection] = await this.db
                .insert(slackConnections)
                .values(connectionData)
                .returning();

            // Fetch and update user details
            await this.updateConnectionUserDetails(connection.id, tokenResponse.access_token);

            // Create default channel mappings if webhook was provided
            if (tokenResponse.incoming_webhook) {
                await this.createDefaultChannelMapping(
                    connection.id,
                    tokenResponse.incoming_webhook.channel_id,
                    tokenResponse.incoming_webhook.channel
                );
            }

            return connection;
        } catch (error) {
            console.error('OAuth callback error:', error);
            throw error instanceof SlackError ? error : new SlackError(
                'Failed to complete Slack integration',
                'OAUTH_INTEGRATION_FAILED'
            );
        }
    }

    private async exchangeOAuthCode(code: string): Promise<SlackOAuthResponse> {
        const response = await fetch('https://slack.com/api/oauth.v2.access', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: process.env.SLACK_CLIENT_ID!,
                client_secret: process.env.SLACK_CLIENT_SECRET!,
                code,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw { response: { status: response.status, data } };
        }

        return data;
    }

    private async updateConnectionUserDetails(
        connectionId: string,
        accessToken: string
    ) {
        try {
            const client = new SlackApiClient(accessToken);
            const userInfo = await client.getUserInfo('me');

            if (userInfo.ok && userInfo.user) {
                await this.db
                    .update(slackConnections)
                    .set({
                        installingUserEmail: userInfo.user.email,
                        installingUserName: userInfo.user.real_name || userInfo.user.name,
                        updatedAt: new Date(),
                    })
                    .where(eq(slackConnections.id, connectionId));
            }
        } catch (error) {
            console.warn('Failed to fetch user details:', error);
            // Non-critical error, don't throw
        }
    }

    private async createDefaultChannelMapping(
        connectionId: string,
        channelId: string,
        channelName: string
    ) {
        const mappingData: NewSlackChannelMapping = {
            connectionId,
            organizationId: this.organizationId,
            slackChannelId: channelId,
            slackChannelName: channelName,
            channelType: 'public',
            isPrivate: false,
            eventTypes: [
                'form_submission',
                'meeting_booked',
                'meeting_confirmed',
                'high_value_lead'
            ],
            isActive: true,
        };

        await this.db
            .insert(slackChannelMappings)
            .values(mappingData);
    }

    // Connection Management
    async getConnections(): Promise<SlackConnection[]> {
        return await this.db
            .select()
            .from(slackConnections)
            .where(
                and(
                    eq(slackConnections.organizationId, this.organizationId),
                    eq(slackConnections.isActive, true)
                )
            )
            .orderBy(desc(slackConnections.createdAt));
    }

    async getConnection(connectionId: string): Promise<SlackConnection | null> {
        const [connection] = await this.db
            .select()
            .from(slackConnections)
            .where(
                and(
                    eq(slackConnections.id, connectionId),
                    eq(slackConnections.organizationId, this.organizationId)
                )
            );

        return connection || null;
    }

    async getDefaultConnection(): Promise<SlackConnection | null> {
        const [connection] = await this.db
            .select()
            .from(slackConnections)
            .where(
                and(
                    eq(slackConnections.organizationId, this.organizationId),
                    eq(slackConnections.isDefault, true),
                    eq(slackConnections.isActive, true)
                )
            );

        return connection || null;
    }

    async deactivateConnection(connectionId: string): Promise<void> {
        await this.db
            .update(slackConnections)
            .set({
                isActive: false,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(slackConnections.id, connectionId),
                    eq(slackConnections.organizationId, this.organizationId)
                )
            );
    }

    // Channel Management
    async getChannelMappings(connectionId?: string): Promise<SlackChannelMapping[]> {
        const conditions = [eq(slackChannelMappings.organizationId, this.organizationId)];

        if (connectionId) {
            conditions.push(eq(slackChannelMappings.connectionId, connectionId));
        }

        return await this.db
            .select()
            .from(slackChannelMappings)
            .where(and(...conditions))
            .orderBy(desc(slackChannelMappings.createdAt));
    }

    async createChannelMapping(data: {
        connectionId: string;
        channelId: string;
        channelName: string;
        channelType: 'public' | 'private' | 'im' | 'mpim';
        eventTypes: string[];
        config?: Partial<SlackNotificationConfig>;
    }): Promise<SlackChannelMapping> {
        const mappingData: NewSlackChannelMapping = {
            connectionId: data.connectionId,
            organizationId: this.organizationId,
            slackChannelId: data.channelId,
            slackChannelName: data.channelName,
            channelType: data.channelType,
            isPrivate: data.channelType === 'private',
            eventTypes: data.eventTypes,
            isActive: true,
            ...data.config,
        };

        const [mapping] = await this.db
            .insert(slackChannelMappings)
            .values(mappingData)
            .returning();

        return mapping;
    }

    async updateChannelMapping(
        mappingId: string,
        updates: Partial<SlackChannelMapping>
    ): Promise<void> {
        await this.db
            .update(slackChannelMappings)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(slackChannelMappings.id, mappingId),
                    eq(slackChannelMappings.organizationId, this.organizationId)
                )
            );
    }

    // Notification Sending
    async sendNotification(payload: SlackEventPayload): Promise<void> {
        try {
            // Get relevant channel mappings
            const mappings = await this.getRelevantMappings(payload);

            if (mappings.length === 0) {
                console.log(`No channel mappings found for event type: ${payload.type}`);
                return;
            }

            // Send to each mapped channel
            for (const mapping of mappings) {
                await this.sendToChannel(mapping, payload);
            }
        } catch (error) {
            console.error('Failed to send Slack notification:', error);
            throw error;
        }
    }

    private async getRelevantMappings(
        payload: SlackEventPayload
    ): Promise<(SlackChannelMapping & { connection: SlackConnection })[]> {
        // Get active mappings that match the event type
        const mappings = await this.db
            .select({
                mapping: slackChannelMappings,
                connection: slackConnections,
            })
            .from(slackChannelMappings)
            .innerJoin(
                slackConnections,
                eq(slackChannelMappings.connectionId, slackConnections.id)
            )
            .where(
                and(
                    eq(slackChannelMappings.organizationId, this.organizationId),
                    eq(slackChannelMappings.isActive, true),
                    eq(slackConnections.isActive, true),
                    eq(slackConnections.notificationsEnabled, true)
                )
            );

        // Filter mappings that support this event type
        return mappings
            .filter(({ mapping }) =>
                Array.isArray(mapping.eventTypes) &&
                mapping.eventTypes.includes(payload.type)
            )
            .filter(({ mapping }) => this.passesFilters(mapping, payload))
            .map(({ mapping, connection }) => ({ ...mapping, connection }));
    }

    private passesFilters(
        mapping: SlackChannelMapping,
        payload: SlackEventPayload
    ): boolean {
        // Check qualification score threshold
        if (mapping.qualificationScoreThreshold && payload.data.qualificationScore) {
            if (payload.data.qualificationScore < mapping.qualificationScoreThreshold) {
                return false;
            }
        }

        // Check intent score threshold
        if (mapping.intentScoreThreshold && payload.data.intentScore) {
            if (payload.data.intentScore < mapping.intentScoreThreshold) {
                return false;
            }
        }

        // Check high value filter
        if (mapping.onlyHighValue && !payload.data.isHighValue) {
            return false;
        }

        // Check form ID filter
        if (mapping.formIds && payload.data.formId) {
            if (!Array.isArray(mapping.formIds) || !mapping.formIds.includes(payload.data.formId)) {
                return false;
            }
        }

        // Check event type ID filter
        if (mapping.eventTypeIds && payload.eventTypeId) {
            if (!Array.isArray(mapping.eventTypeIds) || !mapping.eventTypeIds.includes(payload.eventTypeId)) {
                return false;
            }
        }

        // Check working hours filter
        if (mapping.onlyWorkingHours && mapping.workingHoursConfig) {
            const now = new Date();
            const currentHour = now.getHours();
            const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

            const config = mapping.workingHoursConfig as any;
            if (config.days && !config.days.includes(currentDay)) {
                return false;
            }

            if (config.startHour && config.endHour) {
                if (currentHour < config.startHour || currentHour > config.endHour) {
                    return false;
                }
            }
        }

        return true;
    }

    private async sendToChannel(
        mapping: SlackChannelMapping & { connection: SlackConnection },
        payload: SlackEventPayload
    ): Promise<void> {
        try {
            const client = new SlackApiClient(mapping.connection.botAccessToken);

            // Build message based on event type
            const messageData = await this.buildMessage(mapping, payload);

            if (!messageData) {
                console.warn(`No message builder for event type: ${payload.type}`);
                return;
            }

            // Send message to Slack
            const response = await client.postMessage({
                channel: mapping.slackChannelId,
                text: messageData.text,
                blocks: messageData.blocks,
            });

            // Record message in database
            await this.recordSentMessage({
                connectionId: mapping.connectionId,
                organizationId: this.organizationId,
                formResponseId: payload.formResponseId || null,
                bookingId: payload.bookingId || null,
                eventTypeId: payload.eventTypeId || null,
                slackChannelId: mapping.slackChannelId,
                slackMessageId: response.ts,
                eventType: payload.type,
                messageTemplateId: null,
                priority: payload.priority,
                messageText: messageData.text,
                messageBlocks: messageData.blocks,
                status: 'sent',
                sentAt: new Date(),
                contextData: payload.data,
                triggerUserId: payload.triggerUserId || null,
            });

            // Update mapping statistics
            await this.updateMappingStats(mapping.id);

        } catch (error) {
            console.error(`Failed to send message to channel ${mapping.slackChannelId}:`, error);

            // Record failed message
            await this.recordSentMessage({
                connectionId: mapping.connectionId,
                organizationId: this.organizationId,
                formResponseId: payload.formResponseId || null,
                bookingId: payload.bookingId || null,
                eventTypeId: payload.eventTypeId || null,
                slackChannelId: mapping.slackChannelId,
                eventType: payload.type,
                priority: payload.priority,
                status: 'failed',
                failureReason: error instanceof Error ? error.message : 'Unknown error',
                contextData: payload.data,
                triggerUserId: payload.triggerUserId || null,
            });

            throw error;
        }
    }

    private async buildMessage(
        mapping: SlackChannelMapping,
        payload: SlackEventPayload
    ): Promise<{ text: string; blocks: any[] } | null> {
        const { type, data } = payload;

        switch (type) {
            case 'form_submission':
                return SlackMessageBuilder.buildFormSubmissionMessage({
                    formTitle: data.formTitle || 'Form Submission',
                    respondentName: data.respondentName || 'Unknown',
                    respondentEmail: data.respondentEmail || '',
                    qualificationScore: data.qualificationScore,
                    urgencyLevel: data.urgencyLevel,
                    summary: data.summary || '',
                    formResponseId: payload.formResponseId!,
                    includeButtons: mapping.connectionId.enableInteractiveMessages,
                });

            case 'meeting_booked':
                return SlackMessageBuilder.buildMeetingBookedMessage({
                    eventTitle: data.eventTitle || 'Meeting',
                    guestName: data.guestName || 'Unknown',
                    guestEmail: data.guestEmail || '',
                    startTime: new Date(data.startTime),
                    duration: data.duration || 30,
                    meetingType: data.meetingType || 'video',
                    qualificationSummary: data.qualificationSummary,
                    bookingId: payload.bookingId!,
                    includeButtons: mapping.connectionId.enableInteractiveMessages,
                });

            case 'high_value_lead':
                return SlackMessageBuilder.buildHighValueLeadAlert({
                    leadName: data.leadName || 'Unknown',
                    leadEmail: data.leadEmail || '',
                    qualificationScore: data.qualificationScore || 0,
                    estimatedValue: data.estimatedValue,
                    urgencyLevel: data.urgencyLevel || 'normal',
                    formResponseId: payload.formResponseId!,
                });

            default:
                return null;
        }
    }

    private async recordSentMessage(data: NewSlackMessage): Promise<void> {
        await this.db.insert(slackMessages).values(data);
    }

    private async updateMappingStats(mappingId: string): Promise<void> {
        await this.db
            .update(slackChannelMappings)
            .set({
                messagesSent: sql`${slackChannelMappings.messagesSent} + 1`,
                lastMessageSentAt: new Date(),
            })
            .where(eq(slackChannelMappings.id, mappingId));
    }

    // Event Handlers for SchedForm Events
    async handleFormSubmission(formResponseId: string): Promise<void> {
        // Fetch form response data
        const formResponse = await this.db
            .select({
                response: formResponses,
                form: forms,
            })
            .from(formResponses)
            .innerJoin(forms, eq(formResponses.formId, forms.id))
            .where(eq(formResponses.id, formResponseId))
            .then(rows => rows[0]);

        if (!formResponse) {
            console.warn(`Form response ${formResponseId} not found`);
            return;
        }

        const payload: SlackEventPayload = {
            type: 'form_submission',
            formResponseId,
            organizationId: this.organizationId,
            data: {
                formId: formResponse.response.formId,
                formTitle: formResponse.form.title,
                respondentName: formResponse.response.respondentName,
                respondentEmail: formResponse.response.respondentEmail,
                qualificationScore: formResponse.response.qualificationScore,
                urgencyLevel: formResponse.response.urgencyLevel,
                summary: formResponse.response.aiSummary,
                isHighValue: (formResponse.response.qualificationScore || 0) >= 80,
            },
            priority: 'normal',
        };

        // Check if this is a high value lead
        if (payload.data.isHighValue) {
            await this.sendNotification({
                ...payload,
                type: 'high_value_lead',
                priority: 'high',
            });
        }

        await this.sendNotification(payload);
    }

    async handleMeetingBooked(bookingId: string): Promise<void> {
        // Fetch booking data
        const booking = await this.db
            .select({
                booking: bookings,
                eventType: eventTypes,
                formResponse: formResponses,
            })
            .from(bookings)
            .innerJoin(eventTypes, eq(bookings.eventTypeId, eventTypes.id))
            .leftJoin(formResponses, eq(bookings.formResponseId, formResponses.id))
            .where(eq(bookings.id, bookingId))
            .then(rows => rows[0]);

        if (!booking) {
            console.warn(`Booking ${bookingId} not found`);
            return;
        }

        const payload: SlackEventPayload = {
            type: 'meeting_booked',
            bookingId,
            eventTypeId: booking.eventType.id,
            organizationId: this.organizationId,
            data: {
                eventTitle: booking.eventType.title,
                guestName: booking.booking.guestName,
                guestEmail: booking.booking.guestEmail,
                startTime: booking.booking.startTime.toISOString(),
                duration: booking.eventType.duration,
                meetingType: booking.booking.meetingType,
                qualificationSummary: booking.booking.qualificationSummary,
            },
            priority: 'normal',
        };

        await this.sendNotification(payload);
    }

    async handleMeetingStatusChange(
        bookingId: string,
        status: 'confirmed' | 'cancelled' | 'completed' | 'rescheduled'
    ): Promise<void> {
        const eventTypeMap = {
            confirmed: 'meeting_confirmed',
            cancelled: 'meeting_cancelled',
            completed: 'meeting_completed',
            rescheduled: 'meeting_rescheduled',
        };

        const booking = await this.db
            .select({
                booking: bookings,
                eventType: eventTypes,
            })
            .from(bookings)
            .innerJoin(eventTypes, eq(bookings.eventTypeId, eventTypes.id))
            .where(eq(bookings.id, bookingId))
            .then(rows => rows[0]);

        if (!booking) return;

        const payload: SlackEventPayload = {
            type: eventTypeMap[status],
            bookingId,
            eventTypeId: booking.eventType.id,
            organizationId: this.organizationId,
            data: {
                eventTitle: booking.eventType.title,
                guestName: booking.booking.guestName,
                guestEmail: booking.booking.guestEmail,
                startTime: booking.booking.startTime.toISOString(),
                status,
            },
            priority: 'normal',
        };

        await this.sendNotification(payload);
    }

    // Analytics and Reporting
    async getAnalytics(
        connectionId?: string,
        startDate?: Date,
        endDate?: Date
    ): Promise<any> {
        const conditions = [eq(slackAnalytics.organizationId, this.organizationId)];

        if (connectionId) {
            conditions.push(eq(slackAnalytics.connectionId, connectionId));
        }

        if (startDate) {
            conditions.push(gte(slackAnalytics.date, startDate));
        }

        if (endDate) {
            conditions.push(lte(slackAnalytics.date, endDate));
        }

        return await this.db
            .select()
            .from(slackAnalytics)
            .where(and(...conditions))
            .orderBy(desc(slackAnalytics.date));
    }

    // User Management
    async createUserMapping(data: {
        connectionId: string;
        userId: string;
        slackUserId: string;
        slackUserEmail?: string;
        slackUserName?: string;
        config?: any;
    }): Promise<void> {
        await this.db.insert(slackUserMappings).values({
            connectionId: data.connectionId,
            organizationId: this.organizationId,
            userId: data.userId,
            slackUserId: data.slackUserId,
            slackUserEmail: data.slackUserEmail || null,
            slackUserName: data.slackUserName || null,
            ...data.config,
        });
    }

    async getUserMappings(connectionId?: string): Promise<any[]> {
        const conditions = [eq(slackUserMappings.organizationId, this.organizationId)];

        if (connectionId) {
            conditions.push(eq(slackUserMappings.connectionId, connectionId));
        }

        return await this.db
            .select({
                mapping: slackUserMappings,
                user: users,
            })
            .from(slackUserMappings)
            .innerJoin(users, eq(slackUserMappings.userId, users.id))
            .where(and(...conditions));
    }
}
