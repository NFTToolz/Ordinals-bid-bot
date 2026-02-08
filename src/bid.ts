import { config } from "dotenv"
import fs from "fs"
import * as bitcoin from "bitcoinjs-lib";
import { Mutex } from 'async-mutex';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import PQueue from "p-queue"
import { getBitcoinBalance } from "./utils";
import { ICollectionOffer, IOffer, cancelCollectionOffer, createCollectionOffer, createOffer, getBestCollectionOffer, getBestOffer, getOffers, getUserOffers, retrieveCancelOfferFormat, signCollectionOffer, signData, submitCancelOfferData, submitCollectionOffer, submitSignedOfferOrder } from "./functions/Offer";
import { collectionDetails } from "./functions/Collection";
import { retrieveTokens, ITokenData } from "./functions/Tokens";
import axiosInstance from "./axios/axiosInstance";
import limiter from "./bottleneck";
import WebSocket from 'ws';
import Logger, { getBidStatsData, formatBTC } from "./utils/logger";
import { printVersionBanner } from "./utils/version";
import { getErrorMessage, getErrorResponseData, getErrorStatus } from "./utils/errorUtils";
import {
  initializeBidPacer,
  getBidPacer,
  waitForBidSlot,
  recordBid as recordPacerBid,
  onRateLimitError,
  getBidPacerStatus,
  logBidPacerStatus,
  isGloballyRateLimited,
  getGlobalResetWaitTime,
} from "./utils/bidPacer";
import {
  initializeWalletPool,
  getAvailableWalletAsync,
  waitForAvailableWallet,
  recordBid as recordWalletBid,
  decrementBidCount as decrementWalletBidCount,
  getWalletByPaymentAddress,
  getWalletPoolStats,
  isWalletPoolInitialized,
  getWalletPool,
  WalletState
} from "./utils/walletPool";
import {
  initializeWalletGroupManager,
  getWalletGroupManager,
  isWalletGroupManagerInitialized,
  WalletGroupManager,
} from "./utils/walletGroups";
import {
  isOurPaymentAddress,
  isOurReceiveAddress,
  getWalletCredentialsByPaymentAddress,
} from "./utils/walletHelpers";
import { BidHistoryDirtyTracker } from "./utils/fileWriteTracker";
import {
  // Bid Calculation
  calculateBidPrice,
  calculateOutbidPrice,
  calculateMinimumBidPrice,
  CONVERSION_RATE as BID_CONVERSION_RATE,

  // Bid Validation
  validateBidAgainstFloor,
  validateFloorBidRange,
  validateFloorPrice,
  hasReachedQuantityLimit,
  getEffectiveMaxFloorBid,

  // Recent Bid Tracking
  isRecentBid,
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
  findTokensToCancel as findTokensToCancelFromLogic,
  combineBidsAndListings as combineBidsAndListingsFromLogic,

  // Purchase Events
  getPurchaseEventKey as createPurchaseEventKey,
  markPurchaseEventWithLimit,

  // WebSocket
  isValidJSON as bidLogicIsValidJSON,
  isValidWebSocketMessage as validateWSMessage,
  isWatchedEvent,
  WATCHED_EVENTS,

  // Collection Config
  validateCollectionConfig,

  // Utilities
  getUniqueBottomListings,
  sortListingsByPrice,

  // Types
  BidHistoryEntry,
  UserBid,
  BottomListing,
  CollectionBottomBid,
} from "./utils/bidLogic";
import { isEncryptedFormat, decryptData } from "./manage/services/WalletGenerator";
import { promptPasswordStdin } from "./utils/promptPassword";
import { getFundingWIF, setFundingWIF, hasFundingWIF } from "./utils/fundingWallet";
import { setReceiveAddress, getReceiveAddress, hasReceiveAddress } from "./utils/fundingWallet";
import { startStatsServer, setStatsProvider, stopStatsServer } from "./api/statsServer";
import { buildRuntimeStats, StatsDependencies } from "./api/buildStats";

/** Centralized bot timing and limit constants */
const BOT_CONSTANTS = {
  /** Maximum time to wait for scheduled/queue processing locks (ms) */
  LOCK_WAIT_TIMEOUT_MS: 30_000,
  /** WebSocket connection timeout (ms) */
  WS_CONNECT_TIMEOUT_MS: 30_000,
  /** Graceful shutdown timeout (ms) */
  SHUTDOWN_TIMEOUT_MS: 5_000,
  /** Maximum events in the processing queue */
  EVENT_QUEUE_CAP: 1_000,
  /** Maximum tracked bids per collection */
  MAX_BIDS_PER_COLLECTION: 100,
  /** Bid history TTL (ms) — 24 hours */
  BID_HISTORY_TTL_MS: 24 * 60 * 60 * 1000,
  /** Memory usage warning threshold (fraction) */
  MEMORY_USAGE_THRESHOLD: 0.8,
  /** Heap growth rate warning threshold (MB/min) */
  HEAP_GROWTH_WARNING_RATE: 5,
  /** Bid history write interval (ms) — 5 minutes */
  BID_HISTORY_WRITE_INTERVAL_MS: 300_000,
  /** Memory monitor interval (ms) — 5 minutes */
  MEMORY_MONITOR_INTERVAL_MS: 300_000,
  /** Bid history cleanup interval (ms) — 1 hour */
  BID_HISTORY_CLEANUP_INTERVAL_MS: 3_600_000,
  /** Recent bids cleanup interval (ms) — 1 minute */
  RECENT_BIDS_CLEANUP_INTERVAL_MS: 60_000,
  /** Purchase events cleanup interval (ms) — 1 minute */
  PURCHASE_EVENTS_CLEANUP_INTERVAL_MS: 60_000,
  /** Stale locks cleanup interval (ms) — 2 minutes */
  STALE_LOCKS_CLEANUP_INTERVAL_MS: 120_000,
  /** Pacer status log interval (ms) — 30 seconds */
  PACER_STATUS_INTERVAL_MS: 30_000,
  /** Bid stats print interval (ms) — 30 minutes */
  BID_STATS_PRINT_INTERVAL_MS: 1_800_000,
  /** Initial memory check delay (ms) — 1 minute */
  INITIAL_MEMORY_CHECK_DELAY_MS: 60_000,
  /** Maximum time to wait for a rate-limited wallet to become available (ms) */
  WALLET_WAIT_MAX_MS: 15_000,
  /** Maximum time WS events wait for scheduled task to finish (ms) — shorter than LOCK_WAIT_TIMEOUT_MS */
  WS_SCHEDULED_WAIT_MS: 5_000,
  /** Delay between sequential getUserOffers calls during rehydration (ms) */
  REHYDRATION_INTER_WALLET_DELAY_MS: 2_000,
} as const;

config()

// Validate required environment variables at startup
// Note: FUNDING_WIF and TOKEN_RECEIVE_ADDRESS can come from encrypted wallets.json
const requiredEnvVars = ['API_KEY'] as const;
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  Logger.error(`[STARTUP] Missing required environment variables: ${missingVars.join(', ')}`);
  Logger.error('[STARTUP] Copy .env.example to .env and configure your settings');
  process.exit(1);
}

let TOKEN_RECEIVE_ADDRESS: string = process.env.TOKEN_RECEIVE_ADDRESS as string
const DEFAULT_OUTBID_MARGIN = Number(process.env.DEFAULT_OUTBID_MARGIN) || 0.00001
const API_KEY = process.env.API_KEY as string;
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 32
const DEFAULT_OFFER_EXPIRATION = 30
const FEE_RATE_TIER = 'halfHourFee'
// M3: Use imported CONVERSION_RATE from bidLogic.ts instead of duplicate local definition
const CONVERSION_RATE = BID_CONVERSION_RATE;
const network = bitcoin.networks.bitcoin;

// Multi-wallet rotation configuration
const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './config/wallets.json';
const CENTRALIZE_RECEIVE_ADDRESS = process.env.CENTRALIZE_RECEIVE_ADDRESS === 'true';

// Bid pacing configuration (Magic Eden's per-wallet rate limit)
const BIDS_PER_MINUTE = Number(process.env.BIDS_PER_MINUTE) || 5;
const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

/**
 * Safe wrapper for ECPair.fromWIF() that throws a descriptive error on failure.
 * Validates WIF format before attempting to create key pair.
 */
function safeECPairFromWIF(wif: string, networkParam: typeof network, context: string = 'unknown'): ReturnType<ECPairAPI['fromWIF']> {
  if (!wif || typeof wif !== 'string') {
    throw new Error(`[${context}] Invalid WIF: WIF is empty or not a string`);
  }
  try {
    return ECPair.fromWIF(wif, networkParam);
  } catch (error: unknown) {
    throw new Error(`[${context}] Invalid WIF format: ${getErrorMessage(error)}. Check your FUNDING_WIF or fundingWalletWIF configuration.`);
  }
}

// S3: FUNDING_WIF validation moved into async IIFE (loaded from wallets.json or .env)

const DEFAULT_LOOP = Number(process.env.DEFAULT_LOOP) || 30
const restartState = new Map<string, boolean>();
let lastRehydrationTime = 0;  // Track when rehydration last ran
const rehydrationMutex = new Mutex();  // Prevent concurrent rehydration by multiple collection monitors
const REHYDRATE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour - periodic rehydration interval

// Track bot start time for stats
const BOT_START_TIME = Date.now();

// Define a global map to track processing tokens with atomic lock support
const processingTokens: Record<string, boolean> = {};
const processingTokenTimestamps: Record<string, number | undefined> = {};

// Waiter queue for each token - prevents race condition where multiple coroutines
// pass the lock check simultaneously after awaiting
const processingTokenWaiters: Record<string, Array<(acquired: boolean) => void>> = {};

// Lock timeout: 60 seconds - prevents deadlocks if releaseTokenLock is never called
const TOKEN_LOCK_TIMEOUT_MS = 60000;

/**
 * Atomically acquire a lock for a token to prevent race conditions.
 * Returns true if lock acquired, false if already locked or timeout.
 * Uses a waiter queue to ensure only one coroutine acquires the lock after it's released.
 */
async function acquireTokenLock(tokenId: string): Promise<boolean> {
  // Check for stale lock (older than timeout) and force-release it
  const lockTimestamp = processingTokenTimestamps[tokenId];
  if (lockTimestamp && Date.now() - lockTimestamp > TOKEN_LOCK_TIMEOUT_MS) {
    Logger.warning(`[LOCK] Force-releasing stale lock for ${tokenId.slice(-8)} (held for ${Math.round((Date.now() - lockTimestamp) / 1000)}s)`);
    forceReleaseTokenLock(tokenId);
  }

  // If locked, add to waiter queue instead of racing
  if (processingTokens[tokenId]) {
    return new Promise<boolean>((resolve) => {
      // B2: Prevent double-resolution when both timeout and releaseTokenLock resolve same waiter
      let resolved = false;
      const safeResolve = (val: boolean) => {
        if (!resolved) { resolved = true; resolve(val); }
      };

      if (!processingTokenWaiters[tokenId]) {
        processingTokenWaiters[tokenId] = [];
      }
      processingTokenWaiters[tokenId].push(safeResolve);

      // Timeout handler - remove from queue and return false
      setTimeout(() => {
        const waiters = processingTokenWaiters[tokenId];
        if (waiters) {
          const idx = waiters.indexOf(safeResolve);
          if (idx !== -1) {
            waiters.splice(idx, 1);
            Logger.warning(`[LOCK] Timeout waiting for lock on ${tokenId.slice(-8)}, skipping`);
            safeResolve(false);
          }
        }
      }, TOKEN_LOCK_TIMEOUT_MS);
    });
  }

  // Acquire lock atomically
  processingTokens[tokenId] = true;
  processingTokenTimestamps[tokenId] = Date.now();
  return true;
}

/**
 * Release the lock for a token and grant to first waiter if any.
 * This ensures orderly handoff of the lock to prevent race conditions.
 */
function releaseTokenLock(tokenId: string): void {
  // Check if there are waiters before releasing
  const waiters = processingTokenWaiters[tokenId];
  if (waiters && waiters.length > 0) {
    // Grant lock to first waiter - they get the lock immediately
    const nextWaiter = waiters.shift()!;
    // Update timestamp for new holder
    processingTokenTimestamps[tokenId] = Date.now();
    // processingTokens[tokenId] stays true - lock is transferred, not released
    nextWaiter(true);
  } else {
    // No waiters - actually release the lock
    delete processingTokens[tokenId];
    delete processingTokenTimestamps[tokenId];
    delete processingTokenWaiters[tokenId];
  }
}

/**
 * Force-release a stale lock without granting to waiters.
 * Used only for stale lock cleanup - all waiters will timeout.
 */
function forceReleaseTokenLock(tokenId: string): void {
  delete processingTokens[tokenId];
  delete processingTokenTimestamps[tokenId];
  // L1: Resolve waiters with false and clean up array to prevent memory leak
  const waiters = processingTokenWaiters[tokenId];
  if (waiters) {
    for (const waiter of waiters) {
      waiter(false);
    }
    delete processingTokenWaiters[tokenId];
  }
}

// Global minimum bid interval - scales with total wallet throughput capacity
// Recalculated after wallet init; 2s floor prevents API hammering (30/min hard cap)
let minBidIntervalMs = 12000; // Default 5/min, recalculated after wallet init
let lastGlobalBidTime = 0;

// Rate limit deduplication: Track recently bid tokens to prevent duplicate bids
const recentBids: Map<string, number> = new Map();
const RECENT_BID_COOLDOWN_MS = 30000; // 30 seconds - prevents duplicate bids on same token
const MAX_RECENT_BIDS_SIZE = 5000; // Cap recentBids map size to prevent unbounded growth

/**
 * Add entry to recentBids with size limit enforcement.
 * Removes oldest entry if map exceeds MAX_RECENT_BIDS_SIZE.
 */
function addRecentBid(tokenId: string, timestamp: number): void {
  // Enforce size limit before adding (proactive cleanup)
  if (recentBids.size >= MAX_RECENT_BIDS_SIZE) {
    // Remove oldest entry (first key in Map iteration order)
    const oldestKey = recentBids.keys().next().value;
    if (oldestKey) {
      recentBids.delete(oldestKey);
    }
  }
  recentBids.set(tokenId, timestamp);
}

/**
 * Enforce global minimum interval between ALL bids.
 * This prevents rapid-fire bids from overwhelming the API.
 * The actual per-wallet rate limit is enforced by WalletPool's sliding window.
 */
async function waitForGlobalBidSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastGlobalBidTime;
  const waitTime = minBidIntervalMs - elapsed;

  if (waitTime > 0) {
    Logger.info(`[GLOBAL PACER] Waiting ${(waitTime / 1000).toFixed(1)}s before next bid`);
    await delay(waitTime);
  }
  lastGlobalBidTime = Date.now();
}

// Purchase deduplication: Track processed purchase event IDs with timestamps to prevent double-counting
// This prevents race conditions where same WebSocket purchase event could increment quantity multiple times
// Changed from Set to Map to track timestamps for TTL-based cleanup
const processedPurchaseEvents: Map<string, number> = new Map();
const PURCHASE_EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes - clear old entries periodically
const MAX_PROCESSED_EVENTS_SIZE = 1000; // Cap map size to prevent unbounded growth

// Use imported getPurchaseEventKey from bidLogic.ts
const getPurchaseEventKey = createPurchaseEventKey;

/**
 * Check if a purchase event has already been processed.
 * Returns true if this is a duplicate event that should be skipped.
 */
function isPurchaseEventProcessed(eventKey: string): boolean {
  const timestamp = processedPurchaseEvents.get(eventKey);
  if (!timestamp) return false;
  // M5: Don't delete expired entries inline - let cleanup interval handle deletion
  // This prevents a window where an event could be re-processed after TTL expires
  // but before the cleanup interval runs
  return true;
}

/**
 * Mark a purchase event as processed to prevent duplicate handling.
 * Enforces size limit to prevent unbounded memory growth.
 */
function markPurchaseEventProcessed(eventKey: string): void {
  // Enforce size limit - clear oldest entries if needed
  if (processedPurchaseEvents.size >= MAX_PROCESSED_EVENTS_SIZE) {
    // Map iteration order is insertion order, so we can clear the oldest half
    let count = 0;
    const toDelete: string[] = [];
    for (const key of processedPurchaseEvents.keys()) {
      if (count >= MAX_PROCESSED_EVENTS_SIZE / 2) break;
      toDelete.push(key);
      count++;
    }
    toDelete.forEach(key => processedPurchaseEvents.delete(key));
    Logger.info(`[PURCHASE] Cleared ${toDelete.length} old purchase event entries (size limit)`);
  }
  processedPurchaseEvents.set(eventKey, Date.now());
}

/**
 * Clean up expired purchase events based on TTL.
 * Called periodically to prevent memory leak from stale entries.
 */
function cleanupPurchaseEvents(): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, timestamp] of processedPurchaseEvents.entries()) {
    if (now - timestamp > PURCHASE_EVENT_TTL_MS) {
      processedPurchaseEvents.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    Logger.debug(`[CLEANUP] Removed ${cleaned} expired purchase events (TTL: ${PURCHASE_EVENT_TTL_MS / 1000}s)`);
  }
}

// Mutex for atomic quantity updates to prevent race conditions
// Using a single object for lock state to enable atomic check-and-set
const quantityLockState: Record<string, { promise: Promise<void>; resolver: () => void } | undefined> = {};

/**
 * Atomically increment the quantity for a collection.
 * Uses a proper mutex pattern with atomic lock acquisition to prevent TOCTOU races.
 *
 * Previous bug: The while loop checking quantityLocks[collectionSymbol] had a race
 * where multiple callers could pass the check simultaneously before any acquired the lock.
 *
 * Fix: Check and acquire lock atomically in a single synchronous operation.
 * Uses a loop instead of recursion to prevent stack overflow under high contention.
 */
