// src/lib/slack/index.ts
// Main exports for the Slack integration
export { SlackServiceFactory } from './service-factory';
export { SlackIntegrationService } from './slack-integration-service';
export { SlackApiClient } from './slack-api-client';
export { SlackMessageBuilder } from './message-builder';
export { SlackWebhookHandler } from './webhook-handler';
export { SlackEventTriggers } from './event-triggers';
export { createSlackWebhookHandlers } from './webhook-routes';

export type {
    SlackOAuthResponse,
    SlackChannel,
    SlackUser,
    SlackMessageBlock,
    SlackNotificationConfig,
    SlackEventPayload,
} from './types';

export {
    SlackError,
    SlackAuthError,
    SlackRateLimitError,
    SlackChannelError,
} from './error-handler';

export type {
    SlackConnection,
    SlackChannelMapping,
    SlackMessage,
    SlackUserMapping,
    NewSlackConnection,
    NewSlackChannelMapping,
    NewSlackMessage,
    NewSlackUserMapping,
} from '@/db/schema/slack-integration-core';
