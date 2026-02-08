/**
 * Type definitions for the BidBot factory pattern.
 * These types enable testability by allowing dependency injection
 * and providing clean interfaces for the bot's core functionality.
 */

import type { Trait } from '../utils/traits.utils';

/**
 * Options for creating a BidBot instance.
 * All paths and configuration can be overridden for testing.
 */
export interface BotOptions {
  /** Path to collections.json config file */
  collectionsPath?: string;
  /** Path to wallets.json config file */
  walletConfigPath?: string;
  /** Path to bid history persistence file */
  bidHistoryPath?: string;
  /** Path to bot stats persistence file */
  botStatsPath?: string;
  /** Enable multi-wallet rotation */
  enableWalletRotation?: boolean;
  /** Rate limit for bids per minute */
  bidsPerMinute?: number;
  /** Default ordinals delivery address */
  tokenReceiveAddress?: string;
  /** Private key (WIF) for funding wallet */
  fundingWIF?: string;
  /** Magic Eden API key */
  apiKey?: string;
  /** HTTP request rate limit */
  httpRateLimit?: number;
  /** Default outbid margin in BTC */
  defaultOutbidMargin?: number;
  /** Default bidding loop interval in seconds */
  defaultLoop?: number;
  /** Skip overlapping cycles when rate limited */
  skipOverlappingCycles?: boolean;
  /** Centralize receive address for all wallets */
  centralizeReceiveAddress?: boolean;
  /** Dry run mode - don't make actual API calls */
  dryRun?: boolean;
  /** Skip WebSocket connection */
  skipWebSocket?: boolean;
  /** Skip scheduled bidding loop */
  skipScheduledLoop?: boolean;
  /** Pre-loaded collections (bypasses file loading) */
  collections?: CollectionConfig[];
  /** Logger instance (for testing) */
  logger?: BotLogger;
}

/**
 * Collection configuration as loaded from collections.json.
 */
export interface CollectionConfig {
  collectionSymbol: string;
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  outBidMargin?: number;
  bidCount?: number;
  duration?: number;
  enableCounterBidding?: boolean;
  fundingWalletWIF?: string;
  tokenReceiveAddress?: string;
  scheduledLoop?: number;
  offerType: 'ITEM' | 'COLLECTION';
  feeSatsPerVbyte?: number;
  quantity?: number;
  traits?: Trait[];
  walletGroup?: string;
}

/**
 * Result of a bid placement attempt.
 */
export interface PlaceBidResult {
  success: boolean;
  paymentAddress?: string;
  walletLabel?: string;
  error?: string;
}

/**
 * Bot statistics for monitoring.
 */
export interface BotStats {
  /** Bot start timestamp */
  startTime: number;
  /** Uptime in seconds */
  uptimeSeconds: number;
  /** Total bids placed */
  bidsPlaced: number;
  /** Bids skipped (various reasons) */
  bidsSkipped: number;
  /** Bids cancelled */
  bidsCancelled: number;
  /** Bids adjusted */
  bidsAdjusted: number;
  /** Errors encountered */
  errors: number;
  /** Number of collections being monitored */
  collectionsCount: number;
  /** Total active bids tracked */
  activeBidsCount: number;
  /** WebSocket connection status */
  websocketConnected: boolean;
  /** Memory usage in MB */
  memoryUsedMB: number;
  /** Event queue size */
  eventQueueSize: number;
}

/**
 * Bid pacer status for rate limiting.
 */
export interface PacerStatus {
  bidsUsed: number;
  bidsRemaining: number;
  windowResetIn: number;
  totalBidsPlaced: number;
  totalWaits: number;
}

/**
 * Internal bot state for tracking bids.
 */
export interface BotState {
  bidHistory: BidHistory;
  recentBids: Map<string, number>;
  processedPurchaseEvents: Map<string, number>;
  processingTokens: Record<string, boolean>;
  processingTokenTimestamps: Record<string, number | undefined>;
  processingTokenWaiters: Record<string, Array<(acquired: boolean) => void>>;
  quantityLockState: Record<string, { promise: Promise<void>; resolver: () => void } | undefined>;
  balance?: number;
  restart: boolean;
  lastRehydrationTime: number;
}

