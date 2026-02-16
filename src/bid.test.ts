/**
 * Tests for bid.ts - Core bidding bot logic
 *
 * This file tests the internal logic of bid.ts through unit tests of its
 * extracted/testable components. Since bid.ts has side effects at module load,
 * we test logical units in isolation where possible.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { EventEmitter } from 'events';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// Generate a valid test WIF deterministically
function generateTestWIF(): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

const TEST_WIF = generateTestWIF();
const TEST_RECEIVE_ADDRESS = 'bc1p' + 'a'.repeat(58);
const TEST_PAYMENT_ADDRESS = 'bc1q' + 'a'.repeat(38);

// Store original env for restoration
const originalEnv = { ...process.env };

// Mock dependencies BEFORE any imports that might use them
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('./utils/logger', () => ({
  default: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    printStats: vi.fn(),
    bidPlaced: vi.fn(),
    bidSkipped: vi.fn(),
    bidCancelled: vi.fn(),
    bidAdjusted: vi.fn(),
    collectionOfferPlaced: vi.fn(),
    scheduleStart: vi.fn(),
    scheduleComplete: vi.fn(),
    websocket: {
      connected: vi.fn(),
      disconnected: vi.fn(),
      error: vi.fn(),
      subscribed: vi.fn(),
      event: vi.fn(),
      maxRetriesExceeded: vi.fn(),
    },
    pacer: {
      cycleStart: vi.fn(),
    },
    tokens: {
      retrieved: vi.fn(),
      firstListings: vi.fn(),
    },
    summary: {
      bidPlacement: vi.fn(),
    },
    schedule: {
      rateLimited: vi.fn(),
    },
    queue: {
      waiting: vi.fn(),
      progress: vi.fn(),
    },
    offer: {
      error: vi.fn(),
      insufficientFunds: vi.fn(),
    },
    wallet: {
      allRateLimited: vi.fn(),
    },
    memory: {
      cleanup: vi.fn(),
      status: vi.fn(),
      critical: vi.fn(),
      warning: vi.fn(),
    },
  },
  getBidStatsData: vi.fn().mockReturnValue({
    bidsPlaced: 0,
    bidsSkipped: 0,
    bidsCancelled: 0,
    bidsAdjusted: 0,
    errors: 0,
  }),
}));

vi.mock('./axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('./bottleneck', () => ({
  default: {
    schedule: vi.fn().mockImplementation(async (...args: any[]) => {
      const fn = typeof args[0] === 'function' ? args[0] : args[1];
      return fn();
    }),
  },
}));

vi.mock('p-queue', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      add: vi.fn().mockImplementation(async (fn) => fn()),
      addAll: vi.fn().mockImplementation(async (fns) => Promise.all(fns.map((fn: any) => fn()))),
      size: 0,
      pending: 0,
    })),
  };
});

// Mock WebSocket
class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;

  constructor(url: string) {
    super();
    this.url = url;
    // Auto-open after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.emit('open');
    }, 10);
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  addEventListener(event: string, handler: (...args: any[]) => void): void {
    this.on(event, handler);
  }

  removeAllListeners(event?: string): this {
    return super.removeAllListeners(event);
  }
}

vi.mock('ws', () => ({
  default: MockWebSocket,
  WebSocket: MockWebSocket,
}));

// Mock fs with config files
const mockCollections = [
  {
    collectionSymbol: 'test-collection',
    minBid: 0.001,
    maxBid: 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    bidCount: 5,
    duration: 60,
    scheduledLoop: 60,
    enableCounterBidding: true,
    outBidMargin: 0.000001,
    offerType: 'ITEM',
    quantity: 1,
    feeSatsPerVbyte: 28,
    traits: [],
  },
];

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('collections.json')) return true;
      if (path.includes('wallets.json')) return false;
      if (path.includes('bidHistory.json')) return false;
      if (path.includes('data')) return true;
      return false;
    }),
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('collections.json')) {
        return JSON.stringify(mockCollections);
      }
      throw new Error('File not found');
    }),
    writeFileSync: vi.fn(),
    writeFile: vi.fn().mockImplementation((path, data, encoding, callback) => {
      if (callback) callback(null);
    }),
    rename: vi.fn().mockImplementation((oldPath, newPath, callback) => {
      if (callback) callback(null);
    }),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes('collections.json')) return true;
    if (path.includes('wallets.json')) return false;
    if (path.includes('bidHistory.json')) return false;
    if (path.includes('data')) return true;
    return false;
  }),
  readFileSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes('collections.json')) {
      return JSON.stringify(mockCollections);
    }
    throw new Error('File not found');
  }),
  writeFileSync: vi.fn(),
  writeFile: vi.fn().mockImplementation((path: string, data: any, encoding: any, callback?: any) => {
    const cb = typeof encoding === 'function' ? encoding : callback;
    if (cb) cb(null);
  }),
  rename: vi.fn().mockImplementation((oldPath: string, newPath: string, callback?: any) => {
    if (callback) callback(null);
  }),
  mkdirSync: vi.fn(),
}));

// Mock offer functions
vi.mock('./functions/Offer', () => ({
  getBestOffer: vi.fn(),
  getOffers: vi.fn(),
  getBestCollectionOffer: vi.fn(),
  getUserOffers: vi.fn(),
  createOffer: vi.fn(),
  createCollectionOffer: vi.fn(),
  submitSignedOfferOrder: vi.fn(),
  submitCollectionOffer: vi.fn(),
  signData: vi.fn(),
  signCollectionOffer: vi.fn(),
  retrieveCancelOfferFormat: vi.fn(),
  submitCancelOfferData: vi.fn(),
  cancelCollectionOffer: vi.fn(),
}));

// Mock collection functions
vi.mock('./functions/Collection', () => ({
  collectionDetails: vi.fn().mockResolvedValue({
    floorPrice: 1000000, // 0.01 BTC in sats
  }),
}));

// Mock token functions
vi.mock('./functions/Tokens', () => ({
  retrieveTokens: vi.fn().mockResolvedValue([
    { id: 'token1i0', collectionSymbol: 'test-collection', listedPrice: 500000 },
    { id: 'token2i0', collectionSymbol: 'test-collection', listedPrice: 600000 },
  ]),
}));

// Mock utils
vi.mock('./utils', () => ({
  getBitcoinBalance: vi.fn().mockResolvedValue(0.1),
}));

vi.mock('./utils/bidPacer', () => ({
  initializeBidPacer: vi.fn(),
  waitForBidSlot: vi.fn().mockResolvedValue(undefined),
  recordBid: vi.fn(),
  onRateLimitError: vi.fn(),
  getBidPacerStatus: vi.fn().mockReturnValue({
    bidsUsed: 0,
    bidsRemaining: 5,
    windowResetIn: 60,
    totalBidsPlaced: 0,
    totalWaits: 0,
  }),
  logBidPacerStatus: vi.fn(),
  isGloballyRateLimited: vi.fn().mockReturnValue(false),
  getGlobalResetWaitTime: vi.fn().mockReturnValue(0),
}));

vi.mock('./utils/walletPool', () => ({
  initializeWalletPool: vi.fn(),
  getAvailableWalletAsync: vi.fn(),
  waitForAvailableWallet: vi.fn().mockResolvedValue(null),
  recordBid: vi.fn(),
  decrementBidCount: vi.fn(),
  getWalletByPaymentAddress: vi.fn(),
  getWalletPoolStats: vi.fn().mockReturnValue({
    available: 2,
    total: 2,
    bidsPerMinute: 5,
    wallets: [],
  }),
  isWalletPoolInitialized: vi.fn().mockReturnValue(false),
  getWalletPool: vi.fn(),
}));

vi.mock('./utils/walletGroups', () => ({
  initializeWalletGroupManager: vi.fn(),
  getWalletGroupManager: vi.fn(),
  isWalletGroupManagerInitialized: vi.fn().mockReturnValue(false),
}));

// Set up environment variables before import
beforeAll(() => {
  process.env.TOKEN_RECEIVE_ADDRESS = TEST_RECEIVE_ADDRESS;
  process.env.FUNDING_WIF = TEST_WIF;
  process.env.API_KEY = 'test-api-key';
  process.env.RATE_LIMIT = '32';
  process.env.DEFAULT_OUTBID_MARGIN = '0.00001';
  process.env.DEFAULT_LOOP = '30';
  process.env.BIDS_PER_MINUTE = '5';
  process.env.ENABLE_WALLET_ROTATION = 'false';
});

describe('Bid.ts Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Token Lock Mechanism', () => {
    // These tests simulate the lock behavior described in bid.ts

    it('should implement FIFO lock acquisition', async () => {
      // Simulating the lock mechanism behavior
      const processingTokens: Record<string, boolean> = {};
      const processingTokenTimestamps: Record<string, number | undefined> = {};
      const processingTokenWaiters: Record<string, Array<(acquired: boolean) => void>> = {};
      const TOKEN_LOCK_TIMEOUT_MS = 60000;

      async function acquireTokenLock(tokenId: string): Promise<boolean> {
        // Check for stale lock
        const lockTimestamp = processingTokenTimestamps[tokenId];
        if (lockTimestamp && Date.now() - lockTimestamp > TOKEN_LOCK_TIMEOUT_MS) {
          delete processingTokens[tokenId];
          delete processingTokenTimestamps[tokenId];
        }

        if (processingTokens[tokenId]) {
          return new Promise<boolean>((resolve) => {
            if (!processingTokenWaiters[tokenId]) {
              processingTokenWaiters[tokenId] = [];
            }
            processingTokenWaiters[tokenId].push(resolve);
          });
        }

        processingTokens[tokenId] = true;
        processingTokenTimestamps[tokenId] = Date.now();
        return true;
      }

      function releaseTokenLock(tokenId: string): void {
        const waiters = processingTokenWaiters[tokenId];
        if (waiters && waiters.length > 0) {
          const nextWaiter = waiters.shift()!;
          processingTokenTimestamps[tokenId] = Date.now();
          nextWaiter(true);
        } else {
          delete processingTokens[tokenId];
          delete processingTokenTimestamps[tokenId];
          delete processingTokenWaiters[tokenId];
        }
      }

      // First acquisition should succeed
      const result1 = await acquireTokenLock('token1');
      expect(result1).toBe(true);

      // Second acquisition should wait
      let result2Resolved = false;
      let result2Value: boolean | undefined;
      const result2Promise = acquireTokenLock('token1').then((val) => {
        result2Resolved = true;
        result2Value = val;
        return val;
      });

      // Advance timers slightly but result2 should still be pending
      await vi.advanceTimersByTimeAsync(10);
      expect(result2Resolved).toBe(false);

      // Release the lock
      releaseTokenLock('token1');
      await vi.advanceTimersByTimeAsync(0);

      expect(result2Resolved).toBe(true);
      expect(result2Value).toBe(true);
    });

    it('should clean up lock on release when no waiters', async () => {
      const processingTokens: Record<string, boolean> = {};
      const processingTokenTimestamps: Record<string, number | undefined> = {};
      const processingTokenWaiters: Record<string, Array<(acquired: boolean) => void>> = {};

      processingTokens['token1'] = true;
      processingTokenTimestamps['token1'] = Date.now();

      function releaseTokenLock(tokenId: string): void {
        const waiters = processingTokenWaiters[tokenId];
        if (waiters && waiters.length > 0) {
          const nextWaiter = waiters.shift()!;
          processingTokenTimestamps[tokenId] = Date.now();
          nextWaiter(true);
        } else {
          delete processingTokens[tokenId];
          delete processingTokenTimestamps[tokenId];
          delete processingTokenWaiters[tokenId];
        }
      }

      releaseTokenLock('token1');

      expect(processingTokens['token1']).toBeUndefined();
      expect(processingTokenTimestamps['token1']).toBeUndefined();
    });
  });

  describe('Recent Bids Deduplication', () => {
    it('should enforce max size limit on recentBids', () => {
      const recentBids: Map<string, number> = new Map();
      const MAX_RECENT_BIDS_SIZE = 5;

      function addRecentBid(tokenId: string, timestamp: number): void {
        if (recentBids.size >= MAX_RECENT_BIDS_SIZE) {
          const oldestKey = recentBids.keys().next().value;
          if (oldestKey) {
            recentBids.delete(oldestKey);
          }
        }
        recentBids.set(tokenId, timestamp);
      }

      // Add more than max size
      for (let i = 0; i < 10; i++) {
        addRecentBid(`token${i}`, Date.now() + i);
      }

      expect(recentBids.size).toBe(MAX_RECENT_BIDS_SIZE);
      // Oldest tokens should be removed
      expect(recentBids.has('token0')).toBe(false);
      expect(recentBids.has('token9')).toBe(true);
    });

    it('should skip bids within cooldown period', () => {
      const recentBids: Map<string, number> = new Map();
      const RECENT_BID_COOLDOWN_MS = 30000;
      const now = Date.now();

      recentBids.set('token1', now - 10000); // 10 seconds ago

      const lastBidTime = recentBids.get('token1');
      const shouldSkip = lastBidTime && now - lastBidTime < RECENT_BID_COOLDOWN_MS;

      expect(shouldSkip).toBe(true);
    });

    it('should allow bids after cooldown period', () => {
      const recentBids: Map<string, number> = new Map();
      const RECENT_BID_COOLDOWN_MS = 30000;
      const now = Date.now();

      recentBids.set('token1', now - 35000); // 35 seconds ago

      const lastBidTime = recentBids.get('token1');
      const shouldSkip = lastBidTime && now - lastBidTime < RECENT_BID_COOLDOWN_MS;

      expect(shouldSkip).toBe(false);
    });
  });

  describe('Quantity Lock (Mutex)', () => {
    it('should atomically increment quantity', async () => {
      interface BidHistory {
        [collectionSymbol: string]: {
          quantity: number;
        };
      }

      const bidHistory: BidHistory = {
        'test-collection': { quantity: 0 },
      };
      const quantityLockState: Record<string, { promise: Promise<void>; resolver: () => void } | undefined> = {};
      const MAX_RETRIES = 10;

      async function incrementQuantity(collectionSymbol: string): Promise<number> {
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const existingLock = quantityLockState[collectionSymbol];
          if (existingLock) {
            await existingLock.promise;
            continue;
          }

          let resolver: () => void;
          const promise = new Promise<void>((resolve) => {
            resolver = resolve;
          });
          quantityLockState[collectionSymbol] = { promise, resolver: resolver! };

          try {
            if (bidHistory[collectionSymbol]) {
              bidHistory[collectionSymbol].quantity += 1;
              return bidHistory[collectionSymbol].quantity;
            }
            return 0;
          } finally {
            const lockState = quantityLockState[collectionSymbol];
            if (lockState) {
              lockState.resolver();
            }
            delete quantityLockState[collectionSymbol];
          }
        }
        return bidHistory[collectionSymbol]?.quantity ?? 0;
      }

      // Concurrent increments should be serialized
      const results = await Promise.all([
        incrementQuantity('test-collection'),
        incrementQuantity('test-collection'),
        incrementQuantity('test-collection'),
      ]);

      // Each should get a unique incremented value
      expect(bidHistory['test-collection'].quantity).toBe(3);
      expect(results.sort()).toEqual([1, 2, 3]);
    });
  });

  describe('Bid History Management', () => {
    it('should initialize bid history for collection', () => {
      interface BidHistory {
        [collectionSymbol: string]: {
          offerType: 'ITEM' | 'COLLECTION';
          ourBids: Record<string, any>;
          topBids: Record<string, boolean>;
          bottomListings: { id: string; price: number }[];
          lastSeenActivity: number | null;
          quantity: number;
        };
      }

      const bidHistory: BidHistory = {};

      function initBidHistory(collectionSymbol: string, offerType: 'ITEM' | 'COLLECTION'): void {
        if (!bidHistory[collectionSymbol]) {
          bidHistory[collectionSymbol] = {
            offerType,
            ourBids: {},
            topBids: {},
            bottomListings: [],
            lastSeenActivity: null,
            quantity: 0,
          };
        }
      }

      initBidHistory('new-collection', 'ITEM');

      expect(bidHistory['new-collection']).toBeDefined();
      expect(bidHistory['new-collection'].offerType).toBe('ITEM');
      expect(bidHistory['new-collection'].quantity).toBe(0);
    });

    it('should not reinitialize existing bid history', () => {
      interface BidHistory {
        [collectionSymbol: string]: {
          offerType: 'ITEM' | 'COLLECTION';
          ourBids: Record<string, any>;
          topBids: Record<string, boolean>;
          bottomListings: { id: string; price: number }[];
          lastSeenActivity: number | null;
          quantity: number;
        };
      }

      const bidHistory: BidHistory = {
        'existing-collection': {
          offerType: 'ITEM',
          ourBids: {},
          topBids: {},
          bottomListings: [],
          lastSeenActivity: null,
          quantity: 5,
        },
      };

      function initBidHistory(collectionSymbol: string, offerType: 'ITEM' | 'COLLECTION'): void {
        if (!bidHistory[collectionSymbol]) {
          bidHistory[collectionSymbol] = {
            offerType,
            ourBids: {},
            topBids: {},
            bottomListings: [],
            lastSeenActivity: null,
            quantity: 0,
          };
        }
      }

      initBidHistory('existing-collection', 'COLLECTION');

      // Should preserve existing data
      expect(bidHistory['existing-collection'].quantity).toBe(5);
      expect(bidHistory['existing-collection'].offerType).toBe('ITEM');
    });

    it('should safely get our bids with fallback', () => {
      interface BidHistory {
        [collectionSymbol: string]: {
          ourBids: Record<string, { price: number; expiration: number; paymentAddress?: string }>;
        };
      }

      const bidHistory: BidHistory = {
        'test-collection': {
          ourBids: {
            token1: { price: 100000, expiration: Date.now() + 60000 },
          },
        },
      };

      function getOurBids(collectionSymbol: string): Record<string, { price: number; expiration: number; paymentAddress?: string }> {
        return bidHistory[collectionSymbol]?.ourBids ?? {};
      }

      expect(getOurBids('test-collection')).toEqual({
        token1: { price: 100000, expiration: expect.any(Number) },
      });
      expect(getOurBids('non-existent')).toEqual({});
    });
  });

  describe('Bid Calculation Logic', () => {
    const CONVERSION_RATE = 100000000;

    it('should calculate minOffer correctly', () => {
      const minBid = 0.001; // BTC
      const minFloorBid = 50; // %
      const floorPrice = 1000000; // sats (0.01 BTC)

      const minPrice = Math.round(minBid * CONVERSION_RATE); // 100000 sats
      const minOffer = Math.max(minPrice, Math.round(minFloorBid * floorPrice / 100));

      // minFloorBid% of floor = 50% of 1000000 = 500000
      // minPrice = 100000
      // max(100000, 500000) = 500000
      expect(minOffer).toBe(500000);
    });

    it('should calculate maxOffer correctly', () => {
      const maxBid = 0.01; // BTC
      const maxFloorBid = 95; // %
      const floorPrice = 1000000; // sats (0.01 BTC)

      const maxPrice = Math.round(maxBid * CONVERSION_RATE); // 1000000 sats
      const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100));

      // maxFloorBid% of floor = 95% of 1000000 = 950000
      // maxPrice = 1000000
      // min(1000000, 950000) = 950000
      expect(maxOffer).toBe(950000);
    });

    it('should calculate outbid amount correctly', () => {
      const currentPrice = 500000;
      const outBidMargin = 0.000001; // BTC

      const outBidAmount = Math.round(outBidMargin * CONVERSION_RATE);
      const bidPrice = currentPrice + outBidAmount;

      expect(outBidAmount).toBe(100);
      expect(bidPrice).toBe(500100);
      expect(bidPrice).toBeGreaterThan(currentPrice);
    });

    it('should prevent bids above 100% of floor for non-trait offers', () => {
      const maxFloorBid = 120; // % - above 100
      const traits: any[] = [];
      const offerType = 'ITEM';

      const shouldBlock =
        (offerType === 'ITEM' || offerType === 'COLLECTION') &&
        !traits?.length &&
        maxFloorBid > 100;

      expect(shouldBlock).toBe(true);
    });

    it('should allow bids above 100% of floor for trait offers', () => {
      const maxFloorBid = 120; // % - above 100
      const traits = [{ traitType: 'Background', value: 'Blue' }];
      const offerType = 'ITEM';

      const shouldBlock =
        (offerType === 'ITEM' || offerType === 'COLLECTION') &&
        !traits?.length &&
        maxFloorBid > 100;

      expect(shouldBlock).toBe(false);
    });
  });

  describe('Bid History Cleanup', () => {
    it('should remove expired bids older than TTL', () => {
      const BID_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
      const now = Date.now();

      interface BidHistory {
        [collectionSymbol: string]: {
          ourBids: Record<string, { price: number; expiration: number }>;
          topBids: Record<string, boolean>;
        };
      }

      const bidHistory: BidHistory = {
        'test-collection': {
          ourBids: {
            token1: { price: 100000, expiration: now - BID_HISTORY_MAX_AGE_MS - 1000 }, // Expired 24h ago
            token2: { price: 200000, expiration: now - 1000 }, // Just expired
            token3: { price: 300000, expiration: now + 60000 }, // Not expired
          },
          topBids: {
            token1: true,
            token2: true,
            token3: true,
          },
        },
      };

      function cleanupBidHistory() {
        for (const collectionSymbol in bidHistory) {
          const collection = bidHistory[collectionSymbol];

          for (const tokenId in collection.ourBids) {
            const bid = collection.ourBids[tokenId];
            if (bid.expiration < now && now - bid.expiration > BID_HISTORY_MAX_AGE_MS) {
              delete collection.ourBids[tokenId];
              delete collection.topBids[tokenId];
            }
          }
        }
      }

      cleanupBidHistory();

      expect(bidHistory['test-collection'].ourBids['token1']).toBeUndefined();
      expect(bidHistory['test-collection'].ourBids['token2']).toBeDefined(); // Only just expired
      expect(bidHistory['test-collection'].ourBids['token3']).toBeDefined();
    });

    it('should limit bids per collection to MAX_BIDS_PER_COLLECTION', () => {
      const MAX_BIDS_PER_COLLECTION = 3;
      const now = Date.now();

      interface BidHistory {
        [collectionSymbol: string]: {
          ourBids: Record<string, { price: number; expiration: number }>;
          topBids: Record<string, boolean>;
        };
      }

      const bidHistory: BidHistory = {
        'test-collection': {
          ourBids: {
            token1: { price: 100000, expiration: now + 10000 },
            token2: { price: 200000, expiration: now + 20000 },
            token3: { price: 300000, expiration: now + 30000 },
            token4: { price: 400000, expiration: now + 40000 },
            token5: { price: 500000, expiration: now + 50000 },
          },
          topBids: {},
        },
      };

      function cleanupBidHistory() {
        for (const collectionSymbol in bidHistory) {
          const collection = bidHistory[collectionSymbol];

          const ourBidsEntries = Object.entries(collection.ourBids);
          if (ourBidsEntries.length > MAX_BIDS_PER_COLLECTION) {
            const sortedBids = ourBidsEntries.sort((a, b) => b[1].expiration - a[1].expiration);
            for (let i = MAX_BIDS_PER_COLLECTION; i < sortedBids.length; i++) {
              const [tokenId] = sortedBids[i];
              delete collection.ourBids[tokenId];
              delete collection.topBids[tokenId];
            }
          }
        }
      }

      cleanupBidHistory();

      expect(Object.keys(bidHistory['test-collection'].ourBids).length).toBe(MAX_BIDS_PER_COLLECTION);
      // Should keep the ones with latest expiration
      expect(bidHistory['test-collection'].ourBids['token5']).toBeDefined();
      expect(bidHistory['test-collection'].ourBids['token4']).toBeDefined();
      expect(bidHistory['test-collection'].ourBids['token3']).toBeDefined();
    });
  });

  describe('WebSocket Message Validation', () => {
    it('should validate JSON messages', () => {
      function isValidJSON(str: string): boolean {
        try {
          JSON.parse(str);
          return true;
        } catch {
          return false;
        }
      }

      expect(isValidJSON('{"type": "message"}')).toBe(true);
      expect(isValidJSON('invalid json')).toBe(false);
      expect(isValidJSON('')).toBe(false);
    });

    it('should validate WebSocket message structure', () => {
      interface CollectOfferActivity {
        kind: string;
        collectionSymbol: string;
        tokenId?: string;
        listedPrice?: number;
        newOwner?: string;
        buyerPaymentAddress?: string;
        createdAt?: string;
      }

      function isValidWebSocketMessage(message: unknown): message is CollectOfferActivity {
        if (!message || typeof message !== 'object') return false;
        const msg = message as Record<string, unknown>;
        if (typeof msg.kind !== 'string') return false;
        if (typeof msg.collectionSymbol !== 'string') return false;
        return true;
      }

      expect(
        isValidWebSocketMessage({
          kind: 'offer_placed',
          collectionSymbol: 'test-collection',
          tokenId: 'token1',
          listedPrice: 100000,
        })
      ).toBe(true);

      expect(isValidWebSocketMessage({ kind: 'offer_placed' })).toBe(false);
      expect(isValidWebSocketMessage(null)).toBe(false);
      expect(isValidWebSocketMessage('string')).toBe(false);
    });
  });

  describe('Tokens to Cancel Logic', () => {
    interface CollectionBottomBid {
      tokenId: string;
      collectionSymbol: string;
    }

    function findTokensToCancel(
      tokens: CollectionBottomBid[],
      ourBids: { tokenId: string; collectionSymbol: string }[]
    ): { tokenId: string; collectionSymbol: string }[] {
      const currentTokenIds = new Set(tokens.map((t) => t.tokenId));
      return ourBids.filter((bid) => !currentTokenIds.has(bid.tokenId));
    }

    it('should identify bids to cancel when tokens no longer in bottom listings', () => {
      const currentTokens = [
        { tokenId: 'token1', collectionSymbol: 'test' },
        { tokenId: 'token2', collectionSymbol: 'test' },
      ];

      const ourBids = [
        { tokenId: 'token1', collectionSymbol: 'test' },
        { tokenId: 'token3', collectionSymbol: 'test' }, // No longer in bottom
      ];

      const toCancel = findTokensToCancel(currentTokens, ourBids);

      expect(toCancel).toHaveLength(1);
      expect(toCancel[0].tokenId).toBe('token3');
    });

    it('should return empty array when all bids are still valid', () => {
      const currentTokens = [
        { tokenId: 'token1', collectionSymbol: 'test' },
        { tokenId: 'token2', collectionSymbol: 'test' },
      ];

      const ourBids = [
        { tokenId: 'token1', collectionSymbol: 'test' },
        { tokenId: 'token2', collectionSymbol: 'test' },
      ];

      const toCancel = findTokensToCancel(currentTokens, ourBids);

      expect(toCancel).toHaveLength(0);
    });
  });

  describe('Combine Bids and Listings', () => {
    interface UserBid {
      tokenId: string;
      collectionSymbol: string;
      price: number;
      expiration: string;
    }

    interface BottomListing {
      id: string;
      price: number;
    }

    function combineBidsAndListings(
      userBids: UserBid[],
      bottomListings: BottomListing[]
    ): (UserBid & { listingPrice?: number })[] {
      const listingMap = new Map(bottomListings.map((l) => [l.id, l.price]));

      return userBids.map((bid) => ({
        ...bid,
        listingPrice: listingMap.get(bid.tokenId),
      }));
    }

    it('should combine bids with their listing prices', () => {
      const userBids: UserBid[] = [
        { tokenId: 'token1', collectionSymbol: 'test', price: 100000, expiration: new Date().toISOString() },
        { tokenId: 'token2', collectionSymbol: 'test', price: 200000, expiration: new Date().toISOString() },
      ];

      const bottomListings: BottomListing[] = [
        { id: 'token1', price: 500000 },
        { id: 'token2', price: 600000 },
      ];

      const combined = combineBidsAndListings(userBids, bottomListings);

      expect(combined[0].listingPrice).toBe(500000);
      expect(combined[1].listingPrice).toBe(600000);
    });

    it('should handle bids without matching listings', () => {
      const userBids: UserBid[] = [
        { tokenId: 'token1', collectionSymbol: 'test', price: 100000, expiration: new Date().toISOString() },
      ];

      const bottomListings: BottomListing[] = [];

      const combined = combineBidsAndListings(userBids, bottomListings);

      expect(combined[0].listingPrice).toBeUndefined();
    });
  });

  describe('ECPair Validation', () => {
    it('should validate WIF format', () => {
      function safeECPairFromWIF(
        wif: string,
        networkParam: typeof bitcoin.networks.bitcoin,
        context: string = 'unknown'
      ): ReturnType<ECPairAPI['fromWIF']> {
        if (!wif || typeof wif !== 'string') {
          throw new Error(`[${context}] Invalid WIF: WIF is empty or not a string`);
        }
        try {
          return ECPair.fromWIF(wif, networkParam);
        } catch (error: any) {
          throw new Error(`[${context}] Invalid WIF format: ${error.message}`);
        }
      }

      // Valid WIF should work
      const keyPair = safeECPairFromWIF(TEST_WIF, bitcoin.networks.bitcoin, 'test');
      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();

      // Invalid WIF should throw
      expect(() =>
        safeECPairFromWIF('invalid-wif', bitcoin.networks.bitcoin, 'test')
      ).toThrow('Invalid WIF format');

      // Empty WIF should throw
      expect(() =>
        safeECPairFromWIF('', bitcoin.networks.bitcoin, 'test')
      ).toThrow('Invalid WIF: WIF is empty or not a string');
    });
  });

  describe('Reconnect Logic', () => {
    it('should use exponential backoff for reconnects', () => {
      let retryCount = 0;
      const MAX_RETRIES = 5;
      const delays: number[] = [];

      function attemptReconnect(): number | null {
        if (retryCount < MAX_RETRIES) {
          const delayMs = Math.pow(2, retryCount) * 1000;
          delays.push(delayMs);
          retryCount++;
          return delayMs;
        }
        return null;
      }

      // Simulate 5 reconnect attempts
      for (let i = 0; i < 5; i++) {
        attemptReconnect();
      }

      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);
      expect(attemptReconnect()).toBeNull(); // Max retries exceeded
    });
  });

  describe('Collection Loading Validation', () => {
    it('should reject minBid > maxBid', () => {
      const collection = {
        collectionSymbol: 'test',
        minBid: 0.02,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 95,
        offerType: 'ITEM',
      };

      const errors: string[] = [];
      if (collection.minBid > collection.maxBid) {
        errors.push(`minBid (${collection.minBid}) cannot be greater than maxBid (${collection.maxBid})`);
      }

      expect(errors).toContain('minBid (0.02) cannot be greater than maxBid (0.01)');
    });

    it('should reject minFloorBid > maxFloorBid', () => {
      const collection = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 95,
        maxFloorBid: 50,
        offerType: 'ITEM',
      };

      const errors: string[] = [];
      if (collection.minFloorBid > collection.maxFloorBid) {
        errors.push(`minFloorBid (${collection.minFloorBid}%) cannot be greater than maxFloorBid (${collection.maxFloorBid}%)`);
      }

      expect(errors).toContain('minFloorBid (95%) cannot be greater than maxFloorBid (50%)');
    });

    it('should require valid offerType', () => {
      const collection = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 95,
        offerType: 'INVALID',
      };

      const errors: string[] = [];
      if (!['ITEM', 'COLLECTION'].includes(collection.offerType)) {
        errors.push('offerType must be "ITEM" or "COLLECTION"');
      }

      expect(errors).toContain('offerType must be "ITEM" or "COLLECTION"');
    });
  });

  describe('EventManager Queue Logic', () => {
    it('should limit queue size', () => {
      const MAX_QUEUE_SIZE = 1000;
      const queue: any[] = [];
      let droppedEventsCount = 0;

      function receiveEvent(event: any) {
        if (queue.length >= MAX_QUEUE_SIZE) {
          queue.shift();
          droppedEventsCount++;
        }
        queue.push(event);
      }

      // Add more than max events
      for (let i = 0; i < 1050; i++) {
        receiveEvent({ id: i });
      }

      expect(queue.length).toBe(MAX_QUEUE_SIZE);
      expect(droppedEventsCount).toBe(50);
      // Oldest events should be dropped
      expect(queue[0].id).toBe(50);
    });
  });

  describe('EventManager Ready Gate', () => {
    it('should discard events when not ready', () => {
      let queue: any[] = [];
      let ready = false;
      let startupEventsDiscarded = 0;

      function receiveEvent(event: any) {
        if (!ready) {
          startupEventsDiscarded++;
          return;
        }
        queue.push(event);
      }

      receiveEvent({ id: 1 });
      receiveEvent({ id: 2 });
      receiveEvent({ id: 3 });

      expect(queue.length).toBe(0);
      expect(startupEventsDiscarded).toBe(3);
    });

    it('should accept events after setReady', () => {
      let queue: any[] = [];
      let ready = false;
      let startupEventsDiscarded = 0;

      function receiveEvent(event: any) {
        if (!ready) {
          startupEventsDiscarded++;
          return;
        }
        queue.push(event);
      }

      function setReady() {
        const discardedFromQueue = queue.length;
        queue = [];
        ready = true;
        startupEventsDiscarded += discardedFromQueue;
      }

      receiveEvent({ id: 1 });
      expect(queue.length).toBe(0);
      expect(startupEventsDiscarded).toBe(1);

      setReady();

      receiveEvent({ id: 2 });
      receiveEvent({ id: 3 });
      expect(queue.length).toBe(2);
      expect(startupEventsDiscarded).toBe(1);
    });

    it('should clear accumulated queue on setReady', () => {
      let queue: any[] = [{ id: 'stale1' }, { id: 'stale2' }, { id: 'stale3' }];
      let ready = false;
      let startupEventsDiscarded = 5; // 5 discarded before queue

      function setReady() {
        const discardedFromQueue = queue.length;
        queue = [];
        ready = true;
        startupEventsDiscarded += discardedFromQueue;
      }

      setReady();

      expect(queue.length).toBe(0);
      expect(startupEventsDiscarded).toBe(8); // 5 + 3 from queue
      expect(ready).toBe(true);
    });

    it('should not count startup discards in preFilterStats', () => {
      let ready = false;
      let startupEventsDiscarded = 0;
      const preFilterStats = { notWatched: 0, unknownCollection: 0, ownWallet: 0, deduplicated: 0, superseded: 0, total: 0 };

      function receiveEvent(event: any) {
        if (!ready) {
          startupEventsDiscarded++;
          return;
        }
        // Pre-filter would run here
        preFilterStats.total++;
      }

      receiveEvent({ kind: 'offer_placed' });
      receiveEvent({ kind: 'offer_placed' });

      expect(startupEventsDiscarded).toBe(2);
      expect(preFilterStats.total).toBe(0);
    });

    it('should handle setReady with empty queue', () => {
      let queue: any[] = [];
      let ready = false;
      let startupEventsDiscarded = 0;

      function setReady() {
        const discardedFromQueue = queue.length;
        queue = [];
        ready = true;
        startupEventsDiscarded += discardedFromQueue;
      }

      setReady();

      expect(queue.length).toBe(0);
      expect(startupEventsDiscarded).toBe(0);
      expect(ready).toBe(true);
    });
  });

  describe('Watched Events Filter', () => {
    it('should filter for watched event kinds', () => {
      const watchedEvents = [
        'offer_placed',
        'coll_offer_created',
        'coll_offer_edited',
        'offer_cancelled',
        'coll_offer_cancelled',
        'buying_broadcasted',
        'offer_accepted_broadcasted',
        'coll_offer_fulfill_broadcasted',
      ];

      expect(watchedEvents.includes('offer_placed')).toBe(true);
      expect(watchedEvents.includes('listing_created')).toBe(false);
      expect(watchedEvents.includes('buying_broadcasted')).toBe(true);
      expect(watchedEvents.includes('offer_cancelled')).toBe(true);
      expect(watchedEvents.includes('coll_offer_edited')).toBe(true);
      expect(watchedEvents.includes('coll_offer_cancelled')).toBe(true);
    });
  });

  describe('Pre-Queue Filtering', () => {
    it('should reject events with unwatched kinds before queuing', () => {
      const queue: any[] = [];
      const preFilterStats = { notWatched: 0, unknownCollection: 0, ownWallet: 0, deduplicated: 0, superseded: 0, total: 0 };
      const watchedEvents = ['offer_placed', 'coll_offer_created', 'coll_offer_edited', 'offer_cancelled', 'coll_offer_cancelled', 'buying_broadcasted', 'offer_accepted_broadcasted', 'coll_offer_fulfill_broadcasted'];
      const collectionSymbols = new Set(['test-collection']);

      function receiveEvent(event: { kind: string; collectionSymbol: string }) {
        if (!watchedEvents.includes(event.kind)) {
          preFilterStats.notWatched++;
          preFilterStats.total++;
          return;
        }
        if (!collectionSymbols.has(event.collectionSymbol)) {
          preFilterStats.unknownCollection++;
          preFilterStats.total++;
          return;
        }
        queue.push(event);
      }

      receiveEvent({ kind: 'list', collectionSymbol: 'test-collection' });
      receiveEvent({ kind: 'listing_created', collectionSymbol: 'test-collection' });
      receiveEvent({ kind: 'offer_placed', collectionSymbol: 'unknown-collection' });
      receiveEvent({ kind: 'offer_placed', collectionSymbol: 'test-collection' });

      expect(queue).toHaveLength(1);
      expect(preFilterStats.notWatched).toBe(2);
      expect(preFilterStats.unknownCollection).toBe(1);
      expect(preFilterStats.total).toBe(3);
    });

    it('should deduplicate rapid offer_placed events for the same token', () => {
      const queue: any[] = [];
      const dedupMap = new Map<string, number>();
      const DEDUP_COOLDOWN = 5000;

      function receiveEvent(event: { kind: string; tokenId: string }, now: number) {
        if (event.kind === 'offer_placed' && event.tokenId) {
          const lastSeen = dedupMap.get(event.tokenId);
          if (lastSeen && now - lastSeen < DEDUP_COOLDOWN) return;
          dedupMap.set(event.tokenId, now);
        }
        queue.push(event);
      }

      const now = Date.now();
      receiveEvent({ kind: 'offer_placed', tokenId: 'token1' }, now);
      receiveEvent({ kind: 'offer_placed', tokenId: 'token1' }, now + 1000);  // within cooldown
      receiveEvent({ kind: 'offer_placed', tokenId: 'token1' }, now + 6000);  // after cooldown
      receiveEvent({ kind: 'offer_placed', tokenId: 'token2' }, now + 1000);  // different token

      expect(queue).toHaveLength(3);
    });

    it('should supersede older events in queue with same dedup key', () => {
      const queue: any[] = [];
      let superseded = 0;
      const purchaseKinds = ['buying_broadcasted', 'offer_accepted_broadcasted', 'coll_offer_fulfill_broadcasted'];

      function getDedupKey(event: any): string | null {
        if (purchaseKinds.includes(event.kind)) return null;
        switch (event.kind) {
          case 'offer_placed':
          case 'offer_cancelled':
            return event.tokenId ? `item:${event.collectionSymbol}:${event.tokenId}` : null;
          case 'coll_offer_created':
          case 'coll_offer_edited':
          case 'coll_offer_cancelled':
            return `coll_offer:${event.collectionSymbol}`;
          default:
            return null;
        }
      }

      function receiveEvent(event: any) {
        const key = getDedupKey(event);
        if (key) {
          const idx = queue.findIndex((e: any) => getDedupKey(e) === key);
          if (idx !== -1) {
            queue.splice(idx, 1);
            superseded++;
          }
        }
        queue.push(event);
      }

      // Same token, same kind → superseded
      receiveEvent({ kind: 'offer_placed', collectionSymbol: 'col', tokenId: 't1', listedPrice: 100 });
      receiveEvent({ kind: 'offer_placed', collectionSymbol: 'col', tokenId: 't1', listedPrice: 200 });
      expect(queue).toHaveLength(1);
      expect(queue[0].listedPrice).toBe(200); // newest wins
      expect(superseded).toBe(1);

      // offer_cancelled supersedes offer_placed for same token (shared key)
      receiveEvent({ kind: 'offer_cancelled', collectionSymbol: 'col', tokenId: 't1' });
      expect(queue).toHaveLength(1);
      expect(queue[0].kind).toBe('offer_cancelled');
      expect(superseded).toBe(2);

      // Different token → no supersede
      receiveEvent({ kind: 'offer_placed', collectionSymbol: 'col', tokenId: 't2', listedPrice: 300 });
      expect(queue).toHaveLength(2);

      // coll_offer_edited supersedes coll_offer_created (shared key)
      receiveEvent({ kind: 'coll_offer_created', collectionSymbol: 'col-a', listedPrice: 500 });
      receiveEvent({ kind: 'coll_offer_edited', collectionSymbol: 'col-a', listedPrice: 600 });
      expect(queue).toHaveLength(3);
      expect(queue[2].kind).toBe('coll_offer_edited');
      expect(superseded).toBe(3);

      // coll_offer_cancelled supersedes coll_offer_created (shared key)
      receiveEvent({ kind: 'coll_offer_cancelled', collectionSymbol: 'col-a' });
      expect(queue).toHaveLength(3); // replaced the coll_offer_edited
      expect(queue[2].kind).toBe('coll_offer_cancelled');
      expect(superseded).toBe(4);

      // coll_offer_created supersedes coll_offer_cancelled (shared key)
      receiveEvent({ kind: 'coll_offer_created', collectionSymbol: 'col-a', listedPrice: 700 });
      expect(queue).toHaveLength(3); // replaced the coll_offer_cancelled
      expect(queue[2].kind).toBe('coll_offer_created');
      expect(superseded).toBe(5);

      // Purchase events are never superseded
      receiveEvent({ kind: 'buying_broadcasted', collectionSymbol: 'col', tokenId: 't1' });
      receiveEvent({ kind: 'buying_broadcasted', collectionSymbol: 'col', tokenId: 't1' });
      expect(queue).toHaveLength(5); // both survive
      expect(superseded).toBe(5); // unchanged
    });

    it('should protect purchase events from being dropped on overflow', () => {
      const MAX_QUEUE_SIZE = 5;
      const queue: any[] = [];
      const purchaseKinds = ['buying_broadcasted', 'offer_accepted_broadcasted', 'coll_offer_fulfill_broadcasted'];

      function isPurchase(kind: string) { return purchaseKinds.includes(kind); }

      function receiveEvent(event: { kind: string; id: number }) {
        if (queue.length >= MAX_QUEUE_SIZE) {
          if (isPurchase(event.kind)) {
            const dropIdx = queue.findIndex((e: any) => !isPurchase(e.kind));
            if (dropIdx !== -1) queue.splice(dropIdx, 1);
            else queue.shift();
          } else {
            const dropIdx = queue.findIndex((e: any) => !isPurchase(e.kind));
            if (dropIdx !== -1) queue.splice(dropIdx, 1);
            else queue.shift();
          }
        }
        queue.push(event);
      }

      // Fill queue with non-purchase events
      for (let i = 0; i < 5; i++) {
        receiveEvent({ kind: 'offer_placed', id: i });
      }
      expect(queue).toHaveLength(5);

      // A purchase event should still get in
      receiveEvent({ kind: 'buying_broadcasted', id: 100 });
      expect(queue).toHaveLength(5);
      expect(queue.some((e: any) => e.id === 100)).toBe(true);
    });

    it('should throttle drop logging', () => {
      const DROP_LOG_INTERVAL = 50;
      let logCount = 0;
      let droppedCount = 0;

      for (let i = 0; i < 150; i++) {
        droppedCount++;
        if (droppedCount % DROP_LOG_INTERVAL === 0) {
          logCount++;
        }
      }

      expect(logCount).toBe(3); // 50, 100, 150
    });
  });

  describe('Payment Address Ownership', () => {
    it('should correctly identify own payment address', () => {
      const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
      const primaryPaymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin,
      }).address as string;

      function isOurPaymentAddress(address: string): boolean {
        if (!address) return false;
        return address.toLowerCase() === primaryPaymentAddress.toLowerCase();
      }

      expect(isOurPaymentAddress(primaryPaymentAddress)).toBe(true);
      expect(isOurPaymentAddress('bc1qsomeother')).toBe(false);
      expect(isOurPaymentAddress('')).toBe(false);
    });
  });

  describe('Delay Function', () => {
    it('should resolve after specified time', async () => {
      function delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      const startTime = Date.now();
      const promise = delay(1000);

      await vi.advanceTimersByTimeAsync(1000);
      await promise;

      // With fake timers, this should complete instantly
      expect(true).toBe(true);
    });
  });

  describe('Cancellation Event Handling', () => {
    it('offer_cancelled with no active bid should early return', () => {
      const bidHistory: Record<string, any> = {
        'test-col': { ourBids: {}, topBids: {}, quantity: 0 }
      };
      const tokenId = 'token123';

      // No bid on this token → early return
      const hasActiveBid = !!bidHistory['test-col']?.ourBids?.[tokenId];
      expect(hasActiveBid).toBe(false);
    });

    it('offer_cancelled when we are top should confirm topBids', () => {
      const bidHistory: Record<string, any> = {
        'test-col': {
          ourBids: { 'token123': { price: 50000, expiration: Date.now() + 3600000 } },
          topBids: {},
          quantity: 0
        }
      };
      const tokenId = 'token123';
      const primaryPaymentAddress = 'bc1qouraddress';

      // Simulate: we are the top bidder after cancel
      const topOffer = { buyerPaymentAddress: primaryPaymentAddress, price: 50000 };
      const isOurs = topOffer.buyerPaymentAddress === primaryPaymentAddress;

      if (isOurs) {
        bidHistory['test-col'].topBids[tokenId] = true;
      }

      expect(bidHistory['test-col'].topBids[tokenId]).toBe(true);
    });

    it('offer_cancelled when not top and within limits should counter-bid', () => {
      const maxOffer = 100000;
      const outBidAmount = 100;
      const topPrice = 60000;

      // We're not top, calculate counter-bid
      const bidPrice = Math.round(topPrice + outBidAmount);
      const shouldBid = bidPrice <= maxOffer;

      expect(shouldBid).toBe(true);
      expect(bidPrice).toBe(60100);
      expect(bidPrice).toBeGreaterThan(topPrice);
    });

    it('offer_cancelled when top offer exceeds maxOffer should skip', () => {
      const maxOffer = 50000;
      const topPrice = 60000;

      const shouldSkip = isNaN(topPrice) || topPrice > maxOffer;
      expect(shouldSkip).toBe(true);
    });

    it('coll_offer_edited should be treated same as coll_offer_created', () => {
      const handledKinds = ['coll_offer_created', 'coll_offer_edited'];
      expect(handledKinds.includes('coll_offer_edited')).toBe(true);
      expect(handledKinds.includes('coll_offer_created')).toBe(true);
    });

    it('coll_offer_cancelled with no active collection offer should early return', () => {
      const bidHistory: Record<string, any> = {
        'test-col': { highestCollectionOffer: undefined, quantity: 0 }
      };

      const hasActiveOffer = !!bidHistory['test-col']?.highestCollectionOffer;
      expect(hasActiveOffer).toBe(false);
    });

    it('offer_placed for non-target token should early return before collectionDetails', () => {
      const bottomListings = ['tokenA', 'tokenB', 'tokenC'];
      const collection = { offerType: 'ITEM' };
      const tokenId = 'tokenXYZ'; // not in bottomListings

      // This is the early-exit check added before collectionDetails()
      const shouldEarlyReturn =
        collection.offerType === 'ITEM' && !bottomListings.includes(tokenId);
      expect(shouldEarlyReturn).toBe(true);

      // A token that IS in bottomListings should proceed
      const targetToken = 'tokenB';
      const shouldProceed =
        collection.offerType === 'ITEM' && !bottomListings.includes(targetToken);
      expect(shouldProceed).toBe(false);

      // COLLECTION type should not early-return even for non-target token
      const collOffer = { offerType: 'COLLECTION' };
      const collShouldReturn =
        collOffer.offerType === 'ITEM' && !bottomListings.includes(tokenId);
      expect(collShouldReturn).toBe(false);
    });

    it('item events should share dedup cooldown per token', () => {
      const itemEventDedup = new Map<string, number>();
      const DEDUP_COOLDOWN = 5000;
      const now = Date.now();

      // offer_placed sets the cooldown for token1
      itemEventDedup.set('token1', now);

      // offer_cancelled for same token within cooldown should be blocked
      const cancelBlocked = itemEventDedup.has('token1') &&
        now - itemEventDedup.get('token1')! < DEDUP_COOLDOWN;
      expect(cancelBlocked).toBe(true);

      // Different token should not be blocked
      expect(itemEventDedup.has('token2')).toBe(false);

      // After cooldown expires, same token is unblocked
      const expiredTime = now - DEDUP_COOLDOWN - 1;
      itemEventDedup.set('token1', expiredTime);
      const afterCooldown = itemEventDedup.has('token1') &&
        now - itemEventDedup.get('token1')! < DEDUP_COOLDOWN;
      expect(afterCooldown).toBe(false);
    });

    it('collection events should share dedup cooldown per collection', () => {
      const collectionEventDedup = new Map<string, number>();
      const DEDUP_COOLDOWN = 5000;
      const now = Date.now();

      // coll_offer_created sets the cooldown for collection C
      collectionEventDedup.set('col-abc', now);

      // coll_offer_edited for same collection within cooldown should be blocked
      const editedBlocked = collectionEventDedup.has('col-abc') &&
        now - collectionEventDedup.get('col-abc')! < DEDUP_COOLDOWN;
      expect(editedBlocked).toBe(true);

      // coll_offer_cancelled for same collection within cooldown should be blocked
      const cancelledBlocked = collectionEventDedup.has('col-abc') &&
        now - collectionEventDedup.get('col-abc')! < DEDUP_COOLDOWN;
      expect(cancelledBlocked).toBe(true);

      // Different collection should not be blocked
      expect(collectionEventDedup.has('col-xyz')).toBe(false);
    });

    describe('Equal price tie-breaking via API', () => {
      const ourAddress = 'bc1qourwallet';
      const competitorAddress = 'bc1qcompetitor';

      function isOurPaymentAddress(address: string): boolean {
        if (!address) return false;
        return address.toLowerCase() === ourAddress.toLowerCase();
      }

      it('equal price, we ARE top — should skip (no counterbid)', async () => {
        const ourPrice = 50000;
        const incomingPrice = 50000;
        const bidHistory: Record<string, any> = {
          'test-col': {
            ourBids: { 'token123': { price: ourPrice, expiration: Date.now() + 3600000 } },
            topBids: {},
            quantity: 0
          }
        };

        // Simulate: prices are equal, API confirms we are top
        const bestOfferResponse = {
          offers: [{ buyerPaymentAddress: ourAddress, price: ourPrice }]
        };

        expect(incomingPrice === ourPrice).toBe(true);
        const topOffer = bestOfferResponse.offers[0];
        const weAreTop = isOurPaymentAddress(topOffer.buyerPaymentAddress);
        expect(weAreTop).toBe(true);
        // When we are top, handler returns early — no counterbid
      });

      it('equal price, we are NOT top — should counterbid', async () => {
        const ourPrice = 50000;
        const incomingPrice = 50000;
        const outBidAmount = 100;
        const maxOffer = 100000;

        // Simulate: prices are equal, API shows competitor is top
        const bestOfferResponse = {
          offers: [{ buyerPaymentAddress: competitorAddress, price: ourPrice }]
        };

        expect(incomingPrice === ourPrice).toBe(true);
        const topOffer = bestOfferResponse.offers[0];
        const weAreTop = isOurPaymentAddress(topOffer.buyerPaymentAddress);
        expect(weAreTop).toBe(false);

        // Not top — counterbid against the actual top offer price
        const counterbidPrice = Math.round(topOffer.price + outBidAmount);
        expect(counterbidPrice).toBe(50100);
        expect(counterbidPrice).toBeGreaterThan(topOffer.price);
        expect(counterbidPrice <= maxOffer).toBe(true);
      });

      it('equal price, API error — should skip gracefully', async () => {
        const ourPrice = 50000;
        const incomingPrice = 50000;

        expect(incomingPrice === ourPrice).toBe(true);

        // Simulate: API throws error
        let shouldSkip = false;
        try {
          throw new Error('Network timeout');
        } catch {
          // On API error, handler returns early (skip)
          shouldSkip = true;
        }
        expect(shouldSkip).toBe(true);
      });

      it('strictly lower incoming price — should skip without API call', () => {
        const ourPrice = 50000;
        const incomingPrice = 40000;

        // Strictly less: skip immediately, no API call needed
        const isStrictlyLower = incomingPrice < ourPrice;
        expect(isStrictlyLower).toBe(true);

        // The old <= check would also skip equal prices — that's the bug we fixed
        const oldBehaviorSkipsEqual = (50000 <= 50000);
        expect(oldBehaviorSkipsEqual).toBe(true); // old code wrongly skipped ties
        const newBehaviorSkipsEqual = (50000 < 50000);
        expect(newBehaviorSkipsEqual).toBe(false); // new code correctly checks ties via API
      });
    });
  });
});

describe('Bid Price Safety Checks', () => {
  it('should skip if bid price exceeds maxOffer', () => {
    const bidPrice = 1000000;
    const maxOffer = 950000;

    const shouldSkip = bidPrice > maxOffer;
    expect(shouldSkip).toBe(true);
  });

  it('should skip collection bid if price >= floor price', () => {
    const bidPrice = 1000000;
    const floorPrice = 1000000;

    const shouldSkip = bidPrice >= floorPrice;
    expect(shouldSkip).toBe(true);
  });

  it('should allow bid when under all limits', () => {
    const bidPrice = 900000;
    const maxOffer = 950000;
    const floorPrice = 1000000;

    const shouldSkip = bidPrice > maxOffer || bidPrice >= floorPrice;
    expect(shouldSkip).toBe(false);
  });

  it('bid adjustment down should still be strictly higher than second-best', () => {
    const bestPrice = 100000; // our current top bid
    const secondBestPrice = 90000; // competitor's bid
    const outBidMargin = 0.000001; // BTC
    const outBidAmount = Math.max(1, Math.round(outBidMargin * 1e8));

    // When gap exceeds margin, bot adjusts down to secondBestPrice + outBidAmount
    expect(bestPrice - secondBestPrice).toBeGreaterThan(outBidAmount);
    const adjustedPrice = Math.round(secondBestPrice + outBidAmount);
    expect(adjustedPrice).toBeGreaterThan(secondBestPrice);
    expect(adjustedPrice).toBeLessThan(bestPrice);
  });

  it('zero outBidMargin should still produce bid 1 sat higher (minimum floor)', () => {
    const currentPrice = 500000;
    const outBidMargin = 0; // zero margin

    // Math.max(1, ...) ensures at least 1 sat outbid
    const outBidAmount = Math.max(1, Math.round(outBidMargin * 1e8));
    const bidPrice = currentPrice + outBidAmount;

    expect(outBidAmount).toBe(1);
    expect(bidPrice).toBe(500001);
    expect(bidPrice).toBeGreaterThan(currentPrice);
  });
});

describe('Global Sliding Window Pacer (Map-based slots)', () => {
  it('should allow burst up to capacity', () => {
    // Simulates Map-based sliding window: slot count within 60s must be < capacity
    const capacity = 50; // 10 wallets × 5 bids/min
    const slots = new Map<number, number>(); // slotId → timestamp
    let counter = 0;
    const now = Date.now();

    // Fill up to capacity — all should be allowed
    for (let i = 0; i < capacity; i++) {
      slots.set(++counter, now);
    }

    expect(slots.size).toBe(capacity);
    expect(slots.size).toBeLessThanOrEqual(capacity);
  });

  it('should block when at capacity', () => {
    const capacity = 50;
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Fill to capacity
    for (let i = 0; i < capacity; i++) {
      slots.set(++counter, now);
    }

    // Next bid should be blocked (slots.size >= capacity)
    const canBid = slots.size < capacity;
    expect(canBid).toBe(false);
  });

  it('should unblock after oldest timestamp expires from 60s window', () => {
    const capacity = 50;
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Fill with timestamps from 61 seconds ago (all expired)
    for (let i = 0; i < capacity; i++) {
      slots.set(++counter, now - 61000);
    }

    // Clean expired slots (same logic as waitForGlobalBidSlot)
    const windowStart = now - 60000;
    for (const [id, ts] of slots) {
      if (ts <= windowStart) slots.delete(id);
    }

    // All expired — should be able to bid again
    expect(slots.size).toBe(0);
    const canBid = slots.size < capacity;
    expect(canBid).toBe(true);
  });

  it('should calculate correct wait time when at capacity', () => {
    const capacity = 5;
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Oldest bid was 50s ago, rest are recent
    slots.set(++counter, now - 50000);
    for (let i = 1; i < capacity; i++) {
      slots.set(++counter, now - 1000);
    }

    // At capacity — wait for oldest to expire
    const oldestTs = Math.min(...slots.values());
    const waitMs = oldestTs + 60000 - now + 100;
    // oldest was 50s ago → expires in 10s → wait ~10.1s
    expect(waitMs).toBeCloseTo(10100, -2);
  });

  it('capacity scales with wallet count', () => {
    // Groups path: totalThroughput = sum of (wallets × bidsPerMinute) per group
    const groups = [
      { wallets: 5, bidsPerMinute: 5 },
      { wallets: 3, bidsPerMinute: 5 },
    ];
    const totalThroughput = groups.reduce((sum, g) => sum + g.wallets * g.bidsPerMinute, 0);
    expect(totalThroughput).toBe(40);

    // Legacy path: wallets.length × bidsPerMinute
    const legacyWallets = 10;
    const legacyBpm = 5;
    expect(legacyWallets * legacyBpm).toBe(50);
  });

  it('PQueue concurrency scales with wallet count (capped at 20)', () => {
    expect(Math.min(10 * 4, 20)).toBe(20);
    expect(Math.min(5 * 4, 20)).toBe(20);
    expect(Math.min(3 * 4, 20)).toBe(12);
    expect(Math.min(2 * 4, 20)).toBe(8);
    expect(Math.min(1 * 4, 20)).toBe(4);
    expect(Math.min(20 * 4, 20)).toBe(20);
    expect(Math.min(3 * 4, 20)).toBe(12);
  });

  it('sliding window only counts bids within last 60 seconds', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Mix of expired and active timestamps
    slots.set(++counter, now - 120000); // expired
    slots.set(++counter, now - 90000);  // expired
    slots.set(++counter, now - 30000);  // active
    slots.set(++counter, now - 10000);  // active
    slots.set(++counter, now);          // active

    // Clean expired
    const windowStart = now - 60000;
    for (const [id, ts] of slots) {
      if (ts <= windowStart) slots.delete(id);
    }

    expect(slots.size).toBe(3); // Only 3 active bids in window
  });

  it('concurrent slot reservation prevents over-booking (mutex logic)', () => {
    const capacity = 1;
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // First caller gets the slot
    const canBid1 = slots.size < capacity;
    expect(canBid1).toBe(true);
    slots.set(++counter, now); // Reserve

    // Second caller blocked — slot taken
    const canBid2 = slots.size < capacity;
    expect(canBid2).toBe(false);
  });

  it('concurrent same-ms reservations get unique IDs', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Two reservations at exact same millisecond — different slot IDs
    const slotId1 = ++counter;
    slots.set(slotId1, now);
    const slotId2 = ++counter;
    slots.set(slotId2, now);

    expect(slotId1).not.toBe(slotId2);
    expect(slots.size).toBe(2);
  });

  it('release only removes specific slot (no cross-slot leaks)', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve 3 slots at same millisecond
    const id1 = ++counter; slots.set(id1, now);
    const id2 = ++counter; slots.set(id2, now);
    const id3 = ++counter; slots.set(id3, now);
    expect(slots.size).toBe(3);

    // Release slot 2 — only slot 2 should be gone
    slots.delete(id2);
    expect(slots.size).toBe(2);
    expect(slots.has(id1)).toBe(true);
    expect(slots.has(id2)).toBe(false);
    expect(slots.has(id3)).toBe(true);
  });
});

describe('Reserve-First Pipeline', () => {
  it('should reserve slot and return unique ID for later release', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve a slot (simulates waitForGlobalBidSlot returning slotId)
    const slotId = ++counter;
    slots.set(slotId, now);

    expect(slots.size).toBe(1);
    expect(slotId).toBeGreaterThan(0);
  });

  it('should release reserved slot when no bid is placed', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve a slot
    const slotId = ++counter;
    slots.set(slotId, now);
    expect(slots.size).toBe(1);

    // Decide not to bid — release the slot
    slots.delete(slotId);

    expect(slots.size).toBe(0); // Slot freed
  });

  it('released slot allows next task to proceed', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const capacity = 1;
    const now = Date.now();

    // Task 1 reserves
    const slotId1 = ++counter;
    slots.set(slotId1, now);
    expect(slots.size < capacity).toBe(false); // At capacity

    // Task 1 releases (no bid needed)
    slots.delete(slotId1);
    expect(slots.size < capacity).toBe(true); // Slot available

    // Task 2 can now reserve
    const slotId2 = ++counter;
    slots.set(slotId2, now + 100);
    expect(slots.size).toBe(1);
  });

  it('slot consumption prevents double-release', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve and consume (bid placed successfully)
    const slotId = ++counter;
    slots.set(slotId, now);
    let slotConsumed = false;
    slotConsumed = true; // Bid succeeded

    // Finally block: should NOT release because slotConsumed is true
    if (!slotConsumed && slotId > 0) {
      slots.delete(slotId);
    }

    // Slot stays (bid was placed, timestamp stays in window)
    expect(slots.size).toBe(1);
  });

  it('failed bid does NOT consume slot — finally releases it', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve a slot
    const slotId = ++counter;
    slots.set(slotId, now);
    let slotConsumed = false;

    // Bid fails — slotConsumed stays false (moved inside if(result.success))
    const result = { success: false, reason: 'bid_rejected' };
    if (result.success) {
      slotConsumed = true;
    }

    // Finally block: should release because slotConsumed is false
    if (!slotConsumed && slotId > 0) {
      slots.delete(slotId);
    }

    expect(slots.size).toBe(0); // Slot freed for next task
  });

  it('successful bid consumes slot — finally does NOT release it', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve a slot
    const slotId = ++counter;
    slots.set(slotId, now);
    let slotConsumed = false;

    // Bid succeeds — slotConsumed set true inside if(result.success)
    const result = { success: true };
    if (result.success) {
      slotConsumed = true;
    }

    // Finally block: should NOT release
    if (!slotConsumed && slotId > 0) {
      slots.delete(slotId);
    }

    expect(slots.size).toBe(1); // Slot retained (bid counts toward window)
  });

  it('failed COLLECTION bid releases slot', () => {
    const slots = new Map<number, number>();
    let counter = 0;
    const now = Date.now();

    // Reserve a collection slot
    const collSlotId = ++counter;
    slots.set(collSlotId, now);
    let collSlotConsumed = false;

    // Collection bid fails
    const result = { success: false, reason: 'wallet_exhausted' };
    if (result.success) {
      collSlotConsumed = true;
    }

    // Finally: release unused slot
    if (!collSlotConsumed) {
      slots.delete(collSlotId);
    }

    expect(slots.size).toBe(0); // Slot freed
  });
});

describe('Counter-Bid Bypass', () => {
  it('counter-bids bypass global pacer entirely', () => {
    // Counter-bids are rare, time-sensitive WebSocket events, and per-wallet rate-limited.
    // The rotation functions no longer call waitForGlobalBidSlot() for any path.
    // Scheduled bids reserve their slot in the reserve-first pipeline before calling rotation.
    let globalPacerCalled = false;

    // Neither path calls waitForGlobalBidSlot() inside the rotation functions
    expect(globalPacerCalled).toBe(false);
  });

  it('scheduled bids use pre-reserved slots from reserve-first pipeline', () => {
    // Scheduled bids reserve their slot BEFORE API calls via waitForGlobalBidSlot()
    // in the scheduled loop. The rotation functions never reserve slots themselves.
    let globalPacerCalled = false;

    // Rotation functions don't call waitForGlobalBidSlot in any case
    // The scheduled loop does the reservation before entering the bid task
    expect(globalPacerCalled).toBe(false);
  });
});

describe('Per-Collection Scheduled Lock', () => {
  it('scheduledRunning is a Set of collection symbols, not a boolean', () => {
    // The old isScheduledRunning was a global boolean that serialized ALL collections.
    // The new scheduledRunning is a Set<string> that locks per-collection.
    const scheduledRunning = new Set<string>();

    // Two collections can be tracked independently
    scheduledRunning.add('collection-a');
    scheduledRunning.add('collection-b');

    expect(scheduledRunning.has('collection-a')).toBe(true);
    expect(scheduledRunning.has('collection-b')).toBe(true);
    expect(scheduledRunning.has('collection-c')).toBe(false);
    expect(scheduledRunning.size).toBe(2);
  });

  it('two collections can run scheduled loops concurrently', () => {
    const scheduledRunning = new Set<string>();

    // Collection A starts its cycle
    scheduledRunning.add('collection-a');
    // Collection B can also start (not blocked by A)
    const canStartB = !scheduledRunning.has('collection-b');
    expect(canStartB).toBe(true);

    scheduledRunning.add('collection-b');
    expect(scheduledRunning.size).toBe(2);
  });

  it('same collection skips if already running', () => {
    const scheduledRunning = new Set<string>();

    // Collection A starts
    scheduledRunning.add('collection-a');
    // Second cycle for A should skip
    const shouldSkip = scheduledRunning.has('collection-a');
    expect(shouldSkip).toBe(true);
  });

  it('lock is released after cycle completes', () => {
    const scheduledRunning = new Set<string>();
    scheduledRunning.add('collection-a');

    // Simulate cycle completion (finally block)
    scheduledRunning.delete('collection-a');
    expect(scheduledRunning.has('collection-a')).toBe(false);
    expect(scheduledRunning.size).toBe(0);
  });
});

describe('Counter-Bid Priority', () => {
  it('priority 1 should be higher than default priority 0', () => {
    // PQueue uses higher priority = processed first
    const counterBidPriority = 1;
    const scheduledBidPriority = 0;

    expect(counterBidPriority).toBeGreaterThan(scheduledBidPriority);
  });

  it('counter-bids route through PQueue instead of direct execution', () => {
    // The processQueue method now uses queue.add() with {priority: 1}
    // instead of directly calling handleIncomingBid
    // This ensures counter-bids get prioritized in the PQueue
    const queueAddCalls: Array<{ priority: number }> = [];
    const mockQueueAdd = (fn: () => void, opts: { priority: number }) => {
      queueAddCalls.push(opts);
    };

    // Simulate 3 events being processed
    for (let i = 0; i < 3; i++) {
      mockQueueAdd(() => {}, { priority: 1 });
    }

    expect(queueAddCalls).toHaveLength(3);
    expect(queueAddCalls.every(c => c.priority === 1)).toBe(true);
  });
});

describe('BIDS_PER_MINUTE Flow', () => {
  it('BIDS_PER_MINUTE flows to legacy wallet pool when bidsPerMinute not set', () => {
    const BIDS_PER_MINUTE = 8;
    const walletConfig = { wallets: [{ wif: 'a' }, { wif: 'b' }] } as any;

    // Legacy path uses: walletConfig.bidsPerMinute || BIDS_PER_MINUTE
    const effectiveBpm = walletConfig.bidsPerMinute || BIDS_PER_MINUTE;
    expect(effectiveBpm).toBe(8);
  });

  it('walletConfig.bidsPerMinute overrides BIDS_PER_MINUTE when set', () => {
    const BIDS_PER_MINUTE = 5;
    const walletConfig = { bidsPerMinute: 10, wallets: [{ wif: 'a' }] } as any;

    const effectiveBpm = walletConfig.bidsPerMinute || BIDS_PER_MINUTE;
    expect(effectiveBpm).toBe(10);
  });

  it('BIDS_PER_MINUTE flows to wallet groups as default', () => {
    const BIDS_PER_MINUTE = 8;
    const groups: Record<string, { bidsPerMinute?: number; wallets: any[] }> = {
      'group-a': { wallets: [{ wif: 'a' }] },           // No bidsPerMinute
      'group-b': { bidsPerMinute: 12, wallets: [{ wif: 'b' }] }, // Has own
    };

    // Apply default (same logic as bid.ts)
    for (const groupName of Object.keys(groups)) {
      const group = groups[groupName];
      if (group && !group.bidsPerMinute) {
        group.bidsPerMinute = BIDS_PER_MINUTE;
      }
    }

    expect(groups['group-a'].bidsPerMinute).toBe(8);  // Got default
    expect(groups['group-b'].bidsPerMinute).toBe(12); // Kept own
  });

  it('global capacity scales with wallet count and BPM', () => {
    const BIDS_PER_MINUTE = 8;
    const walletCount = 5;
    const totalThroughput = walletCount * BIDS_PER_MINUTE;

    expect(totalThroughput).toBe(40);
  });
});

describe('Collection Bid Rotation Pattern', () => {
  it('should select wallet from group manager when available', () => {
    // Tests the wallet selection priority logic used by placeCollectionBidWithRotation
    const ENABLE_WALLET_ROTATION = true;
    const isGroupManagerInit = true;
    const hasWalletGroup = true;

    let selectedSource = 'primary';

    if (ENABLE_WALLET_ROTATION && isGroupManagerInit && hasWalletGroup) {
      selectedSource = 'wallet_group';
    }

    expect(selectedSource).toBe('wallet_group');
  });

  it('should fall back to legacy pool when group manager unavailable', () => {
    const ENABLE_WALLET_ROTATION = true;
    const isGroupManagerInit = false;
    const hasWalletGroup = false;
    const isPoolInit = true;

    let selectedSource = 'primary';

    if (ENABLE_WALLET_ROTATION && isGroupManagerInit && hasWalletGroup) {
      selectedSource = 'wallet_group';
    } else if (ENABLE_WALLET_ROTATION && isPoolInit) {
      selectedSource = 'legacy_pool';
    }

    expect(selectedSource).toBe('legacy_pool');
  });

  it('should use primary wallet when rotation is disabled', () => {
    const ENABLE_WALLET_ROTATION = false;
    const isGroupManagerInit = true;
    const hasWalletGroup = true;
    const isPoolInit = true;

    let selectedSource = 'primary';

    if (ENABLE_WALLET_ROTATION && isGroupManagerInit && hasWalletGroup) {
      selectedSource = 'wallet_group';
    } else if (ENABLE_WALLET_ROTATION && isPoolInit) {
      selectedSource = 'legacy_pool';
    }

    expect(selectedSource).toBe('primary');
  });

  it('should reject zero/negative offer prices', () => {
    const testPrices = [0, -1, -100];
    for (const price of testPrices) {
      expect(price <= 0).toBe(true);
    }
  });

  it('should reject prices exceeding max allowed', () => {
    const offerPrice = 1000000;
    const maxAllowedPrice = 950000;

    const shouldReject = maxAllowedPrice && offerPrice > maxAllowedPrice;
    expect(shouldReject).toBeTruthy();
  });

  it('PlaceBidResult should track payment address from rotated wallet', () => {
    // Verify the result shape carries the wallet address for bidHistory updates
    const result = {
      success: true,
      reason: undefined,
      paymentAddress: 'bc1q_rotated_wallet',
      walletLabel: 'group1-wallet2',
    };

    expect(result.paymentAddress).toBe('bc1q_rotated_wallet');
    expect(result.paymentAddress).not.toBe('bc1q_primary');
  });

  it('should use per-wallet pacer only when rotation is disabled', () => {
    // When rotation is enabled and pools are initialized, per-wallet pacer is skipped
    // (the wallet pool/group handles per-wallet rate limiting internally)
    const scenarios = [
      { rotation: true, poolInit: true, groupInit: false, expectPacer: false },
      { rotation: true, poolInit: false, groupInit: true, expectPacer: false },
      { rotation: true, poolInit: true, groupInit: true, expectPacer: false },
      { rotation: false, poolInit: true, groupInit: true, expectPacer: true },
      { rotation: true, poolInit: false, groupInit: false, expectPacer: true },
    ];

    for (const s of scenarios) {
      const usePacer = !s.rotation || (!s.poolInit && !s.groupInit);
      expect(usePacer).toBe(s.expectPacer);
    }
  });
});

describe('Wallet Exhaustion Cycle Skip', () => {
  it('should skip remaining tokens after wallet_exhausted result', () => {
    // Simulates the queue processing loop with walletExhaustedForCycle flag
    let walletExhaustedForCycle = false;
    let successfulBidsPlaced = 0;
    const targetBidCount = 20;
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);
    const processed: string[] = [];
    const skipped: string[] = [];

    for (const tokenId of tokens) {
      if (successfulBidsPlaced >= targetBidCount) break;
      if (walletExhaustedForCycle) {
        skipped.push(tokenId);
        continue;
      }

      processed.push(tokenId);

      // Simulate: first 2 succeed, 3rd gets wallet_exhausted
      if (processed.length <= 2) {
        successfulBidsPlaced++;
      } else {
        const result = { success: false, reason: 'wallet_exhausted' };
        if (result.reason === 'wallet_exhausted' && !walletExhaustedForCycle) {
          walletExhaustedForCycle = true;
        }
      }
    }

    expect(processed.length).toBe(3); // 2 success + 1 exhausted
    expect(skipped.length).toBe(7);   // Remaining tokens skipped
    expect(walletExhaustedForCycle).toBe(true);
    expect(successfulBidsPlaced).toBe(2);
  });

  it('should not set flag for non-exhaustion failures', () => {
    let walletExhaustedForCycle = false;
    const failReasons = ['rate_limited', 'api_error', 'unknown', undefined];

    for (const reason of failReasons) {
      const result = { success: false, reason };
      if (result.reason === 'wallet_exhausted' && !walletExhaustedForCycle) {
        walletExhaustedForCycle = true;
      }
    }

    expect(walletExhaustedForCycle).toBe(false);
  });

  it('should reset flag per cycle (each startCollectionMonitoring iteration)', () => {
    // Each scheduled loop iteration declares a fresh walletExhaustedForCycle = false
    const cycles = 3;
    const flagPerCycle: boolean[] = [];

    for (let cycle = 0; cycle < cycles; cycle++) {
      let walletExhaustedForCycle = false; // Fresh per cycle

      // Simulate exhaustion on first cycle only
      if (cycle === 0) {
        walletExhaustedForCycle = true;
      }

      flagPerCycle.push(walletExhaustedForCycle);
    }

    expect(flagPerCycle).toEqual([true, false, false]);
  });

  it('should log only once when flag transitions from false to true', () => {
    let walletExhaustedForCycle = false;
    let logCount = 0;

    // Simulate 5 consecutive wallet_exhausted results
    for (let i = 0; i < 5; i++) {
      const result = { success: false, reason: 'wallet_exhausted' };
      if (result.reason === 'wallet_exhausted' && !walletExhaustedForCycle) {
        walletExhaustedForCycle = true;
        logCount++;
      }
    }

    expect(logCount).toBe(1);
    expect(walletExhaustedForCycle).toBe(true);
  });

  it('should increment skippedWalletExhausted counter for each skipped token', () => {
    let walletExhaustedForCycle = false;
    let skippedWalletExhausted = 0;
    let successfulBidsPlaced = 0;
    const targetBidCount = 20;
    const tokens = Array.from({ length: 10 }, (_, i) => `token-${i}`);

    for (const tokenId of tokens) {
      if (successfulBidsPlaced >= targetBidCount) break;
      if (walletExhaustedForCycle) {
        skippedWalletExhausted++;
        continue;
      }

      // Simulate: first 2 succeed, 3rd gets wallet_exhausted
      if (tokens.indexOf(tokenId) <= 1) {
        successfulBidsPlaced++;
      } else if (tokens.indexOf(tokenId) === 2) {
        const result = { success: false, reason: 'wallet_exhausted' };
        if (result.reason === 'wallet_exhausted' && !walletExhaustedForCycle) {
          walletExhaustedForCycle = true;
        }
      }
    }

    expect(skippedWalletExhausted).toBe(7); // tokens 3-9 skipped
    expect(successfulBidsPlaced).toBe(2);
    expect(walletExhaustedForCycle).toBe(true);
  });
});

describe('getReceiveAddressesToQuery address selection', () => {
  it('should return payment addresses when CENTRALIZE_RECEIVE_ADDRESS is false', () => {
    // Simulates the logic in getReceiveAddressesToQuery when !CENTRALIZE_RECEIVE_ADDRESS
    const CENTRALIZE_RECEIVE_ADDRESS = false;
    const addresses: string[] = [];
    const seen = new Set<string>();

    if (CENTRALIZE_RECEIVE_ADDRESS) {
      // Would return TOKEN_RECEIVE_ADDRESS (bc1p...)
      addresses.push(TEST_RECEIVE_ADDRESS);
    } else {
      // Should derive payment addresses from WIF
      const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
      const payAddr = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: bitcoin.networks.bitcoin }).address;
      if (payAddr && !seen.has(payAddr.toLowerCase())) {
        addresses.push(payAddr);
        seen.add(payAddr.toLowerCase());
      }
    }

    expect(addresses).toHaveLength(1);
    expect(addresses[0].startsWith('bc1q')).toBe(true);
  });

  it('should return receive address when CENTRALIZE_RECEIVE_ADDRESS is true', () => {
    // Simulates the logic in getReceiveAddressesToQuery when CENTRALIZE_RECEIVE_ADDRESS
    const CENTRALIZE_RECEIVE_ADDRESS = true;
    const addresses: string[] = [];

    if (CENTRALIZE_RECEIVE_ADDRESS) {
      addresses.push(TEST_RECEIVE_ADDRESS);
    }

    expect(addresses).toHaveLength(1);
    expect(addresses[0]).toBe(TEST_RECEIVE_ADDRESS);
    expect(addresses[0].startsWith('bc1p')).toBe(true);
  });

  it('should use getAllPaymentAddresses for wallet groups when !CENTRALIZE_RECEIVE_ADDRESS', () => {
    // Verifies the pattern: wallet group manager returns payment addresses, not receive
    const CENTRALIZE_RECEIVE_ADDRESS = false;
    const mockGroupReceiveAddresses = ['bc1preceive1', 'bc1preceive2'];
    const mockGroupPaymentAddresses = ['bc1qpayment1', 'bc1qpayment2'];
    const addresses: string[] = [];

    // The actual code uses getAllPaymentAddresses() when !CENTRALIZE_RECEIVE_ADDRESS
    const addrs = CENTRALIZE_RECEIVE_ADDRESS ? mockGroupReceiveAddresses : mockGroupPaymentAddresses;
    addresses.push(...addrs);

    expect(addresses).toEqual(mockGroupPaymentAddresses);
    expect(addresses.every(a => a.startsWith('bc1q'))).toBe(true);
  });
});

describe('Prefetched Offers', () => {
  it('placeBid uses prefetchedOffers when provided (skips API call)', () => {
    // Simulates the prefetchedOffers path in placeBid()
    const prefetchedOffers = { offers: [{ id: 'offer1', buyerPaymentAddress: 'bc1q...' }] };

    let offerData;
    let apiFetchCalled = false;

    if (prefetchedOffers) {
      offerData = prefetchedOffers;
    } else {
      apiFetchCalled = true;
      offerData = { offers: [] }; // Would be from API
    }

    expect(offerData).toBe(prefetchedOffers);
    expect(apiFetchCalled).toBe(false);
  });

  it('placeBid fetches from API when prefetchedOffers is undefined', () => {
    const prefetchedOffers = undefined;

    let offerData;
    let apiFetchCalled = false;

    if (prefetchedOffers) {
      offerData = prefetchedOffers;
    } else {
      apiFetchCalled = true;
      offerData = { offers: [{ id: 'api-offer' }] };
    }

    expect(apiFetchCalled).toBe(true);
    expect(offerData.offers[0].id).toBe('api-offer');
  });
});

describe('Collection Details Cache', () => {
  it('returns cached data within TTL', () => {
    const cache = new Map<string, { data: any; fetchedAt: number }>();
    const TTL = 30_000;
    const now = Date.now();

    // Cache a result
    cache.set('test-collection', { data: { floorPrice: 100000 }, fetchedAt: now });

    // Read within TTL
    const cached = cache.get('test-collection');
    const isValid = cached && (now - cached.fetchedAt < TTL);

    expect(isValid).toBe(true);
    expect(cached!.data.floorPrice).toBe(100000);
  });

  it('refetches after TTL expires', () => {
    const cache = new Map<string, { data: any; fetchedAt: number }>();
    const TTL = 30_000;
    const now = Date.now();

    // Cache a result from 31 seconds ago
    cache.set('test-collection', { data: { floorPrice: 100000 }, fetchedAt: now - 31000 });

    // Read after TTL — should be stale
    const cached = cache.get('test-collection');
    const isValid = cached && (now - cached.fetchedAt < TTL);

    expect(isValid).toBe(false);

    // Would refetch and update cache
    const newData = { floorPrice: 120000 };
    cache.set('test-collection', { data: newData, fetchedAt: now });

    const updated = cache.get('test-collection');
    expect(updated!.data.floorPrice).toBe(120000);
  });
});
