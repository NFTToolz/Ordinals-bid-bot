/**
 * Pure cancel logic functions extracted from cancel.ts for testability.
 * These functions have no side effects and can be tested in isolation.
 */

import { IOffer } from '../functions/Offer';

// Types
export interface WalletAddress {
  address: string;
  privateKey: string;
  publicKey: string;
  paymentAddress: string;
  label?: string;
}

export interface CollectionData {
  collectionSymbol: string;
  tokenReceiveAddress?: string;
  fundingWalletWIF?: string;
  offerType: 'ITEM' | 'COLLECTION';
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  outBidMargin: number;
  bidCount: number;
  duration: number;
}

// ============================================================================
// Offer Filtering Functions
// ============================================================================

/**
 * Filter offers to find only those from our addresses.
 *
 * @param offers - Array of offers to filter
 * @param ourPaymentAddresses - Set of our payment addresses (lowercase)
 * @returns Filtered array of offers that belong to us
 */
export function filterOurOffers(
  offers: IOffer[],
  ourPaymentAddresses: Set<string>
): IOffer[] {
  return offers.filter(offer =>
    ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())
  );
}

/**
 * Filter offers that don't belong to us (for skipping during cancellation).
 *
 * @param offers - Array of offers to filter
 * @param ourPaymentAddresses - Set of our payment addresses (lowercase)
 * @returns Filtered array of offers that don't belong to us
 */
export function filterOthersOffers(
  offers: IOffer[],
  ourPaymentAddresses: Set<string>
): IOffer[] {
  return offers.filter(offer =>
    !ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())
  );
}

/**
 * Check if an offer belongs to one of our payment addresses.
 */
export function isOurOffer(
  offer: IOffer,
  ourPaymentAddresses: Set<string>
): boolean {
  return ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase());
}

/**
 * Check if an offer belongs to an unknown wallet (not in our pool).
 * Used to decide whether to skip cancellation for bids placed by external wallets.
 */
export function isUnknownWalletOffer(
  offer: IOffer,
  knownPaymentAddress: string,
  walletPoolAddresses: Set<string>
): boolean {
  const offerAddress = offer.buyerPaymentAddress.toLowerCase();
  const isKnown = offerAddress === knownPaymentAddress.toLowerCase() ||
                  walletPoolAddresses.has(offerAddress);
  return !isKnown;
}

// ============================================================================
// Offer Grouping Functions
// ============================================================================

/**
 * Group offers by their collection symbol.
 *
 * @param offers - Array of offers to group
 * @returns Map of collection symbol to array of offers
 */
export function groupOffersByCollection(
  offers: IOffer[]
): Map<string, IOffer[]> {
  const grouped = new Map<string, IOffer[]>();

  for (const offer of offers) {
    const collectionSymbol = offer.token?.collectionSymbol || 'unknown';
    const existing = grouped.get(collectionSymbol) || [];
    existing.push(offer);
    grouped.set(collectionSymbol, existing);
  }

  return grouped;
}

/**
 * Group offers by their buyer payment address.
 * Useful for wallet rotation scenarios.
 */
export function groupOffersByWallet(
  offers: IOffer[]
): Map<string, IOffer[]> {
  const grouped = new Map<string, IOffer[]>();

  for (const offer of offers) {
    const address = offer.buyerPaymentAddress.toLowerCase();
    const existing = grouped.get(address) || [];
    existing.push(offer);
    grouped.set(address, existing);
  }

  return grouped;
}

/**
 * Count offers by collection symbol.
 */
export function countOffersByCollection(
  offers: IOffer[]
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const offer of offers) {
    const collectionSymbol = offer.token?.collectionSymbol || 'unknown';
    counts.set(collectionSymbol, (counts.get(collectionSymbol) || 0) + 1);
  }

  return counts;
}

// ============================================================================
// Retry Logic Functions
// ============================================================================

/**
 * Determine if a cancel operation should be retried based on error.
 *
 * @param error - The error that occurred
 * @param retryCount - Current retry attempt number (0-indexed)
 * @param maxRetries - Maximum number of retries allowed
 * @returns True if should retry, false otherwise
 */
export function shouldRetryCancel(
  error: Error | unknown,
  retryCount: number,
  maxRetries: number
): boolean {
  // Don't retry if we've exceeded max retries
  if (retryCount >= maxRetries) {
    return false;
  }

  // Extract error message
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Retry on network/transient errors
  const retryablePatterns = [
    'network error',
    'timeout',
    'econnreset',
    'econnrefused',
    'socket hang up',
    'enotfound',
    'etimedout',
    'rate limit',
    'too many requests',
    '429',
    '503',
    '502',
    '504',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
    'temporarily unavailable'
  ];

  return retryablePatterns.some(pattern => lowerMessage.includes(pattern));
}

/**
 * Calculate exponential backoff delay for retries.
 *
 * @param retryCount - Current retry attempt number (0-indexed)
 * @param baseDelayMs - Base delay in milliseconds (default 1000)
 * @param maxDelayMs - Maximum delay cap (default 30000)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(
  retryCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000
): number {
  const delay = baseDelayMs * Math.pow(2, retryCount);
  return Math.min(delay, maxDelayMs);
}

/**
 * Determine if an error is a rate limit error.
 */
