/**
 * BidBot Factory - Creates testable bid bot instances.
 *
 * This module extracts the initialization and orchestration logic from bid.ts
 * into a factory function that accepts options and returns a controllable bot instance.
 *
 * Key changes for testability:
 * - No module-level side effects (no code runs on import)
 * - Configuration passed via options, not process.env
 * - process.exit() replaced with thrown errors
 * - All timers/intervals tracked for cleanup
 * - WebSocket and scheduled loops can be skipped
 */

import fs from 'fs';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { Mutex } from 'async-mutex';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import PQueue from 'p-queue';
import WebSocket from 'ws';

import { getBitcoinBalance } from './utils';
import {
  ICollectionOffer,
  IOffer,
  cancelCollectionOffer,
  createCollectionOffer,
  createOffer,
  getBestCollectionOffer,
  getBestOffer,
  getOffers,
  getUserOffers,
  retrieveCancelOfferFormat,
  signCollectionOffer,
  signData,
  submitCancelOfferData,
  submitCollectionOffer,
  submitSignedOfferOrder,
} from './functions/Offer';
import { collectionDetails } from './functions/Collection';
import { retrieveTokens, ITokenData } from './functions/Tokens';
import Logger, { getBidStatsData } from './utils/logger';
import { getErrorMessage, getErrorResponseData, getErrorStatus } from './utils/errorUtils';
import {
  initializeBidPacer,
  waitForBidSlot,
  recordBid as recordPacerBid,
  onRateLimitError,
  getBidPacerStatus,
  isGloballyRateLimited,
  getGlobalResetWaitTime,
} from './utils/bidPacer';
import {
  initializeWalletPool,
  getAvailableWalletAsync,
  recordBid as recordWalletBid,
  decrementBidCount as decrementWalletBidCount,
  getWalletPoolStats,
  isWalletPoolInitialized,
  getWalletPool,
} from './utils/walletPool';
import {
  initializeWalletGroupManager,
  getWalletGroupManager,
  isWalletGroupManagerInitialized,
} from './utils/walletGroups';
import {
  calculateBidPrice,
  calculateOutbidPrice,
  CONVERSION_RATE as BID_CONVERSION_RATE,
  validateBidAgainstFloor,
  validateFloorBidRange,
  validateFloorPrice,
  hasReachedQuantityLimit,
  getEffectiveMaxFloorBid,
  isRecentBid,
  addRecentBidWithLimit,
  cleanupRecentBidsMap,
  isLockStale,
  createBidHistoryEntry,
  cleanupExpiredBids,
  limitBidsPerCollection,
  limitBottomListings,
  isBidExpired,
  findTokensToCancel as findTokensToCancelFromLogic,
  combineBidsAndListings as combineBidsAndListingsFromLogic,
  getPurchaseEventKey as createPurchaseEventKey,
  markPurchaseEventWithLimit,
  isValidJSON as bidLogicIsValidJSON,
  isValidWebSocketMessage as validateWSMessage,
  isWatchedEvent,
  WATCHED_EVENTS,
  validateCollectionConfig,
  getUniqueBottomListings,
  sortListingsByPrice,
  type BidHistoryEntry,
  type UserBid,
  type BottomListing,
  type CollectionBottomBid,
} from './utils/bidLogic';

import type {
  BotOptions,
  BotState,
  BotStats,
  BotTimers,
  BidBot,
  BidHistory,
  CollectionConfig,
  PlaceBidResult,
  CollectOfferActivity,
  BotLogger,
} from './types/BotTypes';

import {
  BotValidationError,
  BotConfigError,
  BotInitError,
} from './types/BotTypes';

import type { Trait } from './utils/traits.utils';

// Re-export types for consumers
export type {
  BotOptions,
  BotState,
  BotStats,
  BidBot,
  BidHistory,
  CollectionConfig,
  PlaceBidResult,
};
export { BotValidationError, BotConfigError, BotInitError };

