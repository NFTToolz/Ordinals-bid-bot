import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotStatsDirtyTracker, BidHistoryDirtyTracker, BotStatsSnapshot } from './fileWriteTracker';

function makeSnapshot(overrides: Partial<BotStatsSnapshot> = {}): BotStatsSnapshot {
  return {
    bidsPlaced: 0,
    bidsSkipped: 0,
    bidsCancelled: 0,
    bidsAdjusted: 0,
    errors: 0,
    queueSize: 0,
    wsConnected: true,
    bidsTracked: 0,
    walletPoolAvailable: null,
    heapUsedMB: 100,
    ...overrides,
  };
}

describe('BotStatsDirtyTracker', () => {
  let tracker: BotStatsDirtyTracker;

  beforeEach(() => {
    tracker = new BotStatsDirtyTracker(5);
  });

  it('first call is always dirty (no previous snapshot)', () => {
    const snap = makeSnapshot();
    expect(tracker.isDirty(snap)).toBe(true);
  });

  it('identical snapshot after markClean is clean', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(snap)).toBe(false);
  });

  it('bidsPlaced change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ bidsPlaced: 1 }))).toBe(true);
  });

  it('bidsSkipped change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ bidsSkipped: 1 }))).toBe(true);
  });

  it('bidsCancelled change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ bidsCancelled: 1 }))).toBe(true);
  });

  it('bidsAdjusted change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ bidsAdjusted: 1 }))).toBe(true);
  });

  it('errors change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ errors: 1 }))).toBe(true);
  });

  it('queueSize change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ queueSize: 5 }))).toBe(true);
  });

  it('wsConnected change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ wsConnected: false }))).toBe(true);
  });

  it('bidsTracked change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ bidsTracked: 10 }))).toBe(true);
  });

  it('walletPoolAvailable change makes it dirty', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(makeSnapshot({ walletPoolAvailable: 3 }))).toBe(true);
  });

  it('heap below threshold stays clean', () => {
    const snap = makeSnapshot({ heapUsedMB: 100 });
    tracker.markClean(snap);
    // 4 MB change < 5 MB threshold
    expect(tracker.isDirty(makeSnapshot({ heapUsedMB: 104 }))).toBe(false);
  });

  it('heap above threshold makes it dirty', () => {
    const snap = makeSnapshot({ heapUsedMB: 100 });
    tracker.markClean(snap);
    // 6 MB change >= 5 MB threshold
    expect(tracker.isDirty(makeSnapshot({ heapUsedMB: 106 }))).toBe(true);
  });

  it('forceNextDirty makes next call dirty even with identical snapshot', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    expect(tracker.isDirty(snap)).toBe(false);

    tracker.forceNextDirty();
    expect(tracker.isDirty(snap)).toBe(true);

    // After markClean, back to clean
    tracker.markClean(snap);
    expect(tracker.isDirty(snap)).toBe(false);
  });

  it('markClean stores a copy (mutation of original does not affect tracker)', () => {
    const snap = makeSnapshot();
    tracker.markClean(snap);
    snap.bidsPlaced = 999; // mutate original
    expect(tracker.isDirty(makeSnapshot())).toBe(false); // still clean with fresh identical snapshot
  });
});

describe('BidHistoryDirtyTracker', () => {
  let tracker: BidHistoryDirtyTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new BidHistoryDirtyTracker(15_000);
  });

  afterEach(() => {
    tracker.cancelPendingDebounce();
    vi.useRealTimers();
  });

  it('starts clean', () => {
    expect(tracker.isDirty()).toBe(false);
  });

  it('markDirty makes it dirty', () => {
    tracker.markDirty();
    expect(tracker.isDirty()).toBe(true);
  });

  it('markClean makes it clean', () => {
    tracker.markDirty();
    tracker.markClean();
    expect(tracker.isDirty()).toBe(false);
  });

  it('scheduleDebouncedWrite marks dirty immediately', () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    tracker.scheduleDebouncedWrite(writeFn);
    expect(tracker.isDirty()).toBe(true);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('debounce coalesces multiple rapid calls into one write', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);

    tracker.scheduleDebouncedWrite(writeFn);
    tracker.scheduleDebouncedWrite(writeFn);
    tracker.scheduleDebouncedWrite(writeFn);

    expect(writeFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(writeFn).toHaveBeenCalledTimes(1);
  });

  it('cancelPendingDebounce prevents scheduled write', async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);

    tracker.scheduleDebouncedWrite(writeFn);
    tracker.cancelPendingDebounce();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(writeFn).not.toHaveBeenCalled();
  });

  it('debounce re-marks dirty if writeFn fails', async () => {
    const writeFn = vi.fn().mockRejectedValue(new Error('write failed'));

    tracker.scheduleDebouncedWrite(writeFn);
    tracker.markClean(); // clear dirty before timer fires

    await vi.advanceTimersByTimeAsync(15_000);
    expect(writeFn).toHaveBeenCalledTimes(1);
    // After failed write, dirty should be re-set
    expect(tracker.isDirty()).toBe(true);
  });
});