export function isRateLimitError(error: Error | unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  return lowerMessage.includes('rate limit') ||
         lowerMessage.includes('too many requests') ||
         lowerMessage.includes('429');
}

// ============================================================================
// Address Functions
// ============================================================================

/**
 * Deduplicate addresses by their lowercase value.
 * Keeps the first occurrence of each address.
 *
 * @param addresses - Array of wallet addresses
 * @returns Deduplicated array
 */
export function deduplicateAddresses<T extends { address: string }>(
  addresses: T[]
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const addr of addresses) {
    const normalized = addr.address.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(addr);
    }
  }

  return unique;
}

/**
 * Create a set of normalized (lowercase) addresses for quick lookup.
 */
export function createAddressSet(addresses: string[]): Set<string> {
  return new Set(addresses.map(addr => addr.toLowerCase()));
}

/**
 * Check if two addresses are the same (case-insensitive).
 */
export function addressesMatch(addr1: string, addr2: string): boolean {
  return addr1.toLowerCase() === addr2.toLowerCase();
}

// ============================================================================
// Collection Filtering Functions
// ============================================================================

/**
 * Filter collections to get unique token receive addresses with COLLECTION offer type.
 * Used to avoid duplicate API calls when canceling collection offers.
 */
export function getUniqueCollectionOfferConfigs(
  collections: CollectionData[]
): CollectionData[] {
  const seen = new Set<string>();
  const unique: CollectionData[] = [];

  for (const collection of collections) {
    if (collection.offerType !== 'COLLECTION') {
      continue;
    }

    // Create a key based on receiveAddress to deduplicate
    const key = collection.tokenReceiveAddress?.toLowerCase() || 'default';
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(collection);
    }
  }

  return unique;
}

/**
 * Get all unique receive addresses from collections config.
 */
export function getUniqueReceiveAddresses(
  collections: CollectionData[],
  defaultReceiveAddress: string
): string[] {
  const addresses = new Set<string>();

  for (const collection of collections) {
    const addr = collection.tokenReceiveAddress || defaultReceiveAddress;
    addresses.add(addr.toLowerCase());
  }

  return Array.from(addresses);
}

// ============================================================================
// Offer Validation Functions
// ============================================================================

/**
 * Check if an offer response is valid and contains offers.
 */
export function hasValidOffers(
  offerData: { offers?: unknown[]; total?: number } | null | undefined
): boolean {
  return !!(
    offerData &&
    Array.isArray(offerData.offers) &&
    offerData.offers.length > 0
  );
}

/**
 * Extract token info from an offer for logging.
 */
export function getOfferLogInfo(offer: IOffer): {
  collectionSymbol: string;
  tokenId: string;
  price: number;
  paymentAddress: string;
} {
  return {
    collectionSymbol: offer.token?.collectionSymbol || 'unknown',
    tokenId: offer.token?.id || offer.tokenId || 'unknown',
    price: offer.price,
    paymentAddress: offer.buyerPaymentAddress
  };
}

/**
 * Format an address for logging (truncated).
 */
export function formatAddressForLog(address: string, prefixLength: number = 10): string {
  if (address.length <= prefixLength) {
    return address;
  }
  return `${address.slice(0, prefixLength)}...`;
}

// ============================================================================
// Cancel Operation Helpers
// ============================================================================

/**
 * Prepare cancel operations from a list of offers.
 * Returns an array of objects with the info needed to cancel each offer.
 */
export function prepareCancelOperations(
  offers: IOffer[],
  defaultPrivateKey: string,
  getWalletPrivateKey?: (paymentAddress: string) => string | null
): Array<{
  offerId: string;
  privateKey: string;
  collectionSymbol: string;
  tokenId: string;
  paymentAddress: string;
}> {
  return offers.map(offer => {
    // Try to get the correct private key for this wallet
    let privateKey = defaultPrivateKey;
    if (getWalletPrivateKey) {
      const walletKey = getWalletPrivateKey(offer.buyerPaymentAddress);
      if (walletKey) {
        privateKey = walletKey;
      }
    }

    return {
      offerId: offer.id,
      privateKey,
      collectionSymbol: offer.token?.collectionSymbol || 'unknown',
      tokenId: offer.token?.id || offer.tokenId || 'unknown',
      paymentAddress: offer.buyerPaymentAddress
    };
  });
}

/**
 * Count successful and failed operations from Promise.allSettled results.
 */
export function countSettledResults<T>(
  results: PromiseSettledResult<T>[]
): { successful: number; failed: number } {
  let successful = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      successful++;
    } else {
      failed++;
    }
  }

  return { successful, failed };
}

/**
 * Extract failed results from Promise.allSettled for logging.
 */
export function getFailedResults<T>(
  results: PromiseSettledResult<T>[]
): PromiseRejectedResult[] {
  return results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
}
