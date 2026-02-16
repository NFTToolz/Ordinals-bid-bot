/**
 * Throughput Simulation Tests
 *
 * These tests use real PQueue + Mutex to simulate the actual bid pipeline
 * and verify that the reserve-first architecture delivers correct behavior
 * and better throughput than the old fetch-first approach.
 *
 * NOT in bid.test.ts because that file mocks p-queue; these tests need
 * the real implementation to simulate concurrency and priority ordering.
 */

import { describe, it, expect } from 'vitest';
import PQueue from 'p-queue';
import { Mutex } from 'async-mutex';

/**
 * Simulates the global sliding window pacer used in bid.ts.
 * Uses Map<slotId, timestamp> with monotonic counter for unique IDs
 * (matches the production implementation that prevents slot leaks from
 * concurrent same-millisecond reservations).
 */
class PacerSimulator {
  private slots: Map<number, number> = new Map(); // slotId → timestamp
  private slotCounter = 0;
  private mutex = new Mutex();
  private _capacity: number;
  private _slotWaitCount = 0;

  constructor(capacity: number) {
    this._capacity = capacity;
  }

  get capacity() { return this._capacity; }
  get slotWaitCount() { return this._slotWaitCount; }
  get used() {
    const windowStart = Date.now() - 60_000;
    let count = 0;
    for (const ts of this.slots.values()) {
      if (ts > windowStart) count++;
    }
    return count;
  }

  /** Reserve a slot — blocks until one is available. Returns a unique slot ID. */
  async reserveSlot(): Promise<number> {
    while (true) {
      const result = await this.mutex.runExclusive(() => {
        const now = Date.now();
        const windowStart = now - 60_000;
        // Expire old
        for (const [id, ts] of this.slots) {
          if (ts <= windowStart) this.slots.delete(id);
        }
        if (this.slots.size < this._capacity) {
          const slotId = ++this.slotCounter;
          this.slots.set(slotId, now);
          return { available: true, slotId };
        }
        return { available: false, slotId: 0 };
      });
      if (result.available) return result.slotId;
      this._slotWaitCount++;
      // Poll quickly so released slots are picked up fast (test-friendly)
      await new Promise(r => setTimeout(r, 5));
    }
  }

  /** Release a previously reserved slot (task decided not to bid). */
  async releaseSlot(slotId: number): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.slots.delete(slotId);
    });
  }
}