async function incrementQuantity(collectionSymbol: string): Promise<number> {
  const MAX_RETRIES = 10;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // If there's an existing lock, wait for it then retry via loop
    // This ensures only one caller proceeds at a time
    const existingLock = quantityLockState[collectionSymbol];
    if (existingLock) {
      await existingLock.promise;
      // After waiting, loop to try again - another caller may have acquired the lock
      continue;
    }

    // Atomically create and store lock in a single synchronous operation
    // This prevents the TOCTOU race where multiple callers pass the check above
    let resolver: () => void;
    const promise = new Promise<void>(resolve => {
      resolver = resolve;
    });
    quantityLockState[collectionSymbol] = { promise, resolver: resolver! };

    try {
      // Perform the atomic increment
      if (bidHistory[collectionSymbol]) {
        bidHistory[collectionSymbol].quantity += 1;
        bidHistoryDirtyTracker.markDirty();
        return bidHistory[collectionSymbol].quantity;
      }
      return 0;
    } finally {
      // Release the lock - resolve promise first to unblock waiters, then delete state
      const lockState = quantityLockState[collectionSymbol];
      if (lockState) {
        lockState.resolver();
      }
      delete quantityLockState[collectionSymbol];
    }
  }

  // B3: Throw instead of silently returning wrong value when lock acquisition fails
  throw new Error(`[QUANTITY] Failed to acquire lock for ${collectionSymbol} after ${MAX_RETRIES} attempts`);
}

const headers = {
  'Content-Type': 'application/json',
  'X-NFT-API-Key': API_KEY,
}

import path from "path"

// Ensure data directory exists for persistence files with restricted permissions
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
} else {
  // Ensure existing directory has correct permissions
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
}

const filePath = path.join(process.cwd(), 'config/collections.json')

// Load and validate collections.json with error handling
function loadCollections(): CollectionData[] {
  try {
    if (!fs.existsSync(filePath)) {
      Logger.error(`[STARTUP] Config file not found: ${filePath}`);
      Logger.error('[STARTUP] Copy config/collections.example.json to config/collections.json and configure your collections');
      process.exit(1);
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(fileContent);
    } catch (parseError: unknown) {
      Logger.error(`[STARTUP] Invalid JSON in collections.json: ${getErrorMessage(parseError)}`);
      process.exit(1);
    }

    // Validate it's an array
    if (!Array.isArray(parsed)) {
      Logger.error('[STARTUP] collections.json must be an array of collection configurations');
      process.exit(1);
    }

    // Validate each collection has required fields
    const validatedCollections: CollectionData[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      const errors: string[] = [];

      if (typeof item !== 'object' || item === null) {
        Logger.error(`[STARTUP] Collection at index ${i} is not a valid object`);
        process.exit(1);
      }

      // Required fields validation
      if (!item.collectionSymbol || typeof item.collectionSymbol !== 'string') {
        errors.push('collectionSymbol (string) is required');
      }
      // L2: Collection symbol format validation
      if (typeof item.collectionSymbol === 'string') {
        if (item.collectionSymbol.trim().length === 0) {
          errors.push('collectionSymbol cannot be empty or whitespace');
        } else if (/\s/.test(item.collectionSymbol)) {
          errors.push('collectionSymbol cannot contain whitespace');
        } else if (item.collectionSymbol.length > 200) {
          errors.push('collectionSymbol is too long (max 200 characters)');
        }
      }
      if (typeof item.minBid !== 'number' || item.minBid < 0) {
        errors.push('minBid (non-negative number) is required');
      }
      if (typeof item.maxBid !== 'number' || item.maxBid < 0) {
        errors.push('maxBid (non-negative number) is required');
      }
      // L1: Upper bounds validation for bid amounts
      if (typeof item.minBid === 'number' && item.minBid >= 1) {
        errors.push(`minBid (${item.minBid}) must be less than 1 BTC`);
      }
      if (typeof item.maxBid === 'number' && item.maxBid >= 1) {
        errors.push(`maxBid (${item.maxBid}) must be less than 1 BTC`);
      }
      if (typeof item.minFloorBid !== 'number') {
        errors.push('minFloorBid (number) is required');
      }
      if (typeof item.maxFloorBid !== 'number') {
        errors.push('maxFloorBid (number) is required');
      }
      if (!item.offerType || !['ITEM', 'COLLECTION'].includes(item.offerType)) {
        errors.push('offerType must be "ITEM" or "COLLECTION"');
      }

      // Cross-field validation
      if (typeof item.minBid === 'number' && typeof item.maxBid === 'number' && item.minBid > item.maxBid) {
        errors.push(`minBid (${item.minBid}) cannot be greater than maxBid (${item.maxBid})`);
      }
      if (typeof item.minFloorBid === 'number' && typeof item.maxFloorBid === 'number' && item.minFloorBid > item.maxFloorBid) {
        errors.push(`minFloorBid (${item.minFloorBid}%) cannot be greater than maxFloorBid (${item.maxFloorBid}%)`);
      }
      if (item.bidCount !== undefined && (typeof item.bidCount !== 'number' || item.bidCount <= 0)) {
        errors.push('bidCount must be a positive number');
      }
      // L1: Upper bounds for bidCount and scheduledLoop
      if (typeof item.bidCount === 'number' && item.bidCount > 200) {
        errors.push(`bidCount (${item.bidCount}) must be <= 200`);
      }
      if (item.scheduledLoop !== undefined && (typeof item.scheduledLoop !== 'number' || item.scheduledLoop <= 0)) {
        errors.push('scheduledLoop must be a positive number');
      }

      if (errors.length > 0) {
        Logger.error(`[STARTUP] Invalid configuration for collection "${item.collectionSymbol || `index ${i}`}":`);
        errors.forEach(err => Logger.error(`[STARTUP]   - ${err}`));
        process.exit(1);
      }

      // Warn when maxFloorBid will be capped for non-trait offers
      const hasTraits = item.traits && item.traits.length > 0;
      if (item.maxFloorBid > 100 && !hasTraits) {
        Logger.warning(`[STARTUP] ${item.collectionSymbol}: maxFloorBid ${item.maxFloorBid}% will be capped to 100% (non-trait offer)`);
      }

      validatedCollections.push(item as CollectionData);
    }

    if (validatedCollections.length === 0) {
      Logger.error('[STARTUP] No collections configured in collections.json - nothing to monitor');
      Logger.error('[STARTUP] Add at least one collection to config/collections.json');
      process.exit(1);
    }

    return validatedCollections;
  } catch (error: unknown) {
    Logger.error(`[STARTUP] Failed to load collections.json: ${getErrorMessage(error)}`);
    process.exit(1);
  }
}

const collections: CollectionData[] = loadCollections();
Logger.info(`[STARTUP] Loaded ${collections.length} collection(s): ${collections.map(c => c.collectionSymbol).join(', ')}`);
Logger.info(`[STARTUP] Environment: API_KEY=${API_KEY ? 'set' : 'MISSING'}, FUNDING_WIF=${hasFundingWIF() ? 'set' : 'pending (wallets.json)'}, RATE_LIMIT=${RATE_LIMIT}`);
// M3: balance moved to local scope in processScheduledLoop() and placeCollectionBid()

interface BidHistory {
  [collectionSymbol: string]: {
    offerType: 'ITEM' | 'COLLECTION';
    ourBids: {
      [tokenId: string]: {
        price: number,
        expiration: number,
        paymentAddress?: string  // Track which wallet placed the bid (for wallet rotation)
      };
    };
    topBids: {
      [tokenId: string]: boolean;
    };
    bottomListings: {
      id: string;
      price: number;
    }[]
    lastSeenActivity: number | null | undefined
    highestCollectionOffer?: {
      price: number;
      buyerPaymentAddress: string;
    };
    quantity: number;
  };
}


const bidHistory: BidHistory = {};

/**
 * Initialize bidHistory entry for a collection if it doesn't exist
 * Ensures consistent initialization across all code paths
 */
function initBidHistory(collectionSymbol: string, offerType: 'ITEM' | 'COLLECTION'): void {
  if (!bidHistory[collectionSymbol]) {
    bidHistory[collectionSymbol] = {
      offerType,
      ourBids: {},
      topBids: {},
      bottomListings: [],
      lastSeenActivity: null,
      quantity: 0
    };
    bidHistoryDirtyTracker.markDirty();
  }
}

/**
 * Safe accessor for our bids in a collection.
 * Returns empty object if collection is not initialized.
 */
function getOurBids(collectionSymbol: string): Record<string, { price: number; expiration: number; paymentAddress?: string }> {
  return bidHistory[collectionSymbol]?.ourBids ?? {};
}

/**
 * Safe accessor for top bids in a collection.
 * Returns empty object if collection is not initialized.
 */
function getTopBids(collectionSymbol: string): Record<string, boolean> {
  return bidHistory[collectionSymbol]?.topBids ?? {};
}

/**
 * Safe accessor for bottom listings in a collection.
 * Returns empty array if collection is not initialized.
 */
function getBottomListings(collectionSymbol: string): { id: string; price: number }[] {
  return bidHistory[collectionSymbol]?.bottomListings ?? [];
}

/**
 * Safely set a bid in our bids for a collection.
 * Returns false if collection is not initialized (should call initBidHistory first).
 */
function safeSetOurBid(
  collectionSymbol: string,
  tokenId: string,
  bid: { price: number; expiration: number; paymentAddress?: string }
): boolean {
  if (!bidHistory[collectionSymbol]) {
    Logger.warning(`[STATE] Attempt to set bid for uninitialized collection ${collectionSymbol}`);
    return false;
  }
  bidHistory[collectionSymbol].ourBids[tokenId] = bid;
  bidHistoryDirtyTracker.markDirty();
  return true;
}

/**
 * Load bid history from persisted file on startup.
 * Primarily used to restore quantity values to prevent exceeding limits after restart.
 */
function loadBidHistoryFromFile(): void {
  const filePath = path.join(DATA_DIR, 'bidHistory.json');
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      let savedHistory: Record<string, { quantity?: number }>;
      try {
        savedHistory = JSON.parse(fileContent);
      } catch (parseError: unknown) {
        Logger.warning(`[STARTUP] Corrupted bidHistory.json, starting fresh: ${getErrorMessage(parseError)}`);
        return;
      }

      // Restore quantity values for collections that are still in config
      const activeCollectionSymbols = new Set(collections.map(c => c.collectionSymbol));
      let restoredCount = 0;

      for (const collectionSymbol in savedHistory) {
        if (activeCollectionSymbols.has(collectionSymbol)) {
          const savedQuantity = savedHistory[collectionSymbol]?.quantity;
          if (typeof savedQuantity === 'number' && savedQuantity > 0) {
            const matchedCollection = collections.find(c => c.collectionSymbol === collectionSymbol);
            initBidHistory(collectionSymbol, matchedCollection?.offerType ?? "ITEM");
            bidHistory[collectionSymbol].quantity = savedQuantity;
            restoredCount++;
            Logger.info(`[STARTUP] Restored quantity for ${collectionSymbol}: ${savedQuantity}`);
          }
        }
      }

      if (restoredCount > 0) {
        bidHistoryDirtyTracker.markDirty();
        Logger.info(`[STARTUP] Restored quantity values for ${restoredCount} collection(s)`);
      }
    }
  } catch (error: unknown) {
    Logger.warning(`[STARTUP] Could not load bid history: ${getErrorMessage(error)}`);
  }
}

// Wallet credentials interface for wallet rotation
interface WalletCredentials {
  buyerPaymentAddress: string;
  publicKey: string;
  privateKey: string;
  buyerTokenReceiveAddress: string;
  walletLabel?: string;
}

/**
 * Get wallet credentials for placing a bid (async version with proper mutex)
 * Uses wallet group manager if enabled, otherwise falls back to legacy pool or config/defaults.
 *
 * Note: This function is async to properly use mutex-protected wallet selection,
 * preventing TOCTOU race conditions where same wallet could be double-booked.
 */
async function getWalletCredentials(
  collectionConfig: CollectionData,
  defaultReceiveAddress: string,
  defaultWIF: string
): Promise<WalletCredentials | null> {
  // Priority 1: Use wallet group manager if initialized and collection has walletGroup assigned
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();

    // Get the wallet group for this collection
    const groupName = collectionConfig.walletGroup;
    if (!groupName) {
      // Collection doesn't have a wallet group assigned - this is now required
      Logger.warning(`[WALLET] Collection ${collectionConfig.collectionSymbol} has no walletGroup assigned, skipping`);
      return null;
    }

    if (!manager.hasGroup(groupName)) {
      Logger.warning(`[WALLET] Group "${groupName}" not found for collection ${collectionConfig.collectionSymbol}`);
      return null;
    }

    // Wait for an available wallet (retries with sleep instead of skipping)
    const wallet = await manager.waitForAvailableWallet(groupName, BOT_CONSTANTS.WALLET_WAIT_MAX_MS);
    if (!wallet) {
      Logger.wallet.allRateLimited();
      return null;
    }

    // Handle centralized receive address
    const receiveAddress = CENTRALIZE_RECEIVE_ADDRESS
      ? defaultReceiveAddress
      : wallet.config.receiveAddress;

    return {
      buyerPaymentAddress: wallet.paymentAddress,
      publicKey: wallet.publicKey,
      privateKey: wallet.config.wif,
      buyerTokenReceiveAddress: receiveAddress,
      walletLabel: wallet.config.label,
    };
  }

  // Priority 2: Legacy single wallet pool (backward compatibility)
  // Wait for an available wallet (retries with sleep instead of skipping)
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized() && !isWalletGroupManagerInitialized()) {
    const wallet = await waitForAvailableWallet(BOT_CONSTANTS.WALLET_WAIT_MAX_MS);
    if (!wallet) {
      Logger.wallet.allRateLimited();
      return null;
    }
    return {
      buyerPaymentAddress: wallet.paymentAddress,
      publicKey: wallet.publicKey,
      privateKey: wallet.config.wif,
      buyerTokenReceiveAddress: wallet.config.receiveAddress,
      walletLabel: wallet.config.label,
    };
  }

  // Priority 3: Fall back to collection-specific or default wallet
  const privateKey = collectionConfig.fundingWalletWIF ?? defaultWIF;
  const buyerTokenReceiveAddress = collectionConfig.tokenReceiveAddress ?? defaultReceiveAddress;
  const keyPair = safeECPairFromWIF(privateKey, network, `getWalletCredentials:${collectionConfig.collectionSymbol}`);
  const publicKey = keyPair.publicKey.toString('hex');
  const buyerPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string;

  return {
    buyerPaymentAddress,
    publicKey,
    privateKey,
    buyerTokenReceiveAddress,
  };
}

/**
 * Record a successful bid to the wallet pool (for rate limiting)
 */
function recordSuccessfulBid(paymentAddress: string): void {
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    recordWalletBid(paymentAddress);
  }
}

// isOurPaymentAddress and isOurReceiveAddress are imported from ./utils/walletHelpers

/**
 * Get all receive addresses to query for bid rehydration
 * Includes all wallet group/pool addresses and the default TOKEN_RECEIVE_ADDRESS
 */
function getReceiveAddressesToQuery(): string[] {
  const addresses: string[] = [];
  const seen = new Set<string>();

  // If centralized receive is enabled, only query the main receive address
  if (CENTRALIZE_RECEIVE_ADDRESS) {
    if (TOKEN_RECEIVE_ADDRESS) {
      addresses.push(TOKEN_RECEIVE_ADDRESS);
    }
    return addresses;
  }

  // Add wallet group manager addresses if enabled
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    for (const addr of getWalletGroupManager().getAllReceiveAddresses()) {
      if (!seen.has(addr.toLowerCase())) {
        addresses.push(addr);
        seen.add(addr.toLowerCase());
      }
    }
  }

  // Add legacy wallet pool addresses if enabled
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    for (const addr of getWalletPool().getAllReceiveAddresses()) {
      if (!seen.has(addr.toLowerCase())) {
        addresses.push(addr);
        seen.add(addr.toLowerCase());
      }
    }
  }

  // Add default address
  if (TOKEN_RECEIVE_ADDRESS && !seen.has(TOKEN_RECEIVE_ADDRESS.toLowerCase())) {
    addresses.push(TOKEN_RECEIVE_ADDRESS);
  }

  return addresses;
}

// Memory leak fix: bidHistory cleanup configuration
const BID_HISTORY_MAX_AGE_MS = BOT_CONSTANTS.BID_HISTORY_TTL_MS;
const BID_HISTORY_CLEANUP_INTERVAL_MS = BOT_CONSTANTS.BID_HISTORY_CLEANUP_INTERVAL_MS;
const MAX_BIDS_PER_COLLECTION = BOT_CONSTANTS.MAX_BIDS_PER_COLLECTION;

// Must be 1 to ensure pacer works correctly - prevents race conditions where multiple
// tasks call waitForSlot() before any recordBid() completes
const queue = new PQueue({
  concurrency: 1
});

let ws: WebSocket;
let heartbeatIntervalId: NodeJS.Timeout | null = null;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let retryCount: number = 0;

class EventManager {
  queue: any[];
  isScheduledRunning: boolean;
  isProcessingQueue: boolean;
  private readonly MAX_QUEUE_SIZE = BOT_CONSTANTS.EVENT_QUEUE_CAP;
  private droppedEventsCount = 0;


  private queueMutex = new Mutex();

  constructor() {
    this.queue = [];
    this.isScheduledRunning = false;
    this.isProcessingQueue = false;
  }

  async receiveWebSocketEvent(event: CollectOfferActivity): Promise<void> {
    // Memory leak fix: Prevent unbounded queue growth
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Drop oldest events (FIFO)
      const dropped = this.queue.shift();
      this.droppedEventsCount++;

      // Log each dropped event with details for debugging missed counter-bid opportunities
      const droppedInfo = dropped ? `${dropped.collectionSymbol || 'unknown'}/${dropped.tokenId?.slice(-8) || 'unknown'} (${dropped.kind || 'unknown'})` : 'unknown';
      Logger.warning(`[EVENT QUEUE] Dropped event #${this.droppedEventsCount}: ${droppedInfo} - queue full (${this.MAX_QUEUE_SIZE})`);
    }

    this.queue.push(event);

    // Log warning when queue is 80% full
    if (this.queue.length > this.MAX_QUEUE_SIZE * BOT_CONSTANTS.MEMORY_USAGE_THRESHOLD && this.queue.length % 100 === 0) {
      Logger.warning(`[EVENT QUEUE] Queue is ${Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100)}% full (${this.queue.length}/${this.MAX_QUEUE_SIZE})`);
    }

