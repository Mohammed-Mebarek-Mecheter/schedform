// src/lib/slack/message-builder.ts
import type { SlackMessageBlock } from './types';

export class SlackMessageBuilder {
    static buildFormSubmissionMessage(data: {
        formTitle: string;
        respondentName: string;
        respondentEmail: string;
        qualificationScore?: number;
        urgencyLevel?: string;
        summary: string;
        formResponseId: string;
        includeButtons?: boolean;
    }): { text: string; blocks: SlackMessageBlock[] } {
        const {
            formTitle,
            respondentName,
            respondentEmail,
            qualificationScore,
            urgencyLevel,
            summary,
            formResponseId,
            includeButtons = true
        } = data;

        const fallbackText = `New form submission: ${respondentName} (${respondentEmail}) submitted "${formTitle}"`;

        const blocks: SlackMessageBlock[] = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*🎯 New Form Submission: ${formTitle}*\n*${respondentName}* (${respondentEmail})`
                }
            }
        ];

        // Add qualification info if available
        if (qualificationScore !== undefined || urgencyLevel) {
            const fields: any[] = [];

            if (qualificationScore !== undefined) {
                const scoreEmoji = qualificationScore >= 80 ? '🔥' : qualificationScore >= 60 ? '⭐' : '📋';
                fields.push({
                    type: "mrkdwn",
                    text: `*Qualification Score*\n${scoreEmoji} ${qualificationScore}/100`
                });
            }

            if (urgencyLevel) {
                const urgencyEmoji = urgencyLevel === 'urgent' ? '🚨' : urgencyLevel === 'high' ? '⚡' : '📅';
                fields.push({
                    type: "mrkdwn",
                    text: `*Urgency*\n${urgencyEmoji} ${urgencyLevel}`
                });
            }

            blocks.push({
                type: "section",
                fields
            });
        }

        // Add summary
        if (summary) {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Summary:*\n${summary}`
                }
            });
        }

        // Add action buttons
        if (includeButtons) {
            blocks.push({
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "View Details" },
                        style: "primary",
                        action_id: "view_form_response",
                        value: formResponseId
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Assign to Me" },
                        action_id: "assign_lead",
                        value: formResponseId
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Schedule Meeting" },
                        action_id: "schedule_meeting",
                        value: formResponseId
                    }
                ]
            });
        }

        return { text: fallbackText, blocks };
    }

    static buildMeetingBookedMessage(data: {
        eventTitle: string;
        guestName: string;
        guestEmail: string;
        startTime: Date;
        duration: number;
        meetingType: string;
        qualificationSummary?: string;
        bookingId: string;
        includeButtons?: boolean;
    }): { text: string; blocks: SlackMessageBlock[] } {
        const {
            eventTitle,
            guestName,
            guestEmail,
            startTime,
            duration,
            meetingType,
            qualificationSummary,
            bookingId,
            includeButtons = true
        } = data;

        const fallbackText = `Meeting booked: ${guestName} scheduled "${eventTitle}" for ${startTime.toLocaleString()}`;

        const timeString = new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short'
        }).format(startTime);

        const blocks: SlackMessageBlock[] = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*📅 Meeting Booked: ${eventTitle}*\n*${guestName}* (${guestEmail})`
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Date & Time*\n${timeString}`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Duration*\n${duration} minutes`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Type*\n${meetingType}`
                    }
                ]
            }
        ];

        if (qualificationSummary) {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*📋 Qualification Summary:*\n${qualificationSummary}`
                }
            });
        }

        if (includeButtons) {
            blocks.push({
                type: "actions",
                elements: [
                    {
                        type: "button",
                        text: { type: "plain_text", text: "View Booking" },
                        style: "primary",
                        action_id: "view_booking",
                        value: bookingId
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Reschedule" },
                        action_id: "reschedule_booking",
                        value: bookingId
                    },
                    {
                        type: "button",
                        text: { type: "plain_text", text: "Cancel" },
                        style: "danger",
                        action_id: "cancel_booking",
                        value: bookingId
                    }
                ]
            });
        }

        return { text: fallbackText, blocks };
    }

    static buildHighValueLeadAlert(data: {
        leadName: string;
        leadEmail: string;
        qualificationScore: number;
        estimatedValue?: number;
        urgencyLevel: string;
        formResponseId: string;
    }): { text: string; blocks: SlackMessageBlock[] } {
        const {
            leadName,
            leadEmail,
            qualificationScore,
            estimatedValue,
            urgencyLevel,
            formResponseId
        } = data;

        const fallbackText = `🔥 HIGH VALUE LEAD: ${leadName} (Score: ${qualificationScore}/100)`;

        const blocks: SlackMessageBlock[] = [
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*🔥 HIGH VALUE LEAD ALERT*\n*${leadName}* (${leadEmail})`
                }
            },
            {
                type: "section",
                fields: [
                    {
                        type: "mrkdwn",
                        text: `*Qualification Score*\n🎯 ${qualificationScore}/100`
                    },
                    {
                        type: "mrkdwn",
                        text: `*Urgency*\n⚡ ${urgencyLevel}`
                    }
                ]
            }
        ];

        if (estimatedValue) {
            blocks[1].fields!.push({
                type: "mrkdwn",
                text: `*Est. Value*\n💰 $${estimatedValue.toLocaleString()}`
            });
        }

        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: { type: "plain_text", text: "Claim This Lead" },
                    style: "primary",
                    action_id: "claim_high_value_lead",
                    value: formResponseId
                },
                {
                    type: "button",
                    text: { type: "plain_text", text: "View Full Profile" },
                    action_id: "view_lead_profile",
                    value: formResponseId
                }
            ]
        });

        return { text: fallbackText, blocks };
    }
}
