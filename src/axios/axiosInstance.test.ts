import { describe, it, expect } from 'vitest';
import {
  getErrorMessage,
  isRateLimitError,
  isNonRetryableError,
  isDuplicateOfferError,
  parseRetryAfterMs,
} from './axiosInstance';
import { AxiosError } from 'axios';

describe('Axios Instance Helpers', () => {
  describe('getErrorMessage', () => {
    it('should return fallback for null error', () => {
      expect(getErrorMessage(null)).toBe('Unknown error (no response data)');
    });

    it('should return fallback for undefined error', () => {
      expect(getErrorMessage(undefined)).toBe('Unknown error (no response data)');
    });

    it('should return fallback message when no response data', () => {
      expect(getErrorMessage({})).toBe('Unknown error (no response data)');
      expect(getErrorMessage({ response: {} })).toBe('Unknown error (no response data)');
    });

    it('should return network error code when available', () => {
      expect(getErrorMessage({ code: 'ECONNREFUSED' })).toBe('Network error: ECONNREFUSED');
    });

    it('should return error message when available without response data', () => {
      expect(getErrorMessage({ message: 'Request timeout' })).toBe('Request timeout');
    });

    it('should return string data directly', () => {
      const error = { response: { data: 'Error message' } };
      expect(getErrorMessage(error)).toBe('Error message');
    });

    it('should extract error field from object data', () => {
      const error = { response: { data: { error: 'Something went wrong' } } };
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('should extract message field from object data', () => {
      const error = { response: { data: { message: 'Something went wrong' } } };
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('should extract detail field from object data', () => {
      const error = { response: { data: { detail: 'Detailed error' } } };
      expect(getErrorMessage(error)).toBe('Detailed error');
    });

    it('should prefer error over message over detail', () => {
      const error = {
        response: {
          data: {
            error: 'Error field',
            message: 'Message field',
            detail: 'Detail field',
          },
        },
      };
      expect(getErrorMessage(error)).toBe('Error field');
    });
  });

  describe('isRateLimitError', () => {
    it('should return true for 429 status code', () => {
      const error = { response: { status: 429 } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return true for 503 with rate limit message', () => {
      const error = {
        response: {
          status: 503,
          data: { error: 'Rate limit exceeded' },
        },
      };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return false for 503 without rate limit message', () => {
      const error = {
        response: {
          status: 503,
          data: { error: 'Service unavailable' },
        },
      };
      expect(isRateLimitError(error)).toBe(false);
    });

    it('should return true for "rate limit exceeded" message', () => {
      const error = { response: { data: 'Rate limit exceeded, please retry later' } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return true for "too many requests" message', () => {
      const error = { response: { data: { error: 'Too many requests' } } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return true for "throttled" message', () => {
      const error = { response: { data: { message: 'Request throttled' } } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should be case insensitive', () => {
      const error = { response: { data: 'RATE LIMIT EXCEEDED' } };
      expect(isRateLimitError(error)).toBe(true);
    });

    it('should return false for non-rate-limit errors', () => {
      const error = { response: { status: 500, data: 'Server error' } };
      expect(isRateLimitError(error)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });
  });

  describe('isNonRetryableError', () => {
    it('should return true for 402 Payment Required', () => {
      const error = { response: { status: 402 } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for 409 Conflict', () => {
      const error = { response: { status: 409 } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for 422 Unprocessable Entity', () => {
      const error = { response: { status: 422 } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "maximum number of offers" message', () => {
      const error = { response: { data: 'You have reached the maximum number of offers' } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "offer limit reached" message', () => {
      const error = { response: { data: { error: 'Offer limit reached' } } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "Insufficient funds" message', () => {
      const error = { response: { data: 'Insufficient funds. Required 10000 sats.' } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "does not exist" message', () => {
      const error = { response: { data: { message: 'Token does not exist' } } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "not valid anymore" message', () => {
      const error = { response: { data: 'Listing not valid anymore' } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return true for "canceled by the offerer" message', () => {
      const error = { response: { data: { error: 'Offer was canceled by the offerer' } } };
      expect(isNonRetryableError(error)).toBe(true);
    });

    it('should return false for retryable errors', () => {
      const error = { response: { status: 500, data: 'Internal server error' } };
      expect(isNonRetryableError(error)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isNonRetryableError(null)).toBe(false);
      expect(isNonRetryableError(undefined)).toBe(false);
    });
  });

  describe('isDuplicateOfferError', () => {
    it('should return true for 409 with offer-related message', () => {
      const error = {
        response: {
          status: 409,
          data: { error: 'Duplicate offer' },
        },
      };
      expect(isDuplicateOfferError(error)).toBe(true);
    });

    it('should return false for 409 without offer message', () => {
      const error = {
        response: {
          status: 409,
          data: { error: 'Conflict' },
        },
      };
      expect(isDuplicateOfferError(error)).toBe(false);
    });

    it('should return true for "You already have an offer for this token"', () => {
      const error = {
        response: { data: 'You already have an offer for this token' },
      };
      expect(isDuplicateOfferError(error)).toBe(true);
    });

    it('should return true for "already have an offer" message', () => {
      const error = {
        response: { data: { error: 'User already have an offer' } },
      };
      expect(isDuplicateOfferError(error)).toBe(true);
    });

    it('should return false for non-duplicate errors', () => {
      const error = { response: { status: 400, data: 'Bad request' } };
      expect(isDuplicateOfferError(error)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isDuplicateOfferError(null)).toBe(false);
      expect(isDuplicateOfferError(undefined)).toBe(false);
    });
  });

  describe('parseRetryAfterMs', () => {
    function makeAxiosError(headers?: Record<string, string>): AxiosError {
      return {
        response: { headers: headers ?? {}, status: 429, data: '', statusText: '', config: {} as never },
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Too Many Requests',
        config: {} as never,
        toJSON: () => ({}),
      } as AxiosError;
    }

    it('should return 0 when no Retry-After header', () => {
      expect(parseRetryAfterMs(makeAxiosError())).toBe(0);
    });

    it('should return 0 when Retry-After is non-numeric', () => {
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': 'abc' }))).toBe(0);
    });

    it('should return 0 when Retry-After is 0', () => {
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '0' }))).toBe(0);
    });

    it('should return 0 when Retry-After is negative', () => {
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '-5' }))).toBe(0);
    });

    it('should parse valid Retry-After in seconds and return ms', () => {
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '5' }))).toBe(5000);
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '30' }))).toBe(30000);
    });

    it('should cap Retry-After at 60 seconds', () => {
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '120' }))).toBe(60000);
      expect(parseRetryAfterMs(makeAxiosError({ 'retry-after': '9999' }))).toBe(60000);
    });

    it('should return 0 when response is undefined', () => {
      const error = {
        isAxiosError: true,
        name: 'AxiosError',
        message: 'err',
        config: {} as never,
        toJSON: () => ({}),
      } as AxiosError;
      expect(parseRetryAfterMs(error)).toBe(0);
    });
  });
});
