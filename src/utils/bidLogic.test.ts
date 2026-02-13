import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  // Constants
  CONVERSION_RATE,
  DEFAULT_RECENT_BID_COOLDOWN_MS,
  DEFAULT_MAX_RECENT_BIDS_SIZE,
  DEFAULT_TOKEN_LOCK_TIMEOUT_MS,
  DEFAULT_BID_HISTORY_MAX_AGE_MS,
  DEFAULT_MAX_BIDS_PER_COLLECTION,
  WATCHED_EVENTS,

  // Bid Calculation
  calculateBidPrice,
  calculateOutbidPrice,
  calculateMinimumBidPrice,

  // Bid Validation
  validateBidAgainstFloor,
  validateFloorBidRange,
  validateFloorPrice,
  hasReachedQuantityLimit,

  // Recent Bid Tracking
  isRecentBid,
  getSecondsSinceLastBid,
  addRecentBidWithLimit,
  cleanupRecentBidsMap,

  // Token Lock
  isLockStale,
  getLockHeldTime,

  // Bid History
  createBidHistoryEntry,
  cleanupExpiredBids,
  limitBidsPerCollection,
  limitBottomListings,
  isBidExpired,
  findTokensToCancel,
  combineBidsAndListings,

  // Purchase Events
  getPurchaseEventKey,
  markPurchaseEventWithLimit,

  // WebSocket
  isValidJSON,
  isValidWebSocketMessage,
  isWatchedEvent,
  isPurchaseEvent,
  PURCHASE_EVENT_KINDS,

  // Collection Config
  validateCollectionConfig,
  getEffectiveMaxFloorBid,

  // Utilities
  getUniqueBottomListings,
  sortListingsByPrice,
  satsToBTC,
  btcToSats,

  // Types
  BidHistoryEntry,
  UserBid,
  BottomListing,
} from './bidLogic';

