// src/lib/slack/slack-api-client.ts
import { handleSlackApiError } from './error-handler';
import type { SlackChannel, SlackMessageBlock, SlackUser, SlackApiResponse } from "./types";


export class SlackApiClient {
    private baseUrl = 'https://slack.com/api';

    constructor(private accessToken: string) {}

    private async makeRequest<T extends SlackApiResponse>(
        endpoint: string,
        options: {
            method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
            body?: Record<string, any>;
            headers?: Record<string, string>;
        } = {}
    ): Promise<T> {
        const { method = 'GET', body, headers = {} } = options;

        const url = `${this.baseUrl}/${endpoint}`;
        const requestHeaders = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            ...headers,
        };

        const requestOptions: RequestInit = {
            method,
            headers: requestHeaders,
        };

        if (body && method !== 'GET') {
            requestOptions.body = JSON.stringify(body);
        }

        try {
            const response = await fetch(url, requestOptions);
            const data = await response.json() as T;

            if (!response.ok) {
                throw { response: { status: response.status, data } };
            }

            if (!data.ok) {
                throw { response: { status: 200, data } };
            }

            return data;
        } catch (error) {
            handleSlackApiError(error);
        }
    }

    // OAuth and workspace info
    async getWorkspaceInfo() {
        return this.makeRequest<{
            ok: boolean;
            team: {
                id: string;
                name: string;
                domain: string;
                email_domain: string;
            };
        }>('team.info');
    }

    async getBotInfo() {
        return this.makeRequest<{
            ok: boolean;
            bot: {
                id: string;
                app_id: string;
                user_id: string;
                name: string;
            };
        }>('bots.info');
    }

    // Channel methods
    async getChannels() {
        return this.makeRequest<{
            ok: boolean;
            channels: SlackChannel[];
        }>('conversations.list', {
            method: 'GET'
        });
    }

    async getChannelInfo(channelId: string) {
        return this.makeRequest<{
            ok: boolean;
            channel: SlackChannel;
        }>(`conversations.info?channel=${channelId}`);
    }

    // User methods
    async getUsers() {
        return this.makeRequest<{
            ok: boolean;
            members: SlackUser[];
        }>('users.list');
    }

    async getUserInfo(userId: string) {
        return this.makeRequest<{
            ok: boolean;
            user: SlackUser;
        }>(`users.info?user=${userId}`);
    }

    // Message methods
    async postMessage(options: {
        channel: string;
        text?: string;
        blocks?: SlackMessageBlock[];
        attachments?: any[];
        thread_ts?: string;
        reply_broadcast?: boolean;
    }) {
        return this.makeRequest<{
            ok: boolean;
            channel: string;
            ts: string;
            message: {
                text: string;
                user: string;
                ts: string;
            };
        }>('chat.postMessage', {
            method: 'POST',
            body: options,
        });
    }

    async updateMessage(options: {
        channel: string;
        ts: string;
        text?: string;
        blocks?: SlackMessageBlock[];
        attachments?: any[];
    }) {
        return this.makeRequest<{
            ok: boolean;
            channel: string;
            ts: string;
            text: string;
        }>('chat.update', {
            method: 'POST',
            body: options,
        });
    }

    async deleteMessage(channel: string, ts: string) {
        return this.makeRequest<{
            ok: boolean;
            channel: string;
            ts: string;
        }>('chat.delete', {
            method: 'POST',
            body: { channel, ts },
        });
    }

    // Interactive components
    async openModal(options: {
        trigger_id: string;
        view: {
            type: 'modal';
            callback_id: string;
            title: { type: 'plain_text'; text: string };
            blocks: any[];
            submit?: { type: 'plain_text'; text: string };
            close?: { type: 'plain_text'; text: string };
        };
    }) {
        return this.makeRequest<{
            ok: boolean;
            view: any;
        }>('views.open', {
            method: 'POST',
            body: options,
        });
    }

    async respondToInteraction(responseUrl: string, response: any) {
        const requestOptions: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
        };

        try {
            const res = await fetch(responseUrl, requestOptions);
            return await res.json();
        } catch (error) {
            handleSlackApiError(error);
        }
    }
}
