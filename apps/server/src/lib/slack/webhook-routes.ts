// src/lib/slack/webhook-routes.ts
// HTTP handlers for Slack webhooks and interactive components
import { SlackServiceFactory } from './service-factory';
import { SlackWebhookHandler } from './webhook-handler';

export interface SlackWebhookHandlers {
    handleSlackEvents: (request: Request) => Promise<Response>;
    handleSlackInteractivity: (request: Request) => Promise<Response>;
    handleSlackSlashCommands: (request: Request) => Promise<Response>;
}

export function createSlackWebhookHandlers(): SlackWebhookHandlers {
    return {
        async handleSlackEvents(request: Request): Promise<Response> {
            try {
                const body = await request.text();
                const signature = request.headers.get('x-slack-signature');
                const timestamp = request.headers.get('x-slack-request-timestamp');

                if (!signature || !timestamp) {
                    return new Response('Missing required headers', { status: 400 });
                }

                // Get signing secret from environment
                const signingSecret = process.env.SLACK_SIGNING_SECRET;
                if (!signingSecret) {
                    console.error('SLACK_SIGNING_SECRET not configured');
                    return new Response('Server configuration error', { status: 500 });
                }

                const webhookHandler = SlackServiceFactory.createWebhookHandler(signingSecret);

                // Verify request signature
                const isValid = webhookHandler.verifySlackRequest(body, signature, timestamp);
                if (!isValid) {
                    return new Response('Invalid signature', { status: 401 });
                }

                const payload = JSON.parse(body);

                // Log webhook event for debugging/monitoring
                await logWebhookEvent({
                    eventType: payload.type,
                    teamId: payload.team_id,
                    payload,
                    verified: isValid,
                });

                // Handle the event
                const response = await webhookHandler.handleSlackEvent(payload);

                return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (error) {
                console.error('Slack webhook error:', error);
                return new Response('Internal server error', { status: 500 });
            }
        },

        async handleSlackInteractivity(request: Request): Promise<Response> {
            try {
                const formData = await request.formData();
                const payload = JSON.parse(formData.get('payload') as string);

                const signature = request.headers.get('x-slack-signature');
                const timestamp = request.headers.get('x-slack-request-timestamp');

                if (!signature || !timestamp) {
                    return new Response('Missing required headers', { status: 400 });
                }

                const signingSecret = process.env.SLACK_SIGNING_SECRET;
                if (!signingSecret) {
                    return new Response('Server configuration error', { status: 500 });
                }

                const webhookHandler = SlackServiceFactory.createWebhookHandler(signingSecret);

                // Handle interactive component
                const response = await webhookHandler.handleInteractiveComponent(payload);

                return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (error) {
                console.error('Slack interaction error:', error);
                return new Response('Internal server error', { status: 500 });
            }
        },

        async handleSlackSlashCommands(request: Request): Promise<Response> {
            try {
                const formData = await request.formData();
                const command = formData.get('command') as string;
                const text = formData.get('text') as string;
                const userId = formData.get('user_id') as string;
                const userName = formData.get('user_name') as string;
                const channelId = formData.get('channel_id') as string;
                const teamId = formData.get('team_id') as string;
                const triggerId = formData.get('trigger_id') as string;
                const responseUrl = formData.get('response_url') as string;

                // Handle different slash commands
                const response = await handleSlashCommand({
                    command,
                    text,
                    userId,
                    userName,
                    channelId,
                    teamId,
                    triggerId,
                    responseUrl,
                });

                return new Response(JSON.stringify(response), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            } catch (error) {
                console.error('Slack slash command error:', error);
                return new Response(JSON.stringify({
                    text: 'Sorry, there was an error processing your command.',
                    response_type: 'ephemeral'
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        },
    };
}

async function logWebhookEvent(data: {
    eventType: string;
    teamId: string;
    payload: any;
    verified: boolean;
}): Promise<void> {
    // Implementation would log to database for monitoring
    // This is a placeholder - you'd implement actual logging
    console.log('Slack webhook event:', {
        type: data.eventType,
        teamId: data.teamId,
        verified: data.verified,
        timestamp: new Date().toISOString(),
    });
}

async function handleSlashCommand(data: {
    command: string;
    text: string;
    userId: string;
    userName: string;
    channelId: string;
    teamId: string;
    triggerId: string;
    responseUrl: string;
}): Promise<any> {
    const { command, text, userId, teamId } = data;

    // Parse command and subcommand
    const args = text.trim().split(' ');
    const subCommand = args[0] || 'help';

    switch (command) {
        case '/schedform':
            return handleSchedformCommand(subCommand, args.slice(1), data);

        default:
            return {
                text: `Unknown command: ${command}`,
                response_type: 'ephemeral'
            };
    }
}

async function handleSchedformCommand(
    subCommand: string,
    args: string[],
    commandData: any
): Promise<any> {
    switch (subCommand) {
        case 'stats':
        case 'statistics':
            return handleStatsCommand(commandData);

        case 'assign':
            return handleAssignCommand(args, commandData);

        case 'schedule':
            return handleScheduleCommand(args, commandData);

        case 'help':
        default:
            return {
                text: `*SchedForm Commands:*
• \`/schedform stats\` - View today's form submissions and bookings
• \`/schedform assign [user] [lead-id]\` - Assign a lead to a team member
• \`/schedform schedule [client-name]\` - Quick booking for existing contacts
• \`/schedform help\` - Show this help message`,
                response_type: 'ephemeral'
            };
    }
}

async function handleStatsCommand(commandData: any): Promise<any> {
    try {
        // Implementation would fetch actual stats from database
        // This is a placeholder response
        return {
            text: `*Today's SchedForm Activity:*
📋 Form Submissions: 12
📅 Meetings Booked: 8
✅ Meetings Completed: 5
🔥 High Value Leads: 3
📊 Conversion Rate: 67%`,
            response_type: 'ephemeral'
        };
    } catch (error) {
        return {
            text: 'Sorry, I couldn\'t retrieve your stats right now.',
            response_type: 'ephemeral'
        };
    }
}

async function handleAssignCommand(args: string[], commandData: any): Promise<any> {
    if (args.length < 2) {
        return {
            text: 'Usage: `/schedform assign [user] [lead-id]`\nExample: `/schedform assign @john lead-123`',
            response_type: 'ephemeral'
        };
    }

    const [user, leadId] = args;

    // Implementation would actually assign the lead
    return {
        text: `Lead ${leadId} has been assigned to ${user}`,
        response_type: 'in_channel'
    };
}

async function handleScheduleCommand(args: string[], commandData: any): Promise<any> {
    if (args.length === 0) {
        return {
            text: 'Usage: `/schedform schedule [client-name]`\nExample: `/schedform schedule "John Doe"`',
            response_type: 'ephemeral'
        };
    }

    const clientName = args.join(' ');

    // Implementation would open a modal or provide scheduling options
    return {
        text: `Opening scheduling interface for ${clientName}...`,
        response_type: 'ephemeral'
    };
}
