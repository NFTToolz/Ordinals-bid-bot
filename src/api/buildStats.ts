import { BotRuntimeStats } from '../manage/services/BotProcessManager';

/**
 * Dependencies injected into buildRuntimeStats so it remains a pure function.
 * Each field mirrors a data source available inside the running bot process.
 */
export interface StatsDependencies {
  /** getBidStatsData() return value */
  bidStats: {
    bidsPlaced: number;
    bidsSkipped: number;
    bidsCancelled: number;
    bidsAdjusted: number;
    errors: number;
  };
  /** getBidPacerStatus() return value */
  pacer: {
    bidsUsed: number;
    bidsRemaining: number;
    windowResetIn: number;
    totalBidsPlaced: number;
    totalWaits: number;
  };
  /** getBidPacer().getLimit() */
  pacerLimit: number;
  /** Wallet pool data (legacy single-pool format), or null */
  walletPool: {
    available: number;
    total: number;
    bidsPerMinute: number;
    wallets: Array<{
      label: string;
      bidsInWindow: number;
      isAvailable: boolean;
      secondsUntilReset: number;
    }>;
  } | null;
  /** Wallet groups data (new multi-group format), or null */
  walletGroups: {
    groupCount: number;
    totalWallets: number;
    groups: Array<{
      name: string;
      available: number;
      total: number;
      bidsPerMinute: number;
      wallets: Array<{
        label: string;
        bidsInWindow: number;
        isAvailable: boolean;
        secondsUntilReset: number;
      }>;
    }>;
  } | null;
  /** Event queue length from eventManager.queue */
  eventQueueLength: number;
  /** Total events dropped due to queue overflow */
  droppedEventsCount: number;
  /** Events discarded during startup before monitoring loops were ready */
  startupEventsDiscarded: number;
  /** Pre-queue filter rejection counters */
  preFilterStats: {
    notWatched: number;
    unknownCollection: number;
    ownWallet: number;
    deduplicated: number;
    total: number;
  };
  /** PQueue size (waiting) */
  queueSize: number;
  /** PQueue pending (active) */
  queuePending: number;
  /** WebSocket connected state */
  wsConnected: boolean;
  /** Bot start time (epoch ms) */
  botStartTime: number;
  /** Total bids tracked across all collections */
  bidsTracked: number;
  /** Live bid history keyed by collection symbol */
  bidHistory: Record<string, {
    offerType: 'ITEM' | 'COLLECTION';
    ourBids: Record<string, { price: number; expiration: number; paymentAddress?: string }>;
    topBids: Record<string, boolean>;
    bottomListings: Array<{ id: string; price: number }>;
    quantity: number;
    lastSeenActivity?: number | null;
    highestCollectionOffer?: { price: number; buyerPaymentAddress: string };
    marketData?: {
      floorPrice: number;    // sats
      supply: string;
      totalListed: string;
      updatedAt: number;     // epoch ms
    };
  }>;
  /** Collection configs loaded at startup */
  collections: Array<{
    collectionSymbol: string;
    minBid: number;
    maxBid: number;
    minFloorBid: number;
    maxFloorBid: number;
    bidCount: number;
    duration: number;
    scheduledLoop?: number;
    enableCounterBidding: boolean;
    outBidMargin: number;
    offerType: 'ITEM' | 'COLLECTION';
    quantity: number;
    walletGroup?: string;
  }>;
}

/**
 * Build a BotRuntimeStats snapshot from injected dependencies.
 * This is a pure function with no side effects.
 */
export function buildRuntimeStats(deps: StatsDependencies): BotRuntimeStats {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

  // Count total wallets across groups or pool
  let totalWalletCount = 0;
  if (deps.walletGroups) {
    totalWalletCount = deps.walletGroups.totalWallets;
  } else if (deps.walletPool) {
    totalWalletCount = deps.walletPool.total;
  }

  return {
    timestamp: Date.now(),
    runtime: {
      startTime: deps.botStartTime,
      uptimeSeconds: Math.floor((Date.now() - deps.botStartTime) / 1000),
    },
    bidStats: {
      bidsPlaced: deps.bidStats.bidsPlaced,
      bidsSkipped: deps.bidStats.bidsSkipped,
      bidsCancelled: deps.bidStats.bidsCancelled,
      bidsAdjusted: deps.bidStats.bidsAdjusted,
      errors: deps.bidStats.errors,
    },
    pacer: {
      bidsUsed: deps.pacer.bidsUsed,
      bidsRemaining: deps.pacer.bidsRemaining,
      windowResetIn: deps.pacer.windowResetIn,
      totalBidsPlaced: deps.pacer.totalBidsPlaced,
      totalWaits: deps.pacer.totalWaits,
      bidsPerMinute: deps.pacerLimit,
    },
    walletPool: deps.walletPool,
    walletGroups: deps.walletGroups,
    totalWalletCount,
    queue: {
      size: deps.eventQueueLength,
      pending: deps.queueSize,
      active: deps.queuePending,
      droppedEventsCount: deps.droppedEventsCount,
      startupEventsDiscarded: deps.startupEventsDiscarded,
      preFilterStats: deps.preFilterStats,
    },
    memory: {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      percentage: Math.round((heapUsedMB / heapTotalMB) * 100),
    },
    websocket: {
      connected: deps.wsConnected,
    },
    bidsTracked: deps.bidsTracked,
    bidHistory: deps.bidHistory,
    collections: deps.collections,
  };
}