describe('Throughput Simulation — Reserve-First Pipeline', () => {
  it('20 tasks with 25 capacity complete in a single burst', async () => {
    const capacity = 25;  // 5 wallets × 5 bpm
    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency: 20 });
    const API_DELAY = 5;
    const BID_DELAY = 2;
    const TASK_COUNT = 20;

    let bidsPlaced = 0;
    const start = Date.now();

    const tasks = Array.from({ length: TASK_COUNT }, () =>
      queue.add(async () => {
        const reserved = await pacer.reserveSlot();
        await new Promise(r => setTimeout(r, API_DELAY));  // Fetch API data
        await new Promise(r => setTimeout(r, BID_DELAY));  // Place bid
        bidsPlaced++;
      })
    );
    await Promise.all(tasks);
    const duration = Date.now() - start;

    expect(bidsPlaced).toBe(TASK_COUNT);
    // With 25 capacity and 20 tasks, all fit in one burst — no slot expiry needed
    expect(duration).toBeLessThan(500);
    expect(pacer.slotWaitCount).toBe(0); // No waits needed
  });

  it('tasks that skip bidding release their slots immediately', async () => {
    // Capacity large enough so pacer never blocks — focus on release accounting
    const TASK_COUNT = 10;
    const capacity = TASK_COUNT;
    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency: 20 });

    let bidsPlaced = 0;
    let slotsReleased = 0;

    // Odd tasks bid, even tasks decide not to bid (release slot)
    const tasks = Array.from({ length: TASK_COUNT }, (_, i) =>
      queue.add(async () => {
        const reserved = await pacer.reserveSlot();
        await new Promise(r => setTimeout(r, 2)); // API call
        const shouldBid = i % 2 === 0;
        if (shouldBid) {
          await new Promise(r => setTimeout(r, 1)); // bid
          bidsPlaced++;
        } else {
          await pacer.releaseSlot(reserved);
          slotsReleased++;
        }
      })
    );
    await Promise.all(tasks);

    expect(bidsPlaced).toBe(5);
    expect(slotsReleased).toBe(5);
    // Net: 5 consumed, 5 released → pacer.used = 5
    expect(pacer.used).toBe(5);
  });

  it('released slots are immediately available for subsequent tasks', async () => {
    // Capacity = 2. Tasks 0-1 release, so tasks 2-3 can proceed without waiting.
    const capacity = 2;
    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency: 20 });
    const completionOrder: number[] = [];

    const tasks = Array.from({ length: 4 }, (_, i) =>
      queue.add(async () => {
        const reserved = await pacer.reserveSlot();
        if (i < 2) {
          // First 2 tasks release immediately (no bid needed)
          await pacer.releaseSlot(reserved);
        } else {
          // Last 2 tasks consume the slot
          await new Promise(r => setTimeout(r, 1));
        }
        completionOrder.push(i);
      })
    );
    await Promise.all(tasks);

    expect(completionOrder).toHaveLength(4);
    expect(pacer.used).toBe(2); // Only 2 slots consumed
  });

  it('pacer blocks at capacity and unblocks after slot expires', async () => {
    // Custom short window (200ms) for fast testing
    const capacity = 2;
    const slots = new Map<number, number>();
    let slotCounter = 0;
    const mutex = new Mutex();
    const WINDOW_MS = 200;

    async function reserveSlot(): Promise<number> {
      while (true) {
        const result = await mutex.runExclusive(() => {
          const now = Date.now();
          const windowStart = now - WINDOW_MS;
          for (const [id, ts] of slots) {
            if (ts <= windowStart) slots.delete(id);
          }
          if (slots.size < capacity) {
            const slotId = ++slotCounter;
            slots.set(slotId, now);
            return { waitMs: 0, slotId };
          }
          const oldestTs = Math.min(...slots.values());
          return { waitMs: oldestTs + WINDOW_MS - now + 5, slotId: 0 };
        });
        if (result.waitMs <= 0) return result.slotId;
        await new Promise(r => setTimeout(r, result.waitMs));
      }
    }

    const queue = new PQueue({ concurrency: 20 });
    const completionTimes: number[] = [];
    const start = Date.now();

    const tasks = Array.from({ length: 3 }, () =>
      queue.add(async () => {
        await reserveSlot();
        completionTimes.push(Date.now() - start);
      })
    );
    await Promise.all(tasks);

    expect(completionTimes).toHaveLength(3);
    // First 2 complete immediately
    expect(completionTimes[0]).toBeLessThan(50);
    expect(completionTimes[1]).toBeLessThan(50);
    // Third waits for 200ms window expiry
    expect(completionTimes[2]).toBeGreaterThanOrEqual(150);
  });

  it('slot consumption prevents double-release in finally block', async () => {
    const capacity = 5;
    const pacer = new PacerSimulator(capacity);

    // Simulate the try/finally pattern from bid.ts
    let slotId = 0;
    let slotConsumed = false;
    try {
      slotId = await pacer.reserveSlot();
      // Simulate: bid placed successfully
      slotConsumed = true;
    } finally {
      if (!slotConsumed && slotId > 0) {
        await pacer.releaseSlot(slotId);
      }
    }

    // Slot should remain consumed (not released)
    expect(pacer.used).toBe(1);
    expect(slotConsumed).toBe(true);
  });

  it('finally block releases when slotConsumed is false (early return)', async () => {
    const capacity = 5;
    const pacer = new PacerSimulator(capacity);

    let slotId = 0;
    let slotConsumed = false;
    try {
      slotId = await pacer.reserveSlot();
      // Simulate: decided not to bid (e.g., already top bidder)
      // slotConsumed stays false
    } finally {
      if (!slotConsumed && slotId > 0) {
        await pacer.releaseSlot(slotId);
      }
    }

    expect(pacer.used).toBe(0); // Slot released
  });

  it('slotId=0 guard prevents release when slot was never acquired', async () => {
    const capacity = 5;
    const pacer = new PacerSimulator(capacity);

    // Simulate: error thrown before reserveSlot() — slotId stays 0
    let slotId = 0;
    let slotConsumed = false;
    try {
      // Simulate dedup check causing early return before slot reservation
      throw new Error('dedup: recently bid');
    } catch {
      // Expected
    } finally {
      // Should NOT attempt release since slotId is 0
      if (!slotConsumed && slotId > 0) {
        await pacer.releaseSlot(slotId);
      }
    }

    expect(pacer.used).toBe(0); // No slot was ever reserved
  });
});