    this.processQueue().catch(err => Logger.error('[EVENT QUEUE] Queue processing error', err));
  }

  async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    // Use mutex to prevent concurrent queue processing (fixes race condition C5)
    if (this.queueMutex.isLocked()) return;

    const release = await this.queueMutex.acquire();
    this.isProcessingQueue = true;
    try {
      while (this.queue.length > 0) {
        // Wait briefly for scheduled task — 5s is enough since p-queue serializes bids
        let waitedMs = 0;
        while (this.isScheduledRunning) {
          await new Promise(resolve => setTimeout(resolve, 500));
          waitedMs += 500;
          if (waitedMs >= BOT_CONSTANTS.WS_SCHEDULED_WAIT_MS) {
            Logger.debug('[EVENT QUEUE] Scheduled task still running after 5s, proceeding (p-queue serializes bids)');
            break;
          }
        }
        const event = this.queue.shift();
        if (event) {
          try {
            await this.handleIncomingBid(event);
          } catch (err: unknown) {
            Logger.error(`[EVENT QUEUE] Error processing event for ${event?.collectionSymbol || 'unknown'}`, getErrorMessage(err));
          }
        }
      }
    } finally {
      this.isProcessingQueue = false;
      release();
    }
  }

  async handleIncomingBid(message: CollectOfferActivity) {
    try {
      const { newOwner: incomingBuyerTokenReceiveAddress, collectionSymbol, tokenId, listedPrice: incomingBidAmount, createdAt: rawCreatedAt } = message
      const createdAt = typeof rawCreatedAt === 'number' && rawCreatedAt > 0 ? rawCreatedAt : Date.now();

      if (!isWatchedEvent(message.kind)) return
      const collection = collections.find((item) => item.collectionSymbol === collectionSymbol)
      if (!collection) return

      initBidHistory(collectionSymbol, collection.offerType);

      const outBidMargin = collection?.outBidMargin ?? DEFAULT_OUTBID_MARGIN
      const duration = collection?.duration ?? DEFAULT_OFFER_EXPIRATION
      const buyerTokenReceiveAddress = collection?.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const bidCount = collection.bidCount
      const bottomListings = getBottomListings(collectionSymbol).sort((a, b) => a.price - b.price).map((item) => item.id).slice(0, bidCount)
      const privateKey = collection?.fundingWalletWIF ?? getFundingWIF();
      const currentTime = new Date().getTime();
      const expiration = currentTime + (duration * 60 * 1000);
      const keyPair = safeECPairFromWIF(privateKey, network, `handleIncomingBid:${collectionSymbol}`);
      const publicKey = keyPair.publicKey.toString('hex');
      const buyerPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string
      // Use Math.round to prevent floating-point drift (e.g., 0.000001 * 1e8 = 99.99999999)
      const outBidAmount = Math.round(outBidMargin * 1e8)
      const maxFloorBid = collection.offerType === "ITEM" && collection.traits && collection.traits.length > 0
        ? collection.maxFloorBid
        : (collection.maxFloorBid <= 100 ? collection.maxFloorBid : 100);
      const minFloorBid = collection.minFloorBid

      // Log when maxFloorBid is capped (check original config value, not the capped one)
      if (collection.maxFloorBid > 100 && !(collection.traits && collection.traits.length > 0)) {
        Logger.warning(`[WS] ${collectionSymbol}: maxFloorBid ${collection.maxFloorBid}% capped to 100% (non-trait offer)`);
      }

      let collectionData;
      try {
        collectionData = await collectionDetails(collectionSymbol);
      } catch (collectionError: unknown) {
        Logger.warning(`[WS] API error fetching collection details for ${collectionSymbol}, skipping event: ${getErrorMessage(collectionError)}`);
        return;
      }
      // Validate floor price data - skip if unavailable
      if (!collectionData?.floorPrice) {
        Logger.warning(`[WS] No floor price data for ${collectionSymbol}, skipping event`);
        return;
      }
      const floorPrice = Number(collectionData.floorPrice)
      // Validate floor price is a valid number
      if (isNaN(floorPrice) || floorPrice <= 0) {
        Logger.warning(`[WS] Invalid floor price "${collectionData.floorPrice}" for ${collectionSymbol}, skipping event`);
        return;
      }
      const maxPrice = Math.round(collection.maxBid * CONVERSION_RATE)
      const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100))
      const offerType = collection.offerType

      const maxBuy = collection.quantity ?? 1
      // FIX: Use optional chaining with default to handle edge case where bidHistory
      // might not be initialized (e.g., WebSocket event arrives before scheduled loop)
      const quantity = bidHistory[collectionSymbol]?.quantity ?? 0

      if (quantity === maxBuy) return


      if (offerType === "ITEM") {
        if (message.kind === "offer_placed") {
          // Early exit: Check if this bid is from one of our wallets (using buyerPaymentAddress from WebSocket)
          const incomingPaymentAddress = message.buyerPaymentAddress;
          if (isOurPaymentAddress(incomingPaymentAddress)) {
            Logger.debug(`[WS] ${tokenId.slice(-8)}: Our own bid (wallet: ${incomingPaymentAddress.slice(0, 10)}...), ignoring`);
            return;
          }

          if (bottomListings.includes(tokenId)) {
            // Check if incoming bid is from ANY of our wallet group addresses (not just single buyerTokenReceiveAddress)
            if (!isOurReceiveAddress(incomingBuyerTokenReceiveAddress)) {
              let verifiedOfferPrice = Number(incomingBidAmount);
              if (isNaN(verifiedOfferPrice)) {
                Logger.warning(`[WS] ${tokenId.slice(-8)}: Invalid bid amount received: ${incomingBidAmount}`);
                return;
              }
              const ourExistingBid = bidHistory[collectionSymbol]?.ourBids?.[tokenId];

              // Verify the incoming bid is actually the top offer
              if (ourExistingBid) {
                // CASE 1: We have an existing bid - check if we're outbid
                if (verifiedOfferPrice <= ourExistingBid.price) {
                  // Incoming bid is not higher than ours - we still have top bid, skip
                  Logger.info(`[WS] ${tokenId.slice(-8)}: Incoming bid ${verifiedOfferPrice} <= our bid ${ourExistingBid.price}, still top`);
                  return;
                }
                // We're outbid - proceed to counterbid against verifiedOfferPrice
                Logger.info(`[WS] ${tokenId.slice(-8)}: Outbid (${ourExistingBid.price} -> ${verifiedOfferPrice}), counterbidding`);
              } else {
                // CASE 2: No existing bid - verify WebSocket shows actual top offer
                let bestOffer;
                try {
                  bestOffer = await getBestOffer(tokenId);
                } catch (offerError: unknown) {
                  Logger.warning(`[WS] ${tokenId.slice(-8)}: API error fetching best offer, skipping counterbid: ${getErrorMessage(offerError)}`);
                  return;
                }
                if (!bestOffer?.offers?.length) {
                  // No offers exist - skip counterbid (scheduled loop will handle)
                  Logger.info(`[WS] ${tokenId.slice(-8)}: No offers found, skipping counterbid`);
                  return;
                }

                const topOffer = bestOffer.offers[0];

                // Skip if we already have the top bid (edge case: bidHistory not synced)
                if (isOurPaymentAddress(topOffer.buyerPaymentAddress)) {
                  Logger.info(`[WS] ${tokenId.slice(-8)}: We already have top bid, skipping`);
                  return;
                }

                // Use actual top offer price instead of WebSocket event price
                const actualTopPrice = topOffer.price;
                if (actualTopPrice !== verifiedOfferPrice) {
                  // If actual price is lower than WebSocket price, offer was withdrawn/reduced - skip
                  if (actualTopPrice < verifiedOfferPrice) {
                    Logger.info(`[WS] ${tokenId.slice(-8)}: Offer reduced/withdrawn (WS: ${verifiedOfferPrice}, actual: ${actualTopPrice}), skipping`);
                    return;
                  }
                  Logger.info(`[WS] ${tokenId.slice(-8)}: WebSocket stale (${verifiedOfferPrice}), using actual top ${actualTopPrice}`);
                  verifiedOfferPrice = actualTopPrice;
                }
              }

              // Skip if existing offer already exceeds our maximum bid limit
              if (verifiedOfferPrice > maxOffer) {
                Logger.bidSkipped(collectionSymbol, tokenId, 'Incoming offer exceeds maxBid', verifiedOfferPrice, verifiedOfferPrice, maxOffer);
                return;
              }

              // Round after arithmetic to prevent floating-point drift
              const bidPrice = Math.round(verifiedOfferPrice + outBidAmount);

              try {
                // L4: Use colSymbol/bidTokenId to avoid shadowing outer collectionSymbol/tokenId
                const userBids = Object.entries(bidHistory).flatMap(([colSymbol, bidData]) => {
                  return Object.entries(bidData.ourBids).map(([bidTokenId, bidInfo]) => ({
                    collectionSymbol: colSymbol,
                    tokenId: bidTokenId,
                    price: bidInfo.price,
                    expiration: new Date(bidInfo.expiration).toISOString(),
                  }));
                }).sort((a, b) => a.price - b.price)

                userBids.forEach((bid) => {
                  const bidExpirationTime = new Date(bid.expiration).getTime();

                  // Mark as expired if current time is past the bid's expiration
                  if (Date.now() >= bidExpirationTime) {
                    Logger.bidCancelled(bid.collectionSymbol, bid.tokenId, 'Expired');
                    if (bidHistory[bid.collectionSymbol]?.ourBids) {
                      delete bidHistory[bid.collectionSymbol].ourBids[bid.tokenId]
                    }
                    if (bidHistory[bid.collectionSymbol]?.topBids) {
                      delete bidHistory[bid.collectionSymbol].topBids[bid.tokenId]
                    }
                  }
                })

                if (bidPrice <= maxOffer) {
                  // Deduplication: Check if we recently bid on this token (prevents duplicate WS events)
                  const lastBidTime = recentBids.get(tokenId);
                  if (lastBidTime && Date.now() - lastBidTime < RECENT_BID_COOLDOWN_MS) {
                    Logger.info(`[WS] ${tokenId.slice(-8)}: Recently bid ${Math.round((Date.now() - lastBidTime) / 1000)}s ago, skipping duplicate`);
                    return;
                  }

                  // Check global rate limit before counter-bidding - wait if rate limited
                  if (isGloballyRateLimited()) {
                    const waitMs = getGlobalResetWaitTime();
                    Logger.queue.waiting(tokenId, Math.ceil(waitMs / 1000));
                    await delay(waitMs + 1000); // +1s buffer
                  }

                  // Atomically acquire lock for this token to prevent race conditions
                  // IMPORTANT: Lock must be acquired BEFORE adding to recentBids to prevent race where
                  // two events both pass the deduplication check before either acquires the lock
                  const lockAcquired = await acquireTokenLock(tokenId);
                  if (!lockAcquired) {
                    Logger.info(`[WS] ${tokenId.slice(-8)}: Token already being processed, skipping`);
                    return;
                  }

                  // Add to recentBids AFTER acquiring lock to prevent TOCTOU race
                  // If bid fails, we'll delete the entry; if succeeds, we update it
                  const bidAttemptTime = Date.now();
                  addRecentBid(tokenId, bidAttemptTime);

                  // Re-check rate limit after acquiring lock - wait again if still rate limited
                  if (isGloballyRateLimited()) {
                    const waitMs = getGlobalResetWaitTime();
                    Logger.queue.waiting(tokenId, Math.ceil(waitMs / 1000));
                    await delay(waitMs + 1000); // +1s buffer
                  }

                  try {
                    const result = await placeBidWithRotation(collection, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, undefined, maxOffer);
                    if (result.success) {
                      addRecentBid(tokenId, Date.now());  // Update with actual completion time
                      bidHistory[collectionSymbol].topBids[tokenId] = true
                      bidHistory[collectionSymbol].ourBids[tokenId] = {
                        price: bidPrice,
                        expiration: expiration,
                        paymentAddress: result.paymentAddress
                      }
                      Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'COUNTERBID', { floorPrice, maxOffer });
                    } else {
                      // Bid failed - remove the early deduplication entry to allow retry
                      recentBids.delete(tokenId);
                    }
                  } catch (error) {
                    // Bid failed with exception - remove the early deduplication entry to allow retry
                    recentBids.delete(tokenId);
                    throw error;
                  } finally {
                    releaseTokenLock(tokenId);
                  }
                } else {
                  // Counter-bid would exceed maxOffer (which includes maxFloorBid% validation)
                  Logger.bidSkipped(collectionSymbol, tokenId, 'Counter-bid would exceed max', verifiedOfferPrice, bidPrice, maxOffer);
                }

              } catch (error: unknown) {
                Logger.error(`[WS] Counter-bid error for ${collectionSymbol} ${tokenId}`, getErrorMessage(error));
              }
            }
          }
        }
      } else if (offerType === "COLLECTION") {
        if (message.kind === "coll_offer_created") {
          const collectionSymbol = message.collectionSymbol

          const incomingBidAmount = message.listedPrice
          const ourBidPrice = bidHistory[collectionSymbol]?.highestCollectionOffer?.price

          const incomingBuyerPaymentAddress = message.buyerPaymentAddress

          // Early exit: Check if this bid is from one of our wallets
          if (isOurPaymentAddress(incomingBuyerPaymentAddress)) {
            Logger.debug(`[WS] ${collectionSymbol}: Our own collection offer (wallet: ${incomingBuyerPaymentAddress.slice(0, 10)}...), ignoring`);
            return;
          }

          // Address already checked at line 1147 with isOurPaymentAddress(), so we only need price comparison
          if (Number(incomingBidAmount) > Number(ourBidPrice)) {
            Logger.websocket.event('coll_offer_created', collectionSymbol);

            // Atomically acquire lock for this collection to prevent race conditions
            const lockAcquired = await acquireTokenLock(collectionSymbol);
            if (!lockAcquired) {
              Logger.info(`[WS] ${collectionSymbol}: Collection already being processed, skipping`);
              return;
            }

            try {
              // Round after arithmetic to prevent floating-point drift
              const bidPrice = Math.round(+(incomingBidAmount) + outBidAmount)
              let offerData;
              try {
                offerData = await getBestCollectionOffer(collectionSymbol);
              } catch (offerError: unknown) {
                Logger.warning(`[WS] API error fetching collection offers for ${collectionSymbol}, skipping: ${getErrorMessage(offerError)}`);
                return;
              }
              const ourOffer = offerData?.offers?.find((item) => isOurReceiveAddress(item.btcParams.makerOrdinalReceiveAddress))

              if (ourOffer) {
                const offerIds = [ourOffer.id]
                let cancelPublicKey = publicKey;
                let cancelPrivateKey = privateKey;
                const makerAddr = ourOffer.btcParams?.makerPaymentAddress;
                if (ENABLE_WALLET_ROTATION && makerAddr) {
                  const creds = getWalletCredentialsByPaymentAddress(makerAddr);
                  if (creds) {
                    cancelPublicKey = creds.publicKey;
                    cancelPrivateKey = creds.privateKey;
                  } else {
                    Logger.warning(`[CANCEL] Cannot find credentials for wallet ${makerAddr}, cancel may fail`);
                  }
                }
                const cancelled = await cancelCollectionOffer(offerIds, cancelPublicKey, cancelPrivateKey)
                if (!cancelled) {
                  Logger.error(`[WS] Failed to cancel existing collection offer for ${collectionSymbol}, aborting counter-bid`);
                  return;
                }
              }
              const feeSatsPerVbyte = collection.feeSatsPerVbyte || 28
              try {
                if (bidPrice > maxOffer) {
                  Logger.bidSkipped(collectionSymbol, 'COLLECTION', 'Counter-bid would exceed max', +(incomingBidAmount), bidPrice, maxOffer);
                } else if (bidPrice >= floorPrice) {
                  Logger.bidSkipped(collectionSymbol, 'COLLECTION', 'Counter-bid would exceed floor price', +(incomingBidAmount), bidPrice, floorPrice);
                } else {
                  await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte, maxOffer, undefined)
                  bidHistory[collectionSymbol].highestCollectionOffer = {
                    price: bidPrice,
                    buyerPaymentAddress: buyerPaymentAddress
                  }
                  Logger.collectionOfferPlaced(collectionSymbol, bidPrice);
                }
              } catch (error: unknown) {
                Logger.error(`[WS] Failed to place collection bid for ${collectionSymbol}`, getErrorMessage(error));
              }
            } finally {
              releaseTokenLock(collectionSymbol);
            }
          }
        }
      } else {
        Logger.warning(`[WS] Unknown offerType "${offerType}" for ${collectionSymbol}, skipping event`);
      }

      if (message.kind === "buying_broadcasted" || message.kind === "offer_accepted_broadcasted" || message.kind === "coll_offer_fulfill_broadcasted") {
        if (isOurReceiveAddress(incomingBuyerTokenReceiveAddress)) {
          // FIX: Deduplication to prevent race condition where same purchase event
          // increments quantity multiple times if WebSocket delivers duplicate events
          const eventKey = getPurchaseEventKey(collectionSymbol, tokenId, message.kind, message.createdAt);
          if (isPurchaseEventProcessed(eventKey)) {
            Logger.info(`[WS] ${collectionSymbol}: Duplicate purchase event for ${tokenId.slice(-8)}, skipping`);
            return;
          }
          markPurchaseEventProcessed(eventKey);

          // FIX: Wrap incrementQuantity in try/catch to prevent unhandled errors
          // If this fails, the purchase is still marked as processed above
          try {
            const newQuantity = await incrementQuantity(collectionSymbol);
            Logger.info(`[WS] ${collectionSymbol}: Purchase confirmed for ${tokenId.slice(-8)}, quantity now ${newQuantity}`);
            // Debounced persist: coalesces rapid purchase events into a single write
            // (shutdown handler will force-flush any pending write)
            bidHistoryDirtyTracker.scheduleDebouncedWrite(() => writeBidHistoryToFile(true));
          } catch (quantityError: unknown) {
            Logger.error(`[WS] ${collectionSymbol}: Failed to increment quantity for ${tokenId.slice(-8)}`, getErrorMessage(quantityError));
            // Continue processing - purchase event is marked, but quantity wasn't updated
            // This is a recoverable state - next rehydration will sync quantities
          }
        }
      }
      // Mark bidHistory dirty after all WS-triggered mutations
      bidHistoryDirtyTracker.markDirty();
    } catch (error: unknown) {
      Logger.error(`[WS] handleIncomingBid error`, getErrorMessage(error));
    }
  }

  async runScheduledTask(item: CollectionData): Promise<void> {
    // Guard: skip if another collection's scheduled task is already running
    if (this.isScheduledRunning) {
      Logger.info(`[SCHEDULE] Skipping cycle for ${item.collectionSymbol} — another scheduled task is running`);
      return;
    }
    // M1: Timeout guard to prevent infinite wait if queue processing hangs
    let waitedMs = 0;
    while (this.isProcessingQueue) {
      await new Promise(resolve => setTimeout(resolve, 100));
      waitedMs += 100;
      if (waitedMs >= BOT_CONSTANTS.LOCK_WAIT_TIMEOUT_MS) {
        Logger.warning(`[SCHEDULE] Waited 30s for queue processing to finish for ${item.collectionSymbol}, proceeding anyway`);
        break;
      }
    }
    this.isScheduledRunning = true;
    try {
      await this.processScheduledLoop(item);  // FIX: Added await to prevent concurrent execution
    } finally {
      this.isScheduledRunning = false;
    }
  }

  async processScheduledLoop(item: CollectionData) {
    const startTime = Date.now();
    Logger.scheduleStart(item.collectionSymbol);

    // Log pacer status at start of cycle
    const pacerStatus = getBidPacerStatus();
    Logger.pacer.cycleStart(pacerStatus.bidsRemaining, getBidPacer().getLimit(), pacerStatus.windowResetIn);

    const collectionSymbol = item.collectionSymbol
    const traits = item.traits
    const feeSatsPerVbyte = item.feeSatsPerVbyte
    // L3: offerType is validated as uppercase at startup by loadCollections()
    const offerType = item.offerType ?? 'ITEM'
    const minBid = item.minBid
    const maxBid = item.maxBid
    const bidCount = item.bidCount ?? 20
    const duration = item.duration ?? DEFAULT_OFFER_EXPIRATION
    const outBidMargin = item.outBidMargin ?? DEFAULT_OUTBID_MARGIN
    const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = item.fundingWalletWIF ?? getFundingWIF();
    const keyPair = safeECPairFromWIF(privateKey, network, `processScheduledLoop:${collectionSymbol}`);
    const publicKey = keyPair.publicKey.toString('hex');
    const maxBuy = item.quantity ?? 1
    const enableCounterBidding = item.enableCounterBidding ?? false
    const buyerPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string
    let balance: number | undefined;

    // Log when default values are used
    const defaults: string[] = [];
    if (item.bidCount === undefined) defaults.push('bidCount=20');
    if (item.duration === undefined) defaults.push(`duration=${DEFAULT_OFFER_EXPIRATION}`);
    if (item.quantity === undefined) defaults.push('quantity=1');
    if (defaults.length > 0) {
      Logger.info(`${collectionSymbol}: using defaults: ${defaults.join(', ')}`);
    }

    try {
      initBidHistory(collectionSymbol, item.offerType);

      const quantity = bidHistory[collectionSymbol].quantity
      if (quantity === maxBuy) {
        return
      }

      balance = await getBitcoinBalance(buyerPaymentAddress)
      let collectionData;
      try {
        collectionData = await collectionDetails(collectionSymbol);
      } catch (collectionError: unknown) {
        Logger.warning(`[SCHEDULE] API error fetching collection details for ${collectionSymbol}, skipping cycle: ${getErrorMessage(collectionError)}`);
        return;
      }

      // Rehydrate bid history on startup OR periodically every REHYDRATE_INTERVAL_MS
      // This recovers orphaned bids that may not be tracked (e.g., after crash, restart, or clock drift)
      const now = Date.now();
      const isCollectionRestart = restartState.get(item.collectionSymbol) !== false;
      const shouldRehydrate = isCollectionRestart || (now - lastRehydrationTime > REHYDRATE_INTERVAL_MS);

      if (shouldRehydrate && !rehydrationMutex.isLocked()) {
        const releaseRehydration = await rehydrationMutex.acquire();
        try {
          // Double-check after acquiring lock (another monitor may have just completed rehydration)
          const recheckNow = Date.now();
          if (isCollectionRestart || (recheckNow - lastRehydrationTime > REHYDRATE_INTERVAL_MS)) {
            const addressesToQuery = getReceiveAddressesToQuery();
            Logger.info(`[REHYDRATE] ${isCollectionRestart ? 'Startup' : 'Periodic'} rehydration - querying ${addressesToQuery.length} wallet address(es)`);

            for (let addrIdx = 0; addrIdx < addressesToQuery.length; addrIdx++) {
              const receiveAddr = addressesToQuery[addrIdx];
              try {
                const offerData = await getUserOffers(receiveAddr);
                if (offerData && Array.isArray(offerData.offers) && offerData.offers.length > 0) {
                  Logger.info(`[REHYDRATE] Found ${offerData.offers.length} offers for ${receiveAddr.slice(0, 10)}...`);
                  for (const offerItem of offerData.offers) {
                    const matchedCollection = collections.find(c => c.collectionSymbol === offerItem.token.collectionSymbol);
                    initBidHistory(offerItem.token.collectionSymbol, matchedCollection?.offerType ?? "ITEM");
                    bidHistory[offerItem.token.collectionSymbol].topBids[offerItem.tokenId] = true;
                    bidHistory[offerItem.token.collectionSymbol].ourBids[offerItem.tokenId] = {
                      price: offerItem.price,
                      expiration: typeof offerItem.expirationDate === 'string' ? new Date(offerItem.expirationDate).getTime() : offerItem.expirationDate,
                      paymentAddress: offerItem.buyerPaymentAddress
                    };
                    bidHistory[offerItem.token.collectionSymbol].lastSeenActivity = Date.now();
                  }
                }
              } catch (error: unknown) {
                Logger.warning(`[REHYDRATE] Failed to fetch offers for ${receiveAddr.slice(0, 10)}...: ${getErrorMessage(error)}`);
              }
              // Space out sequential API calls to avoid rate-limit bursts
              if (addrIdx < addressesToQuery.length - 1) {
                await delay(BOT_CONSTANTS.REHYDRATION_INTER_WALLET_DELAY_MS);
              }
            }
            lastRehydrationTime = Date.now();
          }
        } finally {
          releaseRehydration();
        }
      }

      let tokens: ITokenData[];
      try {
        tokens = await retrieveTokens(collectionSymbol, bidCount, traits);
      } catch (tokenError: unknown) {
        Logger.warning(`[SCHEDULE] API error retrieving tokens for ${collectionSymbol}, skipping cycle: ${getErrorMessage(tokenError)}`);
        return;
      }
      // Keep all fetched tokens - we'll limit by successful bids placed, not tokens processed
      // This allows skipping tokens where bestOffer > maxOffer and continuing to find valid ones

      Logger.tokens.retrieved(tokens.length, bidCount);

      // Debug: Show first few token prices
      if (tokens.length > 0) {
        Logger.tokens.firstListings(tokens.slice(0, 5).map(t => `${t.id.slice(-8)}:${t.listedPrice}`).join(', '));
      }

      // Create a map of token IDs to full token data for later use
      const tokenDataMap: { [tokenId: string]: any } = {};
      tokens.forEach(token => {
        tokenDataMap[token.id] = token;
      });

      const bottomTokens = tokens
        .sort((a, b) => a.listedPrice - b.listedPrice)
        .map((item) => ({ id: item.id, price: item.listedPrice }))

      const uniqueIds = new Set();
      const uniqueBottomListings: BottomListing[] = [];

      bottomTokens.forEach(listing => {
        if (!uniqueIds.has(listing.id)) {
          uniqueIds.add(listing.id);
          uniqueBottomListings.push(listing);
        }
      });

      // Keep tracking more tokens for potential WebSocket counter-bidding
      bidHistory[collectionSymbol].bottomListings = uniqueBottomListings.slice(0, Math.max(bidCount * 2, 40));
      const bottomListings = bidHistory[collectionSymbol].bottomListings

      const currentTime = new Date().getTime();
      const expiration = currentTime + (duration * 60 * 1000);
      const minPrice = Math.round(minBid * CONVERSION_RATE)
      const maxPrice = Math.round(maxBid * CONVERSION_RATE)

      // Validate floor price data - skip collection if unavailable (API error)
      if (!collectionData?.floorPrice) {
        Logger.warning(`[SCHEDULE] No floor price data for ${collectionSymbol}, skipping cycle`);
        return;
      }
      const floorPrice = Number(collectionData.floorPrice)
      // Validate floor price is a valid number
      if (isNaN(floorPrice) || floorPrice <= 0) {
        Logger.warning(`[SCHEDULE] Invalid floor price "${collectionData.floorPrice}" for ${collectionSymbol}, skipping cycle`);
        return;
      }
      // H3: Cap maxFloorBid at 100% for non-trait offers (matching WS handler at line 951-953)
      const maxFloorBid = item.offerType === "ITEM" && item.traits && item.traits.length > 0
        ? item.maxFloorBid
        : (item.maxFloorBid <= 100 ? item.maxFloorBid : 100);
      const minFloorBid = item.minFloorBid
      const minOffer = Math.max(minPrice, Math.round(minFloorBid * floorPrice / 100))
      const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100))

      // Compact bid calculation summary (full details at LOG_LEVEL=debug)
      Logger.info(`[SCHEDULE] ${collectionSymbol}: floor=${formatBTC(floorPrice)}, bid range=${formatBTC(minOffer)}-${formatBTC(maxOffer)} (${minFloorBid}-${maxFloorBid}% of floor)`);
      Logger.debug(`[SCHEDULE] Bid calc detail for ${collectionSymbol}:`, {
        floorPrice: `${(floorPrice / 1e8).toFixed(8)} BTC (${floorPrice} sats)`,
        config: {
          minBid: `${(minPrice / 1e8).toFixed(8)} BTC`,
          maxBid: `${(maxPrice / 1e8).toFixed(8)} BTC`,
          minFloorBid: `${minFloorBid}%`,
          maxFloorBid: `${maxFloorBid}%`
        },
        calculated: {
          minOffer: `${(minOffer / 1e8).toFixed(8)} BTC (${minOffer} sats)`,
          maxOffer: `${(maxOffer / 1e8).toFixed(8)} BTC (${maxOffer} sats)`,
          minLimit: minPrice > Math.round(minFloorBid * floorPrice / 100) ? 'minBid' : 'minFloorBid%',
          maxLimit: maxPrice < Math.round(maxFloorBid * floorPrice / 100) ? 'maxBid' : 'maxFloorBid%'
        }
      });

      if (minFloorBid > maxFloorBid) {
        Logger.warning(`Min floor bid ${item.minFloorBid}% > max floor bid ${item.maxFloorBid}% for ${item.collectionSymbol}. Skipping bid.`);
        return
      }

      if ((item.offerType === "ITEM" || item.offerType === "COLLECTION") && (!item.traits || item.traits.length === 0) && maxFloorBid > 100) {
        Logger.warning(`Offer for ${item.collectionSymbol} at ${maxFloorBid}% of floor price (above 100%). Skipping bid.`);
        return
      }

      // L4: Use colSymbol/bidTokenId to avoid shadowing outer collectionSymbol/tokenId
      const userBids = Object.entries(bidHistory).flatMap(([colSymbol, bidData]) => {
        return Object.entries(bidData.ourBids).map(([bidTokenId, bidInfo]) => ({
          collectionSymbol: colSymbol,
          tokenId: bidTokenId,
          price: bidInfo.price,
          expiration: new Date(bidInfo.expiration).toISOString(),
        }));
      }).sort((a, b) => a.price - b.price)

      const ourBids = userBids.map((item) => ({ tokenId: item.tokenId, collectionSymbol: item.collectionSymbol })).filter((item) => item.collectionSymbol === collectionSymbol)
      const collectionBottomBids: CollectionBottomBid[] = tokens.map((item) => ({ tokenId: item.id, collectionSymbol: item.collectionSymbol })).filter((item) => item.collectionSymbol === collectionSymbol)
      const tokensToCancel = findTokensToCancel(collectionBottomBids, ourBids)
      const bottomListingBids = combineBidsAndListings(userBids, bottomListings)
      if (bottomListingBids.length > 0) {
        const prices = bottomListingBids.filter((b): b is NonNullable<typeof b> => b !== null).map(b => b.price);
        const minP = Math.min(...prices);
        const maxP = Math.max(...prices);
        Logger.info(`[SCHEDULE] ${collectionSymbol}: ${bottomListingBids.length} bids queued, price range ${formatBTC(minP)}-${formatBTC(maxP)}`);
        Logger.debug(`[SCHEDULE] Bottom listing bids for ${collectionSymbol}:`, bottomListingBids);
      } else {
        Logger.info(`[SCHEDULE] ${collectionSymbol}: no bids to place`);
      }

      if (tokensToCancel.length > 0) {
        await queue.addAll(
          tokensToCancel.map(token => async () => {
            const offerData = await getOffers(token.tokenId, buyerTokenReceiveAddress)
            if (offerData && Number(offerData.total) > 0) {
              // Filter to only our offers from any of our wallets (supports wallet groups)
              const offers = (offerData?.offers ?? []).filter((item) => isOurPaymentAddress(item.buyerPaymentAddress))
              // Use Promise.allSettled to continue cancelling even if some fail
              const results = await Promise.allSettled(offers.map(async (item) => {
                const cancelled = await cancelBid(
                  item,
                  privateKey,
                  collectionSymbol,
                  item.tokenId,
                  buyerPaymentAddress
                );
                // FIX: Only delete from bidHistory after confirmed cancellation success
                if (cancelled) {
                  delete bidHistory[collectionSymbol].ourBids[token.tokenId]
                  delete bidHistory[collectionSymbol].topBids[token.tokenId]
                }
                return cancelled;
              }));
              // Log any failed cancellations
              results.forEach((result, index) => {
                if (result.status === 'rejected') {
                  Logger.warning(`[CANCEL] Failed to cancel offer ${offers[index]?.id}: ${result.reason}`);
                }
              });
            }
          })
        )
      }

      userBids.forEach((bid) => {
        const bidExpirationTime = new Date(bid.expiration).getTime();

        // Mark as expired if current time is past the bid's expiration
        if (Date.now() >= bidExpirationTime) {
          Logger.bidCancelled(bid.collectionSymbol, bid.tokenId, 'Expired');
          if (bidHistory[bid.collectionSymbol]) {
            delete bidHistory[bid.collectionSymbol].ourBids[bid.tokenId]
            delete bidHistory[bid.collectionSymbol].topBids[bid.tokenId]
          }
        }
      })

      const uniqueIdStore: any = {};
      const uniqueListings = bottomListings.filter(listing => {
        if (!uniqueIdStore[listing.id]) {
          uniqueIdStore[listing.id] = true;
          return true;
        }
        return false;
      });

      // Bid placement tracking counters
      let tokensProcessed = 0;
      let newBidsPlaced = 0;
      let bidsAdjusted = 0;
      let alreadyHaveBids = 0;
      let skippedOfferTooHigh = 0;
      let skippedBidTooHigh = 0;
      let skippedAlreadyOurs = 0;
      let noActionNeeded = 0;          // Existing bid is optimal, no adjustment needed
      let bestOfferIssue = 0;          // bestOffer is null/empty/malformed
      let bidsFailed = 0;              // Bids that failed (rate limit, wallet exhaustion, API error, etc.)
      let successfulBidsPlaced = 0;    // Tokens where we have/placed a valid bid (counts toward bidCount target)
      const targetBidCount = bidCount;

      if (offerType.toUpperCase() === "ITEM") {
        // Check global rate limit before queuing - wait if rate limited
        if (isGloballyRateLimited()) {
          const waitMs = getGlobalResetWaitTime();
          Logger.schedule.rateLimited(collectionSymbol, Math.ceil(waitMs / 1000));
          await delay(waitMs);
        }

        await queue.addAll(
          uniqueListings.sort((a, b) => a.price - b.price)
            .map(token => async () => {
              // Early exit if we've placed enough successful bids
              if (successfulBidsPlaced >= targetBidCount) {
                return;
              }

              const { id: tokenId, price: listedPrice } = token
              const fullTokenData = tokenDataMap[tokenId];
              const sellerReceiveAddress = fullTokenData?.listedSellerReceiveAddress;
              const tokenOutput = fullTokenData?.output;
              const genesisTransaction = fullTokenData?.genesisTransaction;

              try {
                tokensProcessed++;

                // Deduplication: Skip if WebSocket recently bid on this token
                const lastBidTime = recentBids.get(tokenId);
                if (lastBidTime && Date.now() - lastBidTime < RECENT_BID_COOLDOWN_MS) {
                  Logger.info(`[SCHEDULE] ${tokenId.slice(-8)}: Recently bid ${Math.round((Date.now() - lastBidTime) / 1000)}s ago, skipping`);
                  return;
                }

                // Check global rate limit BEFORE making any API calls - wait if rate limited
                if (isGloballyRateLimited()) {
                  const waitMs = getGlobalResetWaitTime();
                  Logger.queue.waiting(tokenId, Math.ceil(waitMs / 1000));
                  await delay(waitMs + 1000); // +1s buffer
                }

                // Fetch best offer and our existing offers - skip token on API error
                let bestOffer;
                let offerData;
                try {
                  bestOffer = await getBestOffer(tokenId);
                  offerData = await getOffers(tokenId, buyerTokenReceiveAddress);
                } catch (apiError: unknown) {
                  Logger.warning(`[SCHEDULE] ${tokenId.slice(-8)}: API error fetching offers, skipping: ${getErrorMessage(apiError)}`);
                  return;
                }

                const ourExistingOffer = (bidHistory[collectionSymbol]?.ourBids?.[tokenId]?.expiration ?? 0) > Date.now()

                const currentExpiry = bidHistory[collectionSymbol]?.ourBids?.[tokenId]?.expiration
              const newExpiry = duration * 60 * 1000
              // Filter to only our offers from any of our wallets (supports wallet groups)
              const offer = (offerData?.offers ?? []).filter((item) => isOurPaymentAddress(item.buyerPaymentAddress))

              if (currentExpiry && (currentExpiry - Date.now()) > newExpiry) {
                if (offer && offer.length > 0) {
                  // Use Promise.allSettled to continue cancelling even if some fail
                  const results = await Promise.allSettled(offer.map(async (item) => {
                    const cancelled = await cancelBid(
                      item,
                      privateKey,
                      collectionSymbol,
                      tokenId,
                      buyerPaymentAddress
                    );
                    // FIX: Only delete from bidHistory after confirmed cancellation success
                    if (cancelled) {
                      delete bidHistory[collectionSymbol].ourBids[tokenId]
                      delete bidHistory[collectionSymbol].topBids[tokenId]
                    }
                    return cancelled;
                  }));
                  // Log any failed cancellations
                  results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                      Logger.warning(`[CANCEL] Failed to cancel offer ${offer[index]?.id}: ${result.reason}`);
                    }
                  });
                }
              }


              /*
              * This condition executes in a scenario where we're not currently bidding on a token,
              * and our total bids for that collection are less than the desired bid count.
              *
              * If there's an existing offer on that token:
              *   - It first checks to ensure that we're not the owner of the existing offer.
              *   - If we're not the owner, it proceeds to outbid the existing offer.
              *
              * If there's no existing offer on the token:
              *   - We place a minimum bid on the token.
              */

              // expire bid if configuration has changed and we are not trying to outbid
              if (!ourExistingOffer) {
                // Skip token if API error prevented us from getting current offer state
                if (bestOffer === null) {
                  Logger.warning(`[SCHEDULE] ${tokenId.slice(-8)}: API error getting best offer, skipping token`);
                  return;
                }
                if (bestOffer.offers && bestOffer.offers.length > 0) {
                  const topOffer = bestOffer.offers[0]
                  /*
                   * This condition executes where we don't have an existing offer on a token
                   * And there's a current offer on that token
                   * we outbid the current offer on the token if the calculated bid price is less than our max bid amount
                  */
                  if (!isOurPaymentAddress(topOffer?.buyerPaymentAddress)) {
                    const currentPrice = topOffer.price

                    // Skip if existing offer already exceeds our maximum bid limit
                    if (currentPrice > maxOffer) {
                      skippedOfferTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Existing offer exceeds maxBid', currentPrice, currentPrice, maxOffer);
                      return;
                    }

                    const bidPrice = currentPrice + Math.round(outBidMargin * CONVERSION_RATE)
                    if (bidPrice <= maxOffer) {
                      try {
                        const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress, maxOffer)
                        if (result.success) {
                          addRecentBid(tokenId, Date.now());  // Record bid time for deduplication
                          bidHistory[collectionSymbol].topBids[tokenId] = true
                          bidHistory[collectionSymbol].ourBids[tokenId] = {
                            price: bidPrice,
                            expiration: expiration,
                            paymentAddress: result.paymentAddress
                          }
                          Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'OUTBID', { floorPrice, minOffer, maxOffer });
                          newBidsPlaced++;
                          successfulBidsPlaced++;
                        } else {
                          Logger.warning(`[BID] Bid failed for ${collectionSymbol} ${tokenId.slice(-8)}: ${result.reason || 'unknown'}`);
                          bidsFailed++;
                        }
                      } catch (error) {
                        Logger.error(`Failed to place bid for ${collectionSymbol} ${tokenId}`, error);
                        bidsFailed++;
                      }
                    } else {
                      skippedBidTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Calculated bid exceeds maxBid', currentPrice, bidPrice, maxOffer);
                    }
                  } else {
                    // Top offer is from one of our wallet pool addresses, but not tracked in bidHistory
                    // Rehydrate the orphaned bid into bidHistory so it's tracked going forward
                    bidHistory[collectionSymbol].topBids[tokenId] = true;
                    bidHistory[collectionSymbol].ourBids[tokenId] = {
                      price: topOffer.price,
                      expiration: topOffer.expirationDate || (Date.now() + duration * 60 * 1000),
                      paymentAddress: topOffer.buyerPaymentAddress
                    };
                    skippedAlreadyOurs++;
                    successfulBidsPlaced++;
                    Logger.info(`Token ${tokenId.slice(-8)}: Rehydrated orphan (${topOffer.price} sats)`);
                  }
                }
                /*
                 * This condition executes where we don't have an existing offer on a token
                 * and there is no active offer on that token
                 * we bid the minimum on that token
                */
                else {
                  const bidPrice = minOffer
                  if (bidPrice <= maxOffer) {
                    try {
                      const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress, maxOffer)
                      if (result.success) {
                        addRecentBid(tokenId, Date.now());  // Record bid time for deduplication
                        bidHistory[collectionSymbol].topBids[tokenId] = true
                        bidHistory[collectionSymbol].ourBids[tokenId] = {
                          price: bidPrice,
                          expiration: expiration,
                          paymentAddress: result.paymentAddress
                        }
                        Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'NEW', { floorPrice, minOffer, maxOffer });
                        newBidsPlaced++;
                        successfulBidsPlaced++;
                      } else {
                        Logger.warning(`[BID] Bid failed for ${collectionSymbol} ${tokenId.slice(-8)}: ${result.reason || 'unknown'}`);
                        bidsFailed++;
                      }
                    } catch (error) {
                      Logger.error(`Failed to place minimum bid for ${collectionSymbol} ${tokenId}`, error);
                      bidsFailed++;
                    }
                  } else {
                    skippedBidTooHigh++;
                    Logger.bidSkipped(collectionSymbol, tokenId, 'minOffer exceeds maxOffer (check config)', minOffer, minOffer, maxOffer);
                  }
                }
              }

              /**
               * This block of code handles situations where there exists an offer on the token:
               * It first checks if there's any offer on the token
               * If an offer is present, it determines whether we have the highest offer
               * If we don't have highest offer, it attempts to outbid the current highest offer
               * In case of being the highest offer, it tries to adjust the bid downwards if the difference between our offer and the second best offer exceeds the outbid margin.
               * If our offer stands alone, it ensures that our offer remains at the minimum possible value
               */
              else if (ourExistingOffer) {
                alreadyHaveBids++;
                if (bestOffer && bestOffer.offers && bestOffer.offers.length > 0) {
                  const topOffer = bestOffer.offers[0];
                  const secondTopOffer = bestOffer.offers[1];
                  const bestPrice = topOffer.price

                  if (!isOurPaymentAddress(topOffer.buyerPaymentAddress)) {
                    const currentPrice = topOffer.price

                    // Skip if existing offer already exceeds our maximum bid limit
                    // Don't count toward successfulBidsPlaced - we can't compete on this token
                    if (currentPrice > maxOffer) {
                      skippedOfferTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Existing offer exceeds maxBid', currentPrice, currentPrice, maxOffer);
                      return;
                    }

                    const bidPrice = currentPrice + Math.round(outBidMargin * CONVERSION_RATE)

                    if (bidPrice <= maxOffer) {
                      try {
                        const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress, maxOffer)
                        if (result.success) {
                          addRecentBid(tokenId, Date.now());  // Record bid time for deduplication
                          bidHistory[collectionSymbol].topBids[tokenId] = true
                          bidHistory[collectionSymbol].ourBids[tokenId] = {
                            price: bidPrice,
                            expiration: expiration,
                            paymentAddress: result.paymentAddress
                          }
                          Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'OUTBID', { floorPrice, minOffer, maxOffer });
                          newBidsPlaced++;
                          successfulBidsPlaced++;
                        }
                      } catch (error) {
                        Logger.error(`Failed to outbid for ${collectionSymbol} ${tokenId}`, error);
                      }
                    } else {
                      skippedBidTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Calculated bid exceeds maxBid', currentPrice, bidPrice, maxOffer);
                    }

                  } else {
                    // We have the top offer - this counts toward our target
                    successfulBidsPlaced++;
                    if (secondTopOffer) {
                      const secondBestPrice = secondTopOffer.price
                      const outBidAmount = Math.round(outBidMargin * CONVERSION_RATE)
                      if (bestPrice - secondBestPrice > outBidAmount) {
                        // Round after arithmetic to prevent floating-point drift
                        const bidPrice = Math.round(secondBestPrice + outBidAmount)

                        if (bidPrice <= maxOffer) {
                          try {
                            const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress, maxOffer)
                            if (result.success) {
                              addRecentBid(tokenId, Date.now());  // Record bid time for deduplication
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration,
                                paymentAddress: result.paymentAddress
                              }
                              Logger.bidAdjusted(collectionSymbol, tokenId, bestPrice, bidPrice);
                              bidsAdjusted++;
                            }
                          } catch (error) {
                            Logger.error(`Failed to adjust bid for ${collectionSymbol} ${tokenId}`, error);
                          }
                        } else {
                          skippedBidTooHigh++;
                          Logger.bidSkipped(collectionSymbol, tokenId, 'Adjusted bid would exceed maxBid', secondBestPrice, bidPrice, maxOffer);
                        }
                      } else {
                        // Margin is acceptable, no adjustment needed
                        noActionNeeded++;
                      }
                    } else {
                      const bidPrice = minOffer
                      if (bestPrice !== bidPrice) { // self adjust bids.
                        if (bidPrice <= maxOffer) {
                          try {
                            const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress, maxOffer)
                            if (result.success) {
                              addRecentBid(tokenId, Date.now());  // Record bid time for deduplication
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration,
                                paymentAddress: result.paymentAddress
                              }
                              Logger.bidAdjusted(collectionSymbol, tokenId, bestPrice, bidPrice);
                              bidsAdjusted++;
                            }
                          } catch (error) {
                            Logger.error(`Failed to self-adjust bid for ${collectionSymbol} ${tokenId}`, error);
                          }
                        } else {
                          skippedBidTooHigh++;
                          Logger.bidSkipped(collectionSymbol, tokenId, 'Adjusted bid would exceed maxBid', bidPrice, bidPrice, maxOffer);
                        }
                      } else if (bidPrice > maxOffer) {
                        skippedBidTooHigh++;
                        Logger.warning(`Current price exceeds max offer for ${collectionSymbol} ${tokenId}`);
                      } else {
                        // Bid is already optimal, no adjustment needed
                        noActionNeeded++;
                      }
                    }
                  }
                } else {
                  // We have an existing offer but no best offer data - still counts as we have a bid
                  successfulBidsPlaced++;
                }
              }
              } catch (error: unknown) {
                Logger.error(`[CRITICAL] Token ${tokenId.slice(-8)} crashed`, getErrorMessage(error));
                bidsFailed++;
              }
            })
        )

      } else if (offerType.toUpperCase() === "COLLECTION") {
        let bestOffer;
        try {
          bestOffer = await getBestCollectionOffer(collectionSymbol);
        } catch (offerError: unknown) {
          Logger.warning(`[SCHEDULE] API error fetching collection offers for ${collectionSymbol}, skipping cycle: ${getErrorMessage(offerError)}`);
          return;
        }
        if (bestOffer && bestOffer.offers.length > 0) {

          const topOffer = bestOffer.offers[0];
          const secondTopOffer = bestOffer.offers[1];
          const bestPrice = topOffer.price.amount

          bidHistory[collectionSymbol].highestCollectionOffer = {
            price: bestPrice,
            buyerPaymentAddress: topOffer.btcParams.makerPaymentAddress
          };

          const ourOffer = bestOffer.offers.find((item) => isOurPaymentAddress(item.btcParams.makerPaymentAddress)) as ICollectionOffer

          if (!isOurPaymentAddress(topOffer.btcParams.makerPaymentAddress)) {
            try {
              if (ourOffer) {
                const offerIds = [ourOffer.id]
                let cancelPublicKey = publicKey;
                let cancelPrivateKey = privateKey;
                const makerAddr = ourOffer.btcParams?.makerPaymentAddress;
                if (ENABLE_WALLET_ROTATION && makerAddr) {
                  const creds = getWalletCredentialsByPaymentAddress(makerAddr);
                  if (creds) {
                    cancelPublicKey = creds.publicKey;
                    cancelPrivateKey = creds.privateKey;
                  } else {
                    Logger.warning(`[CANCEL] Cannot find credentials for wallet ${makerAddr}, cancel may fail`);
                  }
                }
                const cancelled = await cancelCollectionOffer(offerIds, cancelPublicKey, cancelPrivateKey)
                if (!cancelled) {
                  Logger.error(`[COLLECTION] Failed to cancel existing offer before outbid for ${collectionSymbol}, skipping bid`);
                  return;
                }
              }
            } catch (error: unknown) {
              Logger.error(`[COLLECTION] Failed to cancel existing offer before outbid for ${collectionSymbol}`, getErrorMessage(error));
              return;
            }

            const currentPrice = topOffer.price.amount
            const bidPrice = currentPrice + Math.round(outBidMargin * CONVERSION_RATE)

            if (bidPrice <= maxOffer) {
              try {
                if (bidPrice < floorPrice) {
                  await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte, maxOffer, balance)
                  bidHistory[collectionSymbol].offerType = "COLLECTION"

                  bidHistory[collectionSymbol].highestCollectionOffer = {
                    price: bidPrice,
                    buyerPaymentAddress: buyerPaymentAddress
                  }
                  Logger.collectionOfferPlaced(collectionSymbol, bidPrice);
                }
              } catch (error) {
                Logger.error(`Failed to place collection offer for ${collectionSymbol}`, error);
              }
            } else {
              Logger.bidSkipped(collectionSymbol, 'COLLECTION', 'Calculated offer exceeds maxBid', currentPrice, bidPrice, maxOffer);
            }

          } else {
            if (secondTopOffer) {
              const secondBestPrice = secondTopOffer.price.amount
              const outBidAmount = Math.round(outBidMargin * CONVERSION_RATE)
              if (bestPrice - secondBestPrice > outBidAmount) {
                // Round after arithmetic to prevent floating-point drift
                const bidPrice = Math.round(secondBestPrice + outBidAmount)

                try {
                  if (ourOffer) {
                    const offerIds = [ourOffer.id]
                    let cancelPublicKey = publicKey;
                    let cancelPrivateKey = privateKey;
                    const makerAddr = ourOffer.btcParams?.makerPaymentAddress;
                    if (ENABLE_WALLET_ROTATION && makerAddr) {
                      const creds = getWalletCredentialsByPaymentAddress(makerAddr);
                      if (creds) {
                        cancelPublicKey = creds.publicKey;
                        cancelPrivateKey = creds.privateKey;
                      } else {
                        Logger.warning(`[CANCEL] Cannot find credentials for wallet ${makerAddr}, cancel may fail`);
                      }
                    }
                    const cancelled = await cancelCollectionOffer(offerIds, cancelPublicKey, cancelPrivateKey)
                    if (!cancelled) {
                      Logger.error(`[COLLECTION] Failed to cancel offer before adjustment for ${collectionSymbol}, skipping bid`);
                      return;
                    }
                  }
                } catch (error: unknown) {
                  Logger.error(`[COLLECTION] Failed to cancel offer before adjustment for ${collectionSymbol}`, getErrorMessage(error));
                  return;
                }

                if (bidPrice <= maxOffer) {
                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte, maxOffer, balance)
                      bidHistory[collectionSymbol].offerType = "COLLECTION"
                      bidHistory[collectionSymbol].highestCollectionOffer = {
                        price: bidPrice,
                        buyerPaymentAddress: buyerPaymentAddress
                      }
                      Logger.bidAdjusted(collectionSymbol, 'COLLECTION', bestPrice, bidPrice);
                    }
                  } catch (error) {
                    Logger.error(`Failed to adjust collection offer for ${collectionSymbol}`, error);
                  }
                } else {
                  Logger.bidSkipped(collectionSymbol, 'COLLECTION', 'Adjusted offer would exceed maxBid', secondBestPrice, bidPrice, maxOffer);
                }
              }
            } else {
              const bidPrice = minOffer
              if (bestPrice !== bidPrice) {
                try {
                  if (ourOffer) {
                    const offerIds = [ourOffer.id]
                    let cancelPublicKey = publicKey;
                    let cancelPrivateKey = privateKey;
                    const makerAddr = ourOffer.btcParams?.makerPaymentAddress;
                    if (ENABLE_WALLET_ROTATION && makerAddr) {
                      const creds = getWalletCredentialsByPaymentAddress(makerAddr);
                      if (creds) {
                        cancelPublicKey = creds.publicKey;
                        cancelPrivateKey = creds.privateKey;
                      } else {
                        Logger.warning(`[CANCEL] Cannot find credentials for wallet ${makerAddr}, cancel may fail`);
                      }
                    }
                    const cancelled = await cancelCollectionOffer(offerIds, cancelPublicKey, cancelPrivateKey)
                    if (!cancelled) {
                      Logger.error(`[COLLECTION] Failed to cancel collection offer for ${collectionSymbol}, skipping bid`);
                      return;
                    }
                  }
                } catch (error) {
                  Logger.error(`Failed to cancel collection offer for ${collectionSymbol}`, error);
                  return;
                }

                if (bidPrice <= maxOffer) {
                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte, maxOffer, balance)
                      bidHistory[collectionSymbol].offerType = "COLLECTION"
                      bidHistory[collectionSymbol].highestCollectionOffer = {
                        price: bidPrice,
                        buyerPaymentAddress: buyerPaymentAddress
                      }
                      Logger.bidAdjusted(collectionSymbol, 'COLLECTION', bestPrice, bidPrice);
                    }
                  } catch (error) {
                    Logger.error(`Failed to adjust collection offer for ${collectionSymbol}`, error);
                  }
                } else {
                  Logger.bidSkipped(collectionSymbol, 'COLLECTION', 'Calculated bid exceeds maxBid', bidPrice, bidPrice, maxOffer);
                }
              }
            }
          }
        } else {
          const bidPrice = minOffer
          if (bidPrice <= maxOffer) {
            if (bidPrice < floorPrice) {
              try {
                await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte, maxOffer, balance)
                bidHistory[collectionSymbol].offerType = "COLLECTION"
                bidHistory[collectionSymbol].highestCollectionOffer = {
                  price: bidPrice,
                  buyerPaymentAddress: buyerPaymentAddress
                }
                Logger.collectionOfferPlaced(collectionSymbol, bidPrice);
              } catch (error) {
                Logger.error(`Failed to place initial collection offer for ${collectionSymbol}`, error);
              }
            }
          }
        }
      } else {
        Logger.warning(`[SCHEDULE] Unknown offerType "${offerType}" for ${collectionSymbol}, skipping bid cycle`);
      }

      // Log bid placement summary
      const currentActiveBids = Object.keys(bidHistory[collectionSymbol].ourBids).filter(
        tokenId => bidHistory[collectionSymbol].ourBids[tokenId]?.expiration > Date.now()
      ).length;

      Logger.summary.bidPlacement({
        tokensProcessed,
        newBidsPlaced,
        bidsAdjusted,
        alreadyHaveBids,
        noActionNeeded,
        skippedOfferTooHigh,
        skippedBidTooHigh,
        skippedAlreadyOurs,
        bidsFailed,
        currentActiveBids,
        bidCount,
        successfulBidsPlaced,
      });

      restartState.set(item.collectionSymbol, false);
      // Mark bidHistory dirty after all scheduled-loop mutations
      bidHistoryDirtyTracker.markDirty();
      const scheduleDuration = (Date.now() - startTime) / 1000;
      Logger.scheduleComplete(item.collectionSymbol, scheduleDuration);
    } catch (error) {
      Logger.error(`Schedule failed for ${item.collectionSymbol}`, error);
      throw error
    }
  }
}

