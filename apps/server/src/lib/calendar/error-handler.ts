// src/lib/calendar/error-handler.ts
export class CalendarError extends Error {
    constructor(
        message: string,
        public code: string,
        public isRetryable: boolean = false,
        public originalError?: any
    ) {
        super(message);
        this.name = 'CalendarError';
    }
}

export class CalendarErrorHandler {
    static handleGoogleError(error: any): CalendarError {
        if (error.code === 401) {
            return new CalendarError(
                'Authentication failed - please reconnect your Google Calendar',
                'AUTHENTICATION_FAILED',
                false,
                error
            );
        } else if (error.code === 403) {
            return new CalendarError(
                'Calendar access denied - check Google Calendar permissions',
                'PERMISSION_DENIED',
                false,
                error
            );
        } else if (error.code === 404) {
            return new CalendarError(
                'Calendar or event not found',
                'NOT_FOUND',
                false,
                error
            );
        } else if (error.code === 409) {
            return new CalendarError(
                'Event conflict - the event may have been modified by another application',
                'CONFLICT',
                true,
                error
            );
        } else if (error.code === 429) {
            return new CalendarError(
                'Google Calendar rate limit exceeded - please try again later',
                'RATE_LIMITED',
                true,
                error
            );
        } else if (error.code >= 500) {
            return new CalendarError(
                'Google Calendar service unavailable - please try again later',
                'SERVICE_UNAVAILABLE',
                true,
                error
            );
        }

        return new CalendarError(
            `Google Calendar error: ${error.message}`,
            'UNKNOWN_ERROR',
            false,
            error
        );
    }

    static handleOutlookError(error: any): CalendarError {
        const statusCode = error.statusCode || error.code;

        if (statusCode === 401) {
            return new CalendarError(
                'Authentication failed - please reconnect your Outlook Calendar',
                'AUTHENTICATION_FAILED',
                false,
                error
            );
        } else if (statusCode === 403) {
            return new CalendarError(
                'Calendar access denied - check Outlook Calendar permissions',
                'PERMISSION_DENIED',
                false,
                error
            );
        } else if (statusCode === 404) {
            return new CalendarError(
                'Calendar or event not found',
                'NOT_FOUND',
                false,
                error
            );
        } else if (statusCode === 409) {
            return new CalendarError(
                'Event conflict - the event may have been modified by another application',
                'CONFLICT',
                true,
                error
            );
        } else if (statusCode === 429) {
            return new CalendarError(
                'Outlook Calendar rate limit exceeded - please try again later',
                'RATE_LIMITED',
                true,
                error
            );
        } else if (statusCode >= 500) {
            return new CalendarError(
                'Outlook Calendar service unavailable - please try again later',
                'SERVICE_UNAVAILABLE',
                true,
                error
            );
        } else if (statusCode === 410) {
            return new CalendarError(
                'Sync token expired - performing full sync',
                'SYNC_TOKEN_EXPIRED',
                true,
                error
            );
        }

        return new CalendarError(
            `Outlook Calendar error: ${error.message}`,
            'UNKNOWN_ERROR',
            false,
            error
        );
    }

    static isRetryableError(error: CalendarError): boolean {
        return error.isRetryable;
    }

    static shouldReconnect(error: CalendarError): boolean {
        return ['AUTHENTICATION_FAILED', 'PERMISSION_DENIED'].includes(error.code);
    }
}

export function withRetry<T>(
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

                if (error instanceof CalendarError && !CalendarErrorHandler.isRetryableError(error)) {
                    return reject(error);
                }

                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`Retrying operation after ${delay}ms (attempt ${attempt + 1})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        reject(lastError!);
    });
}
