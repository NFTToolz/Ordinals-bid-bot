import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BidHistoryDirtyTracker } from './fileWriteTracker';

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