const eventManager = new EventManager();

function connectWebSocket(): void {
  const baseEndpoint: string = 'wss://wss-mainnet.magiceden.io/CJMw7IPrGPUb13adEQYW2ASbR%2FIWToagGUCr02hWp1oWyLAtf5CS0XF69WNXj0MbO6LEQLrFQMQoEqlX7%2Fny2BP08wjFc9MxzEmM5v2c5huTa3R1DPqGSbuO2TXKEEneIc4FMEm5ZJruhU8y4cyfIDzGqhWDhxK3iRnXtYzI0FGG1%2BMKyx9WWOpp3lLA3Gm2BgNpHHp3wFEas5TqVdJn0GtBrptg8ZEveG8c44CGqfWtEsS0iI8LZDR7tbrZ9fZpbrngDaimEYEH6MgvhWPTlKrsGw%3D%3D'

  // L2: Defensive clear of heartbeat interval on reconnect to prevent race
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }

  // Memory leak fix: Clean up existing WebSocket before creating new one
  if (ws) {
    try {
      ws.removeAllListeners('open');
      ws.removeAllListeners('close');
      ws.removeAllListeners('error');
      ws.removeAllListeners('message');
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch (err: unknown) {
      Logger.warning('[WEBSOCKET] Error cleaning up old WebSocket:', getErrorMessage(err));
    }
  }

  ws = new WebSocket(baseEndpoint);

  // M2: Connection timeout - trigger reconnect if connection doesn't open within 30s
  const wsConnectTimeout = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      Logger.warning('[WEBSOCKET] Connection timeout after 30s, triggering reconnect');
      try { ws.close(); } catch {}
    }
  }, BOT_CONSTANTS.WS_CONNECT_TIMEOUT_MS);

  // FIX: Register message listener OUTSIDE open handler to prevent accumulation on reconnects
  ws.on("message", function incoming(data: string) {
    try {
      const dataStr = data.toString();
      let parsed: any;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        return; // Silently skip non-JSON messages (heartbeat responses, etc.)
      }

      // Validate message has required fields before processing
      if (!isValidWebSocketMessage(parsed)) {
        // Only log if it looks like an activity event (has kind field but missing other fields)
        if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
          Logger.warning(`[WEBSOCKET] Malformed message received, missing required fields: kind=${parsed.kind}`);
        }
        return;
      }

      eventManager.receiveWebSocketEvent(parsed);
    } catch (error: unknown) {
      Logger.error('[WEBSOCKET] Error processing message', getErrorMessage(error));
    }
  });

  ws.on("open", function open() {
    Logger.websocket.connected();
    clearTimeout(wsConnectTimeout); // M2: Cancel connection timeout on successful open

    retryCount = 0;
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (heartbeatIntervalId !== null) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    heartbeatIntervalId = setInterval(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              topic: "nfttools",
              event: "heartbeat",
              payload: {},
              ref: 0,
            })
          );
        } else {
          Logger.warning('[WEBSOCKET] Heartbeat skipped - connection not open');
          if (heartbeatIntervalId !== null) {
            clearInterval(heartbeatIntervalId);
            heartbeatIntervalId = null;
          }
          // Trigger reconnect to recover dead connection
          attemptReconnect();
        }
      } catch (err) {
        Logger.warning('[WEBSOCKET] Heartbeat send failed, clearing interval:', err);
        if (heartbeatIntervalId !== null) {
          clearInterval(heartbeatIntervalId);
          heartbeatIntervalId = null;
        }
        // Trigger reconnect to recover from broken connection
        attemptReconnect();
      }
    }, 10000);

    if (collections.length > 0) {
      subscribeToCollections(collections)
    }
  });

  ws.on("close", function close() {
    Logger.websocket.disconnected();
    clearTimeout(wsConnectTimeout); // M2: Cancel connection timeout on close
    if (heartbeatIntervalId !== null) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    attemptReconnect();
  });

  ws.on("error", function error(err: any) {
    clearTimeout(wsConnectTimeout); // H4: Clear connection timeout on error
    Logger.websocket.error(err);
    if (ws) {
      ws.close();
    }
  });
}

