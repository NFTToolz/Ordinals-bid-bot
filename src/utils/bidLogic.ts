/**
 * Pure bidding logic functions extracted from bid.ts for testability.
 * These functions have no side effects and can be tested in isolation.
 */

// Constants
export const CONVERSION_RATE = 100000000; // Satoshi conversion rate
export const DEFAULT_RECENT_BID_COOLDOWN_MS = 30000; // 30 seconds
export const DEFAULT_MAX_RECENT_BIDS_SIZE = 5000;
export const DEFAULT_TOKEN_LOCK_TIMEOUT_MS = 60000; // 60 seconds
export const DEFAULT_BID_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const DEFAULT_MAX_BIDS_PER_COLLECTION = 100;

// Types
export interface BidHistoryEntry {
  offerType: 'ITEM' | 'COLLECTION';
  ourBids: {
    [tokenId: string]: {
      price: number;
      expiration: number;
      paymentAddress?: string;
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

export interface CollectionConfig {
  collectionSymbol: string;
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  outBidMargin: number;
  bidCount: number;
  duration: number;
  enableCounterBidding?: boolean;
  offerType: 'ITEM' | 'COLLECTION';
  feeSatsPerVbyte?: number;
  quantity?: number;
  traits?: { traitType: string; value: string }[];
}

export interface UserBid {
  collectionSymbol: string;
  tokenId: string;
  price: number;
  expiration: string;
}

export interface BottomListing {
  id: string;
  price: number;
}

export interface CollectionBottomBid {
  tokenId: string;
  collectionSymbol: string;
}

export interface WebSocketMessage {
  kind: string;
  collectionSymbol: string;
  tokenId?: string;
  listedPrice?: string | number;
  buyerPaymentAddress?: string;
  newOwner?: string;
  createdAt?: string | number;
}

export interface BidCalculationResult {
  minOffer: number;
  maxOffer: number;
}

export interface BidFilterResult {
  shouldBid: boolean;
  reason?: string;
}

// ============================================================================
// Bid Calculation Functions
// ============================================================================

/**
 * Calculate the minimum and maximum bid prices based on floor price and config.
 *
 * @param floorPrice - The current floor price in satoshis
 * @param minBid - Minimum bid amount in BTC
 * @param maxBid - Maximum bid amount in BTC
 * @param minFloorBid - Minimum percentage of floor price
 * @param maxFloorBid - Maximum percentage of floor price
 * @returns Object with minOffer and maxOffer in satoshis
 */
export function calculateBidPrice(
  floorPrice: number,
  minBid: number,
  maxBid: number,
  minFloorBid: number,
  maxFloorBid: number
): BidCalculationResult {
  const minPrice = Math.round(minBid * CONVERSION_RATE);
  const maxPrice = Math.round(maxBid * CONVERSION_RATE);

  const minOffer = Math.max(minPrice, Math.round(minFloorBid * floorPrice / 100));
  const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100));

  return { minOffer, maxOffer };
}

/**
 * Calculate the outbid price (current price + margin).
 * Returns null if the result would exceed the maximum bid.
 *
 * @param currentPrice - Current top offer price in satoshis
 * @param margin - Outbid margin in BTC
 * @param maxBid - Maximum allowed bid in satoshis
 * @returns The outbid price in satoshis, or null if it would exceed max
 */
export function calculateOutbidPrice(
  currentPrice: number,
  margin: number,
  maxBid: number
): number | null {
  const outBidAmount = Math.round(margin * CONVERSION_RATE);
  const bidPrice = Math.round(currentPrice + outBidAmount);

  if (bidPrice > maxBid) {
    return null;
  }

  return bidPrice;
}

/**
 * Calculate minimum bid price for a token with no competing offers.
 *
 * @param listedPrice - The listing price of the token in satoshis
 * @param minOffer - Calculated minimum offer in satoshis
 * @returns The bid price in satoshis
 */
export function calculateMinimumBidPrice(
  listedPrice: number,
  minOffer: number
): number {
  return minOffer;
}

// ============================================================================
// Bid Filtering / Validation Functions
// ============================================================================

/**
 * Validate that a bid doesn't exceed floor price for non-trait offers.
 * Bidding above 100% of floor is only allowed for trait-based offers.
 *
 * @param maxFloorBid - Maximum floor bid percentage from config
 * @param offerType - Type of offer (ITEM, COLLECTION)
 * @param hasTraits - Whether the collection config has traits defined
 * @returns Object with valid boolean and optional reason
 */
export function validateBidAgainstFloor(
  maxFloorBid: number,
  offerType: 'ITEM' | 'COLLECTION',
  hasTraits: boolean
): { valid: boolean; reason?: string } {
  // Trait bidding is allowed to go above 100%
  if (hasTraits && offerType === 'ITEM') {
    return { valid: true };
  }

  // For ITEM and COLLECTION without traits, cap at 100%
  if ((offerType === 'ITEM' || offerType === 'COLLECTION') && maxFloorBid > 100) {
    return {
      valid: false,
      reason: `Offer at ${maxFloorBid}% of floor price (above 100%). Skipping bid.`
    };
  }

  return { valid: true };
}

/**
 * Validate that minFloorBid is not greater than maxFloorBid.
 */
export function validateFloorBidRange(
  minFloorBid: number,
  maxFloorBid: number
): { valid: boolean; reason?: string } {
  if (minFloorBid > maxFloorBid) {
    return {
      valid: false,
      reason: `Min floor bid ${minFloorBid}% > max floor bid ${maxFloorBid}%. Skipping bid.`
    };
  }
  return { valid: true };
}

/**
 * Validate floor price data is usable.
 */
export function validateFloorPrice(
  floorPrice: number | null | undefined
): { valid: boolean; reason?: string } {
  if (floorPrice === null || floorPrice === undefined) {
    return {
      valid: false,
      reason: 'No floor price data available'
    };
  }

  if (isNaN(floorPrice) || floorPrice <= 0) {
    return {
      valid: false,
      reason: `Invalid floor price: ${floorPrice}`
    };
  }

  return { valid: true };
}

/**
 * Check if we've reached the maximum purchase quantity for a collection.
 */
export function hasReachedQuantityLimit(
  currentQuantity: number,
  maxQuantity: number
): boolean {
  return currentQuantity >= maxQuantity;
}

// ============================================================================
// Recent Bid Tracking Functions
// ============================================================================

/**
 * Check if a token was recently bid on (within cooldown period).
 * Used to prevent duplicate bids from WebSocket events.
 *
 * @param tokenId - The token ID to check
 * @param recentBids - Map of tokenId to timestamp
 * @param cooldownMs - Cooldown period in milliseconds
 * @returns True if the token was recently bid on
 */
export function isRecentBid(
  tokenId: string,
  recentBids: Map<string, number>,
  cooldownMs: number = DEFAULT_RECENT_BID_COOLDOWN_MS
): boolean {
  const lastBidTime = recentBids.get(tokenId);
  if (!lastBidTime) {
    return false;
  }
  return Date.now() - lastBidTime < cooldownMs;
}

/**
 * Get seconds since last bid on a token.
 * Returns -1 if no previous bid exists.
 */
export function getSecondsSinceLastBid(
  tokenId: string,
  recentBids: Map<string, number>
): number {
  const lastBidTime = recentBids.get(tokenId);
  if (!lastBidTime) {
    return -1;
  }
  return Math.round((Date.now() - lastBidTime) / 1000);
}

/**
 * Add a recent bid entry with size limit enforcement.
 * Returns the key that was removed (if any) for testing purposes.
 */
export function addRecentBidWithLimit(
  tokenId: string,
  timestamp: number,
  recentBids: Map<string, number>,
  maxSize: number = DEFAULT_MAX_RECENT_BIDS_SIZE
): string | null {
  let removedKey: string | null = null;

  // Enforce size limit before adding
  if (recentBids.size >= maxSize) {
    const oldestKey = recentBids.keys().next().value;
    if (oldestKey) {
      recentBids.delete(oldestKey);
      removedKey = oldestKey;
    }
  }

  recentBids.set(tokenId, timestamp);
  return removedKey;
}

/**
 * Clean up expired entries from recent bids map.
 * Returns number of entries cleaned.
 */
export function cleanupRecentBidsMap(
  recentBids: Map<string, number>,
  cooldownMs: number = DEFAULT_RECENT_BID_COOLDOWN_MS,
  maxSize: number = DEFAULT_MAX_RECENT_BIDS_SIZE
): number {
  const now = Date.now();
  let cleaned = 0;

  // First pass: Remove expired entries (2x cooldown for safety margin)
  for (const [tokenId, timestamp] of recentBids.entries()) {
    if (now - timestamp > cooldownMs * 2) {
      recentBids.delete(tokenId);
      cleaned++;
    }
  }

  // Second pass: Enforce max size cap
  if (recentBids.size > maxSize) {
    const entries = Array.from(recentBids.entries()).sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, recentBids.size - maxSize);
    for (const [tokenId] of toRemove) {
      recentBids.delete(tokenId);
      cleaned++;
    }
  }

