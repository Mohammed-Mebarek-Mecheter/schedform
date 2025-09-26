// src/lib/slack/event-triggers.ts
// Helper functions to trigger Slack notifications from SchedForm events
import { SlackServiceFactory } from './service-factory';

export class SlackEventTriggers {
    /**
     * Trigger when a new form response is submitted
     */
    static async onFormSubmission(formResponseId: string, organizationId: string): Promise<void> {
        try {
            const service = await SlackServiceFactory.createIntegrationService(organizationId);
            await service.handleFormSubmission(formResponseId);
        } catch (error) {
            console.error('Failed to send Slack notification for form submission:', error);
            // Don't throw - this shouldn't break the main form submission flow
        }
    }

    /**
     * Trigger when a new meeting is booked
     */
    static async onMeetingBooked(bookingId: string, organizationId: string): Promise<void> {
        try {
            const service = await SlackServiceFactory.createIntegrationService(organizationId);
            await service.handleMeetingBooked(bookingId);
        } catch (error) {
            console.error('Failed to send Slack notification for meeting booking:', error);
        }
    }

    /**
     * Trigger when meeting status changes
     */
    static async onMeetingStatusChange(
        bookingId: string,
        status: 'confirmed' | 'cancelled' | 'completed' | 'rescheduled',
        organizationId: string
    ): Promise<void> {
        try {
            const service = await SlackServiceFactory.createIntegrationService(organizationId);
            await service.handleMeetingStatusChange(bookingId, status);
        } catch (error) {
            console.error('Failed to send Slack notification for meeting status change:', error);
        }
    }

    /**
     * Trigger when spam is detected and blocked
     */
    static async onSpamBlocked(
        formResponseId: string,
        spamDetails: { reason: string; score: number },
        organizationId: string
    ): Promise<void> {
        try {
            const service = await SlackServiceFactory.createIntegrationService(organizationId);

            await service.sendNotification({
                type: 'spam_blocked',
                formResponseId,
                organizationId,
                data: {
                    reason: spamDetails.reason,
                    score: spamDetails.score,
                    timestamp: new Date().toISOString(),
                },
                priority: 'low',
            });
        } catch (error) {
            console.error('Failed to send Slack notification for spam blocking:', error);
        }
    }

    /**
     * Trigger when a no-show is detected
     */
    static async onNoShowDetected(
        bookingId: string,
        noShowDetails: { reason: string; detectedAt: Date },
        organizationId: string
    ): Promise<void> {
        try {
            const service = await SlackServiceFactory.createIntegrationService(organizationId);

            await service.sendNotification({
                type: 'no_show_detected',
                bookingId,
                organizationId,
                data: {
                    reason: noShowDetails.reason,
                    detectedAt: noShowDetails.detectedAt.toISOString(),
                },
                priority: 'normal',
            });
        } catch (error) {
            console.error('Failed to send Slack notification for no-show detection:', error);
        }
    }
}
