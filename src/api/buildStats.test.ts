import { describe, it, expect } from 'vitest';
import { buildRuntimeStats, StatsDependencies } from './buildStats';

function createMockDeps(overrides: Partial<StatsDependencies> = {}): StatsDependencies {
  return {
    bidStats: {
      bidsPlaced: 10,
      bidsSkipped: 2,
      bidsCancelled: 1,
      bidsAdjusted: 3,
      errors: 0,
    },
    pacer: {
      bidsUsed: 4,
      bidsRemaining: 1,
      windowResetIn: 30,
      totalBidsPlaced: 50,
      totalWaits: 5,
    },
    pacerLimit: 5,
    walletPool: null,
    walletGroups: null,
    eventQueueLength: 3,
    queueSize: 1,
    queuePending: 0,
    wsConnected: true,
    botStartTime: Date.now() - 60000,
    bidsTracked: 15,
    bidHistory: {},
    collections: [],
    ...overrides,
  };
}

describe('buildRuntimeStats', () => {
  it('should return correct structure with all fields', () => {
    const deps = createMockDeps();
    const stats = buildRuntimeStats(deps);

    expect(stats.timestamp).toBeGreaterThan(0);
    expect(stats.runtime.startTime).toBe(deps.botStartTime);
    expect(stats.runtime.uptimeSeconds).toBeGreaterThanOrEqual(59);
    expect(stats.bidStats.bidsPlaced).toBe(10);
    expect(stats.bidStats.bidsSkipped).toBe(2);
    expect(stats.bidStats.bidsCancelled).toBe(1);
    expect(stats.bidStats.bidsAdjusted).toBe(3);
    expect(stats.bidStats.errors).toBe(0);
    expect(stats.pacer.bidsUsed).toBe(4);
    expect(stats.pacer.bidsPerMinute).toBe(5);
    expect(stats.walletPool).toBeNull();
    expect(stats.walletGroups).toBeNull();
    expect(stats.totalWalletCount).toBe(0);
    expect(stats.queue.size).toBe(3);
    expect(stats.queue.pending).toBe(1);
    expect(stats.queue.active).toBe(0);
    expect(stats.websocket.connected).toBe(true);
    expect(stats.bidsTracked).toBe(15);
    expect(stats.memory.heapUsedMB).toBeGreaterThan(0);
    expect(stats.memory.heapTotalMB).toBeGreaterThan(0);
    expect(stats.memory.percentage).toBeGreaterThan(0);
  });

  it('should calculate totalWalletCount from walletGroups', () => {
    const deps = createMockDeps({
      walletGroups: {
        groupCount: 2,
        totalWallets: 5,
        groups: [
          { name: 'group1', available: 2, total: 3, bidsPerMinute: 5, wallets: [] },
          { name: 'group2', available: 1, total: 2, bidsPerMinute: 5, wallets: [] },
        ],
      },
    });
    const stats = buildRuntimeStats(deps);
    expect(stats.totalWalletCount).toBe(5);
  });

  it('should calculate totalWalletCount from walletPool', () => {
    const deps = createMockDeps({
      walletPool: {
        available: 3,
        total: 4,
        bidsPerMinute: 5,
        wallets: [],
      },
    });
    const stats = buildRuntimeStats(deps);
    expect(stats.totalWalletCount).toBe(4);
  });

  it('should prefer walletGroups over walletPool for totalWalletCount', () => {
    const deps = createMockDeps({
      walletGroups: {
        groupCount: 1,
        totalWallets: 7,
        groups: [],
      },
      walletPool: {
        available: 2,
        total: 3,
        bidsPerMinute: 5,
        wallets: [],
      },
    });
    const stats = buildRuntimeStats(deps);
    expect(stats.totalWalletCount).toBe(7);
  });

  it('should handle disconnected websocket', () => {
    const deps = createMockDeps({ wsConnected: false });
    const stats = buildRuntimeStats(deps);
    expect(stats.websocket.connected).toBe(false);
  });

  it('should pass through bidHistory and collections', () => {
    const bidHistory = {
      'test-collection': {
        offerType: 'ITEM' as const,
        ourBids: { 'token1': { price: 0.001, expiration: Date.now() + 60000 } },
        topBids: { 'token1': true },
        bottomListings: [],
        quantity: 0,
      },
    };
    const collections = [
      {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 97,
        bidCount: 20,
        duration: 60,
        enableCounterBidding: true,
        outBidMargin: 0.000001,
        offerType: 'ITEM' as const,
        quantity: 1,
      },
    ];
    const deps = createMockDeps({ bidHistory, collections });
    const stats = buildRuntimeStats(deps);
    expect(stats.bidHistory).toEqual(bidHistory);
    expect(stats.collections).toEqual(collections);
  });

  it('should pass through wallet pool data', () => {
    const walletPool = {
      available: 2,
      total: 3,
      bidsPerMinute: 5,
      wallets: [
        { label: 'w1', bidsInWindow: 2, isAvailable: true, secondsUntilReset: 0 },
        { label: 'w2', bidsInWindow: 5, isAvailable: false, secondsUntilReset: 15 },
      ],
    };
    const deps = createMockDeps({ walletPool });
    const stats = buildRuntimeStats(deps);
    expect(stats.walletPool).toEqual(walletPool);
  });
});