  return cleaned;
}

// ============================================================================
// Token Lock Functions (Pure Logic Parts)
// ============================================================================

/**
 * Check if a lock is stale (older than timeout).
 */
export function isLockStale(
  lockTimestamp: number | undefined,
  timeoutMs: number = DEFAULT_TOKEN_LOCK_TIMEOUT_MS
): boolean {
  if (!lockTimestamp) {
    return false;
  }
  return Date.now() - lockTimestamp > timeoutMs;
}

/**
 * Calculate time held for a lock (for logging).
 */
export function getLockHeldTime(lockTimestamp: number): number {
  return Math.round((Date.now() - lockTimestamp) / 1000);
}

// ============================================================================
// Bid History Functions
// ============================================================================

/**
 * Initialize a bid history entry for a collection.
 * Returns the initialized entry.
 */
export function createBidHistoryEntry(
  offerType: 'ITEM' | 'COLLECTION'
): BidHistoryEntry {
  return {
    offerType,
    ourBids: {},
    topBids: {},
    bottomListings: [],
    lastSeenActivity: null,
    quantity: 0
  };
}

/**
 * Clean up expired bids from a bid history entry.
 * Returns count of cleaned entries.
 */
export function cleanupExpiredBids(
  entry: BidHistoryEntry,
  maxAgeMs: number = DEFAULT_BID_HISTORY_MAX_AGE_MS
): number {
  const now = Date.now();
  let cleaned = 0;

  for (const tokenId in entry.ourBids) {
    const bid = entry.ourBids[tokenId];
    // Remove if bid has been expired for more than maxAgeMs
    if (bid.expiration < now && (now - bid.expiration) > maxAgeMs) {
      delete entry.ourBids[tokenId];
      delete entry.topBids[tokenId];
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Limit bids per collection by removing oldest bids.
 * Returns count of removed bids.
 */
export function limitBidsPerCollection(
  entry: BidHistoryEntry,
  maxBids: number = DEFAULT_MAX_BIDS_PER_COLLECTION
): number {
  const ourBidsEntries = Object.entries(entry.ourBids);
  if (ourBidsEntries.length <= maxBids) {
    return 0;
  }

  // Sort by expiration (newest first)
  const sortedBids = ourBidsEntries.sort((a, b) => b[1].expiration - a[1].expiration);
  let removed = 0;

  // Remove oldest bids
  for (let i = maxBids; i < sortedBids.length; i++) {
    const [tokenId] = sortedBids[i];
    delete entry.ourBids[tokenId];
    delete entry.topBids[tokenId];
    removed++;
  }

  return removed;
}

/**
 * Limit bottom listings array size.
 * Modifies the entry in place.
 */
export function limitBottomListings(
  entry: BidHistoryEntry,
  maxListings: number = DEFAULT_MAX_BIDS_PER_COLLECTION
): void {
  if (entry.bottomListings.length > maxListings) {
    entry.bottomListings = entry.bottomListings
      .sort((a, b) => a.price - b.price)
      .slice(0, maxListings);
  }
}

/**
 * Check if a bid is expired.
 */
export function isBidExpired(
  bidExpiration: number,
  now: number = Date.now()
): boolean {
  return now >= bidExpiration;
}

/**
 * Find tokens that have bids but are no longer in the bottom listings.
 * These should be cancelled.
 */
export function findTokensToCancel(
  tokens: CollectionBottomBid[],
  ourBids: { tokenId: string; collectionSymbol: string }[]
): { tokenId: string; collectionSymbol: string }[] {
  return ourBids.filter(bid =>
    !tokens.some(token =>
      token.tokenId === bid.tokenId &&
      token.collectionSymbol === bid.collectionSymbol
    )
  );
}

/**
 * Combine user bids with bottom listings to show bid context.
 */
export function combineBidsAndListings(
  userBids: UserBid[],
  bottomListings: BottomListing[]
): Array<{
  bidId: string;
  bottomListingId: string;
  expiration: string;
  price: number;
  listedPrice: number;
} | null> {
  const now = Date.now();
  const activeBids = userBids.filter(bid => new Date(bid.expiration).getTime() > now);
  const combined = activeBids
    .map(bid => {
      const matchedListing = bottomListings.find(listing => listing.id === bid.tokenId);
      if (matchedListing) {
        return {
          bidId: bid.tokenId.slice(-8),
          bottomListingId: matchedListing.id.slice(-8),
          expiration: bid.expiration,
          price: bid.price,
          listedPrice: matchedListing.price
        };
      }
      return null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return combined.sort((a, b) => a.listedPrice - b.listedPrice);
}

// ============================================================================
// Purchase Event Tracking Functions
// ============================================================================

/**
 * Create a unique key for a purchase event to track deduplication.
 */
export function getPurchaseEventKey(
  collectionSymbol: string,
  tokenId: string,
  kind: string,
  createdAt?: string | number
): string {
  const timestamp = createdAt ? String(createdAt) : 'unknown';
  return `${collectionSymbol}:${tokenId}:${kind}:${timestamp}`;
}

/**
 * Mark purchase events and enforce size limit.
 * Returns count of entries cleared.
 */
export function markPurchaseEventWithLimit(
  eventKey: string,
  processedEvents: Set<string>,
  maxSize: number = 1000
): number {
  let cleared = 0;

  // Enforce size limit - clear oldest entries if needed
  if (processedEvents.size >= maxSize) {
    const toDelete: string[] = [];
    let count = 0;
    for (const key of processedEvents) {
      if (count >= maxSize / 2) break;
      toDelete.push(key);
      count++;
    }
    toDelete.forEach(key => processedEvents.delete(key));
    cleared = toDelete.length;
  }

  processedEvents.add(eventKey);
  return cleared;
}

// ============================================================================
// WebSocket Message Validation Functions
// ============================================================================

/**
 * Check if a string is valid JSON.
 */
export function isValidJSON(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate WebSocket message has required fields for processing.
 */
export function isValidWebSocketMessage(message: unknown): message is WebSocketMessage {
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

  // For offer_placed and buying events, tokenId is required
  const tokenEvents = ['offer_placed', 'buying_broadcasted', 'offer_accepted_broadcasted'];
  if (tokenEvents.includes(msg.kind) && typeof msg.tokenId !== 'string') {
    return false;
  }

  // listedPrice can be string or number, but must exist for offer events
  if (msg.kind === 'offer_placed' || msg.kind === 'coll_offer_created') {
    if (msg.listedPrice === undefined || msg.listedPrice === null) {
      return false;
    }
    // buyerPaymentAddress is required for offer events
    if (typeof msg.buyerPaymentAddress !== 'string' || !msg.buyerPaymentAddress) {
      return false;
    }
  }

  return true;
}

/**
 * List of WebSocket event types that trigger bid processing.
 */
export const WATCHED_EVENTS = [
  'offer_placed',
  'coll_offer_created',
  'offer_cancelled',
  'buying_broadcasted',
  'offer_accepted_broadcasted',
  'coll_offer_fulfill_broadcasted'
];

/**
 * Check if an event type is one we should process.
 */
export function isWatchedEvent(kind: string): boolean {
  return WATCHED_EVENTS.includes(kind);
}

// ============================================================================
// Collection Config Validation Functions
// ============================================================================

/**
 * Validate a collection configuration object.
 * Returns array of error messages (empty if valid).
 */
export function validateCollectionConfig(item: unknown): string[] {
  const errors: string[] = [];

  if (typeof item !== 'object' || item === null) {
    return ['Configuration is not a valid object'];
  }

  const config = item as Record<string, unknown>;

  // Required fields validation
  if (!config.collectionSymbol || typeof config.collectionSymbol !== 'string') {
    errors.push('collectionSymbol (string) is required');
  }
  if (typeof config.minBid !== 'number' || config.minBid < 0) {
    errors.push('minBid (non-negative number) is required');
  }
  if (typeof config.maxBid !== 'number' || config.maxBid < 0) {
    errors.push('maxBid (non-negative number) is required');
  }
  if (typeof config.minFloorBid !== 'number') {
    errors.push('minFloorBid (number) is required');
  }
  if (typeof config.maxFloorBid !== 'number') {
    errors.push('maxFloorBid (number) is required');
  }
  if (!config.offerType || !['ITEM', 'COLLECTION'].includes(config.offerType as string)) {
    errors.push('offerType must be "ITEM" or "COLLECTION"');
  }

  // Cross-field validation
  if (typeof config.minBid === 'number' && typeof config.maxBid === 'number' && config.minBid > config.maxBid) {
    errors.push(`minBid (${config.minBid}) cannot be greater than maxBid (${config.maxBid})`);
  }
  if (typeof config.minFloorBid === 'number' && typeof config.maxFloorBid === 'number' && config.minFloorBid > config.maxFloorBid) {
    errors.push(`minFloorBid (${config.minFloorBid}%) cannot be greater than maxFloorBid (${config.maxFloorBid}%)`);
  }
  if (config.bidCount !== undefined && (typeof config.bidCount !== 'number' || config.bidCount <= 0)) {
    errors.push('bidCount must be a positive number');
  }

  return errors;
}

/**
 * Get effective maxFloorBid, capping at 100% for non-trait offers.
 */
export function getEffectiveMaxFloorBid(
  maxFloorBid: number,
  offerType: 'ITEM' | 'COLLECTION',
  hasTraits: boolean
): number {
  // Trait-based ITEM offers can exceed 100%
  if (offerType === 'ITEM' && hasTraits) {
    return maxFloorBid;
  }
  // Cap at 100% for non-trait offers
  return maxFloorBid <= 100 ? maxFloorBid : 100;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safely extract unique bottom listings from an array.
 */
export function getUniqueBottomListings(
  listings: BottomListing[]
): BottomListing[] {
  const uniqueIds = new Set<string>();
  const unique: BottomListing[] = [];

  for (const listing of listings) {
    if (!uniqueIds.has(listing.id)) {
      uniqueIds.add(listing.id);
      unique.push(listing);
    }
  }

  return unique;
}

/**
 * Sort listings by price (ascending).
 */
export function sortListingsByPrice(listings: BottomListing[]): BottomListing[] {
  return [...listings].sort((a, b) => a.price - b.price);
}

/**
 * Format satoshis as BTC string.
 */
export function satsToBTC(sats: number): string {
  return (sats / CONVERSION_RATE).toFixed(8);
}

/**
 * Convert BTC to satoshis.
 */
export function btcToSats(btc: number): number {
  return Math.round(btc * CONVERSION_RATE);
}