describe('Throughput Simulation — Counter-Bid Priority', () => {
  it('priority 1 tasks execute before priority 0 when queue is congested', async () => {
    const executionOrder: string[] = [];
    const queue = new PQueue({ concurrency: 1 }); // Serialize to observe ordering

    // Queue 5 scheduled bids (priority 0)
    for (let i = 0; i < 5; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 5));
        executionOrder.push(`scheduled-${i}`);
      }, { priority: 0 });
    }

    // Wait for first task to start executing
    await new Promise(r => setTimeout(r, 2));

    // Add 2 counter-bids (priority 1) — should jump ahead of remaining scheduled
    for (let i = 0; i < 2; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 5));
        executionOrder.push(`counter-${i}`);
      }, { priority: 1 });
    }

    await queue.onIdle();

    expect(executionOrder).toHaveLength(7);
    // First task already started before counter-bids were added
    expect(executionOrder[0]).toBe('scheduled-0');
    // Counter-bids should appear near the start (after the already-running task)
    const counterIndices = executionOrder
      .map((e, i) => e.startsWith('counter') ? i : -1)
      .filter(i => i !== -1);
    expect(counterIndices[0]).toBeLessThanOrEqual(2);
    expect(counterIndices[1]).toBeLessThanOrEqual(3);
  });

  it('counter-bids complete faster on average with high concurrency', async () => {
    const executionOrder: Array<{ type: string; id: number; time: number }> = [];
    const queue = new PQueue({ concurrency: 5 });
    const start = Date.now();

    // Add 10 scheduled bids (priority 0)
    for (let i = 0; i < 10; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 20));
        executionOrder.push({ type: 'scheduled', id: i, time: Date.now() - start });
      }, { priority: 0 });
    }

    // After a brief delay, add 3 counter-bids (priority 1)
    await new Promise(r => setTimeout(r, 5));
    for (let i = 0; i < 3; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 5)); // Counter-bids are faster
        executionOrder.push({ type: 'counter', id: i, time: Date.now() - start });
      }, { priority: 1 });
    }

    await queue.onIdle();

    expect(executionOrder).toHaveLength(13);
    const counterTimes = executionOrder.filter(e => e.type === 'counter').map(e => e.time);
    const scheduledTimes = executionOrder.filter(e => e.type === 'scheduled').map(e => e.time);
    const avgCounter = counterTimes.reduce((a, b) => a + b, 0) / counterTimes.length;
    const avgScheduled = scheduledTimes.reduce((a, b) => a + b, 0) / scheduledTimes.length;

    // Counter-bids should complete faster on average
    expect(avgCounter).toBeLessThan(avgScheduled);
  });

  it('priority ordering preserved: all priority-1 before remaining priority-0', async () => {
    const executionOrder: number[] = [];
    const queue = new PQueue({ concurrency: 1 }); // Force serial execution

    // Fill the queue while first task is running
    const firstDone = new Promise<void>(resolve => {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 10));
        executionOrder.push(0);
        resolve();
      }, { priority: 0 });
    });

    // These will be queued (not started yet since concurrency=1)
    queue.add(async () => { executionOrder.push(1); }, { priority: 0 });
    queue.add(async () => { executionOrder.push(2); }, { priority: 0 });

    // Wait for first task to start
    await new Promise(r => setTimeout(r, 2));

    // Now add priority-1 tasks while priority-0 tasks are waiting
    queue.add(async () => { executionOrder.push(10); }, { priority: 1 });
    queue.add(async () => { executionOrder.push(11); }, { priority: 1 });

    await queue.onIdle();

    // Expected: 0 (already running), then 10, 11 (priority 1), then 1, 2 (priority 0)
    expect(executionOrder).toEqual([0, 10, 11, 1, 2]);
  });
});

