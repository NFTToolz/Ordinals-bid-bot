import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { getAllBalances, calculateTotalBalance, getAllUTXOs } from './BalanceService';
import { loadWallets, isGroupsFormat, getAllWalletsFromGroups, getWalletFromWIF } from './WalletGenerator';
import { loadCollections } from './CollectionService';
import { isRunning } from './BotProcessManager';
import { getUserOffers } from '../../functions/Offer';
import { getFundingWIF, hasFundingWIF } from '../../utils/fundingWallet';
import Logger from '../../utils/logger';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

export interface EnhancedStatus {
  botStatus: 'RUNNING' | 'STOPPED';
  walletCount: number;
  collectionCount: number;
  totalBalance: number;
  activeOfferCount: number;
  pendingTxCount: number;
  dataFreshness: 'fresh' | 'stale' | 'unavailable';
  lastRefreshAgoSec: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

// Cache TTL in milliseconds (30 seconds)
const CACHE_TTL = 30 * 1000;

// Cache storage
const cache: {
  enhancedStatus?: CacheEntry<EnhancedStatus>;
  totalBalance?: CacheEntry<number>;
  activeOfferCount?: CacheEntry<number>;
  pendingTxCount?: CacheEntry<number>;
  walletCount?: CacheEntry<number>;
  collectionCount?: CacheEntry<number>;
} = {};

// Circuit breaker state
let consecutiveFailures = 0;
let lastFailureTime = 0;
let currentBackoffMs = 0;

const FAILURE_THRESHOLD = 3;
const INITIAL_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 300_000;
const BACKOFF_MULTIPLIER = 2;

function recordSuccess(): void {
  consecutiveFailures = 0;
  currentBackoffMs = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    lastFailureTime = Date.now();
    currentBackoffMs = Math.min(
      currentBackoffMs ? currentBackoffMs * BACKOFF_MULTIPLIER : INITIAL_BACKOFF_MS,
      MAX_BACKOFF_MS,
    );
    Logger.warning(`Status refresh circuit breaker open (${consecutiveFailures} consecutive failures, backoff ${Math.round(currentBackoffMs / 1000)}s)`);
  }
}

function isCircuitOpen(): boolean {
  return consecutiveFailures >= FAILURE_THRESHOLD && Date.now() - lastFailureTime < currentBackoffMs;
}

export function getCircuitBreakerStatus(): {
  isOpen: boolean;
  consecutiveFailures: number;
  backoffMs: number;
  lastFailureTime: number;
} {
  return {
    isOpen: isCircuitOpen(),
    consecutiveFailures,
    backoffMs: currentBackoffMs,
    lastFailureTime,
  };
}

export function resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  lastFailureTime = 0;
  currentBackoffMs = 0;
}

// Data freshness tracking
let lastRefreshTime = 0;
let lastRefreshSuccess = false;

/**
 * Check if a cache entry is still valid
 */
function isCacheValid<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  if (!entry) return false;
  return Date.now() - entry.timestamp < CACHE_TTL;
}

/**
 * Get all wallet payment addresses
 */
function getAllWalletAddresses(): string[] {
  const addresses: string[] = [];

  // Add main wallet (from wallets.json or .env)
  if (hasFundingWIF()) {
    try {
      const mainWallet = getWalletFromWIF(getFundingWIF(), network);
      addresses.push(mainWallet.paymentAddress);
    } catch {
      // Skip if invalid
    }
  }

  // Add wallets from config
  const walletsData = loadWallets();
  if (walletsData) {
    let configWallets: Array<{ label: string; wif: string; receiveAddress: string }> = [];

    if (isGroupsFormat(walletsData)) {
      configWallets = getAllWalletsFromGroups();
    } else if (walletsData.wallets?.length > 0) {
      configWallets = walletsData.wallets;
    }

    for (const w of configWallets) {
      try {
        const walletInfo = getWalletFromWIF(w.wif, network);
        addresses.push(walletInfo.paymentAddress);
      } catch (error) {
        // Skip if invalid
      }
    }
  }

  return addresses;
}

