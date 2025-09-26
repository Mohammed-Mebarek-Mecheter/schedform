// src/lib/slack/error-handler.ts
export class SlackError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode?: number,
        public slackError?: any
    ) {
        super(message);
        this.name = 'SlackError';
    }
}

export class SlackAuthError extends SlackError {
    constructor(message: string, slackError?: any) {
        super(message, 'SLACK_AUTH_ERROR', 401, slackError);
    }
}

export class SlackRateLimitError extends SlackError {
    constructor(message: string, retryAfter?: number) {
        super(message, 'SLACK_RATE_LIMIT', 429);
        this.retryAfter = retryAfter;
    }

    retryAfter?: number;
}

export class SlackChannelError extends SlackError {
    constructor(message: string, channelId: string) {
        super(message, 'SLACK_CHANNEL_ERROR', 404);
        this.channelId = channelId;
    }

    channelId: string;
}

export function handleSlackApiError(error: any): never {
    if (error.response?.status === 429) {
        const retryAfter = parseInt(error.response.headers['retry-after'] || '60');
        throw new SlackRateLimitError('Rate limited by Slack API', retryAfter);
    }

    if (error.response?.status === 401) {
        throw new SlackAuthError('Slack authentication failed', error.response.data);
    }

    if (error.response?.data?.error) {
        const slackError = error.response.data.error;
        switch (slackError) {
            case 'channel_not_found':
            case 'is_archived':
                throw new SlackChannelError('Channel not found or archived', error.response.data);
            case 'invalid_auth':
            case 'account_inactive':
                throw new SlackAuthError('Invalid Slack authentication', error.response.data);
            default:
                throw new SlackError(
                    `Slack API error: ${slackError}`,
                    'SLACK_API_ERROR',
                    error.response?.status,
                    error.response.data
                );
        }
    }

    throw new SlackError(
        error.message || 'Unknown Slack API error',
        'SLACK_UNKNOWN_ERROR',
        error.response?.status
    );
}