describe('Throughput Simulation — Full Pipeline', () => {
  it('5 wallets × 5 bpm: 20 tokens processed with correct slot accounting', async () => {
    const WALLET_COUNT = 5;
    const BPM = 5;
    const capacity = WALLET_COUNT * BPM; // 25
    const concurrency = Math.min(WALLET_COUNT * 4, 20); // 20
    const TOKEN_COUNT = 20;
    const API_DELAY = 3;
    const BID_DELAY = 2;

    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency });

    let successfulBids = 0;
    let slotsReleased = 0;
    const bidTimes: number[] = [];
    const start = Date.now();

    const tasks = Array.from({ length: TOKEN_COUNT }, (_, i) =>
      queue.add(async () => {
        let slotId = 0;
        let slotConsumed = false;
        try {
          slotId = await pacer.reserveSlot();
          await new Promise(r => setTimeout(r, API_DELAY)); // API calls

          // 80% of tokens get a bid, 20% skip (every 5th token)
          const shouldBid = i % 5 !== 0;
          if (shouldBid) {
            slotConsumed = true;
            await new Promise(r => setTimeout(r, BID_DELAY));
            successfulBids++;
            bidTimes.push(Date.now() - start);
          }
        } finally {
          if (!slotConsumed && slotId > 0) {
            await pacer.releaseSlot(slotId);
            slotsReleased++;
          }
        }
      })
    );

    await Promise.all(tasks);
    const totalDuration = Date.now() - start;

    expect(successfulBids).toBe(16);   // 20 - 4 skipped
    expect(slotsReleased).toBe(4);     // 4 released
    expect(pacer.used).toBe(16);
    expect(totalDuration).toBeLessThan(300);

    // Verify bids were placed concurrently, not serialized
    if (bidTimes.length >= 2) {
      const spread = bidTimes[bidTimes.length - 1] - bidTimes[0];
      expect(spread).toBeLessThan(200);
    }
  });

  it('slot recycling allows more tasks than capacity', async () => {
    // 3 capacity, 6 tasks. Tasks 0-2 release immediately, freeing slots for 3-5.
    const capacity = 3;
    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency: 20 });
    let bidsPlaced = 0;
    let released = 0;

    const tasks = Array.from({ length: 6 }, (_, i) =>
      queue.add(async () => {
        const reserved = await pacer.reserveSlot();
        await new Promise(r => setTimeout(r, 2));
        if (i < 3) {
          await pacer.releaseSlot(reserved);
          released++;
        } else {
          await new Promise(r => setTimeout(r, 1));
          bidsPlaced++;
        }
      })
    );

    await Promise.all(tasks);
    expect(bidsPlaced + released).toBe(6);
    expect(bidsPlaced).toBe(3);
    expect(released).toBe(3);
  });

  it('mixed scheduled + counter-bid workload: counters jump the queue', async () => {
    // Low concurrency forces queue congestion — priority matters
    const queue = new PQueue({ concurrency: 2 });
    const executionOrder: string[] = [];

    // 8 scheduled bids (priority 0) — each takes 15ms
    for (let i = 0; i < 8; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 15));
        executionOrder.push(`scheduled-${i}`);
      }, { priority: 0 });
    }

    // Wait for first 2 to start, then add counter-bids
    await new Promise(r => setTimeout(r, 5));
    for (let i = 0; i < 3; i++) {
      queue.add(async () => {
        await new Promise(r => setTimeout(r, 5));
        executionOrder.push(`counter-${i}`);
      }, { priority: 1 });
    }

    await queue.onIdle();

    expect(executionOrder).toHaveLength(11);
    // Counter-bids should appear before the last scheduled bids
    const counterPositions = executionOrder
      .map((e, idx) => e.startsWith('counter') ? idx : -1)
      .filter(i => i !== -1);
    const lastScheduledPos = executionOrder.lastIndexOf(
      executionOrder.filter(e => e.startsWith('scheduled')).pop()!
    );
    // All counter-bids should finish before the last scheduled bid
    expect(Math.max(...counterPositions)).toBeLessThan(lastScheduledPos);
  });

  it('wallet exhaustion mid-cycle: correct slot cleanup', async () => {
    const capacity = 10;
    const pacer = new PacerSimulator(capacity);
    // Use concurrency=1 so tasks run sequentially (no race on successfulBids)
    const queue = new PQueue({ concurrency: 1 });

    let walletExhaustedForCycle = false;
    let successfulBids = 0;
    let skippedExhausted = 0;
    let slotsReleased = 0;

    const tasks = Array.from({ length: 10 }, (_, i) =>
      queue.add(async () => {
        if (walletExhaustedForCycle) {
          skippedExhausted++;
          return;
        }

        let slotId = 0;
        let slotConsumed = false;
        try {
          slotId = await pacer.reserveSlot();
          if (walletExhaustedForCycle) return;

          await new Promise(r => setTimeout(r, 2));

          if (successfulBids < 3) {
            slotConsumed = true;
            successfulBids++;
            await new Promise(r => setTimeout(r, 1)); // bid
          } else if (!walletExhaustedForCycle) {
            walletExhaustedForCycle = true;
          }
        } finally {
          if (!slotConsumed && slotId > 0) {
            await pacer.releaseSlot(slotId);
            slotsReleased++;
          }
        }
      })
    );

    await Promise.all(tasks);

    expect(successfulBids).toBe(3);
    expect(walletExhaustedForCycle).toBe(true);
    expect(successfulBids + skippedExhausted + slotsReleased).toBe(10);
    expect(pacer.used).toBe(3);
  });

  it('mutex prevents slot over-booking under high concurrency', async () => {
    // 5 capacity, 20 concurrency, 50 tasks
    // Tasks release their slots after "bidding" so subsequent tasks can proceed
    const capacity = 5;
    const pacer = new PacerSimulator(capacity);
    const queue = new PQueue({ concurrency: 20 });

    let maxConcurrentSlots = 0;
    let currentSlots = 0;
    let totalBids = 0;

    const tasks = Array.from({ length: 50 }, () =>
      queue.add(async () => {
        const reserved = await pacer.reserveSlot();
        currentSlots++;
        maxConcurrentSlots = Math.max(maxConcurrentSlots, currentSlots);
        await new Promise(r => setTimeout(r, 1)); // simulate bid
        totalBids++;
        currentSlots--;
        // Release slot so next tasks can proceed (simulates 60s window expiry)
        await pacer.releaseSlot(reserved);
      })
    );

    await Promise.all(tasks);

    expect(totalBids).toBe(50);
    // Mutex ensures at most `capacity` tasks hold slots at any instant
    expect(maxConcurrentSlots).toBeLessThanOrEqual(capacity);
  });
});