const MAX_RETRIES: number = 5;
const RECONNECT_COOLDOWN_MS: number = 5 * 60 * 1000; // 5 minutes cooldown before resetting retry count

function attemptReconnect(): void {
  if (retryCount < MAX_RETRIES) {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
    }
    let delayMs: number = Math.pow(2, retryCount) * 1000;
    Logger.info(`[WEBSOCKET] Attempting to reconnect in ${delayMs / 1000} seconds...`);
    reconnectTimeoutId = setTimeout(connectWebSocket, delayMs);
    retryCount++;
  } else {
    // Max retries exceeded - wait 5 minutes then try again from scratch
    Logger.websocket.maxRetriesExceeded();
    Logger.warning(`[WEBSOCKET] Waiting ${RECONNECT_COOLDOWN_MS / 60000} minutes before retrying...`);
    Logger.warning('[WEBSOCKET] Counter-bidding temporarily disabled. Scheduled bidding continues.');

    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
    }
    reconnectTimeoutId = setTimeout(() => {
      Logger.info('[WEBSOCKET] Cooldown complete, resetting retry count and attempting to reconnect...');
      retryCount = 0;
      attemptReconnect();
    }, RECONNECT_COOLDOWN_MS);
  }
}

function subscribeToCollections(collections: CollectionData[]) {
  collections.forEach((item) => {
    const subscriptionMessage = {
      type: 'subscribeCollection',
      constraint: {
        chain: 'bitcoin',
        collectionSymbol: item.collectionSymbol
      }
    };

    if (item.enableCounterBidding) {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(subscriptionMessage));
          Logger.websocket.subscribed(item.collectionSymbol);
        } else {
          Logger.warning(`[WEBSOCKET] Cannot subscribe to ${item.collectionSymbol}: connection not open`);
        }
      } catch (err) {
        Logger.warning(`[WEBSOCKET] Failed to subscribe to ${item.collectionSymbol}:`, err);
      }
    }
  });
}

