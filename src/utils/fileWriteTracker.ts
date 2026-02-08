/**
 * File Write Trackers - Dirty-flag caching & debouncing to reduce disk I/O
 *
 * BotStatsDirtyTracker: Compares discrete counter snapshots to skip identical writes
 * BidHistoryDirtyTracker: Simple dirty flag with debounced write coalescing
 */

/**
 * Snapshot of bot stats fields that indicate meaningful change.
 * Excludes always-changing fields: timestamp, uptimeSeconds, windowResetIn, secondsUntilReset
 */
export interface BotStatsSnapshot {
  bidsPlaced: number;
  bidsSkipped: number;
  bidsCancelled: number;
  bidsAdjusted: number;
  errors: number;
  queueSize: number;
  wsConnected: boolean;
  bidsTracked: number;
  walletPoolAvailable: number | null;
  heapUsedMB: number;
}

export class BotStatsDirtyTracker {
  private lastSnapshot: BotStatsSnapshot | null = null;
  private forceDirty = true; // First call is always dirty
  private readonly heapThresholdMB: number;

  constructor(heapThresholdMB: number = 5) {
    this.heapThresholdMB = heapThresholdMB;
  }

  /**
   * Check if the given snapshot differs from the last written snapshot.
   */
  isDirty(snapshot: BotStatsSnapshot): boolean {
    if (this.forceDirty) return true;
    if (!this.lastSnapshot) return true;

    const prev = this.lastSnapshot;

    // Check discrete counters
    if (
      snapshot.bidsPlaced !== prev.bidsPlaced ||
      snapshot.bidsSkipped !== prev.bidsSkipped ||
      snapshot.bidsCancelled !== prev.bidsCancelled ||
      snapshot.bidsAdjusted !== prev.bidsAdjusted ||
      snapshot.errors !== prev.errors ||
      snapshot.queueSize !== prev.queueSize ||
      snapshot.wsConnected !== prev.wsConnected ||
      snapshot.bidsTracked !== prev.bidsTracked ||
      snapshot.walletPoolAvailable !== prev.walletPoolAvailable
    ) {
      return true;
    }

    // Check heap memory with threshold
    if (Math.abs(snapshot.heapUsedMB - prev.heapUsedMB) >= this.heapThresholdMB) {
      return true;
    }

    return false;
  }

  /**
   * Record that a write happened with this snapshot.
   */
  markClean(snapshot: BotStatsSnapshot): void {
    this.lastSnapshot = { ...snapshot };
    this.forceDirty = false;
  }

  /**
   * Force the next isDirty() call to return true.
   */
  forceNextDirty(): void {
    this.forceDirty = true;
  }
}

export class BidHistoryDirtyTracker {
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(debounceMs: number = 15_000) {
    this.debounceMs = debounceMs;
  }

  markDirty(): void {
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  /**
   * Schedule a debounced write. Multiple rapid calls coalesce into a single write
   * after debounceMs of inactivity.
   */
  scheduleDebouncedWrite(writeFn: () => Promise<void>): void {
    this.markDirty();

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      writeFn().catch(() => {
        // Error is logged inside writeFn; re-mark dirty so next interval retries
        this.markDirty();
      });
    }, this.debounceMs);
  }

  /**
   * Cancel any pending debounced write (call before forced shutdown write).
   */
  cancelPendingDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