// Constants
const CONVERSION_RATE = 100000000;
const DEFAULT_OFFER_EXPIRATION = 30;
const FEE_RATE_TIER = 'halfHourFee';
const network = bitcoin.networks.bitcoin;

// Initialize ECPair
const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

/**
 * Default options for createBidBot.
 */
const DEFAULT_OPTIONS: Partial<BotOptions> = {
  collectionsPath: './config/collections.json',
  walletConfigPath: './config/wallets.json',
  bidHistoryPath: './data/bidHistory.json',
  botStatsPath: './data/botStats.json',
  enableWalletRotation: false,
  bidsPerMinute: 5,
  httpRateLimit: 32,
  defaultOutbidMargin: 0.00001,
  defaultLoop: 30,
  skipOverlappingCycles: true,
  centralizeReceiveAddress: false,
  dryRun: false,
  skipWebSocket: false,
  skipScheduledLoop: false,
};

/**
 * Safe wrapper for ECPair.fromWIF() that throws a descriptive error on failure.
 */
function safeECPairFromWIF(
  wif: string,
  networkParam: typeof network,
  context: string = 'unknown'
): ReturnType<ECPairAPI['fromWIF']> {
  if (!wif || typeof wif !== 'string') {
    throw new BotConfigError(`[${context}] Invalid WIF: WIF is empty or not a string`);
  }
  try {
    return ECPair.fromWIF(wif, networkParam);
  } catch (error: any) {
    throw new BotConfigError(
      `[${context}] Invalid WIF format: ${getErrorMessage(error)}. Check your FUNDING_WIF or fundingWalletWIF configuration.`
    );
  }
}

/**
 * Load and validate collections from a JSON file.
 * @throws BotValidationError if file is missing or invalid
 * @throws BotConfigError if JSON is malformed
 */