// Memory leak fix: Properly await collection monitoring loops
async function startCollectionMonitoring(item: CollectionData) {
  const loop = (item.scheduledLoop || DEFAULT_LOOP) * 1000
  while (true) {
    try {
      // Check if globally rate limited before starting a cycle
      if (isGloballyRateLimited()) {
        const waitMs = getGlobalResetWaitTime();
        Logger.schedule.skipping(item.collectionSymbol, Math.ceil(waitMs / 1000));
        await delay(Math.min(waitMs + 1000, loop)); // Wait for rate limit or next cycle, whichever is shorter
        continue;
      }

      await eventManager.runScheduledTask(item);
      await delay(loop)
    } catch (error) {
      Logger.error(`[SCHEDULE] Collection monitoring failed for ${item.collectionSymbol}`, error);
      await delay(loop); // Continue loop even on error
    }
  }
}

async function startProcessing() {
  // Memory leak fix: Properly await all collection monitoring promises
  // Each startCollectionMonitoring runs an infinite loop, so Promise.all should never resolve.
  // If it does, something critical has gone wrong.
  await Promise.all(
    collections.map(item => startCollectionMonitoring(item))
  );
  // If we reach here, all monitoring loops have unexpectedly exited
  Logger.critical('[CRITICAL] All collection monitoring loops exited unexpectedly');
  await gracefulShutdown('MONITORING_EXIT');
}

// Display version banner on startup
printVersionBanner();

// S1: Fix permissions on sensitive config files at startup
const WALLET_CONFIG_FULL_PATH = path.resolve(WALLET_CONFIG_PATH);
const CONFIG_DIR = path.join(process.cwd(), 'config');
try {
  if (fs.existsSync(CONFIG_DIR)) {
    fs.chmodSync(CONFIG_DIR, 0o700);
  }
  if (fs.existsSync(WALLET_CONFIG_FULL_PATH)) {
    fs.chmodSync(WALLET_CONFIG_FULL_PATH, 0o600);
    Logger.info(`[STARTUP] Set secure permissions on ${WALLET_CONFIG_FULL_PATH}`);
  }
  // Set secure permissions on .env file
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    fs.chmodSync(envPath, 0o600);
    Logger.info(`[STARTUP] Set secure permissions on ${envPath}`);
  }
} catch (err: unknown) {
  Logger.warning(`[STARTUP] Could not set file permissions: ${getErrorMessage(err)}`);
}

// Load persisted bid history (for quantity restoration after restart)
loadBidHistoryFromFile();

// Initialize wallet groups/pool if multi-wallet rotation is enabled
// Wrapped in async IIFE because encrypted wallets.json requires async password prompt
(async () => {
// Load funding WIF from wallets.json (always, regardless of ENABLE_WALLET_ROTATION)
let walletConfigContent: string | null = null;
let walletConfig: any = null;

if (fs.existsSync(WALLET_CONFIG_PATH)) {
  walletConfigContent = fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8');
  if (isEncryptedFormat(walletConfigContent)) {
    Logger.info('[STARTUP] Wallets file is encrypted — password required');
    const password = await promptPasswordStdin('[STARTUP] Enter wallets encryption password: ');
    try {
      walletConfigContent = decryptData(walletConfigContent, password);
    } catch {
      Logger.error('[STARTUP] Wrong password — could not decrypt wallets.json');
      process.exit(1);
    }
    Logger.success('[STARTUP] Wallets file decrypted successfully');
  }
  walletConfig = JSON.parse(walletConfigContent);

  // Extract funding WIF from wallets.json if present
  if (walletConfig.fundingWallet?.wif) {
    setFundingWIF(walletConfig.fundingWallet.wif);
    Logger.info('[STARTUP] Funding WIF loaded from encrypted wallets.json');
  }

  // Extract receive address from wallets.json if present
  if (walletConfig.fundingWallet?.receiveAddress) {
    setReceiveAddress(walletConfig.fundingWallet.receiveAddress);
    Logger.info('[STARTUP] Token receive address loaded from encrypted wallets.json');
  }
}

// Resolve funding WIF: wallets.json > .env > error
if (!hasFundingWIF()) {
  if (process.env.FUNDING_WIF) {
    Logger.warning('[STARTUP] FUNDING_WIF loaded from .env (deprecated)');
    Logger.warning('[STARTUP] Run: yarn manage → "Encrypt wallets file" to migrate FUNDING_WIF into encrypted wallets.json');
  } else {
    Logger.error('[STARTUP] No FUNDING_WIF found in wallets.json or .env');
    Logger.error('[STARTUP] Run: yarn manage → "Encrypt wallets file" to configure');
    process.exit(1);
  }
}

// S3: Validate funding WIF at startup - fail fast
try {
  safeECPairFromWIF(getFundingWIF(), network, 'startup');
} catch (error: unknown) {
  Logger.error(`[STARTUP] Invalid FUNDING_WIF: ${getErrorMessage(error)}`);
  Logger.error('[STARTUP] Check your wallets.json or .env — FUNDING_WIF must be a valid Bitcoin WIF private key');
  process.exit(1);
}

// Resolve TOKEN_RECEIVE_ADDRESS: wallets.json > .env > error
if (!hasReceiveAddress()) {
  if (process.env.TOKEN_RECEIVE_ADDRESS) {
    Logger.warning('[STARTUP] TOKEN_RECEIVE_ADDRESS loaded from .env (deprecated)');
    Logger.warning('[STARTUP] Run: yarn manage → "Encrypt wallets file" to migrate TOKEN_RECEIVE_ADDRESS into encrypted wallets.json');
  } else {
    Logger.error('[STARTUP] No TOKEN_RECEIVE_ADDRESS found in wallets.json or .env');
    Logger.error('[STARTUP] Run: yarn manage → "Encrypt wallets file" to configure');
    process.exit(1);
  }
}
TOKEN_RECEIVE_ADDRESS = getReceiveAddress();

let pacerLimit = BIDS_PER_MINUTE;

if (ENABLE_WALLET_ROTATION) {
  try {
    if (!walletConfig) {
      Logger.warning(`[WALLET GROUPS] Config file not found at ${WALLET_CONFIG_PATH}`);
      Logger.warning('[WALLET GROUPS] Copy config/wallets.example.json to config/wallets.json and configure your wallets');
      Logger.warning('[WALLET GROUPS] Continuing with single wallet mode...');
    } else {

      // Check if using new groups format
      if (walletConfig.groups && typeof walletConfig.groups === 'object') {
        // New wallet groups format
        const manager = initializeWalletGroupManager(walletConfig, network);
        const groupNames = manager.getGroupNames();
        const totalWallets = manager.getTotalWalletCount();

        Logger.success(`[WALLET GROUPS] Initialized ${groupNames.length} wallet group(s) with ${totalWallets} total wallets`);
        for (const groupName of groupNames) {
          const stats = manager.getGroupStats(groupName);
          if (stats) {
            Logger.info(`[WALLET GROUPS]   - "${groupName}": ${stats.total} wallets, ${stats.bidsPerMinute} bids/min each`);
          }
        }

        // Validate collections have walletGroup assigned when using groups format
        const collectionsWithoutGroup = collections.filter(c => !c.walletGroup);
        if (collectionsWithoutGroup.length > 0) {
          Logger.error(`[STARTUP] ${collectionsWithoutGroup.length} collection(s) missing walletGroup assignment:`);
          for (const c of collectionsWithoutGroup) {
            Logger.error(`[STARTUP]   - ${c.collectionSymbol}`);
          }
          Logger.error('[STARTUP] All collections must have walletGroup assigned when using wallet groups.');
          Logger.error('[STARTUP] Use: yarn manage → collection:assign-group');
          process.exit(1);
        }

        // Validate all assigned walletGroups exist
        const validGroups = new Set(groupNames);
        const invalidAssignments = collections.filter(c => c.walletGroup && !validGroups.has(c.walletGroup));
        if (invalidAssignments.length > 0) {
          Logger.error(`[STARTUP] ${invalidAssignments.length} collection(s) assigned to non-existent groups:`);
          for (const c of invalidAssignments) {
            Logger.error(`[STARTUP]   - ${c.collectionSymbol} → "${c.walletGroup}"`);
          }
          Logger.error('[STARTUP] Available groups: ' + groupNames.join(', '));
          process.exit(1);
        }

        Logger.success('[STARTUP] All collections have valid walletGroup assignments');

        // M5: Validate all wallet WIFs at startup (fail-fast before bot loop)
        for (const groupName of groupNames) {
          const group = walletConfig.groups[groupName];
          if (group && group.wallets) {
            for (const wallet of group.wallets) {
              try {
                ECPair.fromWIF(wallet.wif, network);
              } catch (wifError: unknown) {
                Logger.error(`[STARTUP] Invalid WIF for wallet in group "${groupName}": ${getErrorMessage(wifError)}`);
                process.exit(1);
              }
            }
          }
        }

        // Scale global pacer with total wallet throughput
        let totalThroughput = 0;
        for (const groupName of groupNames) {
          const stats = manager.getGroupStats(groupName);
          if (stats) {
            totalThroughput += stats.total * stats.bidsPerMinute;
          }
        }
        if (totalThroughput > 0) {
          minBidIntervalMs = Math.max(2000, Math.floor(60000 / totalThroughput));
          Logger.info(`[GLOBAL PACER] Interval set to ${(minBidIntervalMs / 1000).toFixed(1)}s (${totalThroughput} bids/min across all wallets)`);
          pacerLimit = totalThroughput;
        }

      } else if (walletConfig.wallets && walletConfig.wallets.length > 0) {
        // Legacy flat wallets format - use single pool for backward compatibility
        initializeWalletPool(walletConfig.wallets, walletConfig.bidsPerMinute || 5, network);
        Logger.success(`[WALLET ROTATION] Initialized wallet pool with ${walletConfig.wallets.length} wallets (legacy mode)`);
        Logger.info(`[WALLET ROTATION] Each wallet limited to ${walletConfig.bidsPerMinute || 5} bids/min`);
        Logger.info(`[WALLET ROTATION] Maximum throughput: ${walletConfig.wallets.length * (walletConfig.bidsPerMinute || 5)} bids/min`);
        Logger.warning('[WALLET ROTATION] Consider migrating to wallet groups for per-collection wallet assignment');

        // Scale global pacer with total wallet throughput
        const totalThroughput = walletConfig.wallets.length * (walletConfig.bidsPerMinute || 5);
        if (totalThroughput > 0) {
          minBidIntervalMs = Math.max(2000, Math.floor(60000 / totalThroughput));
          Logger.info(`[GLOBAL PACER] Interval set to ${(minBidIntervalMs / 1000).toFixed(1)}s (${totalThroughput} bids/min across all wallets)`);
          pacerLimit = totalThroughput;
        }

        // M5: Validate all wallet WIFs at startup (fail-fast before bot loop)
        for (const wallet of walletConfig.wallets) {
          try {
            ECPair.fromWIF(wallet.wif, network);
          } catch (wifError: unknown) {
            Logger.error(`[STARTUP] Invalid WIF for wallet in legacy pool: ${getErrorMessage(wifError)}`);
            process.exit(1);
          }
        }
      } else {
        Logger.warning('[WALLET GROUPS] No wallets configured in wallets.json');
        Logger.warning('[WALLET GROUPS] Continuing with single wallet mode...');
      }
    }
  } catch (error: unknown) {
    Logger.error(`[WALLET GROUPS] Failed to initialize: ${getErrorMessage(error)}`);
    Logger.warning('[WALLET GROUPS] Continuing with single wallet mode...');
  }
}

// Initialize bid pacer once (after wallet loading determines actual throughput)
initializeBidPacer(pacerLimit);

// Start HTTP stats API server for live stats queries from manage CLI
const statsApiPort = await startStatsServer();
if (statsApiPort > 0) {
  // Register stats provider that builds live stats on each request
  setStatsProvider(() => buildRuntimeStats(gatherStatsDeps()));

  // Update PID file with API port so manage CLI can find it
  const pidFilePath = path.join(process.cwd(), '.bot.pid');
  try {
    const existing = fs.readFileSync(pidFilePath, 'utf-8');
    const pidData = JSON.parse(existing);
    pidData.apiPort = statsApiPort;
    fs.writeFileSync(pidFilePath, JSON.stringify(pidData));
  } catch {
    // PID file might not exist yet in dev mode — ignore
  }
}

connectWebSocket();

startProcessing().catch(error => {
  Logger.error('[CRITICAL] startProcessing failed with unhandled error', error);
  process.exit(1);
});
})().catch(error => {
  Logger.error(`[CRITICAL] Startup initialization failed: ${getErrorMessage(error)}`);
  process.exit(1);
});

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// Mutex to prevent concurrent file writes which can corrupt state files
const fileWriteMutex = new Mutex();