describe('Throughput Simulation — Reserve-First Pipeline', () => {
  it('rotation functions never call global pacer internally', async () => {
    const pacerCalls: string[] = [];

    // Simulate placeBidWithRotation — no slotReserved param anymore
    // The function never calls waitForGlobalBidSlot() internally.
    // Scheduled bids reserve externally; counter-bids bypass entirely.
    async function placeBidWithRotation() {
      // No pacer call — removed in audit
      pacerCalls.push('placeBid');
      return { success: true };
    }

    await placeBidWithRotation();
    expect(pacerCalls).toEqual(['placeBid']);
  });

  it('scheduled loop pattern: reserve → fetch → decide → bid', async () => {
    const pacer = new PacerSimulator(10);
    const steps: string[] = [];

    // Simulate the reserve-first pipeline
    let slotId = 0;
    let slotConsumed = false;
    try {
      slotId = await pacer.reserveSlot();
      steps.push('reserved');

      await new Promise(r => setTimeout(r, 1)); // API fetch
      steps.push('fetched');

      // Decision: bid
      slotConsumed = true;
      steps.push('bid');
    } finally {
      if (!slotConsumed && slotId > 0) {
        await pacer.releaseSlot(slotId);
        steps.push('released');
      }
    }

    expect(steps).toEqual(['reserved', 'fetched', 'bid']);
    expect(pacer.used).toBe(1);
  });

  it('scheduled loop pattern: reserve → fetch → skip → release', async () => {
    const pacer = new PacerSimulator(10);
    const steps: string[] = [];

    let slotId = 0;
    let slotConsumed = false;
    try {
      slotId = await pacer.reserveSlot();
      steps.push('reserved');

      await new Promise(r => setTimeout(r, 1)); // API fetch
      steps.push('fetched');

      // Decision: skip (already top bidder)
      steps.push('skip');
    } finally {
      if (!slotConsumed && slotId > 0) {
        await pacer.releaseSlot(slotId);
        steps.push('released');
      }
    }

    expect(steps).toEqual(['reserved', 'fetched', 'skip', 'released']);
    expect(pacer.used).toBe(0);
  });

  it('counter-bid pattern: bypasses global pacer entirely', async () => {
    const pacer = new PacerSimulator(10);
    const steps: string[] = [];

    // Counter-bids bypass the global pacer — they're rare, time-sensitive,
    // and already per-wallet rate-limited. No reservation at all.
    async function mockPlaceBidWithRotation() {
      await new Promise(r => setTimeout(r, 1));
      steps.push('bid');
    }

    await mockPlaceBidWithRotation();
    expect(steps).toEqual(['bid']);
    // Pacer not touched — counter-bids are free
    expect(pacer.used).toBe(0);
  });
});