export function loadCollections(filePath: string): CollectionConfig[] {
  if (!fs.existsSync(filePath)) {
    throw new BotConfigError(
      `Config file not found: ${filePath}. Copy config/collections.example.json to config/collections.json and configure your collections`
    );
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (parseError: any) {
    throw new BotConfigError(`Invalid JSON in collections.json: ${parseError?.message || parseError}`);
  }

  if (!Array.isArray(parsed)) {
    throw new BotValidationError('collections.json must be an array of collection configurations');
  }

  const validatedCollections: CollectionConfig[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    const errors: string[] = [];

    if (typeof item !== 'object' || item === null) {
      throw new BotValidationError(`Collection at index ${i} is not a valid object`);
    }

    // Required fields validation
    if (!item.collectionSymbol || typeof item.collectionSymbol !== 'string') {
      errors.push('collectionSymbol (string) is required');
    }
    if (typeof item.minBid !== 'number' || item.minBid < 0) {
      errors.push('minBid (non-negative number) is required');
    }
    if (typeof item.maxBid !== 'number' || item.maxBid < 0) {
      errors.push('maxBid (non-negative number) is required');
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
    if (
      typeof item.minFloorBid === 'number' &&
      typeof item.maxFloorBid === 'number' &&
      item.minFloorBid > item.maxFloorBid
    ) {
      errors.push(`minFloorBid (${item.minFloorBid}%) cannot be greater than maxFloorBid (${item.maxFloorBid}%)`);
    }
    if (item.bidCount !== undefined && (typeof item.bidCount !== 'number' || item.bidCount <= 0)) {
      errors.push('bidCount must be a positive number');
    }

    if (errors.length > 0) {
      throw new BotValidationError(
        `Invalid configuration for collection "${item.collectionSymbol || `index ${i}`}": ${errors.join('; ')}`
      );
    }

    validatedCollections.push(item as CollectionConfig);
  }

  return validatedCollections;
}

/**
 * Load bid history from file for crash recovery.
 */
export function loadBidHistoryFromFile(
  filePath: string,
  collections: CollectionConfig[]
): BidHistory {
  const bidHistory: BidHistory = {};

  try {
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      let savedHistory: Record<string, { quantity?: number }>;
      try {
        savedHistory = JSON.parse(fileContent);
      } catch {
        Logger.warning('[STARTUP] Corrupted bidHistory.json, starting fresh');
        return bidHistory;
      }

      const activeCollectionSymbols = new Set(collections.map((c) => c.collectionSymbol));

      for (const collectionSymbol in savedHistory) {
        if (activeCollectionSymbols.has(collectionSymbol)) {
          const savedQuantity = savedHistory[collectionSymbol]?.quantity;
          if (typeof savedQuantity === 'number' && savedQuantity > 0) {
            const matchedCollection = collections.find((c) => c.collectionSymbol === collectionSymbol);
            bidHistory[collectionSymbol] = {
              offerType: matchedCollection?.offerType ?? 'ITEM',
              ourBids: {},
              topBids: {},
              bottomListings: [],
              lastSeenActivity: null,
              quantity: savedQuantity,
            };
            Logger.info(`[STARTUP] Restored quantity for ${collectionSymbol}: ${savedQuantity}`);
          }
        }
      }
    }
  } catch (error: any) {
    Logger.warning(`[STARTUP] Could not load bid history: ${getErrorMessage(error)}`);
  }

  return bidHistory;
}

/**
 * Initialize bidHistory entry for a collection if it doesn't exist.
 */
function initBidHistory(
  bidHistory: BidHistory,
  collectionSymbol: string,
  offerType: 'ITEM' | 'COLLECTION'
): void {
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

/**
 * Create initial bot state.
 */
function createBotState(): BotState {
  return {
    bidHistory: {},
    recentBids: new Map(),
    processedPurchaseEvents: new Map(),
    processingTokens: {},
    processingTokenTimestamps: {},
    processingTokenWaiters: {},
    quantityLockState: {},
    balance: undefined,
    restart: true,
    lastRehydrationTime: 0,
  };
}

/**
 * Create a BidBot instance with the given options.
 * This is the main factory function that replaces the module-level initialization in bid.ts.
 *
 * @param options - Configuration options for the bot
 * @returns A BidBot instance
 * @throws BotConfigError if required configuration is missing
 * @throws BotValidationError if configuration is invalid
 */
export async function createBidBot(options: BotOptions = {}): Promise<BidBot> {
  // Merge with defaults
  const config = { ...DEFAULT_OPTIONS, ...options };

  // Validate required configuration
  if (!config.dryRun) {
    if (!config.tokenReceiveAddress) {
      throw new BotConfigError('tokenReceiveAddress is required (set TOKEN_RECEIVE_ADDRESS env var or pass in options)');
    }
    if (!config.fundingWIF) {
      throw new BotConfigError('fundingWIF is required (set FUNDING_WIF env var or pass in options)');
    }
    if (!config.apiKey) {
      throw new BotConfigError('apiKey is required (set API_KEY env var or pass in options)');
    }
  }

  // Load collections (from options or file)
  let collections: CollectionConfig[];
  if (config.collections) {
    collections = config.collections;
  } else {
    const collectionsPath = path.resolve(config.collectionsPath!);
    collections = loadCollections(collectionsPath);
  }

  if (collections.length === 0) {
    Logger.warning('[STARTUP] No collections configured - bot will have nothing to monitor');
  }

  // Ensure data directory exists
  const dataDir = path.dirname(path.resolve(config.bidHistoryPath!));
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Initialize state
  const state = createBotState();

  // Load persisted bid history
  const bidHistoryPath = path.resolve(config.bidHistoryPath!);
  if (fs.existsSync(bidHistoryPath)) {
    state.bidHistory = loadBidHistoryFromFile(bidHistoryPath, collections);
  }

  // Initialize bid pacer
  initializeBidPacer(config.bidsPerMinute!);
  Logger.info(`[BID PACER] Initialized with ${config.bidsPerMinute} bids/minute limit`);

  // Initialize wallet rotation if enabled
  if (config.enableWalletRotation && !config.dryRun) {
    const walletConfigPath = path.resolve(config.walletConfigPath!);
    if (fs.existsSync(walletConfigPath)) {
      try {
        const walletConfig = JSON.parse(fs.readFileSync(walletConfigPath, 'utf-8'));

        if (walletConfig.groups && typeof walletConfig.groups === 'object') {
          const manager = initializeWalletGroupManager(walletConfig, network);
          const groupNames = manager.getGroupNames();
          const totalWallets = manager.getTotalWalletCount();
          Logger.success(`[WALLET GROUPS] Initialized ${groupNames.length} group(s) with ${totalWallets} wallets`);

          // Validate collections have walletGroup assigned
          const collectionsWithoutGroup = collections.filter((c) => !c.walletGroup);
          if (collectionsWithoutGroup.length > 0) {
            throw new BotValidationError(
              `${collectionsWithoutGroup.length} collection(s) missing walletGroup assignment: ${collectionsWithoutGroup.map((c) => c.collectionSymbol).join(', ')}`
            );
          }

          // Validate all assigned walletGroups exist
          const validGroups = new Set(groupNames);
          const invalidAssignments = collections.filter((c) => c.walletGroup && !validGroups.has(c.walletGroup));
          if (invalidAssignments.length > 0) {
            throw new BotValidationError(
              `${invalidAssignments.length} collection(s) assigned to non-existent groups: ${invalidAssignments.map((c) => `${c.collectionSymbol} → "${c.walletGroup}"`).join(', ')}`
            );
          }
        } else if (walletConfig.wallets && walletConfig.wallets.length > 0) {
          initializeWalletPool(walletConfig.wallets, walletConfig.bidsPerMinute || 5, network);
          Logger.success(`[WALLET ROTATION] Initialized pool with ${walletConfig.wallets.length} wallets (legacy mode)`);
        }
      } catch (error: any) {
        if (error instanceof BotValidationError) {
          throw error;
        }
        Logger.warning(`[WALLET GROUPS] Failed to initialize: ${error.message}`);
      }
    } else {
      Logger.warning(`[WALLET GROUPS] Config file not found at ${walletConfigPath}`);
    }
  }

  // Create the bid queue
  const queue = new PQueue({ concurrency: 1 });

  // Timer handles for cleanup
  const timers: BotTimers = {};

  // WebSocket state
  let ws: WebSocket | null = null;
  let retryCount = 0;
  const MAX_RETRIES = 5;
  const RECONNECT_COOLDOWN_MS = 5 * 60 * 1000;

  // File write mutex
  const fileWriteMutex = new Mutex();

  // Track bot start time
  const BOT_START_TIME = Date.now();

  // Running state
  let isRunning = false;
  let monitoringPromises: Promise<void>[] = [];

  // EventManager for WebSocket events
  class EventManager {
    queue: CollectOfferActivity[] = [];
    isScheduledRunning = false;
    isProcessingQueue = false;
    private readonly MAX_QUEUE_SIZE = 1000;
    private droppedEventsCount = 0;

    async receiveWebSocketEvent(event: CollectOfferActivity): Promise<void> {
      if (this.queue.length >= this.MAX_QUEUE_SIZE) {
        const dropped = this.queue.shift();
        this.droppedEventsCount++;
        Logger.warning(`[EVENT QUEUE] Dropped event #${this.droppedEventsCount} - queue full`);
      }
      this.queue.push(event);
      this.processQueue().catch((err) => Logger.error('[EVENT QUEUE] Queue processing error', err));
    }

    async processQueue(): Promise<void> {
      if (!this.isProcessingQueue && this.queue.length > 0) {
        this.isProcessingQueue = true;
        try {
          while (this.queue.length > 0) {
            while (this.isScheduledRunning) {
              await delay(500);
            }
            const event = this.queue.shift();
            if (event) {
              try {
                await this.handleIncomingBid(event);
              } catch (err: any) {
                Logger.error(`[EVENT QUEUE] Error processing event`, err?.message || err);
              }
            }
          }
        } finally {
          this.isProcessingQueue = false;
        }
      }
    }

    async handleIncomingBid(message: CollectOfferActivity): Promise<void> {
      // Simplified handler - delegates to the main bid handling logic
      // Full implementation would mirror bid.ts handleIncomingBid
      const { collectionSymbol, tokenId } = message;
      const collection = collections.find((item) => item.collectionSymbol === collectionSymbol);
      if (!collection) return;

      initBidHistory(state.bidHistory, collectionSymbol, collection.offerType);

      // For now, just log the event (full implementation would handle counter-bidding)
      if (config.dryRun) {
        Logger.info(`[DRY RUN] Would handle ${message.kind} for ${collectionSymbol}/${tokenId?.slice(-8)}`);
        return;
      }

      // TODO: Full counter-bidding logic from bid.ts handleIncomingBid
    }

    async runScheduledTask(item: CollectionConfig): Promise<void> {
      while (this.isProcessingQueue) {
        await delay(100);
      }
      this.isScheduledRunning = true;
      try {
        await this.processScheduledLoop(item);
      } finally {
        this.isScheduledRunning = false;
      }
    }

    async processScheduledLoop(item: CollectionConfig): Promise<void> {
      const startTime = Date.now();
      Logger.scheduleStart(item.collectionSymbol);

      const collectionSymbol = item.collectionSymbol;
      initBidHistory(state.bidHistory, collectionSymbol, item.offerType);

      const maxBuy = item.quantity ?? 1;
      const quantity = state.bidHistory[collectionSymbol]?.quantity ?? 0;
      if (quantity === maxBuy) {
        Logger.info(`[SCHEDULE] ${collectionSymbol}: Reached quantity limit (${quantity}/${maxBuy})`);
        return;
      }

      if (config.dryRun) {
        Logger.info(`[DRY RUN] Would process scheduled loop for ${collectionSymbol}`);
        const duration = (Date.now() - startTime) / 1000;
        Logger.scheduleComplete(collectionSymbol, duration);
        return;
      }

      // TODO: Full scheduled loop logic from bid.ts processScheduledLoop
      const duration = (Date.now() - startTime) / 1000;
      Logger.scheduleComplete(collectionSymbol, duration);
      state.restart = false;
    }
  }

  const eventManager = new EventManager();

  // Helper functions
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function writeBidHistoryToFile(): Promise<void> {
    const release = await fileWriteMutex.acquire();
    try {
      const jsonString = JSON.stringify(state.bidHistory, null, 2);
      const filePath = path.resolve(config.bidHistoryPath!);
      const tempPath = filePath + '.tmp';
      await fs.promises.writeFile(tempPath, jsonString, 'utf-8');
      await fs.promises.rename(tempPath, filePath);
    } catch (err) {
      Logger.error('[PERSIST] Error writing bidHistory to file', err);
    } finally {
      release();
    }
  }

  function writeBotStatsToFile(): void {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const bidStatsData = getBidStatsData();
    const pacerStatus = getBidPacerStatus();

    let totalBidsTracked = 0;
    for (const collectionSymbol in state.bidHistory) {
      totalBidsTracked += Object.keys(state.bidHistory[collectionSymbol]?.ourBids || {}).length;
    }

    const stats = {
      timestamp: Date.now(),
      runtime: {
        startTime: BOT_START_TIME,
        uptimeSeconds: Math.floor((Date.now() - BOT_START_TIME) / 1000),
      },
      bidStats: {
        bidsPlaced: bidStatsData.bidsPlaced,
        bidsSkipped: bidStatsData.bidsSkipped,
        bidsCancelled: bidStatsData.bidsCancelled,
        bidsAdjusted: bidStatsData.bidsAdjusted,
        errors: bidStatsData.errors,
      },
      pacer: {
        ...pacerStatus,
        bidsPerMinute: config.bidsPerMinute,
      },
      queue: {
        size: eventManager.queue.length,
        pending: queue.size,
        active: queue.pending,
      },
      memory: {
        heapUsedMB: Math.round(heapUsedMB * 100) / 100,
        heapTotalMB: Math.round(heapTotalMB * 100) / 100,
        percentage: Math.round((heapUsedMB / heapTotalMB) * 100),
      },
      websocket: {
        connected: ws !== null && ws.readyState === WebSocket.OPEN,
      },
      bidsTracked: totalBidsTracked,
    };

    const filePath = path.resolve(config.botStatsPath!);
    const tempPath = filePath + '.tmp';

    fileWriteMutex
      .acquire()
      .then(async (release) => {
        try {
          await fs.promises.writeFile(tempPath, JSON.stringify(stats, null, 2), 'utf-8');
          await fs.promises.rename(tempPath, filePath);
        } catch (err) {
          Logger.error('[PERSIST] Error writing botStats to file', err);
        } finally {
          release();
        }
      })
      .catch((err) => {
        Logger.error('[PERSIST] Failed to acquire file write lock', err);
      });
  }

  // WebSocket functions
  function connectWebSocket(): void {
    if (config.skipWebSocket || config.dryRun) {
      Logger.info('[WEBSOCKET] Skipped (dry run or disabled)');
      return;
    }

    const baseEndpoint =
      'wss://wss-mainnet.magiceden.io/CJMw7IPrGPUb13adEQYW2ASbR%2FIWToagGUCr02hWp1oWyLAtf5CS0XF69WNXj0MbO6LEQLrFQMQoEqlX7%2Fny2BP08wjFc9MxzEmM5v2c5huTa3R1DPqGSbuO2TXKEEneIc4FMEm5ZJruhU8y4cyfIDzGqhWDhxK3iRnXtYzI0FGG1%2BMKyx9WWOpp3lLA3Gm2BgNpHHp3wFEas5TqVdJn0GtBrptg8ZEveG8c44CGqfWtEsS0iI8LZDR7tbrZ9fZpbrngDaimEYEH6MgvhWPTlKrsGw%3D%3D';

    // Clean up existing WebSocket
    if (ws) {
      try {
        ws.removeAllListeners();
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch (err: any) {
        Logger.warning('[WEBSOCKET] Error cleaning up old WebSocket:', err?.message || err);
      }
    }

    ws = new WebSocket(baseEndpoint);

    ws.on('message', function incoming(data: string) {
      try {
        const dataStr = data.toString();
        if (!bidLogicIsValidJSON(dataStr)) {
          return;
        }
        const parsed = JSON.parse(dataStr);
        if (!isValidWebSocketMessage(parsed)) {
          return;
        }
        eventManager.receiveWebSocketEvent(parsed);
      } catch (error: unknown) {
        Logger.error('[WEBSOCKET] Error processing message', getErrorMessage(error));
      }
    });

    ws.addEventListener('open', function open() {
      Logger.websocket.connected();
      retryCount = 0;

      if (timers.reconnectTimeout) {
        clearTimeout(timers.reconnectTimeout);
        timers.reconnectTimeout = undefined;
      }
      if (timers.heartbeatInterval) {
        clearInterval(timers.heartbeatInterval);
        timers.heartbeatInterval = undefined;
      }

      timers.heartbeatInterval = setInterval(() => {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                topic: 'nfttools',
                event: 'heartbeat',
                payload: {},
                ref: 0,
              })
            );
          } else if (timers.heartbeatInterval) {
            clearInterval(timers.heartbeatInterval);
            timers.heartbeatInterval = undefined;
          }
        } catch (err) {
          Logger.warning('[WEBSOCKET] Heartbeat send failed:', err);
          if (timers.heartbeatInterval) {
            clearInterval(timers.heartbeatInterval);
            timers.heartbeatInterval = undefined;
          }
        }
      }, 10000);

      // Subscribe to collections with counter-bidding enabled
      collections
        .filter((c) => c.enableCounterBidding)
        .forEach((item) => {
          try {
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'subscribeCollection',
                  constraint: {
                    chain: 'bitcoin',
                    collectionSymbol: item.collectionSymbol,
                  },
                })
              );
              Logger.websocket.subscribed(item.collectionSymbol);
            }
          } catch (err) {
            Logger.warning(`[WEBSOCKET] Failed to subscribe to ${item.collectionSymbol}:`, err);
          }
        });
    });

    ws.addEventListener('close', function close() {
      Logger.websocket.disconnected();
      if (timers.heartbeatInterval) {
        clearInterval(timers.heartbeatInterval);
        timers.heartbeatInterval = undefined;
      }
      if (isRunning) {
        attemptReconnect();
      }
    });

    ws.addEventListener('error', function error(err) {
      Logger.websocket.error(err);
      if (ws) {
        ws.close();
      }
    });
  }

  function attemptReconnect(): void {
    if (retryCount < MAX_RETRIES) {
      if (timers.reconnectTimeout) {
        clearTimeout(timers.reconnectTimeout);
      }
      const delayMs = Math.pow(2, retryCount) * 1000;
      Logger.info(`[WEBSOCKET] Attempting to reconnect in ${delayMs / 1000} seconds...`);
      timers.reconnectTimeout = setTimeout(connectWebSocket, delayMs);
      retryCount++;
    } else {
      Logger.websocket.maxRetriesExceeded();
      Logger.warning(`[WEBSOCKET] Waiting ${RECONNECT_COOLDOWN_MS / 60000} minutes before retrying...`);
      if (timers.reconnectTimeout) {
        clearTimeout(timers.reconnectTimeout);
      }
      timers.reconnectTimeout = setTimeout(() => {
        Logger.info('[WEBSOCKET] Cooldown complete, resetting retry count...');
        retryCount = 0;
        attemptReconnect();
      }, RECONNECT_COOLDOWN_MS);
    }
  }

  function isValidWebSocketMessage(message: unknown): message is CollectOfferActivity {
    if (!message || typeof message !== 'object') {
      return false;
    }
    const msg = message as Record<string, unknown>;
    if (typeof msg.kind !== 'string' || !msg.kind) {
      return false;
    }
    if (typeof msg.collectionSymbol !== 'string') {
      return false;
    }
    const tokenEvents = ['offer_placed', 'buying_broadcasted', 'offer_accepted_broadcasted'];
    if (tokenEvents.includes(msg.kind) && typeof msg.tokenId !== 'string') {
      return false;
    }
    if (msg.kind === 'offer_placed' || msg.kind === 'coll_offer_created') {
      if (msg.listedPrice === undefined || msg.listedPrice === null) {
        return false;
      }
      if (typeof msg.buyerPaymentAddress !== 'string' || !msg.buyerPaymentAddress) {
        return false;
      }
    }
    return true;
  }

  // Collection monitoring
  async function startCollectionMonitoring(item: CollectionConfig): Promise<void> {
    const loop = (item.scheduledLoop || config.defaultLoop!) * 1000;
    while (isRunning) {
      try {
        if (isGloballyRateLimited()) {
          const waitMs = getGlobalResetWaitTime();
          Logger.schedule.skipping(item.collectionSymbol, Math.ceil(waitMs / 1000));
          await delay(Math.min(waitMs + 1000, loop));
          continue;
        }
        await eventManager.runScheduledTask(item);
        await delay(loop);
      } catch (error) {
        Logger.error(`[SCHEDULE] Collection monitoring failed for ${item.collectionSymbol}`, error);
        await delay(loop);
      }
    }
  }

  // Start all intervals
  function startIntervals(): void {
    // Bot stats every 30s
    timers.botStatsInterval = setInterval(() => {
      try {
        writeBotStatsToFile();
      } catch (err) {
        Logger.error('[INTERVAL] writeBotStatsToFile failed:', err);
      }
    }, 30000);

    // Bid history every 5 minutes
    timers.bidHistoryInterval = setInterval(() => {
      try {
        writeBidHistoryToFile();
      } catch (err) {
        Logger.error('[INTERVAL] writeBidHistoryToFile failed:', err);
      }
    }, 5 * 60 * 1000);

    // Memory monitoring every 5 minutes
    timers.memoryMonitorInterval = setInterval(() => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
      let totalBidsTracked = 0;
      for (const collectionSymbol in state.bidHistory) {
        totalBidsTracked += Object.keys(state.bidHistory[collectionSymbol]?.ourBids || {}).length;
      }
      Logger.memory.status(heapUsedMB, heapTotalMB, eventManager.queue.length, totalBidsTracked);
    }, 5 * 60 * 1000);

    // Initial writes
    setTimeout(() => writeBotStatsToFile(), 5000);
    setTimeout(() => {
      const memUsage = process.memoryUsage();
      Logger.memory.status(
        memUsage.heapUsed / 1024 / 1024,
        memUsage.heapTotal / 1024 / 1024,
        eventManager.queue.length,
        0
      );
    }, 60000);
  }

  // Clear all intervals
  function clearAllIntervals(): void {
    for (const key of Object.keys(timers) as (keyof BotTimers)[]) {
      const timer = timers[key];
      if (timer) {
        if (key.includes('Timeout')) {
          clearTimeout(timer);
        } else {
          clearInterval(timer);
        }
        timers[key] = undefined;
      }
    }
  }

  // Return the BidBot interface
  const bot: BidBot = {
    async start(): Promise<void> {
      if (isRunning) {
        Logger.warning('[BOT] Already running');
        return;
      }
      isRunning = true;

      // Connect WebSocket
      connectWebSocket();

      // Start intervals
      startIntervals();

      // Start scheduled monitoring if not skipped
      if (!config.skipScheduledLoop) {
        monitoringPromises = collections.map((item) => startCollectionMonitoring(item));
      }

      Logger.success('[BOT] Started successfully');
    },

    async stop(): Promise<void> {
      if (!isRunning) {
        Logger.warning('[BOT] Already stopped');
        return;
      }
      isRunning = false;

      Logger.info('[BOT] Stopping...');

      // Clear all intervals
      clearAllIntervals();

      // Close WebSocket
      if (ws) {
        try {
          ws.removeAllListeners();
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch (err) {
          Logger.warning('[BOT] Error closing WebSocket:', err);
        }
        ws = null;
      }

      // Persist state
      Logger.printStats();
      await writeBidHistoryToFile();

      Logger.success('[BOT] Stopped successfully');
    },

    async placeBid(collectionSymbol: string, tokenId: string, price: number): Promise<PlaceBidResult> {
      if (config.dryRun) {
        Logger.info(`[DRY RUN] Would place bid: ${collectionSymbol}/${tokenId} @ ${price}`);
        return { success: true };
      }

      // TODO: Implement full bid placement logic
      return { success: false, error: 'Not implemented' };
    },

    async cancelBid(offerId: string): Promise<boolean> {
      if (config.dryRun) {
        Logger.info(`[DRY RUN] Would cancel bid: ${offerId}`);
        return true;
      }

      // TODO: Implement full bid cancellation logic
      return false;
    },

    getStats(): BotStats {
      const memUsage = process.memoryUsage();
      const bidStatsData = getBidStatsData();

      let totalBidsTracked = 0;
      for (const collectionSymbol in state.bidHistory) {
        totalBidsTracked += Object.keys(state.bidHistory[collectionSymbol]?.ourBids || {}).length;
      }

      return {
        startTime: BOT_START_TIME,
        uptimeSeconds: Math.floor((Date.now() - BOT_START_TIME) / 1000),
        bidsPlaced: bidStatsData.bidsPlaced,
        bidsSkipped: bidStatsData.bidsSkipped,
        bidsCancelled: bidStatsData.bidsCancelled,
        bidsAdjusted: bidStatsData.bidsAdjusted,
        errors: bidStatsData.errors,
        collectionsCount: collections.length,
        activeBidsCount: totalBidsTracked,
        websocketConnected: ws !== null && ws.readyState === WebSocket.OPEN,
        memoryUsedMB: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
        eventQueueSize: eventManager.queue.length,
      };
    },

    getState(): BotState {
      return state;
    },

    getCollections(): CollectionConfig[] {
      return collections;
    },

    isRunning(): boolean {
      return isRunning;
    },
  };

  return bot;
}
