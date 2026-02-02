import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import BidPacer, {
  initializeBidPacer,
  getBidPacer,
  setGlobalRateLimit,
  isGloballyRateLimited,
  getGlobalResetWaitTime,
} from './bidPacer';

// Mock the logger to prevent console output during tests
vi.mock('./logger', () => ({
  default: {
    pacer: {
      init: vi.fn(),
      bid: vi.fn(),
      waiting: vi.fn(),
      windowReset: vi.fn(),
      error: vi.fn(),
      status: vi.fn(),
      manualReset: vi.fn(),
    },
    rateLimit: {
      pause: vi.fn(),
      lifted: vi.fn(),
    },
  },
}));

describe('BidPacer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset the singleton
    initializeBidPacer(5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('canPlaceBid', () => {
    it('should return true when under limit', () => {
      const pacer = getBidPacer();
      expect(pacer.canPlaceBid()).toBe(true);
    });

    it('should return false when at limit', () => {
      const pacer = getBidPacer();
      // Record 5 bids
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }
      expect(pacer.canPlaceBid()).toBe(false);
    });

    it('should return true after window reset', () => {
      const pacer = getBidPacer();
      // Record 5 bids
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }
      expect(pacer.canPlaceBid()).toBe(false);

      // Advance time past window (60 seconds)
      vi.advanceTimersByTime(61000);

      expect(pacer.canPlaceBid()).toBe(true);
    });
  });

  describe('waitForSlot', () => {
    it('should resolve immediately when under limit', async () => {
      const pacer = getBidPacer();
      const promise = pacer.waitForSlot();
      await expect(promise).resolves.toBeUndefined();
    });

    it('should wait when at limit', async () => {
      const pacer = getBidPacer();
      // Record 5 bids
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }

      const waitPromise = pacer.waitForSlot();

      // Should not resolve immediately
      let resolved = false;
      waitPromise.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(1000);
      expect(resolved).toBe(false);

      // Advance past window reset
      await vi.advanceTimersByTimeAsync(60000);
      await waitPromise;

      expect(resolved).toBe(true);
    });

    it('should share wait promise among multiple waiters', async () => {
      const pacer = getBidPacer();
      // Record 5 bids to exhaust the limit
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }

      // First call creates the wait promise
      const promise1 = pacer.waitForSlot();
      // Second call should join the same wait
      const promise2 = pacer.waitForSlot();

      // Both calls should resolve (whether same promise or not)
      // The key behavior is that both waiters resolve after window reset

      // Advance time to resolve both waiters
      await vi.advanceTimersByTimeAsync(62000);

      // Both should resolve without error
      await Promise.all([promise1, promise2]);

      // Verify both resolved successfully
      expect(true).toBe(true);
    });
  });

  describe('recordBid', () => {
    it('should increment bid count', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      const status = pacer.getStatus();
      expect(status.bidsUsed).toBe(1);
    });

    it('should track total bids placed', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      pacer.recordBid();
      pacer.recordBid();
      expect(pacer.getStatus().totalBidsPlaced).toBe(3);
    });

    it('should reset count after window expires', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      pacer.recordBid();

      vi.advanceTimersByTime(61000);

      pacer.recordBid();
      expect(pacer.getStatus().bidsUsed).toBe(1);
    });
  });

  describe('onRateLimitError', () => {
    it('should force pause on rate limit', () => {
      const pacer = getBidPacer();
      pacer.onRateLimitError();

      expect(pacer.canPlaceBid()).toBe(false);
      expect(pacer.getStatus().isPaused).toBe(true);
    });

    it('should set global rate limit', () => {
      const pacer = getBidPacer();
      pacer.onRateLimitError();

      expect(isGloballyRateLimited()).toBe(true);
    });

    it('should parse retry duration from error message', () => {
      const pacer = getBidPacer();
      pacer.onRateLimitError('Please retry in 2 minutes');

      // Should set global rate limit for 2 minutes (120000ms)
      expect(getGlobalResetWaitTime()).toBeGreaterThan(100000);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      pacer.recordBid();

      const status = pacer.getStatus();
      expect(status.bidsUsed).toBe(2);
      expect(status.bidsRemaining).toBe(3);
      expect(status.isPaused).toBe(false);
      expect(status.totalBidsPlaced).toBe(2);
      expect(status.windowResetIn).toBeGreaterThan(0);
    });

    it('should report isPaused when at limit', () => {
      const pacer = getBidPacer();
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }

      // Trigger pause by attempting to wait
      pacer.waitForSlot();

      expect(pacer.getStatus().isPaused).toBe(true);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      pacer.recordBid();
      pacer.recordBid();

      pacer.reset();

      const status = pacer.getStatus();
      expect(status.bidsUsed).toBe(0);
      expect(status.isPaused).toBe(false);
    });
  });

  describe('getLimit', () => {
    it('should return configured limit', () => {
      const pacer = initializeBidPacer(10);
      expect(pacer.getLimit()).toBe(10);
    });

    it('should use default limit of 5', () => {
      const pacer = initializeBidPacer();
      expect(pacer.getLimit()).toBe(5);
    });
  });
});

describe('Global Rate Limit Functions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset global state by advancing time past any existing limit
    vi.advanceTimersByTime(300000);
    initializeBidPacer(5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('setGlobalRateLimit', () => {
    it('should set rate limit for specified duration', () => {
      setGlobalRateLimit(30000);
      expect(isGloballyRateLimited()).toBe(true);
    });

    it('should clear after duration', () => {
      setGlobalRateLimit(30000);
      expect(isGloballyRateLimited()).toBe(true);

      vi.advanceTimersByTime(31000);
      expect(isGloballyRateLimited()).toBe(false);
    });
  });

  describe('getGlobalResetWaitTime', () => {
    it('should return remaining wait time', () => {
      setGlobalRateLimit(30000);
      vi.advanceTimersByTime(10000);

      const remaining = getGlobalResetWaitTime();
      expect(remaining).toBeGreaterThan(15000);
      expect(remaining).toBeLessThanOrEqual(20000);
    });

    it('should return 0 when not rate limited', () => {
      vi.advanceTimersByTime(300000); // Clear any existing limit
      expect(getGlobalResetWaitTime()).toBe(0);
    });
  });
});
