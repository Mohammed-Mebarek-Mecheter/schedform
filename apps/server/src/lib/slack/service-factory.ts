// src/lib/slack/service-factory.ts
import { SlackIntegrationService } from './slack-integration-service';
import { SlackApiClient } from './slack-api-client';
import { SlackWebhookHandler } from './webhook-handler';
import {db} from "@/db";

export class SlackServiceFactory {
    static async createIntegrationService(
        organizationId: string,
        userId?: string
    ): Promise<SlackIntegrationService> {
        return new SlackIntegrationService(db, organizationId, userId);
    }

    static createApiClient(accessToken: string): SlackApiClient {
        return new SlackApiClient(accessToken);
    }

    static createWebhookHandler(signingSecret: string): SlackWebhookHandler {
        return new SlackWebhookHandler(signingSecret);
    }
}
