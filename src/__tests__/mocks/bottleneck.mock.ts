import { vi } from 'vitest';

/**
 * Create a mock Bottleneck rate limiter that executes immediately
 */
export function createMockBottleneck() {
  return {
    schedule: vi.fn().mockImplementation(async (optionsOrFn: any, fn?: () => Promise<any>) => {
      // Handle both schedule(fn) and schedule(options, fn) signatures
      const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn;
      if (!actualFn) {
        throw new Error('No function provided to schedule');
      }
      return actualFn();
    }),
    wrap: vi.fn().mockImplementation((fn: (...args: any[]) => any) => {
      return fn;
    }),
    stop: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn(),
    counts: vi.fn().mockReturnValue({
      RECEIVED: 0,
      QUEUED: 0,
      RUNNING: 0,
      EXECUTING: 0,
      DONE: 0,
    }),
    jobs: vi.fn().mockReturnValue([]),
    running: vi.fn().mockReturnValue(0),
    done: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockReturnValue(true),
    updateSettings: vi.fn(),
    currentReservoir: vi.fn().mockResolvedValue(null),
    incrementReservoir: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Create a mock that simulates rate limiting
 */
export function createMockBottleneckWithDelay(delayMs: number = 100) {
  return {
    schedule: vi.fn().mockImplementation(async (optionsOrFn: any, fn?: () => Promise<any>) => {
      const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn;
      if (!actualFn) {
        throw new Error('No function provided to schedule');
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return actualFn();
    }),
    wrap: vi.fn().mockImplementation((fn: (...args: any[]) => any) => {
      return async (...args: any[]) => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return fn(...args);
      };
    }),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
}

/**
 * Create a mock that rejects after certain number of calls (simulates rate limit hit)
 */
export function createMockBottleneckWithRateLimit(rejectAfterCalls: number = 5) {
  let callCount = 0;

  return {
    schedule: vi.fn().mockImplementation(async (optionsOrFn: any, fn?: () => Promise<any>) => {
      callCount++;
      if (callCount > rejectAfterCalls) {
        const error: any = new Error('Rate limit exceeded');
        error.response = { status: 429, data: 'Too many requests' };
        throw error;
      }
      const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn;
      if (!actualFn) {
        throw new Error('No function provided to schedule');
      }
      return actualFn();
    }),
    resetCallCount: () => {
      callCount = 0;
    },
  };
}
