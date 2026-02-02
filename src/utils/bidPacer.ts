/**
 * Bid Pacer - Adaptive rate limiting for Magic Eden's 5 bids/min per wallet limit
 *
 * This utility tracks bids placed in a rolling 60-second window and:
 * 1. Enforces the 5 bids/min limit proactively
 * 2. Pauses when limit is reached, waiting for window reset
 * 3. Detects rate limit errors and backs off immediately
 * 4. Resumes automatically when window resets
 */

import Logger from './logger';

// Global rate limit state (API-enforced pause)
// This is separate from the per-window pacer to handle API-level rate limits
let globalRateLimited = false;
let globalResumeTime = 0;

/**
 * Set a global rate limit pause (called when API returns rate limit error)
 * @param durationMs - How long to pause in milliseconds
 */
export function setGlobalRateLimit(durationMs: number): void {
  globalRateLimited = true;
  globalResumeTime = Date.now() + durationMs;
  Logger.rateLimit.pause(Math.ceil(durationMs / 1000));
}

/**
 * Check if we're currently in a global rate limit pause
 * Auto-clears if the pause has expired
 */
export function isGloballyRateLimited(): boolean {
  if (globalRateLimited && Date.now() >= globalResumeTime) {
    globalRateLimited = false;
    Logger.rateLimit.lifted();
  }
  return globalRateLimited;
}

/**
 * Get remaining wait time for global rate limit (in ms)
 */
export function getGlobalResetWaitTime(): number {
  return Math.max(0, globalResumeTime - Date.now());
}

export interface BidPacerStatus {
  bidsUsed: number;
  bidsRemaining: number;
  windowResetIn: number;  // seconds
  isPaused: boolean;
  totalBidsPlaced: number;
  totalWaits: number;
}

class BidPacer {
  private bidCount: number = 0;
  private windowStart: number = Date.now();
  private readonly WINDOW_MS: number;
  private readonly MAX_BIDS: number;
  private isPaused: boolean = false;
  private totalBidsPlaced: number = 0;
  private totalWaits: number = 0;
  // Single-waiter pattern: shared promise so all waiters resolve together
  private waitPromise: Promise<void> | null = null;

  constructor(bidsPerMinute: number = 5, windowMs: number = 60000) {
    this.WINDOW_MS = windowMs;
    this.MAX_BIDS = bidsPerMinute;
    Logger.pacer.init(this.MAX_BIDS, this.WINDOW_MS / 1000);
  }

