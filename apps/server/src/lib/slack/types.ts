// src/lib/slack/types.ts

// Base interface for all Slack API responses
export interface SlackApiResponse {
    ok: boolean;
    [key: string]: any;
}

export interface SlackOAuthResponse extends SlackApiResponse {
    ok: boolean;
    access_token: string;
    token_type: string;
    scope: string;
    bot_user_id: string;
    app_id: string;
    team: {
        id: string;
        name: string;
        domain: string;
    };
    enterprise?: {
        id: string;
        name: string;
    };
    authed_user: {
        id: string;
        scope: string;
        access_token: string;
        token_type: string;
    };
    incoming_webhook?: {
        channel: string;
        channel_id: string;
        configuration_url: string;
        url: string;
    };
}

export interface SlackChannel {
    id: string;
    name: string;
    is_private: boolean;
    is_channel: boolean;
    is_group: boolean;
    is_im: boolean;
    is_mpim: boolean;
}

export interface SlackUser {
    id: string;
    name: string;
    real_name: string;
    email: string;
    is_bot: boolean;
}

export interface SlackMessageBlock {
    type: string;
    text?: {
        type: string;
        text: string;
    };
    accessory?: any;
    elements?: any[];
    fields?: any[];
}

export interface SlackNotificationConfig {
    channelId: string;
    eventTypes: string[];
    includeFormSummary: boolean;
    includeQualificationScore: boolean;
    includeAiInsights: boolean;
    mentionUsers: string[];
    priority: 'low' | 'normal' | 'high' | 'urgent';
}

export interface SlackEventPayload {
    type: string;
    formResponseId?: string;
    bookingId?: string;
    eventTypeId?: string;
    organizationId: string;
    data: Record<string, any>;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    triggerUserId?: string;
}