// Dirty-flag tracker to reduce disk I/O
const bidHistoryDirtyTracker = new BidHistoryDirtyTracker(15_000);

async function writeBidHistoryToFile(force = false): Promise<void> {
  if (!force && !bidHistoryDirtyTracker.isDirty()) return;
  const release = await fileWriteMutex.acquire();
  try {
    const jsonString = JSON.stringify(bidHistory, null, 2);
    const filePath = path.join(DATA_DIR, 'bidHistory.json');
    const tempPath = path.join(DATA_DIR, 'bidHistory.json.tmp');

    // Atomic write: write to temp file first, then rename
    await fs.promises.writeFile(tempPath, jsonString, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
    bidHistoryDirtyTracker.markClean();
  } catch (err) {
    Logger.error('[PERSIST] Error writing bidHistory to file', err);
  } finally {
    release();
  }
}

// Gather current stats dependencies for buildRuntimeStats (shared by HTTP API and file writer)
function gatherStatsDeps(): StatsDependencies {
  const bidStatsData = getBidStatsData();
  const pacerStatus = getBidPacerStatus();

  let walletPoolData: StatsDependencies['walletPool'] = null;
  let walletGroupsData: StatsDependencies['walletGroups'] = null;

  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized()) {
    const manager = getWalletGroupManager();
    const allStats = manager.getAllStats();
    walletGroupsData = {
      groupCount: allStats.length,
      totalWallets: manager.getTotalWalletCount(),
      groups: allStats.map(stats => ({
        name: stats.groupName,
        available: stats.available,
        total: stats.total,
        bidsPerMinute: stats.bidsPerMinute,
        wallets: stats.wallets.map(w => ({
          label: w.label,
          bidsInWindow: w.bidsInWindow,
          isAvailable: w.isAvailable,
          secondsUntilReset: w.secondsUntilReset,
        })),
      })),
    };
  } else if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const stats = getWalletPoolStats();
    walletPoolData = {
      available: stats.available,
      total: stats.total,
      bidsPerMinute: stats.bidsPerMinute,
      wallets: stats.wallets.map(w => ({
        label: w.label,
        bidsInWindow: w.bidsInWindow,
        isAvailable: w.isAvailable,
        secondsUntilReset: w.secondsUntilReset,
      })),
    };
  }

  let bidsTracked = 0;
  for (const collectionSymbol in bidHistory) {
    bidsTracked += Object.keys(bidHistory[collectionSymbol]?.ourBids || {}).length;
  }

  return {
    bidStats: bidStatsData,
    pacer: pacerStatus,
    pacerLimit: getBidPacer().getLimit(),
    walletPool: walletPoolData,
    walletGroups: walletGroupsData,
    eventQueueLength: eventManager.queue.length,
    queueSize: queue.size,
    queuePending: queue.pending,
    wsConnected: !!(ws && ws.readyState === WebSocket.OPEN),
    botStartTime: BOT_START_TIME,
    bidsTracked,
    bidHistory,
    collections,
  };
}

// Write bid history periodically for crash recovery
const bidHistoryIntervalId = setInterval(() => {
  try {
    writeBidHistoryToFile();
  } catch (err) {
    Logger.error('[INTERVAL] writeBidHistoryToFile failed:', err);
  }
}, BOT_CONSTANTS.BID_HISTORY_WRITE_INTERVAL_MS);

// Memory leak fix: Clean up expired entries from recentBids deduplication map
// Runs every 1 minute to prevent unbounded growth during heavy bidding
function cleanupRecentBids() {
  const now = Date.now();
  let recentBidsCleaned = 0;

  // First pass: Remove expired entries (2x cooldown for safety margin)
  for (const [tokenId, timestamp] of recentBids.entries()) {
    if (now - timestamp > RECENT_BID_COOLDOWN_MS * 2) {
      recentBids.delete(tokenId);
      recentBidsCleaned++;
    }
  }

  // Second pass: Enforce max size cap - remove oldest entries if still over limit
  if (recentBids.size > MAX_RECENT_BIDS_SIZE) {
    // Convert to array, sort by timestamp (oldest first), and remove excess
    const entries = Array.from(recentBids.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, recentBids.size - MAX_RECENT_BIDS_SIZE);
    for (const [tokenId] of toRemove) {
      recentBids.delete(tokenId);
      recentBidsCleaned++;
    }
    Logger.debug(`[CLEANUP] Enforced max size cap on recentBids (removed ${toRemove.length} oldest entries)`);
  }

  if (recentBidsCleaned > 0) {
    Logger.debug(`[CLEANUP] Removed ${recentBidsCleaned} entries from recentBids map (size: ${recentBids.size})`);
  }
}

// Cleanup lock to prevent concurrent modifications during cleanup
let isCleaningUp = false;

// Memory leak fix: Clean up old bidHistory entries
function cleanupBidHistory() {
  // Prevent concurrent cleanup runs
  if (isCleaningUp) {
    Logger.debug('[CLEANUP] Cleanup already in progress, skipping');
    return;
  }
  isCleaningUp = true;

  try {
    const now = Date.now();
    let totalCleaned = 0;

    // Also clean recentBids during full cleanup
    cleanupRecentBids();

  // Remove collections that are no longer in the config
  const activeCollectionSymbols = new Set(collections.map(c => c.collectionSymbol));
  for (const collectionSymbol in bidHistory) {
    if (!activeCollectionSymbols.has(collectionSymbol)) {
      delete bidHistory[collectionSymbol];
      totalCleaned++;
      Logger.info(`[CLEANUP] Removed inactive collection: ${collectionSymbol}`);
    }
  }

  // Clean up old bids based on TTL
  for (const collectionSymbol in bidHistory) {
    const collection = bidHistory[collectionSymbol];

    // Clean expired ourBids - remove bids that expired more than 24 hours ago
    // This keeps recent expired bids for reference but cleans up very old ones
    for (const tokenId in collection.ourBids) {
      const bid = collection.ourBids[tokenId];
      // Remove if bid has been expired for more than BID_HISTORY_MAX_AGE_MS (24h)
      // bid.expiration is in the past if expired, so (now - bid.expiration) = time since expiration
      if (bid.expiration < now && (now - bid.expiration) > BID_HISTORY_MAX_AGE_MS) {
        delete collection.ourBids[tokenId];
        delete collection.topBids[tokenId];
        totalCleaned++;
      }
    }

    // Limit bids per collection (keep only most recent MAX_BIDS_PER_COLLECTION)
    const ourBidsEntries = Object.entries(collection.ourBids);
    if (ourBidsEntries.length > MAX_BIDS_PER_COLLECTION) {
      // Sort by expiration (newest first)
      const sortedBids = ourBidsEntries.sort((a, b) => b[1].expiration - a[1].expiration);
      // Remove oldest bids
      for (let i = MAX_BIDS_PER_COLLECTION; i < sortedBids.length; i++) {
        const [tokenId] = sortedBids[i];
        delete collection.ourBids[tokenId];
        delete collection.topBids[tokenId];
        totalCleaned++;
      }
    }

    // Limit bottomListings array size
    if (collection.bottomListings.length > MAX_BIDS_PER_COLLECTION) {
      collection.bottomListings = collection.bottomListings
        .sort((a, b) => a.price - b.price)
        .slice(0, MAX_BIDS_PER_COLLECTION);
    }
  }

    if (totalCleaned > 0) {
      bidHistoryDirtyTracker.markDirty();
      Logger.memory.cleanup(totalCleaned);
    }
  } finally {
    isCleaningUp = false;
  }
}

// Start periodic cleanup
const cleanupBidHistoryIntervalId = setInterval(() => {
  try {
    cleanupBidHistory();
  } catch (err) {
    Logger.error('[INTERVAL] cleanupBidHistory failed:', err);
  }
}, BID_HISTORY_CLEANUP_INTERVAL_MS);

// More frequent cleanup for recentBids to prevent memory growth during heavy bidding
const cleanupRecentBidsIntervalId = setInterval(() => {
  try {
    cleanupRecentBids();
  } catch (err) {
    Logger.error('[INTERVAL] cleanupRecentBids failed:', err);
  }
}, BOT_CONSTANTS.RECENT_BIDS_CLEANUP_INTERVAL_MS);

// Periodic cleanup for purchase events to enforce TTL and prevent memory leak
const cleanupPurchaseEventsIntervalId = setInterval(() => {
  try {
    cleanupPurchaseEvents();
  } catch (err) {
    Logger.error('[INTERVAL] cleanupPurchaseEvents failed:', err);
  }
}, BOT_CONSTANTS.PURCHASE_EVENTS_CLEANUP_INTERVAL_MS);

// Periodic cleanup for stale processing token locks
function cleanupStaleLocks() {
  const now = Date.now();
  let staleLocksRemoved = 0;

  for (const tokenId in processingTokenTimestamps) {
    const lockTimestamp = processingTokenTimestamps[tokenId];
    if (lockTimestamp && now - lockTimestamp > TOKEN_LOCK_TIMEOUT_MS) {
      Logger.warning(`[LOCK CLEANUP] Removing stale lock for ${tokenId.slice(-8)} (held for ${Math.round((now - lockTimestamp) / 1000)}s)`);
      forceReleaseTokenLock(tokenId);
      staleLocksRemoved++;
    }
  }

  if (staleLocksRemoved > 0) {
    Logger.debug(`[LOCK CLEANUP] Removed ${staleLocksRemoved} stale lock(s)`);
  }
}

const cleanupStaleLocksIntervalId = setInterval(() => {
  try {
    cleanupStaleLocks();
  } catch (err) {
    Logger.error('[INTERVAL] cleanupStaleLocks failed:', err);
  }
}, BOT_CONSTANTS.STALE_LOCKS_CLEANUP_INTERVAL_MS);

// Memory leak fix: Add memory monitoring and alerting
let lastMemoryCheck = { heapUsed: process.memoryUsage().heapUsed, timestamp: Date.now() };
const MEMORY_WARNING_THRESHOLD_MB = 1500; // Warn if heap exceeds 1.5GB
const MEMORY_GROWTH_RATE_THRESHOLD_MB_PER_MIN = 10; // Warn if growing faster than 10MB/min

function monitorMemoryUsage() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

  const now = Date.now();
  const timeDiffMin = (now - lastMemoryCheck.timestamp) / 60000;
  const heapGrowthMB = heapUsedMB - (lastMemoryCheck.heapUsed / 1024 / 1024);
  // Require at least 6 seconds of data to avoid false warnings from tiny time differences
  const growthRatePerMin = timeDiffMin > 0.1 ? heapGrowthMB / timeDiffMin : 0;

  // Count total bids being tracked
  let totalBidsTracked = 0;
  for (const collectionSymbol in bidHistory) {
    totalBidsTracked += Object.keys(bidHistory[collectionSymbol]?.ourBids || {}).length;
  }

  Logger.memory.status(heapUsedMB, heapTotalMB, eventManager.queue.length, totalBidsTracked, queue.size, queue.pending);

  // Warning checks
  if (heapUsedMB > MEMORY_WARNING_THRESHOLD_MB) {
    Logger.memory.critical(`Heap usage (${heapUsedMB.toFixed(2)} MB) exceeds threshold (${MEMORY_WARNING_THRESHOLD_MB} MB)! Consider restarting.`);
  }

  if (growthRatePerMin > MEMORY_GROWTH_RATE_THRESHOLD_MB_PER_MIN) {
    Logger.memory.warning(`Memory growing rapidly at ${growthRatePerMin.toFixed(2)} MB/min!`);
  }

  lastMemoryCheck = { heapUsed: memUsage.heapUsed, timestamp: now };
}

// Start periodic memory monitoring
const memoryMonitorIntervalId = setInterval(() => {
  try {
    monitorMemoryUsage();
  } catch (err) {
    Logger.error('[INTERVAL] monitorMemoryUsage failed:', err);
  }
}, BOT_CONSTANTS.MEMORY_MONITOR_INTERVAL_MS);

// Initial memory check after 1 minute
setTimeout(() => {
  try {
    monitorMemoryUsage();
  } catch (err) {
    Logger.error('[TIMEOUT] Initial monitorMemoryUsage failed:', err);
  }
}, BOT_CONSTANTS.INITIAL_MEMORY_CHECK_DELAY_MS);

// Print bid pacer progress when queue has pending items
const pacerProgressIntervalId = setInterval(() => {
  try {
    if (queue.size > 0 || queue.pending > 0) {
      const status = getBidPacerStatus();
      Logger.queue.progress(queue.size, queue.pending, status.bidsUsed, getBidPacer().getLimit(), status.windowResetIn, status.totalBidsPlaced);
    }
  } catch (err) {
    Logger.error('[INTERVAL] pacer progress failed:', err);
  }
}, BOT_CONSTANTS.PACER_STATUS_INTERVAL_MS);

// Print bid statistics periodically
const bidStatsIntervalId = setInterval(() => {
  try {
    Logger.printStats();

    // Print pacer stats
    const pacerStatus = getBidPacerStatus();
    const pacerLines = [
      '',
      '━'.repeat(60),
      'BID PACER STATUS',
      '━'.repeat(60),
      `  Bids in window:     ${pacerStatus.bidsUsed}/${getBidPacer().getLimit()}`,
      `  Window resets in:   ${pacerStatus.windowResetIn}s`,
      `  Total bids placed:  ${pacerStatus.totalBidsPlaced}`,
      `  Total waits:        ${pacerStatus.totalWaits}`,
      '━'.repeat(60),
    ];
    Logger.info(pacerLines.join('\n'));

    // Print wallet pool stats if rotation is enabled
    if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
      const stats = getWalletPoolStats();
      const walletLines = [
        '',
        '━'.repeat(60),
        'WALLET POOL STATUS',
        '━'.repeat(60),
        `  Available wallets: ${stats.available}/${stats.total}`,
        `  Rate limit: ${stats.bidsPerMinute} bids/min per wallet`,
        `  Max throughput: ${stats.total * stats.bidsPerMinute} bids/min`,
        '',
        ...stats.wallets.map(w => {
          const statusIcon = w.isAvailable ? '[OK]' : '[WAIT]';
          return `  ${statusIcon} ${w.label}: ${w.bidsInWindow}/${stats.bidsPerMinute} bids (reset in ${w.secondsUntilReset}s)`;
        }),
        '━'.repeat(60),
      ];
      Logger.info(walletLines.join('\n'));
    }
  } catch (err) {
    Logger.error('[INTERVAL] bid stats print failed:', err);
  }
}, BOT_CONSTANTS.BID_STATS_PRINT_INTERVAL_MS);

// B6: Shared graceful shutdown with timeout guard and WebSocket cleanup
async function gracefulShutdown(signal: string): Promise<void> {
  Logger.info(`Received ${signal} signal. Shutting down...`);

  // B6: Safety net - force exit if shutdown hangs
  const forceExitTimer = setTimeout(() => {
    Logger.error('[SHUTDOWN] Graceful shutdown timed out after 5s, forcing exit');
    process.exit(1);
  }, BOT_CONSTANTS.SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref(); // Don't keep process alive just for this timer

  // M6: Wrap each clearInterval in try-catch so one failure doesn't skip the rest
  const intervals = [bidHistoryIntervalId, cleanupBidHistoryIntervalId,
    cleanupRecentBidsIntervalId, cleanupPurchaseEventsIntervalId, memoryMonitorIntervalId,
    pacerProgressIntervalId, bidStatsIntervalId, cleanupStaleLocksIntervalId];
  for (const id of intervals) {
    try { clearInterval(id); } catch {}
  }
  try { if (heartbeatIntervalId !== null) clearInterval(heartbeatIntervalId); } catch {}
  try { if (reconnectTimeoutId !== null) clearTimeout(reconnectTimeoutId); } catch {}

  // B5: Close WebSocket cleanly before exit
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {}
  }

  // Stop HTTP stats server
  try { await stopStatsServer(); } catch {}

  Logger.printStats();
  bidHistoryDirtyTracker.cancelPendingDebounce();
  await writeBidHistoryToFile(true);
  process.exit(0);
}

process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });

// Global error handlers to prevent silent crashes
process.on('uncaughtException', async (error) => {
  Logger.error('[CRITICAL] Uncaught exception:', error);
  Logger.printStats();
  bidHistoryDirtyTracker.cancelPendingDebounce();
  await writeBidHistoryToFile(true);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  Logger.error('[CRITICAL] Unhandled rejection:', reason);
  // Don't exit on unhandled rejection - log and continue
  // This prevents crashes from non-critical async errors
});