  /**
   * Reset window if expired
   */
  private checkWindowReset(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.WINDOW_MS) {
      this.bidCount = 0;
      this.windowStart = now;
      this.isPaused = false;
    }
  }

  /**
   * Wait for an available bid slot
   * Call this BEFORE placing a bid
   * Uses single-waiter pattern: all tasks share the same wait promise
   */
  async waitForSlot(): Promise<void> {
    this.checkWindowReset();

    // If at limit, wait for window reset
    if (this.bidCount >= this.MAX_BIDS) {
      // If already waiting, join existing wait (single-waiter pattern)
      if (this.waitPromise) {
        return this.waitPromise;
      }

      const now = Date.now();
      const elapsed = now - this.windowStart;
      const waitTime = this.WINDOW_MS - elapsed + 1000; // +1s buffer

      if (waitTime > 0) {
        this.isPaused = true;
        this.totalWaits++;
        Logger.pacer.waiting(this.bidCount, this.MAX_BIDS, Math.ceil(waitTime / 1000));

        // Create shared promise that all waiters will join
        this.waitPromise = new Promise<void>(resolve => {
          setTimeout(() => {
            // Reset after wait
            this.bidCount = 0;
            this.windowStart = Date.now();
            this.isPaused = false;
            this.waitPromise = null;
            Logger.pacer.windowReset();
            resolve();
          }, Math.max(waitTime, 0));
        });

        return this.waitPromise;
      }
    }
  }

  /**
   * Record a successful bid placement
   * Call this AFTER a bid is successfully placed
   */
  recordBid(): void {
    this.checkWindowReset();
    this.bidCount++;
    this.totalBidsPlaced++;

    const remaining = this.MAX_BIDS - this.bidCount;
    const elapsed = Date.now() - this.windowStart;
    const resetIn = Math.max(0, Math.ceil((this.WINDOW_MS - elapsed) / 1000));

    Logger.pacer.bid(this.bidCount, this.MAX_BIDS, remaining, resetIn);
  }

  /**
   * Called when a rate limit error is detected from the API
   * Forces immediate pause until window reset
   * @param errorMessage - Optional error message to extract retry duration
   */
  onRateLimitError(errorMessage?: string): void {
    let pauseDuration = this.WINDOW_MS;  // Default 60s

    // Try to extract retry time from error message (e.g., "retry in 1 minute", "retry in 30 seconds", "retry in 1 hour")
    if (errorMessage) {
      const minuteMatch = errorMessage.match(/retry in (\d+) minute/i);
      const secondMatch = errorMessage.match(/retry in (\d+) second/i);
      const hourMatch = errorMessage.match(/retry in (\d+) hour/i);

      if (minuteMatch) {
        pauseDuration = parseInt(minuteMatch[1]) * 60 * 1000;
      } else if (secondMatch) {
        pauseDuration = parseInt(secondMatch[1]) * 1000;
      } else if (hourMatch) {
        pauseDuration = parseInt(hourMatch[1]) * 60 * 60 * 1000;
      }
      // If no match, keep default 60s
    }

    // Force the count to max to trigger pause on next waitForSlot
    this.bidCount = this.MAX_BIDS;
    this.isPaused = true;

    // Also set global rate limit so scheduled runs can check
    setGlobalRateLimit(pauseDuration);

    Logger.pacer.error();
  }

  /**
   * Check if we can place a bid right now (non-blocking check)
   */
  canPlaceBid(): boolean {
    this.checkWindowReset();
    return this.bidCount < this.MAX_BIDS;
  }

  /**
   * Get current pacer status
   */
  getStatus(): BidPacerStatus {
    this.checkWindowReset();

    const elapsed = Date.now() - this.windowStart;
    const remaining = Math.max(0, this.WINDOW_MS - elapsed);

    return {
      bidsUsed: this.bidCount,
      bidsRemaining: this.MAX_BIDS - this.bidCount,
      windowResetIn: Math.ceil(remaining / 1000),
      isPaused: this.isPaused,
      totalBidsPlaced: this.totalBidsPlaced,
      totalWaits: this.totalWaits,
    };
  }

  /**
   * Log current status to console
   */
  logStatus(): void {
    const status = this.getStatus();
    Logger.pacer.status(status.bidsUsed, this.MAX_BIDS, status.bidsRemaining, status.windowResetIn);
  }

  /**
   * Reset the pacer (useful for testing or manual intervention)
   */
  reset(): void {
    this.bidCount = 0;
    this.windowStart = Date.now();
    this.isPaused = false;
    Logger.pacer.manualReset();
  }

  /**
   * Get the configured bids per minute limit
   */
  getLimit(): number {
    return this.MAX_BIDS;
  }
}

// Singleton instance with default Magic Eden limit of 5 bids/min
let pacerInstance: BidPacer | null = null;

/**
 * Initialize or reconfigure the bid pacer
 */
export function initializeBidPacer(bidsPerMinute: number = 5): BidPacer {
  pacerInstance = new BidPacer(bidsPerMinute);
  return pacerInstance;
}

/**
 * Get the singleton bid pacer instance
 */
export function getBidPacer(): BidPacer {
  if (!pacerInstance) {
    // Auto-initialize with default settings
    pacerInstance = new BidPacer();
  }
  return pacerInstance;
}

// Export convenience functions that use the singleton

/**
 * Wait for an available bid slot (call before placing bid)
 */
export async function waitForBidSlot(): Promise<void> {
  return getBidPacer().waitForSlot();
}

/**
 * Record a successful bid (call after bid succeeds)
 */
export function recordBid(): void {
  getBidPacer().recordBid();
}

/**
 * Handle rate limit error from API
 * @param errorMessage - Optional error message to extract retry duration
 */
export function onRateLimitError(errorMessage?: string): void {
  getBidPacer().onRateLimitError(errorMessage);
}

/**
 * Check if we can place a bid right now
 */
export function canPlaceBid(): boolean {
  return getBidPacer().canPlaceBid();
}

/**
 * Get current pacer status
 */
export function getBidPacerStatus(): BidPacerStatus {
  return getBidPacer().getStatus();
}

/**
 * Log current pacer status
 */
export function logBidPacerStatus(): void {
  getBidPacer().logStatus();
}

export default BidPacer;
