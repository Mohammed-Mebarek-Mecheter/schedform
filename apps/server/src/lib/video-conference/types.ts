// src/lib/video-conference/types.ts
import { z } from 'zod';

// Universal meeting structure
export const VideoMeetingSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    agenda: z.string().optional(),

    startTime: z.date(),
    endTime: z.date(),
    timeZone: z.string(),
    duration: z.number(), // in minutes

    joinUrl: z.string(),
    hostUrl: z.string().optional(),
    meetingCode: z.string().optional(),
    password: z.string().optional(),

    settings: z.object({
        isRecurring: z.boolean().default(false),
        recurrenceRule: z.string().optional(),
        maxParticipants: z.number().optional(),
        waitingRoom: z.boolean().default(false),
        muteOnEntry: z.boolean().default(false),
        autoRecord: z.boolean().default(false),
        autoTranscribe: z.boolean().default(false),
    }),

    providerData: z.record(z.string(), z.unknown()).optional(),
});

export type VideoMeeting = z.infer<typeof VideoMeetingSchema>;

// Participant structure
export const MeetingParticipantSchema = z.object({
    id: z.string(),
    email: z.email(),
    name: z.string(),
    role: z.enum(['host', 'co-host', 'attendee']),
    joinTime: z.date().optional(),
    leaveTime: z.date().optional(),
    duration: z.number().default(0),
});

export type MeetingParticipant = z.infer<typeof MeetingParticipantSchema>;

// Recording structure
export const MeetingRecordingSchema = z.object({
    id: z.string(),
    startTime: z.date(),
    endTime: z.date(),
    fileSize: z.number().optional(),
    fileType: z.string(),
    downloadUrl: z.string().optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'deleted']),
    providerData: z.record(z.string(), z.unknown()).optional(),
});

export type MeetingRecording = z.infer<typeof MeetingRecordingSchema>;

// Transcript structure
export const MeetingTranscriptSchema = z.object({
    id: z.string(),
    language: z.string(),
    wordCount: z.number().default(0),
    downloadUrl: z.string().optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'deleted']),
    providerData: z.record(z.string(), z.unknown()).optional(),
});

export type MeetingTranscript = z.infer<typeof MeetingTranscriptSchema>;

export interface RecordingDeliveryOptions {
    includeTranscript?: boolean;
    customMessage?: string;
    deliveryMethod?: 'email' | 'link';
    recipients?: string[];
    scheduleDelivery?: Date;
}

export interface MeetingIntelligence {
    intentScore: number;
    urgency: 'low' | 'medium' | 'high' | 'urgent';
    budgetIndication: 'low' | 'medium' | 'high' | 'enterprise';
    decisionTimeline: 'immediate' | '1-3_months' | '3-6_months' | '6+_months';
    confidence: number;
    recommendations: string[];
}

export interface MeetingSummary {
    summary: string;
    keyPoints: string[];
    actionItems: string[];
    sentiment: 'positive' | 'neutral' | 'negative';
    confidence: number;
}

// Provider configurations
export interface ZoomConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
    webhookSecret?: string;
}

export interface GoogleMeetConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
}

// Factory configuration
export type VideoProviderConfig =
    | { provider: 'zoom'; config: ZoomConfig }
    | { provider: 'google_meet'; config: GoogleMeetConfig };

// Universal service interface
export interface VideoConferenceService {
    // Connection management
    validateConnection(connectionId: string): Promise<boolean>;
    refreshTokens(connectionId: string): Promise<void>;

    // Meeting management
    createMeeting(params: {
        connectionId: string;
        title: string;
        startTime: Date;
        duration: number;
        timeZone: string;
        agenda?: string;
        settings?: any;
    }): Promise<VideoMeeting>;

    updateMeeting(connectionId: string, meetingId: string, updates: Partial<VideoMeeting>): Promise<VideoMeeting>;
    deleteMeeting(connectionId: string, meetingId: string): Promise<void>;
    getMeeting(connectionId: string, meetingId: string): Promise<VideoMeeting>;

    // Webhook management
    setupWebhook(connectionId: string, options: any): Promise<{ webhookId: string; expirationTime: Date }>;
    removeWebhook(connectionId: string, webhookId: string): Promise<void>;

    // Meeting control
    startMeeting(connectionId: string, meetingId: string): Promise<void>;
    endMeeting(connectionId: string, meetingId: string): Promise<void>;

    // Recording & Transcript methods
    getMeetingRecordings(connectionId: string, meetingId: string): Promise<MeetingRecording[]>;
    getMeetingTranscript(connectionId: string, meetingId: string): Promise<MeetingTranscript>;
    getRecordingSettings(connectionId: string, meetingId: string): Promise<any>;
    updateRecordingSettings(connectionId: string, meetingId: string, settings: any): Promise<void>;

    // Strategic business methods
    deliverRecordingToParticipants(
        connectionId: string,
        meetingId: string,
        options?: RecordingDeliveryOptions
    ): Promise<{ success: boolean; deliveryId?: string }>;

    generateMeetingSummary(connectionId: string, meetingId: string): Promise<MeetingSummary>;
    analyzeProspectIntent(connectionId: string, meetingId: string, formResponses: any): Promise<MeetingIntelligence>;

    // Utility methods
    enableAutoRecording(connectionId: string, meetingId: string, storageType?: 'cloud' | 'local'): Promise<void>;
    configureRecordingSharing(connectionId: string, meetingId: string, sharePublicly?: boolean): Promise<void>;
}
