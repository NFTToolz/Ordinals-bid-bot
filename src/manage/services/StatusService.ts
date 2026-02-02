import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { getAllBalances, calculateTotalBalance, getAllUTXOs } from './BalanceService';
import { loadWallets, isGroupsFormat, getAllWalletsFromGroups, getWalletFromWIF } from './WalletGenerator';
import { loadCollections } from './CollectionService';
import { isRunning } from './BotProcessManager';
import { getUserOffers } from '../../functions/Offer';

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
} = {};

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

  // Add main wallet from .env
  const FUNDING_WIF = process.env.FUNDING_WIF;
  if (FUNDING_WIF) {
    try {
      const mainWallet = getWalletFromWIF(FUNDING_WIF, network);
      addresses.push(mainWallet.paymentAddress);
    } catch (error) {
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

  // Fetch offers for each wallet (with rate limiting)
  for (const address of addresses) {
    try {
      const userOffers = await getUserOffers(address);
      totalOffers += userOffers.offers?.length || 0;
    } catch (error) {
      // Skip on error
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
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

  // Get basic counts (fast, no API calls)
  const botStatus = isRunning() ? 'RUNNING' : 'STOPPED';

  const walletsData = loadWallets();
  let walletCount = 1; // main wallet
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      walletCount += getAllWalletsFromGroups().length;
    } else {
      walletCount += walletsData.wallets?.length || 0;
    }
  }

  const collections = loadCollections();
  const collectionCount = collections.length;

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

  const status: EnhancedStatus = {
    botStatus,
    walletCount,
    collectionCount,
    totalBalance,
    activeOfferCount,
    pendingTxCount,
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

  const walletsData = loadWallets();
  let walletCount = 1;
  if (walletsData) {
    if (isGroupsFormat(walletsData)) {
      walletCount += getAllWalletsFromGroups().length;
    } else {
      walletCount += walletsData.wallets?.length || 0;
    }
  }

  const collections = loadCollections();
  const collectionCount = collections.length;

  return {
    botStatus,
    walletCount,
    collectionCount,
    totalBalance: cache.totalBalance?.data || 0,
    activeOfferCount: cache.activeOfferCount?.data || 0,
    pendingTxCount: cache.pendingTxCount?.data || 0,
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
}

/**
 * Refresh offer count in the background
 * Call this periodically to keep offer count updated without blocking
 */
export async function refreshOfferCountAsync(): Promise<void> {
  try {
    await getActiveOfferCount();
  } catch (error) {
    // Silently fail
  }
}