/**
 * Get cached wallet count (recomputed on cache miss)
 */
function getCachedWalletCount(): number {
  if (isCacheValid(cache.walletCount)) return cache.walletCount.data;

  const walletsData = loadWallets();
  let count = hasFundingWIF() ? 1 : 0;
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      count += getAllWalletsFromGroups().length;
    } else {
      count += walletsData.wallets?.length || 0;
    }
  }

  cache.walletCount = { data: count, timestamp: Date.now() };
  return count;
}

/**
 * Get cached collection count (recomputed on cache miss)
 */
function getCachedCollectionCount(): number {
  if (isCacheValid(cache.collectionCount)) return cache.collectionCount.data;
  const collections = loadCollections();
  const count = collections.length;
  cache.collectionCount = { data: count, timestamp: Date.now() };
  return count;
}

/**
 * Get total BTC balance across all wallets
 */
export async function getTotalBalance(): Promise<number> {
  if (isCacheValid(cache.totalBalance)) {
    return cache.totalBalance.data;
  }

  const addresses = getAllWalletAddresses();
  if (addresses.length === 0) {
    return 0;
  }

  const balances = await getAllBalances(addresses);
  const totals = calculateTotalBalance(balances);

  cache.totalBalance = {
    data: totals.total,
    timestamp: Date.now(),
  };

  return totals.total;
}

/**
 * Get count of active offers across all wallets
 */
