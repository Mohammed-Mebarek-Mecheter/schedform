// src/lib/video-conference/error-handler.ts
export class VideoConferenceError extends Error {
    constructor(
        message: string,
        public code: string,
        public isRetryable: boolean = false,
        public originalError?: any
    ) {
        super(message);
        this.name = 'VideoConferenceError';
    }
}

export class VideoConferenceErrorHandler {
    static handleZoomError(error: any): VideoConferenceError {
        if (error.message?.includes('401')) {
            return new VideoConferenceError(
                'Authentication failed - please reconnect your Zoom account',
                'AUTHENTICATION_FAILED',
                false,
                error
            );
        } else if (error.message?.includes('403')) {
            return new VideoConferenceError(
                'Zoom access denied - check permissions',
                'PERMISSION_DENIED',
                false,
                error
            );
        } else if (error.message?.includes('404')) {
            return new VideoConferenceError(
                'Meeting not found',
                'NOT_FOUND',
                false,
                error
            );
        } else if (error.message?.includes('429')) {
            return new VideoConferenceError(
                'Zoom rate limit exceeded - please try again later',
                'RATE_LIMITED',
                true,
                error
            );
        }

        return new VideoConferenceError(
            `Zoom error: ${error.message}`,
            'UNKNOWN_ERROR',
            false,
            error
        );
    }

    static handleGoogleMeetError(error: any): VideoConferenceError {
        if (error.code === 401) {
            return new VideoConferenceError(
                'Authentication failed - please reconnect your Google Meet account',
                'AUTHENTICATION_FAILED',
                false,
                error
            );
        } else if (error.code === 403) {
            return new VideoConferenceError(
                'Google Meet access denied - check permissions',
                'PERMISSION_DENIED',
                false,
                error
            );
        } else if (error.code === 404) {
            return new VideoConferenceError(
                'Meeting space not found',
                'NOT_FOUND',
                false,
                error
            );
        } else if (error.code === 429) {
            return new VideoConferenceError(
                'Google Meet rate limit exceeded - please try again later',
                'RATE_LIMITED',
                true,
                error
            );
        }

        return new VideoConferenceError(
            `Google Meet error: ${error.message}`,
            'UNKNOWN_ERROR',
            false,
            error
        );
    }

    static isRetryableError(error: VideoConferenceError): boolean {
        return error.isRetryable;
    }

    static shouldReconnect(error: VideoConferenceError): boolean {
        return ['AUTHENTICATION_FAILED', 'PERMISSION_DENIED'].includes(error.code);
    }
}

export function withVideoRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
): Promise<T> {
    return new Promise(async (resolve, reject) => {
        let lastError: Error;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await operation();
                return resolve(result);
            } catch (error) {
                lastError = error as Error;

                if (error instanceof VideoConferenceError && !VideoConferenceErrorHandler.isRetryableError(error)) {
                    return reject(error);
                }

                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`Retrying video operation after ${delay}ms (attempt ${attempt + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        reject(lastError!);
    });
}