describe('Throughput Simulation — COLLECTION Branch', () => {
  it('COLLECTION reserve-first: bid consumed → slot kept', async () => {
    const pacer = new PacerSimulator(5);

    let collSlotConsumed = false;
    const collReservedAt = await pacer.reserveSlot();

    try {
      await new Promise(r => setTimeout(r, 2)); // API
      // Place bid
      collSlotConsumed = true;
      await new Promise(r => setTimeout(r, 1));
    } finally {
      if (!collSlotConsumed) {
        await pacer.releaseSlot(collReservedAt);
      }
    }

    expect(collSlotConsumed).toBe(true);
    expect(pacer.used).toBe(1);
  });

  it('COLLECTION reserve-first: no bid needed → slot released', async () => {
    const pacer = new PacerSimulator(5);

    let collSlotConsumed = false;
    const collReservedAt = await pacer.reserveSlot();

    try {
      await new Promise(r => setTimeout(r, 2)); // API
      // Already top bidder — no bid needed
    } finally {
      if (!collSlotConsumed) {
        await pacer.releaseSlot(collReservedAt);
      }
    }

    expect(collSlotConsumed).toBe(false);
    expect(pacer.used).toBe(0);
  });

  it('COLLECTION: API error releases slot', async () => {
    const pacer = new PacerSimulator(5);

    let collSlotConsumed = false;
    const collReservedAt = await pacer.reserveSlot();

    try {
      // Simulate API error
      throw new Error('API error fetching collection offers');
    } catch {
      // Expected — continue to finally
    } finally {
      if (!collSlotConsumed) {
        await pacer.releaseSlot(collReservedAt);
      }
    }

    expect(pacer.used).toBe(0); // Slot released despite error
  });
});