export async function getActiveOfferCount(): Promise<number> {
  if (isCacheValid(cache.activeOfferCount)) {
    return cache.activeOfferCount.data;
  }

  const addresses = getAllWalletAddresses();
  if (addresses.length === 0) {
    return 0;
  }

  let totalOffers = 0;
  let failCount = 0;

  // Fetch offers for each wallet (with rate limiting)
  for (const address of addresses) {
    try {
      const userOffers = await getUserOffers(address);
      totalOffers += userOffers.offers?.length || 0;
    } catch (error) {
      failCount++;
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (failCount === addresses.length) {
    throw new Error(`Failed to fetch offers for all ${addresses.length} wallet addresses`);
  }

  cache.activeOfferCount = {
    data: totalOffers,
    timestamp: Date.now(),
  };

  return totalOffers;
}

/**
 * Get count of pending (unconfirmed) transactions
 */
export async function getPendingTxCount(): Promise<number> {
  if (isCacheValid(cache.pendingTxCount)) {
    return cache.pendingTxCount.data;
  }

  const addresses = getAllWalletAddresses();
  if (addresses.length === 0) {
    return 0;
  }

  const utxoMap = await getAllUTXOs(addresses);
  let pendingCount = 0;

  for (const utxos of utxoMap.values()) {
    for (const utxo of utxos) {
      if (!utxo.status.confirmed) {
        pendingCount++;
      }
    }
  }

  cache.pendingTxCount = {
    data: pendingCount,
    timestamp: Date.now(),
  };

  return pendingCount;
}

/**
 * Get enhanced status with all metrics
 * Uses caching to avoid excessive API calls
 */
export async function getEnhancedStatus(): Promise<EnhancedStatus> {
  // Check if full cache is valid
  if (isCacheValid(cache.enhancedStatus)) {
    // Update bot status (always real-time)
    const currentStatus = isRunning() ? 'RUNNING' : 'STOPPED';
    if (cache.enhancedStatus.data.botStatus !== currentStatus) {
      cache.enhancedStatus.data.botStatus = currentStatus;
    }
    return cache.enhancedStatus.data;
  }

  // Get basic counts (fast, cached)
  const botStatus = isRunning() ? 'RUNNING' : 'STOPPED';
  const walletCount = getCachedWalletCount();
  const collectionCount = getCachedCollectionCount();

  // Fetch balance and pending count in parallel (offers take longer, skip for quick refresh)
  let totalBalance = 0;
  let pendingTxCount = 0;
  let activeOfferCount = 0;

  try {
    const [balance, pending] = await Promise.all([
      getTotalBalance(),
      getPendingTxCount(),
    ]);
    totalBalance = balance;
    pendingTxCount = pending;
  } catch (error) {
    // Use cached values if available
    totalBalance = cache.totalBalance?.data || 0;
    pendingTxCount = cache.pendingTxCount?.data || 0;
  }

  // Use cached offer count if available, don't block on it
  activeOfferCount = cache.activeOfferCount?.data || 0;

  // Compute freshness
  const now = Date.now();
  const agoMs = lastRefreshTime > 0 ? now - lastRefreshTime : -1;
  const dataFreshness: 'fresh' | 'stale' | 'unavailable' =
    lastRefreshTime === 0 ? 'unavailable' :
    (agoMs > 120_000 || !lastRefreshSuccess) ? 'stale' : 'fresh';
  const lastRefreshAgoSec = lastRefreshTime > 0 ? Math.floor(agoMs / 1000) : -1;

  const status: EnhancedStatus = {
    botStatus,
    walletCount,
    collectionCount,
    totalBalance,
    activeOfferCount,
    pendingTxCount,
    dataFreshness,
    lastRefreshAgoSec,
  };

  cache.enhancedStatus = {
    data: status,
    timestamp: Date.now(),
  };

  return status;
}

/**
 * Get quick status (no API calls, uses cache or defaults)
 * Useful for UI updates where fresh data isn't critical
 */
export function getQuickStatus(): EnhancedStatus {
  const botStatus = isRunning() ? 'RUNNING' : 'STOPPED';
  const walletCount = getCachedWalletCount();
  const collectionCount = getCachedCollectionCount();

  // Compute freshness
  const now = Date.now();
  const agoMs = lastRefreshTime > 0 ? now - lastRefreshTime : -1;
  const dataFreshness: 'fresh' | 'stale' | 'unavailable' =
    lastRefreshTime === 0 ? 'unavailable' :
    (agoMs > 120_000 || !lastRefreshSuccess) ? 'stale' : 'fresh';
  const lastRefreshAgoSec = lastRefreshTime > 0 ? Math.floor(agoMs / 1000) : -1;

  return {
    botStatus,
    walletCount,
    collectionCount,
    totalBalance: cache.totalBalance?.data || 0,
    activeOfferCount: cache.activeOfferCount?.data || 0,
    pendingTxCount: cache.pendingTxCount?.data || 0,
    dataFreshness,
    lastRefreshAgoSec,
  };
}

/**
 * Clear all cached status data
 */
export function clearStatusCache(): void {
  delete cache.enhancedStatus;
  delete cache.totalBalance;
  delete cache.activeOfferCount;
  delete cache.pendingTxCount;
  delete cache.walletCount;
  delete cache.collectionCount;
  lastRefreshTime = 0;
  lastRefreshSuccess = false;
}

/**
 * Refresh offer count in the background
 * Call this periodically to keep offer count updated without blocking
 */
export async function refreshOfferCountAsync(): Promise<void> {
  await getActiveOfferCount();
}

/**
 * Refresh balance in the background
 */
export async function refreshBalanceAsync(): Promise<void> {
  await getTotalBalance();
}

/**
 * Refresh pending transaction count in the background
 */
export async function refreshPendingAsync(): Promise<void> {
  await getPendingTxCount();
}

/**
 * Refresh all status caches in the background (balance, pending, offers)
 */
export async function refreshAllStatusAsync(): Promise<void> {
  if (isCircuitOpen()) {
    return; // Skip while circuit breaker is open
  }

  const results = await Promise.allSettled([
    getTotalBalance(),
    getPendingTxCount(),
    getActiveOfferCount(),
  ]);

  const allFailed = results.every(r => r.status === 'rejected');
  const hasSuccess = results.some(r => r.status === 'fulfilled');

  lastRefreshTime = Date.now();
  lastRefreshSuccess = hasSuccess;

  if (allFailed) {
    recordFailure();
  } else {
    recordSuccess();
  }
}
