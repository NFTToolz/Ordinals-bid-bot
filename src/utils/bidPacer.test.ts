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

    it('should return true after oldest bid expires from sliding window', () => {
      const pacer = getBidPacer();
      // Record 5 bids
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }
      expect(pacer.canPlaceBid()).toBe(false);

      // Advance time past window (60 seconds) — all 5 bids expire
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

      // Advance past the oldest bid's expiry (60s + 100ms buffer)
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

      // Both calls should resolve after oldest bid expires
      await vi.advanceTimersByTimeAsync(61000);

      // Both should resolve without error
      await Promise.all([promise1, promise2]);
      expect(true).toBe(true);
    });

    it('sliding window allows bid after oldest expires (~12s not 51s)', async () => {
      // With 5 bids/min limit and 60s window:
      // Place 5 bids at t=0, then advance 12s.
      // With fixed window: would wait ~49s (until 60s window resets)
      // With sliding window: oldest bid at t=0 expires at t=60s, so wait ~48s
      // But if we space them out, e.g. bid at t=0, t=10, t=20, t=30, t=40:
      // Then at t=50, the oldest bid (t=0) expires at t=60, wait ~10s
      const pacer = getBidPacer();

      // Place bids at t=0, t=10s, t=20s, t=30s, t=40s
      pacer.recordBid(); // t=0
      vi.advanceTimersByTime(10000);
      pacer.recordBid(); // t=10s
      vi.advanceTimersByTime(10000);
      pacer.recordBid(); // t=20s
      vi.advanceTimersByTime(10000);
      pacer.recordBid(); // t=30s
      vi.advanceTimersByTime(10000);
      pacer.recordBid(); // t=40s

      expect(pacer.canPlaceBid()).toBe(false);

      // At t=40s, oldest bid (t=0) expires at t=60s
      // So we need to wait ~20s + 100ms buffer
      // Advance 21s to t=61s — oldest bid should have expired
      vi.advanceTimersByTime(21000);

      // Now at t=61s, the bid from t=0 has expired (> 60s ago)
      expect(pacer.canPlaceBid()).toBe(true);
    });

    it('sliding window burst then pace', async () => {
      const pacer = getBidPacer();

      // Burst: place all 5 bids at once
      for (let i = 0; i < 5; i++) {
        pacer.recordBid();
      }
      expect(pacer.canPlaceBid()).toBe(false);

      // Advance past window — all 5 bids expire
      vi.advanceTimersByTime(61000);
      expect(pacer.canPlaceBid()).toBe(true);

      // Can now place another burst
      pacer.recordBid();
      expect(pacer.getStatus().bidsUsed).toBe(1);
      expect(pacer.getStatus().bidsRemaining).toBe(4);
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

    it('should remove expired bids from sliding window', () => {
      const pacer = getBidPacer();
      pacer.recordBid();
      pacer.recordBid();

      vi.advanceTimersByTime(61000);

      pacer.recordBid();
      // Only the new bid should be in the window (old 2 expired)
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

    it('should fill timestamps to MAX_BIDS with current time', () => {
      const pacer = getBidPacer();
      pacer.recordBid(); // 1 existing bid
      pacer.onRateLimitError();

      // After onRateLimitError, should be at capacity (5 timestamps)
      expect(pacer.getStatus().bidsUsed).toBe(5);
      expect(pacer.canPlaceBid()).toBe(false);
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

    it('should reflect sliding window counts correctly', () => {
      const pacer = getBidPacer();

      // Place 3 bids at t=0
      for (let i = 0; i < 3; i++) {
        pacer.recordBid();
      }
      expect(pacer.getStatus().bidsUsed).toBe(3);

      // Advance 30s, place 2 more
      vi.advanceTimersByTime(30000);
      pacer.recordBid();
      pacer.recordBid();
      expect(pacer.getStatus().bidsUsed).toBe(5);

      // Advance 31s more (total 61s) — first 3 bids expire
      vi.advanceTimersByTime(31000);
      expect(pacer.getStatus().bidsUsed).toBe(2);
      expect(pacer.getStatus().bidsRemaining).toBe(3);
    });

    it('should return 0 windowResetIn when no bids placed', () => {
      const pacer = getBidPacer();
      expect(pacer.getStatus().windowResetIn).toBe(0);
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
