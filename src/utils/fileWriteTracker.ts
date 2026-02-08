/**
 * File Write Trackers - Dirty-flag caching & debouncing to reduce disk I/O
 *
 * BidHistoryDirtyTracker: Simple dirty flag with debounced write coalescing
 */

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