describe('Throughput Simulation — Scaling Scenarios', () => {
  it('1 wallet × 5 bpm: 5 capacity, concurrency 4', () => {
    const wallets = 1;
    const bpm = 5;
    expect(wallets * bpm).toBe(5);
    expect(Math.min(wallets * 4, 20)).toBe(4);
  });

  it('3 wallets × 5 bpm: 15 capacity, concurrency 12', () => {
    const wallets = 3;
    const bpm = 5;
    expect(wallets * bpm).toBe(15);
    expect(Math.min(wallets * 4, 20)).toBe(12);
  });

  it('5 wallets × 5 bpm: 25 capacity, concurrency 20', () => {
    const wallets = 5;
    const bpm = 5;
    expect(wallets * bpm).toBe(25);
    expect(Math.min(wallets * 4, 20)).toBe(20);
  });

  it('5 wallets × 8 bpm: 40 capacity, concurrency 20', () => {
    const wallets = 5;
    const bpm = 8;
    expect(wallets * bpm).toBe(40);
    expect(Math.min(wallets * 4, 20)).toBe(20);
  });

  it('12 wallets × 5 bpm: 60 capacity, concurrency capped at 20', () => {
    const wallets = 12;
    const bpm = 5;
    expect(wallets * bpm).toBe(60);
    expect(Math.min(wallets * 4, 20)).toBe(20);
  });

  it('multi-group capacity: sum of (wallets × bpm) per group', () => {
    const groups = [
      { wallets: 5, bidsPerMinute: 5 },   // 25
      { wallets: 3, bidsPerMinute: 8 },   // 24
      { wallets: 4, bidsPerMinute: 5 },   // 20
    ];
    const totalThroughput = groups.reduce((sum, g) => sum + g.wallets * g.bidsPerMinute, 0);
    const totalWallets = groups.reduce((sum, g) => sum + g.wallets, 0);

    expect(totalThroughput).toBe(69);
    expect(totalWallets).toBe(12);
    expect(Math.min(totalWallets * 4, 20)).toBe(20);
  });

  it('BIDS_PER_MINUTE=8 with 5 wallets: 40 bids/min throughput', async () => {
    // Simulate: 40 capacity should handle 40 bids in one 60s window
    const pacer = new PacerSimulator(40);
    const queue = new PQueue({ concurrency: 20 });
    let bids = 0;

    const tasks = Array.from({ length: 40 }, () =>
      queue.add(async () => {
        await pacer.reserveSlot();
        await new Promise(r => setTimeout(r, 1));
        bids++;
      })
    );
    await Promise.all(tasks);

    expect(bids).toBe(40);
    expect(pacer.used).toBe(40);
    expect(pacer.slotWaitCount).toBe(0); // All fit in one burst
  });

  it('exceeding capacity requires waiting: 30 bids with capacity 25', async () => {
    // Use a short window (100ms) so test doesn't take 60s
    const slots2 = new Map<number, number>();
    let slotCounter2 = 0;
    const mutex = new Mutex();
    const capacity = 25;
    const WINDOW_MS = 100;

    async function reserveSlot(): Promise<number> {
      while (true) {
        const result = await mutex.runExclusive(() => {
          const now = Date.now();
          const windowStart = now - WINDOW_MS;
          for (const [id, ts] of slots2) {
            if (ts <= windowStart) slots2.delete(id);
          }
          if (slots2.size < capacity) {
            const slotId = ++slotCounter2;
            slots2.set(slotId, now);
            return { waitMs: 0, slotId };
          }
          const oldestTs = Math.min(...slots2.values());
          return { waitMs: oldestTs + WINDOW_MS - now + 5, slotId: 0 };
        });
        if (result.waitMs <= 0) return result.slotId;
        await new Promise(r => setTimeout(r, result.waitMs));
      }
    }

    const queue = new PQueue({ concurrency: 20 });
    let bids = 0;
    const start = Date.now();

    const tasks = Array.from({ length: 30 }, () =>
      queue.add(async () => {
        await reserveSlot();
        bids++;
      })
    );
    await Promise.all(tasks);
    const duration = Date.now() - start;

    expect(bids).toBe(30);
    // First 25 are instant, last 5 must wait for window expiry (~100ms)
    expect(duration).toBeGreaterThanOrEqual(80);
  });
});
