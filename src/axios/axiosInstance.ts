import axios, { AxiosError, AxiosInstance } from "axios";
import axiosRetry, { IAxiosRetryConfig } from "axios-retry";

// Memory leak fix: Reduce timeout from 5 minutes to 90 seconds to prevent long-lived requests
const axiosInstance: AxiosInstance = axios.create({
  timeout: 90000, // 90 seconds (was 300000ms / 5 minutes)
});

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: unknown;
  };
  code?: string;
  message?: string;
}

function asAxiosError(error: unknown): AxiosLikeError {
  if (error && typeof error === 'object') {
    return error as AxiosLikeError;
  }
  return {};
}

/**
 * Helper to extract error message from various response formats
 */
export function getErrorMessage(error: unknown): string {
  const e = asAxiosError(error);
  const data = e.response?.data;
  if (!data) {
    // Provide fallback context when no response data available
    if (e.code) return `Network error: ${e.code}`;
    if (e.message) return e.message;
    return 'Unknown error (no response data)';
  }
  if (typeof data === 'string') return data;
  const dataObj = data as Record<string, unknown>;
  return String(dataObj.error || dataObj.message || dataObj.detail || '');
}

/**
 * Check if error indicates a rate limit (by status code or message)
 */
export function isRateLimitError(error: unknown): boolean {
  const e = asAxiosError(error);
  const status = e.response?.status;
  // Check HTTP status codes for rate limiting
  if (status === 429) return true;
  if (status === 503 && /rate limit/i.test(getErrorMessage(error))) return true;

  // Check error message patterns (case-insensitive)
  const errorMessage = getErrorMessage(error);
  return /rate limit exceeded|too many requests|throttled/i.test(errorMessage);
}

/**
 * Check if error is a permanent/non-retryable business logic error
 */
export function isNonRetryableError(error: unknown): boolean {
  const e = asAxiosError(error);
  const status = e.response?.status;
  const errorText = getErrorMessage(error);

  // 402 Payment Required - insufficient funds
  if (status === 402) return true;

  // 409 Conflict - often used for duplicate/existing resource errors
  if (status === 409) return true;

  // 422 Unprocessable Entity - validation errors that won't change on retry
  if (status === 422) return true;

  // Check specific error message patterns
  if (/maximum number of offers|offer limit reached/i.test(errorText)) return true;
  if (/Insufficient funds/i.test(errorText)) return true;
  if (/does not exist|not valid anymore|canceled by the offerer/i.test(errorText)) return true;

  return false;
}

/**
 * Check if error indicates a duplicate offer that should be retried after cancellation
 */
export function isDuplicateOfferError(error: unknown): boolean {
  const e = asAxiosError(error);
  const status = e.response?.status;
  const errorText = getErrorMessage(error);

  // 409 Conflict with offer-related message
  if (status === 409 && /offer/i.test(errorText)) return true;

  return /You already have an offer for this token|already have an offer/i.test(errorText);
}

const retryConfig: IAxiosRetryConfig = {
  retries: 3,
  retryDelay: (retryCount, _error: AxiosError) => {
    // Note: Rate limiting is handled by limiter.schedule() wrapping each API call,
    // not here. retryDelay must return a number synchronously, so we can't await.
    // Use exponential delay for network errors only
    // Rate limits are handled by bid pacer, not axios retry
    return axiosRetry.exponentialDelay(retryCount);
  },
  retryCondition: async (error: AxiosError) => {
    // DON'T retry on rate limits - let bid pacer handle it
    if (isRateLimitError(error)) {
      return false;
    }

    // Non-retryable business logic errors
    if (isNonRetryableError(error)) {
      return false;
    }

    // Duplicate offer - should retry after caller cancels existing offer
    if (isDuplicateOfferError(error)) {
      return true;
    }

    // Retry on server errors (502, 503, 504) - these are usually transient
    const e = asAxiosError(error);
    const status = e.response?.status;
    if (status && [502, 503, 504].includes(status)) {
      return true;
    }

    // Only retry network errors
    return axiosRetry.isNetworkError(error);
  },
};

axiosRetry(axiosInstance, retryConfig);

export default axiosInstance;