async function cancelBid(offer: IOffer, privateKey: string, collectionSymbol?: string, tokenId?: string, buyerPaymentAddress?: string): Promise<boolean> {
  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id)
    if (!offerFormat) {
      Logger.warning(`[CANCEL] No cancel format returned for offer ${offer.id}`);
      return false;
    }
    const signedOfferFormat = signData(offerFormat, privateKey)
    const result = await submitCancelOfferData(offer.id, signedOfferFormat)
    return result === true;
  } catch (error: unknown) {
    Logger.error(`[CANCEL] Failed to cancel bid ${offer.id}`, getErrorMessage(error));
    return false;
  }
}



// Use imported findTokensToCancel from bidLogic.ts
const findTokensToCancel = findTokensToCancelFromLogic;

// CollectionBottomBid interface imported from bidLogic.ts
interface LocalCollectionBottomBid {
  tokenId: string;
  collectionSymbol: string
}

interface PlaceBidResult {
  success: boolean;
  reason?: string;
  paymentAddress?: string;
  walletLabel?: string;
}

/**
 * Place a bid with optional wallet rotation support
 * When wallet rotation is enabled, this function will:
 * 1. Get an available wallet from the pool
 * 2. Place the bid using that wallet's credentials
 * 3. Record the bid for rate limiting
 *
 * @param collectionConfig - The collection configuration (for fallback credentials)
 * @param tokenId - Token to bid on
 * @param offerPrice - Bid price in satoshis
 * @param expiration - Bid expiration timestamp
 * @param fallbackReceiveAddress - Fallback receive address if not using rotation
 * @param fallbackPaymentAddress - Fallback payment address if not using rotation
 * @param fallbackPublicKey - Fallback public key if not using rotation
 * @param fallbackPrivateKey - Fallback private key if not using rotation
 */
async function placeBidWithRotation(
  collectionConfig: CollectionData | null,
  tokenId: string,
  offerPrice: number,
  expiration: number,
  fallbackReceiveAddress: string,
  fallbackPaymentAddress: string,
  fallbackPublicKey: string,
  fallbackPrivateKey: string,
  sellerReceiveAddress?: string,
  maxAllowedPrice?: number  // Safety cap - last line of defense against overbidding
): Promise<PlaceBidResult> {
  let buyerTokenReceiveAddress = fallbackReceiveAddress;
  let buyerPaymentAddress = fallbackPaymentAddress;
  let publicKey = fallbackPublicKey;
  let privateKey = fallbackPrivateKey;
  let walletLabel: string | undefined;
  // Track whether we acquired a wallet from the pool (for slot cleanup on failure)
  let usingWalletPool = false;

  // Priority 1: Use wallet group manager if enabled and collection has walletGroup assigned
  if (ENABLE_WALLET_ROTATION && isWalletGroupManagerInitialized() && collectionConfig?.walletGroup) {
    const manager = getWalletGroupManager();
    const groupName = collectionConfig.walletGroup;

    if (manager.hasGroup(groupName)) {
      const wallet = await manager.waitForAvailableWallet(groupName, BOT_CONSTANTS.WALLET_WAIT_MAX_MS);
      if (!wallet) {
        Logger.wallet.allRateLimited(tokenId);
        return { success: false, reason: 'wallet_exhausted' };
      }

      buyerTokenReceiveAddress = CENTRALIZE_RECEIVE_ADDRESS
        ? fallbackReceiveAddress
        : wallet.config.receiveAddress;
      buyerPaymentAddress = wallet.paymentAddress;
      publicKey = wallet.publicKey;
      privateKey = wallet.config.wif;
      walletLabel = wallet.config.label;
      usingWalletPool = true;

      Logger.wallet.using(walletLabel || 'unnamed', tokenId);
    }
  }
  // Priority 2: Legacy single wallet pool (backward compatibility)
  // Wait for an available wallet (retries with sleep instead of skipping)
  else if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = await waitForAvailableWallet(BOT_CONSTANTS.WALLET_WAIT_MAX_MS);
    if (!wallet) {
      Logger.wallet.allRateLimited(tokenId);
      return { success: false, reason: 'wallet_exhausted' };
    }

    // Use central receive address if enabled, otherwise use wallet's receive address
    buyerTokenReceiveAddress = CENTRALIZE_RECEIVE_ADDRESS
      ? fallbackReceiveAddress  // Uses TOKEN_RECEIVE_ADDRESS
      : wallet.config.receiveAddress;
    buyerPaymentAddress = wallet.paymentAddress;
    publicKey = wallet.publicKey;
    privateKey = wallet.config.wif;
    walletLabel = wallet.config.label;
    usingWalletPool = true;  // Mark that we acquired a wallet slot

    Logger.wallet.using(walletLabel || 'unnamed', tokenId);
    // Note: getAvailableWalletAsync already increments bid count atomically
    // so we don't need to call recordSuccessfulBid separately
  }

  // M4: Validate offer price before proceeding to API call
  if (offerPrice <= 0) {
    Logger.warning(`[BID] Rejected zero/negative offer price (${offerPrice}) for ${tokenId.slice(-8)}`);
    return { success: false, reason: 'invalid_price' };
  }
  if (maxAllowedPrice && offerPrice > maxAllowedPrice) {
    Logger.warning(`[BID] Rejected offer price ${offerPrice} exceeding max ${maxAllowedPrice} for ${tokenId.slice(-8)}`);
    return { success: false, reason: 'price_exceeds_max' };
  }

  // Enforce global minimum interval between ALL bids (regardless of wallet rotation)
  // This prevents API rate limits since Magic Eden limits ~5 bids/min per API key, not per wallet
  await waitForGlobalBidSlot();

  try {
    // Only use per-wallet pacer if wallet rotation is disabled
    // When wallet rotation is enabled, the wallet pool/group handles per-wallet rate limiting
    if (!ENABLE_WALLET_ROTATION || (!isWalletPoolInitialized() && !isWalletGroupManagerInitialized())) {
      await waitForBidSlot();
    }

    const success = await placeBid(
      tokenId,
      offerPrice,
      expiration,
      buyerTokenReceiveAddress,
      buyerPaymentAddress,
      publicKey,
      privateKey,
      sellerReceiveAddress,
      maxAllowedPrice
    );

    if (success) {
      // Always record to global pacer so manage console shows accurate stats
      recordPacerBid();
    } else {
      // Bid failed - decrement the pre-incremented wallet bid count to recover the slot
      // This prevents "lost" bid slots when bids fail after wallet reservation
      if (usingWalletPool) {
        // Try wallet groups first, then legacy pool
        if (isWalletGroupManagerInitialized() && collectionConfig?.walletGroup) {
          const manager = getWalletGroupManager();
          const walletInfo = manager.getWalletByPaymentAddress(buyerPaymentAddress);
          if (walletInfo) {
            manager.decrementBidCount(walletInfo.groupName, buyerPaymentAddress);
          }
        } else {
          decrementWalletBidCount(buyerPaymentAddress);
        }
      }
    }

    return {
      success: success === true,
      reason: success ? undefined : 'bid_rejected',
      paymentAddress: success ? buyerPaymentAddress : undefined,
      walletLabel,
    };
  } catch (error: unknown) {
    // Bid failed due to exception - decrement the pre-incremented wallet bid count
    if (usingWalletPool) {
      // Try wallet groups first, then legacy pool
      if (isWalletGroupManagerInitialized() && collectionConfig?.walletGroup) {
        const manager = getWalletGroupManager();
        const walletInfo = manager.getWalletByPaymentAddress(buyerPaymentAddress);
        if (walletInfo) {
          manager.decrementBidCount(walletInfo.groupName, buyerPaymentAddress);
        }
      } else {
        decrementWalletBidCount(buyerPaymentAddress);
      }
    }

    // Check for rate limit errors - API returns "Rate limit exceeded, retry in 1 minute"
    // as a string directly in error.response.data, not in error.response.data.error
    const errorData = getErrorResponseData(error);
    const errorDataStr = typeof errorData === 'object' && errorData !== null && 'error' in errorData
      ? String((errorData as { error: unknown }).error)
      : typeof errorData === 'string' ? errorData : '';
    const errorMessage = errorDataStr || getErrorMessage(error);
    const isRateLimitError =
      getErrorStatus(error) === 429 ||
      errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('too many requests');

    if (isRateLimitError) {
      // Pass error message so pacer can extract retry duration
      onRateLimitError(errorMessage);
      Logger.pacer.error(tokenId);
    }

    return { success: false, reason: isRateLimitError ? 'rate_limit' : 'error' };
  }
}

async function placeBid(
  tokenId: string,
  offerPrice: number,
  expiration: number,
  buyerTokenReceiveAddress: string,
  buyerPaymentAddress: string,
  publicKey: string,
  privateKey: string,
  sellerReceiveAddress?: string,
  maxAllowedPrice?: number  // Safety cap - last line of defense against overbidding
) {
  try {
    const price = Math.round(offerPrice)
    // check for current offers and cancel before placing the bid
    // Note: delay removed - per-wallet rate limiting handles API safety

    // Fetch existing offers - abort on API error to prevent duplicate bids
    // When wallet rotation is enabled, query without wallet filter to find offers from ALL our wallets
    let offerData;
    try {
      offerData = await getOffers(tokenId, ENABLE_WALLET_ROTATION ? undefined : buyerTokenReceiveAddress);
    } catch (apiError: unknown) {
      const status = getErrorStatus(apiError);
      const msg = getErrorMessage(apiError);
      // Detect rate limit errors and trigger the rate limit handler before returning
      if (status === 429 || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
        onRateLimitError(msg);
        throw apiError; // Re-throw for rotation handling
      }
      Logger.warning(`[PLACEBID] ${tokenId.slice(-8)}: API error getting existing offers, aborting bid to prevent duplicates: ${msg}`);
      return false;
    }

    if (Array.isArray(offerData?.offers) && offerData.offers.length > 0) {
      // When wallet rotation is enabled, unfiltered query returns all offers — only cancel ours
      const offers = ENABLE_WALLET_ROTATION
        ? offerData.offers.filter(item => isOurPaymentAddress(item.buyerPaymentAddress))
        : offerData.offers;
      // Use Promise.allSettled to ensure all cancellations are attempted even if some fail
      const results = await Promise.allSettled(offers.map(async (item) => {
        // Use the correct wallet's private key for cancellation
        let cancelKey = privateKey;
        if (ENABLE_WALLET_ROTATION && item.buyerPaymentAddress) {
          const creds = getWalletCredentialsByPaymentAddress(item.buyerPaymentAddress);
          if (creds) {
            cancelKey = creds.privateKey;
          } else {
            Logger.warning(`[CANCEL] Cannot find credentials for wallet ${item.buyerPaymentAddress}, cancel may fail`);
          }
        }
        await cancelBid(item, cancelKey)
      }));
      // Log any failed cancellations
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          Logger.warning(`[CANCEL] Failed to cancel offer ${offers[index]?.id}: ${result.reason}`);
        }
      });
    }

    const unsignedOffer = await createOffer(tokenId, price, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, FEE_RATE_TIER, sellerReceiveAddress, maxAllowedPrice)
    const signedOffer = signData(unsignedOffer, privateKey)
    await submitSignedOfferOrder(signedOffer, tokenId, price, expiration, buyerPaymentAddress, buyerTokenReceiveAddress, publicKey, FEE_RATE_TIER, privateKey, sellerReceiveAddress)
    return true

  } catch (error: unknown) {
    Logger.error(`[PLACEBID] Token ${tokenId.slice(-8)}: ${getErrorMessage(error)}`);

    // Log more details about the error
    const responseData = getErrorResponseData(error);
    if (responseData) {
      Logger.error(`[PLACEBID] API Response:`, responseData);
    }
    const status = getErrorStatus(error);
    if (status) {
      Logger.error(`[PLACEBID] HTTP Status: ${status}`);
    }

    // Check for rate limit errors - must re-throw so placeBidWithRotation can handle
    const errorDataStr = typeof responseData === 'object' && responseData !== null && 'error' in responseData
      ? String((responseData as { error: unknown }).error)
      : typeof responseData === 'string' ? responseData : '';
    const errorMessage = errorDataStr || getErrorMessage(error);
    const isRateLimitError =
      status === 429 ||
      errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('too many requests');

    if (isRateLimitError) {
      // Re-throw rate limit errors so placeBidWithRotation() can trigger onRateLimitError()
      throw error;
    }

    // Check for "Invalid platform fee address" error - skip this token, don't retry
    if (errorMessage.toLowerCase().includes('invalid platform fee address')) {
      Logger.info(`[PLACEBID] Token ${tokenId.slice(-8)}: Invalid platform fee address - skipping`);
      return false;
    }

    // Check for specific error patterns
    if (getErrorMessage(error).includes('maximum number of offers')) {
      Logger.error(`[PLACEBID] Hit maximum offer limit!`);
    }
    if (getErrorMessage(error).includes('Insufficient funds')) {
      Logger.error(`[PLACEBID] Insufficient funds error`);
    }

    return false
  }
}

async function placeCollectionBid(
  offerPrice: number,
  expiration: number,
  collectionSymbol: string,
  buyerTokenReceiveAddress: string,
  publicKey: string,
  privateKey: string,
  feeSatsPerVbyte: number = 28,
  maxAllowedPrice?: number,  // Safety cap - last line of defense against overbidding
  balance?: number  // M3: Pass balance explicitly instead of using global
): Promise<boolean> {
  try {
    const priceSats = Math.round(offerPrice)
    const expirationAt = new Date(expiration).toISOString();

    // Validate balance is available before checking - if undefined, skip the balance check
    // (balance may not be fetched yet on first cycle, or API may have failed)
    if (balance !== undefined && offerPrice > balance) {
      Logger.warning(`Insufficient BTC to place bid for ${collectionSymbol}. Balance: ${(balance / 1e8).toFixed(8)} BTC, Required: ${(offerPrice / 1e8).toFixed(8)} BTC`);
      return false;
    }

    const unsignedCollectionOffer = await createCollectionOffer(collectionSymbol, priceSats, expirationAt, feeSatsPerVbyte, publicKey, buyerTokenReceiveAddress, privateKey, maxAllowedPrice)

    if (unsignedCollectionOffer) {
      const { signedOfferPSBTBase64, signedCancelledPSBTBase64 } = signCollectionOffer(unsignedCollectionOffer, privateKey)
      // Validate signed PSBT before submitting - signCollectionOffer can return undefined signedCancelledPSBTBase64
      if (!signedOfferPSBTBase64) {
        Logger.error(`[COLLECTION BID] Failed to sign offer for ${collectionSymbol}`);
        return false;
      }
      await submitCollectionOffer(signedOfferPSBTBase64, collectionSymbol, priceSats, expirationAt, publicKey, buyerTokenReceiveAddress, privateKey, signedCancelledPSBTBase64)
      return true;
    }
    return false;
  } catch (error: unknown) {
    Logger.error(`[COLLECTION BID] Failed to place collection bid for ${collectionSymbol}`, getErrorMessage(error));
    return false;
  }
}

// Use imported isValidJSON from bidLogic.ts
const isValidJSON = bidLogicIsValidJSON;

/**
 * Validate WebSocket message has required fields for processing.
 * Returns true if message has minimum required fields, false otherwise.
 * Used to prevent crashes on malformed or incomplete WebSocket messages.
 */
function isValidWebSocketMessage(message: unknown): message is CollectOfferActivity {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const msg = message as Record<string, unknown>;

  // Required fields for all event types
  if (typeof msg.kind !== 'string' || !msg.kind) {
    return false;
  }
  if (typeof msg.collectionSymbol !== 'string') {
    return false;
  }

  // For offer_placed, buying, and fulfillment events, tokenId is required
  const tokenEvents = ['offer_placed', 'buying_broadcasted', 'offer_accepted_broadcasted', 'coll_offer_fulfill_broadcasted'];
  if (tokenEvents.includes(msg.kind) && typeof msg.tokenId !== 'string') {
    return false;
  }

  // listedPrice can be string or number, but must exist for offer events
  if (msg.kind === 'offer_placed' || msg.kind === 'coll_offer_created') {
    if (msg.listedPrice === undefined || msg.listedPrice === null) {
      return false;
    }
    // buyerPaymentAddress is required for offer events - used for our-wallet detection
    if (typeof msg.buyerPaymentAddress !== 'string' || !msg.buyerPaymentAddress) {
      return false;
    }
  }

  return true;
}

// Use imported combineBidsAndListings from bidLogic.ts
const combineBidsAndListings = combineBidsAndListingsFromLogic;

// UserBid interface imported from bidLogic.ts
interface LocalUserBid {
  collectionSymbol: string;
  tokenId: string;
  price: number;
  expiration: string;
}

// BottomListing interface imported from bidLogic.ts

export interface CollectionData {
  collectionSymbol: string;
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  outBidMargin: number;
  bidCount: number;
  duration: number;
  enableCounterBidding: boolean;
  fundingWalletWIF?: string;
  tokenReceiveAddress?: string;
  scheduledLoop?: number;
  offerType: "ITEM" | "COLLECTION";
  feeSatsPerVbyte?: number;
  quantity: number;
  traits: Trait[];
  walletGroup?: string;  // Wallet group to use for this collection
}

interface Token {
  id: string;
  price: number;
}

export interface Trait {
  traitType: string;
  value: string;
}

interface Offer {
  collectionSymbol: string;
  tokenId: string;
  buyerPaymentAddress: string;
  price: number;
  createdAt: string;
}


interface CollectOfferActivity {
  createdAt: string;
  kind: string;
  tokenId: string;
  listedPrice: string | number;
  sellerPaymentReceiverAddress: string;
  tokenInscriptionNumber: string;
  tokenSatRarity: string;
  tokenSatBlockHeight: number;
  tokenSatBlockTime: string;
  collectionSymbol: string;
  chain: string;
  newOwner: string;
  brc20TransferAmt: null; // Change this to the appropriate type if not always null
  brc20ListedUnitPrice: null; // Change this to the appropriate type if not always null
  btcUsdPrice: number;
  oldLocation: string;
  oldOwner: string;
  buyerPaymentAddress: string;
  listedMakerFeeBp: number;
  listedTakerFeeBp: number;
  reasonForActivity: string;
}