describe('bidLogic', () => {
  // ============================================================================
  // Constants Tests
  // ============================================================================
  describe('Constants', () => {
    it('should have correct CONVERSION_RATE', () => {
      expect(CONVERSION_RATE).toBe(100000000);
    });

    it('should have correct DEFAULT_RECENT_BID_COOLDOWN_MS', () => {
      expect(DEFAULT_RECENT_BID_COOLDOWN_MS).toBe(30000);
    });

    it('should have correct DEFAULT_MAX_RECENT_BIDS_SIZE', () => {
      expect(DEFAULT_MAX_RECENT_BIDS_SIZE).toBe(5000);
    });

    it('should have correct DEFAULT_TOKEN_LOCK_TIMEOUT_MS', () => {
      expect(DEFAULT_TOKEN_LOCK_TIMEOUT_MS).toBe(60000);
    });

    it('should have correct DEFAULT_BID_HISTORY_MAX_AGE_MS', () => {
      expect(DEFAULT_BID_HISTORY_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('should have correct WATCHED_EVENTS', () => {
      expect(WATCHED_EVENTS).toContain('offer_placed');
      expect(WATCHED_EVENTS).toContain('coll_offer_created');
      expect(WATCHED_EVENTS).toContain('coll_offer_edited');
      expect(WATCHED_EVENTS).toContain('offer_cancelled');
      expect(WATCHED_EVENTS).toContain('coll_offer_cancelled');
      expect(WATCHED_EVENTS).toContain('buying_broadcasted');
      expect(WATCHED_EVENTS).not.toContain('list');
      expect(WATCHED_EVENTS).toHaveLength(8);
    });
  });

  // ============================================================================
  // Bid Calculation Tests
  // ============================================================================
  describe('calculateBidPrice', () => {
    it('should calculate min and max offers correctly', () => {
      // Floor: 1 BTC, minBid: 0.001 BTC, maxBid: 0.5 BTC
      // minFloorBid: 50%, maxFloorBid: 80%
      const floorPrice = 100000000; // 1 BTC in sats
      const result = calculateBidPrice(floorPrice, 0.001, 0.5, 50, 80);

      // minOffer = max(0.001 BTC, 50% of 1 BTC) = max(100000, 50000000) = 50000000
      expect(result.minOffer).toBe(50000000);
      // maxOffer = min(0.5 BTC, 80% of 1 BTC) = min(50000000, 80000000) = 50000000
      expect(result.maxOffer).toBe(50000000);
    });

    it('should use minBid when higher than floor percentage', () => {
      const floorPrice = 10000000; // 0.1 BTC
      const result = calculateBidPrice(floorPrice, 0.01, 0.5, 10, 80);

      // minFloorBid% = 10% of 0.1 BTC = 0.01 BTC = 1000000 sats
      // minBid = 0.01 BTC = 1000000 sats
      // They're equal in this case
      expect(result.minOffer).toBe(1000000);
    });

    it('should use maxBid when lower than floor percentage', () => {
      const floorPrice = 100000000; // 1 BTC
      const result = calculateBidPrice(floorPrice, 0.001, 0.1, 50, 90);

      // maxFloorBid% = 90% of 1 BTC = 0.9 BTC = 90000000 sats
      // maxBid = 0.1 BTC = 10000000 sats
      expect(result.maxOffer).toBe(10000000);
    });

    it('should handle small floor prices', () => {
      const floorPrice = 100000; // 0.001 BTC
      const result = calculateBidPrice(floorPrice, 0.0001, 0.0005, 50, 80);

      expect(result.minOffer).toBe(50000); // 50% of 0.001 BTC
      expect(result.maxOffer).toBe(50000); // min(0.0005 BTC, 80% of 0.001 BTC)
    });

    it('should round values correctly', () => {
      const floorPrice = 123456789;
      const result = calculateBidPrice(floorPrice, 0.001, 1, 33.33, 66.66);

      // Should be integers (rounded)
      expect(Number.isInteger(result.minOffer)).toBe(true);
      expect(Number.isInteger(result.maxOffer)).toBe(true);
    });
  });

  describe('calculateOutbidPrice', () => {
    it('should calculate outbid price correctly', () => {
      const currentPrice = 1000000; // 0.01 BTC in sats
      const margin = 0.00001; // 0.00001 BTC
      const maxBid = 2000000;

      const result = calculateOutbidPrice(currentPrice, margin, maxBid);
      expect(result).toBe(1001000); // 1000000 + 1000
    });

    it('should return null when outbid would exceed max', () => {
      const currentPrice = 1990000;
      const margin = 0.0002; // 20000 sats
      const maxBid = 2000000;

      const result = calculateOutbidPrice(currentPrice, margin, maxBid);
      expect(result).toBeNull();
    });

    it('should return exact max when outbid equals max', () => {
      const currentPrice = 1980000;
      const margin = 0.0002;
      const maxBid = 2000000;

      const result = calculateOutbidPrice(currentPrice, margin, maxBid);
      expect(result).toBe(2000000);
    });

    it('should handle zero margin', () => {
      const result = calculateOutbidPrice(1000000, 0, 2000000);
      expect(result).toBe(1000000);
    });
  });

  describe('calculateMinimumBidPrice', () => {
    it('should always return minOffer regardless of listed price', () => {
      const listedPrice = 1000000;
      const minOffer = 100000;

      const result = calculateMinimumBidPrice(listedPrice, minOffer);
      expect(result).toBe(100000); // always returns minOffer
    });

    it('should return minOffer even when it equals listed price', () => {
      const listedPrice = 100000;
      const minOffer = 100000;

      const result = calculateMinimumBidPrice(listedPrice, minOffer);
      expect(result).toBe(100000);
    });

    it('should return minOffer without any rounding', () => {
      const listedPrice = 123457;
      const minOffer = 10001;

      const result = calculateMinimumBidPrice(listedPrice, minOffer);
      expect(result).toBe(10001); // returns minOffer as-is
    });
  });

  // ============================================================================
  // Bid Validation Tests
  // ============================================================================
  describe('validateBidAgainstFloor', () => {
    it('should allow trait-based ITEM offers above 100%', () => {
      const result = validateBidAgainstFloor(150, 'ITEM', true);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject ITEM offers above 100% without traits', () => {
      const result = validateBidAgainstFloor(150, 'ITEM', false);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('above 100%');
    });

    it('should reject COLLECTION offers above 100%', () => {
      const result = validateBidAgainstFloor(150, 'COLLECTION', false);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('above 100%');
    });

    it('should allow offers at exactly 100%', () => {
      const result = validateBidAgainstFloor(100, 'ITEM', false);
      expect(result.valid).toBe(true);
    });

    it('should allow offers below 100%', () => {
      const result = validateBidAgainstFloor(80, 'COLLECTION', false);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFloorBidRange', () => {
    it('should reject when minFloorBid > maxFloorBid', () => {
      const result = validateFloorBidRange(80, 50);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('80%');
      expect(result.reason).toContain('50%');
    });

    it('should allow when minFloorBid < maxFloorBid', () => {
      const result = validateFloorBidRange(50, 80);
      expect(result.valid).toBe(true);
    });

    it('should allow when minFloorBid == maxFloorBid', () => {
      const result = validateFloorBidRange(70, 70);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateFloorPrice', () => {
    it('should reject null floor price', () => {
      const result = validateFloorPrice(null);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No floor price');
    });

    it('should reject undefined floor price', () => {
      const result = validateFloorPrice(undefined);
      expect(result.valid).toBe(false);
    });

    it('should reject NaN floor price', () => {
      const result = validateFloorPrice(NaN);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid');
    });

    it('should reject zero floor price', () => {
      const result = validateFloorPrice(0);
      expect(result.valid).toBe(false);
    });

    it('should reject negative floor price', () => {
      const result = validateFloorPrice(-100000);
      expect(result.valid).toBe(false);
    });

    it('should accept valid floor price', () => {
      const result = validateFloorPrice(100000000);
      expect(result.valid).toBe(true);
    });
  });

  describe('hasReachedQuantityLimit', () => {
    it('should return true when current equals max', () => {
      expect(hasReachedQuantityLimit(5, 5)).toBe(true);
    });

    it('should return true when current exceeds max', () => {
      expect(hasReachedQuantityLimit(6, 5)).toBe(true);
    });

    it('should return false when current is below max', () => {
      expect(hasReachedQuantityLimit(3, 5)).toBe(false);
    });

    it('should return false when current is zero', () => {
      expect(hasReachedQuantityLimit(0, 5)).toBe(false);
    });
  });

  // ============================================================================
  // Recent Bid Tracking Tests
  // ============================================================================
  describe('isRecentBid', () => {
    it('should return false for unknown token', () => {
      const recentBids = new Map<string, number>();
      expect(isRecentBid('token123', recentBids, 30000)).toBe(false);
    });

    it('should return true for recently bid token', () => {
      const recentBids = new Map<string, number>();
      recentBids.set('token123', Date.now() - 10000); // 10 seconds ago
      expect(isRecentBid('token123', recentBids, 30000)).toBe(true);
    });

    it('should return false for expired bid', () => {
      const recentBids = new Map<string, number>();
      recentBids.set('token123', Date.now() - 60000); // 60 seconds ago
      expect(isRecentBid('token123', recentBids, 30000)).toBe(false);
    });

    it('should use default cooldown when not specified', () => {
      const recentBids = new Map<string, number>();
      recentBids.set('token123', Date.now() - 15000); // 15 seconds ago
      expect(isRecentBid('token123', recentBids)).toBe(true);
    });
  });

  describe('getSecondsSinceLastBid', () => {
    it('should return -1 for unknown token', () => {
      const recentBids = new Map<string, number>();
      expect(getSecondsSinceLastBid('token123', recentBids)).toBe(-1);
    });

    it('should return approximate seconds since last bid', () => {
      const recentBids = new Map<string, number>();
      recentBids.set('token123', Date.now() - 15500); // ~15 seconds ago

      const result = getSecondsSinceLastBid('token123', recentBids);
      expect(result).toBeGreaterThanOrEqual(15);
      expect(result).toBeLessThanOrEqual(16);
    });
  });

  describe('addRecentBidWithLimit', () => {
    it('should add bid to map', () => {
      const recentBids = new Map<string, number>();
      addRecentBidWithLimit('token123', 12345, recentBids, 10);

      expect(recentBids.has('token123')).toBe(true);
      expect(recentBids.get('token123')).toBe(12345);
    });

    it('should remove oldest when at limit', () => {
      const recentBids = new Map<string, number>();
      recentBids.set('token1', 1);
      recentBids.set('token2', 2);
      recentBids.set('token3', 3);

      const removed = addRecentBidWithLimit('token4', 4, recentBids, 3);

      expect(removed).toBe('token1');
      expect(recentBids.has('token1')).toBe(false);
      expect(recentBids.has('token4')).toBe(true);
      expect(recentBids.size).toBe(3);
    });

    it('should return null when not at limit', () => {
      const recentBids = new Map<string, number>();
      const removed = addRecentBidWithLimit('token1', 1, recentBids, 10);
      expect(removed).toBeNull();
    });
  });

  describe('cleanupRecentBidsMap', () => {
    it('should remove expired entries', () => {
      const recentBids = new Map<string, number>();
      const now = Date.now();
      recentBids.set('old', now - 120000); // 2 minutes old (beyond 2x cooldown)
      recentBids.set('new', now - 10000); // 10 seconds old

      const cleaned = cleanupRecentBidsMap(recentBids, 30000, 100);

      expect(cleaned).toBe(1);
      expect(recentBids.has('old')).toBe(false);
      expect(recentBids.has('new')).toBe(true);
    });

    it('should enforce max size', () => {
      const recentBids = new Map<string, number>();
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        recentBids.set(`token${i}`, now - i * 1000);
      }

      const cleaned = cleanupRecentBidsMap(recentBids, 30000, 5);

      expect(recentBids.size).toBe(5);
      expect(cleaned).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Token Lock Tests
  // ============================================================================
  describe('isLockStale', () => {
    it('should return false for undefined timestamp', () => {
      expect(isLockStale(undefined)).toBe(false);
    });

    it('should return false for recent lock', () => {
      const recentTimestamp = Date.now() - 30000; // 30 seconds ago
      expect(isLockStale(recentTimestamp, 60000)).toBe(false);
    });

    it('should return true for stale lock', () => {
      const staleTimestamp = Date.now() - 120000; // 2 minutes ago
      expect(isLockStale(staleTimestamp, 60000)).toBe(true);
    });
  });

  describe('getLockHeldTime', () => {
    it('should return time in seconds', () => {
      const timestamp = Date.now() - 45000; // 45 seconds ago
      const result = getLockHeldTime(timestamp);

      expect(result).toBeGreaterThanOrEqual(45);
      expect(result).toBeLessThanOrEqual(46);
    });
  });

  // ============================================================================
  // Bid History Tests
  // ============================================================================
  describe('createBidHistoryEntry', () => {
    it('should create ITEM entry with correct structure', () => {
      const entry = createBidHistoryEntry('ITEM');

      expect(entry.offerType).toBe('ITEM');
      expect(entry.ourBids).toEqual({});
      expect(entry.topBids).toEqual({});
      expect(entry.bottomListings).toEqual([]);
      expect(entry.lastSeenActivity).toBeNull();
      expect(entry.quantity).toBe(0);
    });

    it('should create COLLECTION entry', () => {
      const entry = createBidHistoryEntry('COLLECTION');
      expect(entry.offerType).toBe('COLLECTION');
    });
  });

  describe('cleanupExpiredBids', () => {
    it('should remove very old expired bids', () => {
      const now = Date.now();
      const entry: BidHistoryEntry = {
        offerType: 'ITEM',
        ourBids: {
          'old': { price: 1000, expiration: now - 48 * 60 * 60 * 1000 }, // 48 hours expired
          'recent': { price: 2000, expiration: now + 60000 }, // Not expired
        },
        topBids: { 'old': true, 'recent': true },
        bottomListings: [],
        lastSeenActivity: null,
        quantity: 0
      };

      const cleaned = cleanupExpiredBids(entry, 24 * 60 * 60 * 1000);

      expect(cleaned).toBe(1);
      expect(entry.ourBids['old']).toBeUndefined();
      expect(entry.ourBids['recent']).toBeDefined();
    });

    it('should keep recently expired bids within max age', () => {
      const now = Date.now();
      const entry: BidHistoryEntry = {
        offerType: 'ITEM',
        ourBids: {
          'recent_expired': { price: 1000, expiration: now - 1000 }, // 1 second expired
        },
        topBids: { 'recent_expired': true },
        bottomListings: [],
        lastSeenActivity: null,
        quantity: 0
      };

      const cleaned = cleanupExpiredBids(entry, 24 * 60 * 60 * 1000);

      expect(cleaned).toBe(0);
      expect(entry.ourBids['recent_expired']).toBeDefined();
    });
  });

  describe('limitBidsPerCollection', () => {
    it('should remove oldest bids when over limit', () => {
      const now = Date.now();
      const entry: BidHistoryEntry = {
        offerType: 'ITEM',
        ourBids: {
          'oldest': { price: 1000, expiration: now + 10000 },
          'middle': { price: 2000, expiration: now + 20000 },
          'newest': { price: 3000, expiration: now + 30000 },
        },
        topBids: { 'oldest': true, 'middle': true, 'newest': true },
        bottomListings: [],
        lastSeenActivity: null,
        quantity: 0
      };

      const removed = limitBidsPerCollection(entry, 2);

      expect(removed).toBe(1);
      expect(entry.ourBids['oldest']).toBeUndefined();
      expect(entry.ourBids['middle']).toBeDefined();
      expect(entry.ourBids['newest']).toBeDefined();
    });

    it('should not remove anything when under limit', () => {
      const entry: BidHistoryEntry = {
        offerType: 'ITEM',
        ourBids: { 'token1': { price: 1000, expiration: Date.now() + 10000 } },
        topBids: { 'token1': true },
        bottomListings: [],
        lastSeenActivity: null,
        quantity: 0
      };

      const removed = limitBidsPerCollection(entry, 10);
      expect(removed).toBe(0);
    });
  });

  describe('limitBottomListings', () => {
    it('should limit listings and sort by price', () => {
      const entry: BidHistoryEntry = {
        offerType: 'ITEM',
        ourBids: {},
        topBids: {},
        bottomListings: [
          { id: 'high', price: 3000 },
          { id: 'low', price: 1000 },
          { id: 'mid', price: 2000 },
        ],
        lastSeenActivity: null,
        quantity: 0
      };

      limitBottomListings(entry, 2);

      expect(entry.bottomListings).toHaveLength(2);
      expect(entry.bottomListings[0].id).toBe('low');
      expect(entry.bottomListings[1].id).toBe('mid');
    });
  });

  describe('isBidExpired', () => {
    it('should return true for past expiration', () => {
      const expiration = Date.now() - 1000;
      expect(isBidExpired(expiration)).toBe(true);
    });

    it('should return false for future expiration', () => {
      const expiration = Date.now() + 60000;
      expect(isBidExpired(expiration)).toBe(false);
    });

    it('should use provided now value', () => {
      const expiration = 100000;
      expect(isBidExpired(expiration, 99999)).toBe(false);
      expect(isBidExpired(expiration, 100000)).toBe(true);
      expect(isBidExpired(expiration, 100001)).toBe(true);
    });
  });

  describe('findTokensToCancel', () => {
    it('should find bids not in bottom listings', () => {
      const tokens = [
        { tokenId: 'token1', collectionSymbol: 'col1' },
        { tokenId: 'token2', collectionSymbol: 'col1' },
      ];
      const ourBids = [
        { tokenId: 'token1', collectionSymbol: 'col1' },
        { tokenId: 'token3', collectionSymbol: 'col1' }, // Not in bottom
      ];

      const toCancel = findTokensToCancel(tokens, ourBids);

      expect(toCancel).toHaveLength(1);
      expect(toCancel[0].tokenId).toBe('token3');
    });

    it('should return empty array when all bids are valid', () => {
      const tokens = [
        { tokenId: 'token1', collectionSymbol: 'col1' },
        { tokenId: 'token2', collectionSymbol: 'col1' },
      ];
      const ourBids = [
        { tokenId: 'token1', collectionSymbol: 'col1' },
      ];

      const toCancel = findTokensToCancel(tokens, ourBids);
      expect(toCancel).toHaveLength(0);
    });

    it('should check collection symbol matches', () => {
      const tokens = [
        { tokenId: 'token1', collectionSymbol: 'col1' },
      ];
      const ourBids = [
        { tokenId: 'token1', collectionSymbol: 'col2' }, // Different collection
      ];

      const toCancel = findTokensToCancel(tokens, ourBids);
      expect(toCancel).toHaveLength(1);
    });
  });

  describe('combineBidsAndListings', () => {
    it('should combine matching bids and listings', () => {
      const userBids: UserBid[] = [
        { collectionSymbol: 'col1', tokenId: 'token123', price: 1000, expiration: '2099-01-01' },
      ];
      const listings: BottomListing[] = [
        { id: 'token123', price: 2000 },
      ];

      const combined = combineBidsAndListings(userBids, listings);

      expect(combined).toHaveLength(1);
      expect(combined[0]!.bidId).toBe('token123'.slice(-8));
      expect(combined[0]!.price).toBe(1000);
      expect(combined[0]!.listedPrice).toBe(2000);
    });

    it('should filter out non-matching bids', () => {
      const userBids: UserBid[] = [
        { collectionSymbol: 'col1', tokenId: 'token123', price: 1000, expiration: '2099-01-01' },
      ];
      const listings: BottomListing[] = [
        { id: 'differentToken', price: 2000 },
      ];

      const combined = combineBidsAndListings(userBids, listings);
      expect(combined).toHaveLength(0);
    });

    it('should filter out expired bids', () => {
      const pastDate = new Date(Date.now() - 60_000).toISOString();
      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      const userBids: UserBid[] = [
        { collectionSymbol: 'col1', tokenId: 'token1', price: 1000, expiration: futureDate },
        { collectionSymbol: 'col1', tokenId: 'token2', price: 2000, expiration: pastDate },
      ];
      const listings: BottomListing[] = [
        { id: 'token1', price: 3000 },
        { id: 'token2', price: 4000 },
      ];

      const combined = combineBidsAndListings(userBids, listings);

      expect(combined).toHaveLength(1);
      expect(combined[0]!.bidId).toBe('token1'.slice(-8));
    });

    it('should sort by listed price ascending', () => {
      const userBids: UserBid[] = [
        { collectionSymbol: 'col1', tokenId: 'token1', price: 1000, expiration: '2099-01-01' },
        { collectionSymbol: 'col1', tokenId: 'token2', price: 500, expiration: '2099-01-01' },
      ];
      const listings: BottomListing[] = [
        { id: 'token1', price: 3000 },
        { id: 'token2', price: 1000 },
      ];

      const combined = combineBidsAndListings(userBids, listings);

      expect(combined).toHaveLength(2);
      expect(combined[0]!.listedPrice).toBe(1000);
      expect(combined[1]!.listedPrice).toBe(3000);
    });
  });

  // ============================================================================
  // Purchase Event Tests
  // ============================================================================
  describe('getPurchaseEventKey', () => {
    it('should create unique key from all parameters', () => {
      const key = getPurchaseEventKey('collection1', 'token123', 'buying_broadcasted', '2024-01-01');
      expect(key).toBe('collection1:token123:buying_broadcasted:2024-01-01');
    });

    it('should handle numeric createdAt', () => {
      const key = getPurchaseEventKey('col', 'tok', 'kind', 12345);
      expect(key).toBe('col:tok:kind:12345');
    });

    it('should handle undefined createdAt', () => {
      const key = getPurchaseEventKey('col', 'tok', 'kind');
      expect(key).toBe('col:tok:kind:unknown');
    });
  });

  describe('markPurchaseEventWithLimit', () => {
    it('should add event to set', () => {
      const events = new Set<string>();
      markPurchaseEventWithLimit('event1', events, 100);

      expect(events.has('event1')).toBe(true);
    });

    it('should clear half when at limit', () => {
      const events = new Set<string>();
      for (let i = 0; i < 10; i++) {
        events.add(`event${i}`);
      }

      const cleared = markPurchaseEventWithLimit('newEvent', events, 10);

      expect(cleared).toBe(5);
      expect(events.has('newEvent')).toBe(true);
    });

    it('should return 0 when not at limit', () => {
      const events = new Set<string>();
      const cleared = markPurchaseEventWithLimit('event1', events, 100);
      expect(cleared).toBe(0);
    });
  });

  // ============================================================================
  // WebSocket Tests
  // ============================================================================
  describe('isValidJSON', () => {
    it('should return true for valid JSON', () => {
      expect(isValidJSON('{"key": "value"}')).toBe(true);
      expect(isValidJSON('[]')).toBe(true);
      expect(isValidJSON('"string"')).toBe(true);
      expect(isValidJSON('123')).toBe(true);
      expect(isValidJSON('null')).toBe(true);
    });

    it('should return false for invalid JSON', () => {
      expect(isValidJSON('not json')).toBe(false);
      expect(isValidJSON('{invalid}')).toBe(false);
      expect(isValidJSON('')).toBe(false);
      expect(isValidJSON('undefined')).toBe(false);
    });
  });

  describe('isValidWebSocketMessage', () => {
    it('should reject null/undefined', () => {
      expect(isValidWebSocketMessage(null)).toBe(false);
      expect(isValidWebSocketMessage(undefined)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(isValidWebSocketMessage('string')).toBe(false);
      expect(isValidWebSocketMessage(123)).toBe(false);
      expect(isValidWebSocketMessage([])).toBe(false);
    });

    it('should reject missing kind', () => {
      expect(isValidWebSocketMessage({ collectionSymbol: 'col' })).toBe(false);
    });

    it('should reject missing collectionSymbol', () => {
      expect(isValidWebSocketMessage({ kind: 'offer_placed' })).toBe(false);
    });

    it('should require tokenId for token events', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_placed',
        collectionSymbol: 'col',
        listedPrice: 1000,
        buyerPaymentAddress: 'addr'
      })).toBe(false);
    });

    it('should require listedPrice for offer events', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_placed',
        collectionSymbol: 'col',
        tokenId: 'token',
        buyerPaymentAddress: 'addr'
      })).toBe(false);
    });

    it('should require buyerPaymentAddress for offer events', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_placed',
        collectionSymbol: 'col',
        tokenId: 'token',
        listedPrice: 1000
      })).toBe(false);
    });

    it('should accept valid offer_placed message', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_placed',
        collectionSymbol: 'col',
        tokenId: 'token',
        listedPrice: 1000,
        buyerPaymentAddress: 'addr'
      })).toBe(true);
    });

    it('should accept valid coll_offer_created message', () => {
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_created',
        collectionSymbol: 'col',
        listedPrice: '1000', // String is also valid
        buyerPaymentAddress: 'addr'
      })).toBe(true);
    });

    it('should accept simple events without extra fields', () => {
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_cancelled',
        collectionSymbol: 'col'
      })).toBe(true);
    });

    it('should require tokenId for offer_cancelled', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_cancelled',
        collectionSymbol: 'col'
      })).toBe(false);
    });

    it('should accept valid offer_cancelled with tokenId', () => {
      expect(isValidWebSocketMessage({
        kind: 'offer_cancelled',
        collectionSymbol: 'col',
        tokenId: 'token123'
      })).toBe(true);
    });

    it('should require listedPrice and buyerPaymentAddress for coll_offer_edited', () => {
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_edited',
        collectionSymbol: 'col'
      })).toBe(false);
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_edited',
        collectionSymbol: 'col',
        listedPrice: 1000
      })).toBe(false);
    });

    it('should accept valid coll_offer_edited with all fields', () => {
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_edited',
        collectionSymbol: 'col',
        listedPrice: 1000,
        buyerPaymentAddress: 'addr'
      })).toBe(true);
    });

    it('should accept coll_offer_cancelled with just kind and collectionSymbol', () => {
      expect(isValidWebSocketMessage({
        kind: 'coll_offer_cancelled',
        collectionSymbol: 'col'
      })).toBe(true);
    });
  });

  describe('isWatchedEvent', () => {
    it('should return true for watched events', () => {
      expect(isWatchedEvent('offer_placed')).toBe(true);
      expect(isWatchedEvent('coll_offer_created')).toBe(true);
      expect(isWatchedEvent('coll_offer_edited')).toBe(true);
      expect(isWatchedEvent('offer_cancelled')).toBe(true);
      expect(isWatchedEvent('coll_offer_cancelled')).toBe(true);
      expect(isWatchedEvent('buying_broadcasted')).toBe(true);
      expect(isWatchedEvent('offer_accepted_broadcasted')).toBe(true);
      expect(isWatchedEvent('coll_offer_fulfill_broadcasted')).toBe(true);
    });

    it('should return false for unwatched events', () => {
      expect(isWatchedEvent('listing_created')).toBe(false);
      expect(isWatchedEvent('unknown_event')).toBe(false);
      expect(isWatchedEvent('')).toBe(false);
      expect(isWatchedEvent('list')).toBe(false);
    });
  });

  describe('isPurchaseEvent', () => {
    it('should return true for purchase event kinds', () => {
      expect(isPurchaseEvent('buying_broadcasted')).toBe(true);
      expect(isPurchaseEvent('offer_accepted_broadcasted')).toBe(true);
      expect(isPurchaseEvent('coll_offer_fulfill_broadcasted')).toBe(true);
    });

    it('should return false for non-purchase events', () => {
      expect(isPurchaseEvent('offer_placed')).toBe(false);
      expect(isPurchaseEvent('coll_offer_created')).toBe(false);
      expect(isPurchaseEvent('offer_cancelled')).toBe(false);
      expect(isPurchaseEvent('')).toBe(false);
    });

    it('should have PURCHASE_EVENT_KINDS matching a subset of WATCHED_EVENTS', () => {
      for (const kind of PURCHASE_EVENT_KINDS) {
        expect(WATCHED_EVENTS).toContain(kind);
      }
      expect(PURCHASE_EVENT_KINDS).toHaveLength(3);
    });
  });

  // ============================================================================
  // Collection Config Tests
  // ============================================================================
  describe('validateCollectionConfig', () => {
    it('should accept valid config', () => {
      const config = {
        collectionSymbol: 'test-collection',
        minBid: 0.001,
        maxBid: 0.1,
        minFloorBid: 50,
        maxFloorBid: 90,
        offerType: 'ITEM'
      };

      const errors = validateCollectionConfig(config);
      expect(errors).toHaveLength(0);
    });

    it('should reject non-object', () => {
      const errors = validateCollectionConfig('not an object');
      expect(errors).toContain('Configuration is not a valid object');
    });

    it('should reject null', () => {
      const errors = validateCollectionConfig(null);
      expect(errors).toContain('Configuration is not a valid object');
    });

    it('should require collectionSymbol', () => {
      const config = { minBid: 0.001, maxBid: 0.1, minFloorBid: 50, maxFloorBid: 90, offerType: 'ITEM' };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('collectionSymbol'))).toBe(true);
    });

    it('should require minBid to be non-negative', () => {
      const config = {
        collectionSymbol: 'test',
        minBid: -0.001,
        maxBid: 0.1,
        minFloorBid: 50,
        maxFloorBid: 90,
        offerType: 'ITEM'
      };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('minBid'))).toBe(true);
    });

    it('should reject minBid > maxBid', () => {
      const config = {
        collectionSymbol: 'test',
        minBid: 0.2,
        maxBid: 0.1,
        minFloorBid: 50,
        maxFloorBid: 90,
        offerType: 'ITEM'
      };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('cannot be greater than maxBid'))).toBe(true);
    });

    it('should reject minFloorBid > maxFloorBid', () => {
      const config = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.1,
        minFloorBid: 90,
        maxFloorBid: 50,
        offerType: 'ITEM'
      };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('minFloorBid'))).toBe(true);
    });

    it('should require valid offerType', () => {
      const config = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.1,
        minFloorBid: 50,
        maxFloorBid: 90,
        offerType: 'INVALID'
      };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('offerType'))).toBe(true);
    });

    it('should reject non-positive bidCount', () => {
      const config = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.1,
        minFloorBid: 50,
        maxFloorBid: 90,
        offerType: 'ITEM',
        bidCount: 0
      };
      const errors = validateCollectionConfig(config);
      expect(errors.some(e => e.includes('bidCount'))).toBe(true);
    });
  });

  describe('getEffectiveMaxFloorBid', () => {
    it('should cap at 100% for ITEM without traits', () => {
      expect(getEffectiveMaxFloorBid(150, 'ITEM', false)).toBe(100);
    });

    it('should cap at 100% for COLLECTION', () => {
      expect(getEffectiveMaxFloorBid(150, 'COLLECTION', false)).toBe(100);
    });

    it('should allow above 100% for ITEM with traits', () => {
      expect(getEffectiveMaxFloorBid(150, 'ITEM', true)).toBe(150);
    });

    it('should return value unchanged when under 100%', () => {
      expect(getEffectiveMaxFloorBid(80, 'ITEM', false)).toBe(80);
    });
  });

  // ============================================================================
  // Utility Function Tests
  // ============================================================================
  describe('getUniqueBottomListings', () => {
    it('should remove duplicates by id', () => {
      const listings: BottomListing[] = [
        { id: 'token1', price: 1000 },
        { id: 'token2', price: 2000 },
        { id: 'token1', price: 1500 }, // Duplicate
      ];

      const unique = getUniqueBottomListings(listings);

      expect(unique).toHaveLength(2);
      expect(unique[0].price).toBe(1000); // First occurrence kept
    });

    it('should handle empty array', () => {
      const unique = getUniqueBottomListings([]);
      expect(unique).toHaveLength(0);
    });
  });

  describe('sortListingsByPrice', () => {
    it('should sort ascending by price', () => {
      const listings: BottomListing[] = [
        { id: 'high', price: 3000 },
        { id: 'low', price: 1000 },
        { id: 'mid', price: 2000 },
      ];

      const sorted = sortListingsByPrice(listings);

      expect(sorted[0].id).toBe('low');
      expect(sorted[1].id).toBe('mid');
      expect(sorted[2].id).toBe('high');
    });

    it('should not modify original array', () => {
      const listings: BottomListing[] = [
        { id: 'high', price: 3000 },
        { id: 'low', price: 1000 },
      ];

      const sorted = sortListingsByPrice(listings);

      expect(listings[0].id).toBe('high');
      expect(sorted[0].id).toBe('low');
    });
  });

  describe('satsToBTC', () => {
    it('should convert satoshis to BTC string', () => {
      expect(satsToBTC(100000000)).toBe('1.00000000');
      expect(satsToBTC(50000000)).toBe('0.50000000');
      expect(satsToBTC(1)).toBe('0.00000001');
    });
  });

  describe('btcToSats', () => {
    it('should convert BTC to satoshis', () => {
      expect(btcToSats(1)).toBe(100000000);
      expect(btcToSats(0.5)).toBe(50000000);
      expect(btcToSats(0.00000001)).toBe(1);
    });

    it('should round to nearest integer', () => {
      // Test floating point precision handling
      expect(btcToSats(0.00000001)).toBe(1);
      expect(Number.isInteger(btcToSats(0.123456789))).toBe(true);
    });
  });
});