/**
 * Bid history for tracking our bids per collection.
 */
export interface BidHistory {
  [collectionSymbol: string]: BidHistoryEntry;
}

/**
 * Bid history entry for a single collection.
 */
export interface BidHistoryEntry {
  offerType: 'ITEM' | 'COLLECTION';
  ourBids: {
    [tokenId: string]: {
      price: number;
      expiration: number;
      paymentAddress: string;
    };
  };
  topBids: {
    [tokenId: string]: boolean;
  };
  bottomListings: {
    id: string;
    price: number;
  }[];
  lastSeenActivity: number | null | undefined;
  highestCollectionOffer?: {
    price: number;
    buyerPaymentAddress: string;
  };
  quantity: number;
}

/**
 * Timer/interval handles for cleanup.
 */
export interface BotTimers {
  botStatsInterval?: NodeJS.Timeout;
  bidHistoryInterval?: NodeJS.Timeout;
  cleanupBidHistoryInterval?: NodeJS.Timeout;
  cleanupRecentBidsInterval?: NodeJS.Timeout;
  cleanupPurchaseEventsInterval?: NodeJS.Timeout;
  cleanupStaleLocksInterval?: NodeJS.Timeout;
  memoryMonitorInterval?: NodeJS.Timeout;
  pacerProgressInterval?: NodeJS.Timeout;
  bidStatsInterval?: NodeJS.Timeout;
  heartbeatInterval?: NodeJS.Timeout;
  reconnectTimeout?: NodeJS.Timeout;
}

/**
 * Logger interface for dependency injection in tests.
 */
export interface BotLogger {
  info(message: string, ...args: unknown[]): void;
  warning(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  success(message: string, ...args: unknown[]): void;
  bidPlaced(collection: string, tokenId: string, price: number, type: string): void;
  bidSkipped(collection: string, tokenId: string, reason: string, currentPrice: number, bidPrice: number, maxOffer: number): void;
  bidCancelled(collection: string, tokenId: string, reason: string): void;
  bidAdjusted(collection: string, tokenId: string, oldPrice: number, newPrice: number): void;
  scheduleStart(collection: string): void;
  scheduleComplete(collection: string, duration: number): void;
  printStats(): void;
}

/**
 * The main BidBot interface returned by createBidBot().
 */
export interface BidBot {
  /**
   * Start the bot (connects WebSocket, starts scheduled loops).
   * Call this after createBidBot() to begin operations.
   */
  start(): Promise<void>;

  /**
   * Stop the bot gracefully.
   * Clears all timers, closes WebSocket, persists state.
   */
  stop(): Promise<void>;

  /**
   * Place a bid on a specific token.
   * @param collectionSymbol - Collection to bid in
   * @param tokenId - Token to bid on
   * @param price - Bid price in satoshis
   * @returns Result of the bid attempt
   */
  placeBid(collectionSymbol: string, tokenId: string, price: number): Promise<PlaceBidResult>;

  /**
   * Cancel a specific bid.
   * @param offerId - The offer ID to cancel
   * @returns True if cancellation succeeded
   */
  cancelBid(offerId: string): Promise<boolean>;

  /**
   * Get current bot statistics.
   */
  getStats(): BotStats;

  /**
   * Get the internal state (for testing).
   */
  getState(): BotState;

  /**
   * Get collections being monitored.
   */
  getCollections(): CollectionConfig[];

  /**
   * Check if the bot is running.
   */
  isRunning(): boolean;
}

/**
 * WebSocket activity event from Magic Eden.
 */
export interface CollectOfferActivity {
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
  brc20TransferAmt: null;
  brc20ListedUnitPrice: null;
  btcUsdPrice: number;
  oldLocation: string;
  oldOwner: string;
  buyerPaymentAddress: string;
  listedMakerFeeBp: number;
  listedTakerFeeBp: number;
  reasonForActivity: string;
}

/**
 * Validation error thrown when configuration is invalid.
 */
export class BotValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotValidationError';
  }
}

/**
 * Configuration error thrown when required config is missing.
 */
export class BotConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotConfigError';
  }
}

/**
 * Initialization error thrown when bot fails to start.
 */
export class BotInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotInitError';
  }
}
