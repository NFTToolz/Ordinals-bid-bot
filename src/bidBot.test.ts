/**
 * Tests for the BidBot factory function.
 *
 * These tests verify that the bidBot module can be tested in isolation
 * without triggering the side effects that make bid.ts untestable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
  createBidBot,
  loadCollections,
  loadBidHistoryFromFile,
  BotValidationError,
  BotConfigError,
  BotInitError,
} from './bidBot';

import type { BotOptions, CollectionConfig, BidBot } from './bidBot';

// Mock external dependencies
vi.mock('./utils/logger', () => ({
  default: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    bidPlaced: vi.fn(),
    bidSkipped: vi.fn(),
    bidCancelled: vi.fn(),
    bidAdjusted: vi.fn(),
    scheduleStart: vi.fn(),
    scheduleComplete: vi.fn(),
    printStats: vi.fn(),
    websocket: {
      connected: vi.fn(),
      disconnected: vi.fn(),
      error: vi.fn(),
      subscribed: vi.fn(),
      maxRetriesExceeded: vi.fn(),
    },
    memory: {
      status: vi.fn(),
      cleanup: vi.fn(),
      warning: vi.fn(),
      critical: vi.fn(),
    },
    schedule: {
      skipping: vi.fn(),
      rateLimited: vi.fn(),
    },
    pacer: {
      cycleStart: vi.fn(),
      error: vi.fn(),
    },
    queue: {
      waiting: vi.fn(),
      progress: vi.fn(),
    },
    wallet: {
      using: vi.fn(),
      allRateLimited: vi.fn(),
    },
    collectionOfferPlaced: vi.fn(),
    summary: {
      bidPlacement: vi.fn(),
    },
    tokens: {
      retrieved: vi.fn(),
      firstListings: vi.fn(),
    },
  },
  getBidStatsData: vi.fn(() => ({
    bidsPlaced: 0,
    bidsSkipped: 0,
    bidsCancelled: 0,
    bidsAdjusted: 0,
    errors: 0,
  })),
}));

vi.mock('./utils/bidPacer', () => ({
  initializeBidPacer: vi.fn(),
  waitForBidSlot: vi.fn(() => Promise.resolve()),
  recordBid: vi.fn(),
  onRateLimitError: vi.fn(),
  getBidPacerStatus: vi.fn(() => ({
    bidsUsed: 0,
    bidsRemaining: 5,
    windowResetIn: 60,
    totalBidsPlaced: 0,
    totalWaits: 0,
  })),
  isGloballyRateLimited: vi.fn(() => false),
  getGlobalResetWaitTime: vi.fn(() => 0),
  logBidPacerStatus: vi.fn(),
}));

vi.mock('./utils/walletPool', () => ({
  initializeWalletPool: vi.fn(),
  getAvailableWallet: vi.fn(),
  getAvailableWalletAsync: vi.fn(),
  recordBid: vi.fn(),
  decrementBidCount: vi.fn(),
  getWalletByPaymentAddress: vi.fn(),
  getWalletPoolStats: vi.fn(() => ({
    available: 0,
    total: 0,
    bidsPerMinute: 5,
    wallets: [],
  })),
  isWalletPoolInitialized: vi.fn(() => false),
  getWalletPool: vi.fn(),
}));

vi.mock('./utils/walletGroups', () => ({
  initializeWalletGroupManager: vi.fn(() => ({
    getGroupNames: vi.fn(() => []),
    getTotalWalletCount: vi.fn(() => 0),
    getGroupStats: vi.fn(),
    hasGroup: vi.fn(() => false),
    getAvailableWalletAsync: vi.fn(),
    getAllPaymentAddresses: vi.fn(() => []),
    getAllReceiveAddresses: vi.fn(() => []),
    getAllStats: vi.fn(() => []),
  })),
  getWalletGroupManager: vi.fn(),
  isWalletGroupManagerInitialized: vi.fn(() => false),
}));

// Create a temp directory for test files
const testDataDir = path.join(__dirname, '../.test-data');

describe('loadCollections', () => {
  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should throw BotConfigError if file does not exist', () => {
    expect(() => loadCollections('/non/existent/path.json')).toThrow(BotConfigError);
    expect(() => loadCollections('/non/existent/path.json')).toThrow(/Config file not found/);
  });

  it('should throw BotConfigError for invalid JSON', () => {
    const filePath = path.join(testDataDir, 'invalid.json');
    fs.writeFileSync(filePath, '{ invalid json }');

    expect(() => loadCollections(filePath)).toThrow(BotConfigError);
    expect(() => loadCollections(filePath)).toThrow(/Invalid JSON/);
  });

  it('should throw BotValidationError if not an array', () => {
    const filePath = path.join(testDataDir, 'not-array.json');
    fs.writeFileSync(filePath, JSON.stringify({ collections: [] }));

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/must be an array/);
  });

  it('should throw BotValidationError for invalid collection object', () => {
    const filePath = path.join(testDataDir, 'invalid-object.json');
    fs.writeFileSync(filePath, JSON.stringify(['not an object']));

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/not a valid object/);
  });

  it('should throw BotValidationError for missing required fields', () => {
    const filePath = path.join(testDataDir, 'missing-fields.json');
    fs.writeFileSync(filePath, JSON.stringify([{ collectionSymbol: 'test' }]));

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/minBid/);
  });

  it('should throw BotValidationError for invalid offerType', () => {
    const filePath = path.join(testDataDir, 'invalid-offer.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'INVALID',
        },
      ])
    );

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/offerType must be/);
  });

  it('should throw BotValidationError when minBid > maxBid', () => {
    const filePath = path.join(testDataDir, 'min-greater.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.1,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'ITEM',
        },
      ])
    );

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/minBid.*cannot be greater than maxBid/);
  });

  it('should throw BotValidationError when minFloorBid > maxFloorBid', () => {
    const filePath = path.join(testDataDir, 'floor-greater.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 90,
          maxFloorBid: 50,
          offerType: 'ITEM',
        },
      ])
    );

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/minFloorBid.*cannot be greater than maxFloorBid/);
  });

  it('should throw BotValidationError for invalid bidCount', () => {
    const filePath = path.join(testDataDir, 'invalid-bidcount.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'ITEM',
          bidCount: -5,
        },
      ])
    );

    expect(() => loadCollections(filePath)).toThrow(BotValidationError);
    expect(() => loadCollections(filePath)).toThrow(/bidCount must be a positive number/);
  });

  it('should load valid collections successfully', () => {
    const filePath = path.join(testDataDir, 'valid.json');
    const validCollections = [
      {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 80,
        offerType: 'ITEM',
        bidCount: 10,
      },
      {
        collectionSymbol: 'test-collection-2',
        minBid: 0.002,
        maxBid: 0.02,
        minFloorBid: 40,
        maxFloorBid: 90,
        offerType: 'COLLECTION',
      },
    ];
    fs.writeFileSync(filePath, JSON.stringify(validCollections));

    const result = loadCollections(filePath);
    expect(result).toHaveLength(2);
    expect(result[0].collectionSymbol).toBe('test-collection');
    expect(result[1].offerType).toBe('COLLECTION');
  });

  it('should return empty array for empty collections file', () => {
    const filePath = path.join(testDataDir, 'empty.json');
    fs.writeFileSync(filePath, '[]');

    const result = loadCollections(filePath);
    expect(result).toHaveLength(0);
  });
});

describe('loadBidHistoryFromFile', () => {
  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should return empty object if file does not exist', () => {
    const result = loadBidHistoryFromFile('/non/existent/path.json', []);
    expect(result).toEqual({});
  });

  it('should return empty object for corrupted JSON', () => {
    const filePath = path.join(testDataDir, 'corrupted.json');
    fs.writeFileSync(filePath, '{ corrupted }');

    const result = loadBidHistoryFromFile(filePath, []);
    expect(result).toEqual({});
  });

  it('should restore quantities for active collections', () => {
    const filePath = path.join(testDataDir, 'history.json');
    const savedHistory = {
      'active-collection': { quantity: 5 },
      'inactive-collection': { quantity: 3 },
    };
    fs.writeFileSync(filePath, JSON.stringify(savedHistory));

    const collections: CollectionConfig[] = [
      {
        collectionSymbol: 'active-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 80,
        offerType: 'ITEM',
      },
    ];

    const result = loadBidHistoryFromFile(filePath, collections);
    expect(result['active-collection']).toBeDefined();
    expect(result['active-collection'].quantity).toBe(5);
    expect(result['inactive-collection']).toBeUndefined();
  });

  it('should not restore zero quantities', () => {
    const filePath = path.join(testDataDir, 'zero-qty.json');
    const savedHistory = {
      'test-collection': { quantity: 0 },
    };
    fs.writeFileSync(filePath, JSON.stringify(savedHistory));

    const collections: CollectionConfig[] = [
      {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 80,
        offerType: 'ITEM',
      },
    ];

    const result = loadBidHistoryFromFile(filePath, collections);
    expect(result['test-collection']).toBeUndefined();
  });
});

describe('createBidBot', () => {
  let bot: BidBot | null = null;

  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up bot if running
    if (bot && bot.isRunning()) {
      await bot.stop();
    }
    bot = null;

    // Clean up test files
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should throw BotConfigError for missing tokenReceiveAddress in non-dry-run mode', async () => {
    await expect(
      createBidBot({
        dryRun: false,
        fundingWIF: 'test-wif',
        apiKey: 'test-api-key',
        collections: [],
      })
    ).rejects.toThrow(BotConfigError);
    await expect(
      createBidBot({
        dryRun: false,
        fundingWIF: 'test-wif',
        apiKey: 'test-api-key',
        collections: [],
      })
    ).rejects.toThrow(/tokenReceiveAddress is required/);
  });

  it('should throw BotConfigError for missing fundingWIF in non-dry-run mode', async () => {
    await expect(
      createBidBot({
        dryRun: false,
        tokenReceiveAddress: 'bc1test',
        apiKey: 'test-api-key',
        collections: [],
      })
    ).rejects.toThrow(BotConfigError);
    await expect(
      createBidBot({
        dryRun: false,
        tokenReceiveAddress: 'bc1test',
        apiKey: 'test-api-key',
        collections: [],
      })
    ).rejects.toThrow(/fundingWIF is required/);
  });

  it('should throw BotConfigError for missing apiKey in non-dry-run mode', async () => {
    await expect(
      createBidBot({
        dryRun: false,
        tokenReceiveAddress: 'bc1test',
        fundingWIF: 'test-wif',
        collections: [],
      })
    ).rejects.toThrow(BotConfigError);
    await expect(
      createBidBot({
        dryRun: false,
        tokenReceiveAddress: 'bc1test',
        fundingWIF: 'test-wif',
        collections: [],
      })
    ).rejects.toThrow(/apiKey is required/);
  });

  it('should create bot successfully in dry run mode without credentials', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    expect(bot).toBeDefined();
    expect(bot.isRunning()).toBe(false);
  });

  it('should accept pre-loaded collections via options', async () => {
    const collections: CollectionConfig[] = [
      {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 80,
        offerType: 'ITEM',
      },
    ];

    bot = await createBidBot({
      dryRun: true,
      collections,
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    expect(bot.getCollections()).toHaveLength(1);
    expect(bot.getCollections()[0].collectionSymbol).toBe('test-collection');
  });

  it('should start and stop cleanly', async () => {
    bot = await createBidBot({
      dryRun: true,
      skipWebSocket: true,
      skipScheduledLoop: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    expect(bot.isRunning()).toBe(false);

    await bot.start();
    expect(bot.isRunning()).toBe(true);

    await bot.stop();
    expect(bot.isRunning()).toBe(false);
  });

  it('should return stats', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    const stats = bot.getStats();
    expect(stats).toBeDefined();
    expect(stats.collectionsCount).toBe(0);
    expect(stats.bidsPlaced).toBe(0);
    expect(stats.websocketConnected).toBe(false);
    expect(typeof stats.uptimeSeconds).toBe('number');
    expect(typeof stats.memoryUsedMB).toBe('number');
  });

  it('should return initial state', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    const state = bot.getState();
    expect(state).toBeDefined();
    expect(state.bidHistory).toEqual({});
    expect(state.recentBids).toBeInstanceOf(Map);
    expect(state.processedPurchaseEvents).toBeInstanceOf(Map);
    expect(state.restart).toBe(true);
  });

  it('should not start twice', async () => {
    bot = await createBidBot({
      dryRun: true,
      skipWebSocket: true,
      skipScheduledLoop: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    await bot.start();
    expect(bot.isRunning()).toBe(true);

    // Second start should be a no-op
    await bot.start();
    expect(bot.isRunning()).toBe(true);

    await bot.stop();
  });

  it('should handle stop when not running', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    expect(bot.isRunning()).toBe(false);

    // Stop should be a no-op
    await bot.stop();
    expect(bot.isRunning()).toBe(false);
  });

  it('should handle placeBid in dry run mode', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    const result = await bot.placeBid('test-collection', 'token123', 1000000);
    expect(result.success).toBe(true);
  });

  it('should handle cancelBid in dry run mode', async () => {
    bot = await createBidBot({
      dryRun: true,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    const result = await bot.cancelBid('offer123');
    expect(result).toBe(true);
  });
});

describe('BotValidationError', () => {
  it('should have correct name', () => {
    const error = new BotValidationError('test message');
    expect(error.name).toBe('BotValidationError');
    expect(error.message).toBe('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BotValidationError);
  });
});

describe('BotConfigError', () => {
  it('should have correct name', () => {
    const error = new BotConfigError('test message');
    expect(error.name).toBe('BotConfigError');
    expect(error.message).toBe('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BotConfigError);
  });
});

describe('BotInitError', () => {
  it('should have correct name', () => {
    const error = new BotInitError('test message');
    expect(error.name).toBe('BotInitError');
    expect(error.message).toBe('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BotInitError);
  });
});

describe('Collection Config Validation Edge Cases', () => {
  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should accept valid COLLECTION offerType', () => {
    const filePath = path.join(testDataDir, 'collection-offer.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'COLLECTION',
        },
      ])
    );

    const result = loadCollections(filePath);
    expect(result[0].offerType).toBe('COLLECTION');
  });

  it('should accept equal minBid and maxBid', () => {
    const filePath = path.join(testDataDir, 'equal-bids.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.01,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'ITEM',
        },
      ])
    );

    const result = loadCollections(filePath);
    expect(result[0].minBid).toBe(result[0].maxBid);
  });

  it('should accept equal minFloorBid and maxFloorBid', () => {
    const filePath = path.join(testDataDir, 'equal-floor.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 75,
          maxFloorBid: 75,
          offerType: 'ITEM',
        },
      ])
    );

    const result = loadCollections(filePath);
    expect(result[0].minFloorBid).toBe(result[0].maxFloorBid);
  });

  it('should accept negative minFloorBid', () => {
    const filePath = path.join(testDataDir, 'negative-floor.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: -10,
          maxFloorBid: 80,
          offerType: 'ITEM',
        },
      ])
    );

    const result = loadCollections(filePath);
    expect(result[0].minFloorBid).toBe(-10);
  });

  it('should preserve optional fields when present', () => {
    const filePath = path.join(testDataDir, 'optional-fields.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        {
          collectionSymbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 80,
          offerType: 'ITEM',
          outBidMargin: 0.00001,
          bidCount: 15,
          duration: 45,
          enableCounterBidding: true,
          scheduledLoop: 120,
          feeSatsPerVbyte: 30,
          quantity: 5,
          walletGroup: 'default',
          traits: [{ traitType: 'rarity', value: 'legendary' }],
        },
      ])
    );

    const result = loadCollections(filePath);
    expect(result[0].outBidMargin).toBe(0.00001);
    expect(result[0].bidCount).toBe(15);
    expect(result[0].duration).toBe(45);
    expect(result[0].enableCounterBidding).toBe(true);
    expect(result[0].scheduledLoop).toBe(120);
    expect(result[0].feeSatsPerVbyte).toBe(30);
    expect(result[0].quantity).toBe(5);
    expect(result[0].walletGroup).toBe('default');
    expect(result[0].traits).toHaveLength(1);
  });
});

describe('BidBot State Management', () => {
  let bot: BidBot | null = null;

  beforeEach(() => {
    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (bot && bot.isRunning()) {
      await bot.stop();
    }
    bot = null;
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  it('should restore bid history from file', async () => {
    const historyPath = path.join(testDataDir, 'history.json');
    fs.writeFileSync(
      historyPath,
      JSON.stringify({
        'test-collection': { quantity: 3 },
      })
    );

    const collections: CollectionConfig[] = [
      {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 80,
        offerType: 'ITEM',
      },
    ];

    bot = await createBidBot({
      dryRun: true,
      collections,
      bidHistoryPath: historyPath,
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    const state = bot.getState();
    expect(state.bidHistory['test-collection']).toBeDefined();
    expect(state.bidHistory['test-collection'].quantity).toBe(3);
  });

  it('should initialize bid pacer with custom rate', async () => {
    const { initializeBidPacer } = await import('./utils/bidPacer');

    bot = await createBidBot({
      dryRun: true,
      bidsPerMinute: 10,
      collections: [],
      bidHistoryPath: path.join(testDataDir, 'history.json'),
      botStatsPath: path.join(testDataDir, 'stats.json'),
    });

    expect(initializeBidPacer).toHaveBeenCalledWith(10);
  });
});
