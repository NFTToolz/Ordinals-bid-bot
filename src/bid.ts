import { config } from "dotenv"
import fs from "fs"
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import PQueue from "p-queue"
import { getBitcoinBalance } from "./utils";
import { ICollectionOffer, IOffer, cancelCollectionOffer, createCollectionOffer, createOffer, getBestCollectionOffer, getBestOffer, getOffers, getUserOffers, retrieveCancelOfferFormat, signCollectionOffer, signData, submitCancelOfferData, submitCollectionOffer, submitSignedOfferOrder } from "./functions/Offer";
import { collectionDetails } from "./functions/Collection";
import { retrieveTokens } from "./functions/Tokens";
import axiosInstance from "./axios/axiosInstance";
import limiter from "./bottleneck";
import WebSocket from 'ws';
import Logger, { getBidStatsData } from "./utils/logger";
import {
  initializeBidPacer,
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
  getAvailableWallet,
  recordBid as recordWalletBid,
  getWalletByPaymentAddress,
  getWalletPoolStats,
  isWalletPoolInitialized,
  getWalletPool,
  WalletState
} from "./utils/walletPool";


config()

const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS as string
const FUNDING_WIF = process.env.FUNDING_WIF as string;
const DEFAULT_OUTBID_MARGIN = Number(process.env.DEFAULT_OUTBID_MARGIN) || 0.00001
const API_KEY = process.env.API_KEY as string;
const RATE_LIMIT = Number(process.env.RATE_LIMIT) ?? 32
const DEFAULT_OFFER_EXPIRATION = 30
const FEE_RATE_TIER = 'halfHourFee'
const CONVERSION_RATE = 100000000
const network = bitcoin.networks.bitcoin;

// Multi-wallet rotation configuration
const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './src/config/wallets.json';

// Bid pacing configuration (Magic Eden's per-wallet rate limit)
const BIDS_PER_MINUTE = Number(process.env.BIDS_PER_MINUTE) || 5;
const SKIP_OVERLAPPING_CYCLES = process.env.SKIP_OVERLAPPING_CYCLES !== 'false';  // Default true

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

const DEFAULT_LOOP = Number(process.env.DEFAULT_LOOP) ?? 30
let RESTART = true

// Track bot start time for stats
const BOT_START_TIME = Date.now();

// Define a global map to track processing tokens
const processingTokens: Record<string, boolean> = {};

// Rate limit deduplication: Track recently bid tokens to prevent duplicate bids
const recentBids: Map<string, number> = new Map();
const RECENT_BID_COOLDOWN_MS = 30000; // 30 seconds - prevents duplicate bids on same token

const headers = {
  'Content-Type': 'application/json',
  'X-NFT-API-Key': API_KEY,
}

const filePath = `${__dirname}/collections.json`
const collections: CollectionData[] = JSON.parse(fs.readFileSync(filePath, "utf-8"))
let balance: number | undefined;

interface BidHistory {
  [collectionSymbol: string]: {
    offerType: 'ITEM' | 'COLLECTION';
    topOffers: {
      [tokenId: string]: {
        price: number,
        buyerPaymentAddress: string
      }
    },
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

// Wallet credentials interface for wallet rotation
interface WalletCredentials {
  buyerPaymentAddress: string;
  publicKey: string;
  privateKey: string;
  buyerTokenReceiveAddress: string;
  walletLabel?: string;
}

/**
 * Get wallet credentials for placing a bid
 * Uses wallet pool rotation if enabled, otherwise falls back to config/defaults
 */
function getWalletCredentials(
  collectionConfig: CollectionData,
  defaultReceiveAddress: string,
  defaultWIF: string
): WalletCredentials | null {
  // If wallet rotation is enabled and pool is initialized, use the pool
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = getAvailableWallet();
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

  // Fall back to collection-specific or default wallet
  const privateKey = collectionConfig.fundingWalletWIF ?? defaultWIF;
  const buyerTokenReceiveAddress = collectionConfig.tokenReceiveAddress ?? defaultReceiveAddress;
  const keyPair = ECPair.fromWIF(privateKey, network);
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

/**
 * Check if a payment address belongs to one of our wallets
 * Used for WebSocket own-bid detection to skip counter-bidding on our own bids
 */
function isOurPaymentAddress(address: string): boolean {
  if (!address) return false;
  const normalizedAddress = address.toLowerCase();

  // Check primary wallet (derived from FUNDING_WIF)
  const primaryKeyPair = ECPair.fromWIF(FUNDING_WIF, network);
  const primaryPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: primaryKeyPair.publicKey, network: network }).address as string;
  if (normalizedAddress === primaryPaymentAddress.toLowerCase()) {
    return true;
  }

  // Check wallet pool (if enabled)
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const pool = getWalletPool();
    const allAddresses = pool.getAllPaymentAddresses();
    return allAddresses.some(addr => addr.toLowerCase() === normalizedAddress);
  }

  return false;
}

// Memory leak fix: bidHistory cleanup configuration
const BID_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours TTL
const BID_HISTORY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour
const MAX_BIDS_PER_COLLECTION = 100; // Limit bids per collection

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
  private readonly MAX_QUEUE_SIZE = 1000; // Memory leak fix: Limit queue size
  private droppedEventsCount = 0;


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

      if (this.droppedEventsCount % 10 === 0) {
        console.log(`[WARNING] Event queue full! Dropped ${this.droppedEventsCount} events total. Consider increasing processing speed.`);
      }
    }

    this.queue.push(event);

    // Log warning when queue is 80% full
    if (this.queue.length > this.MAX_QUEUE_SIZE * 0.8 && this.queue.length % 100 === 0) {
      console.log(`[WARNING] Event queue is ${Math.round((this.queue.length / this.MAX_QUEUE_SIZE) * 100)}% full (${this.queue.length}/${this.MAX_QUEUE_SIZE})`);
    }

    this.processQueue();
  }

  async processQueue(): Promise<void> {
    // Ensure that the queue is not currently being processed and that there is something to process
    if (!this.isProcessingQueue && this.queue.length > 0) {
      this.isProcessingQueue = true;
      // Process the queue
      while (this.queue.length > 0) {
        // Wait until `this.isScheduledRunning` is false before starting processing
        while (this.isScheduledRunning) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const event = this.queue.shift();
        if (event) {
          this.handleIncomingBid(event);
        }
      }
      this.isProcessingQueue = false
    }
  }

  async handleIncomingBid(message: CollectOfferActivity) {
    try {
      const { newOwner: incomingBuyerTokenReceiveAddress, collectionSymbol, tokenId, listedPrice: incomingBidAmount, createdAt } = message

      const watchedEvents = [
        "offer_placed",
        "coll_offer_created",
        "offer_cancelled",
        "buying_broadcasted",
        "offer_accepted_broadcasted",
        "coll_offer_created",
        "coll_offer_fulfill_broadcasted"
      ]

      if (!watchedEvents.includes(message.kind)) return
      const collection = collections.find((item) => item.collectionSymbol === collectionSymbol)
      if (!collection) return

      if (!bidHistory[collectionSymbol]) {
        bidHistory[collectionSymbol] = {
          offerType: collection.offerType,
          topOffers: {},
          ourBids: {},
          topBids: {},
          bottomListings: [],
          lastSeenActivity: null,
          quantity: 0
        };
      }

      const outBidMargin = collection?.outBidMargin ?? DEFAULT_OUTBID_MARGIN
      const duration = collection?.duration ?? DEFAULT_OFFER_EXPIRATION
      const buyerTokenReceiveAddress = collection?.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const bidCount = collection.bidCount
      const bottomListings = bidHistory[collectionSymbol].bottomListings.sort((a, b) => a.price - b.price).map((item) => item.id).slice(0, bidCount)
      const privateKey = collection?.fundingWalletWIF ?? FUNDING_WIF;
      const currentTime = new Date().getTime();
      const expiration = currentTime + (duration * 60 * 1000);
      const keyPair = ECPair.fromWIF(privateKey, network);
      const publicKey = keyPair.publicKey.toString('hex');
      const buyerPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string
      const outBidAmount = outBidMargin * 1e8
      const maxFloorBid = collection.offerType === "ITEM" && collection.traits && collection.traits.length > 0
        ? collection.maxFloorBid
        : (collection.maxFloorBid <= 100 ? collection.maxFloorBid : 100);
      const minFloorBid = collection.minFloorBid

      if ((collection.offerType === "ITEM" || collection.offerType === "COLLECTION") && !collection.traits && maxFloorBid > 100) {
        Logger.warning(`Offer for ${collection.collectionSymbol} at ${maxFloorBid}% of floor price (above 100%). Skipping bid.`);
        return
      }

      const collectionData = await collectionDetails(collectionSymbol)
      const floorPrice = Number(collectionData?.floorPrice) ?? 0
      const maxPrice = Math.round(collection.maxBid * CONVERSION_RATE)
      const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100))
      const offerType = collection.offerType

      const maxBuy = collection.quantity ?? 1
      const quantity = bidHistory[collectionSymbol].quantity

      if (quantity === maxBuy) return


      if (offerType === "ITEM") {
        if (message.kind === "offer_placed") {
          // Early exit: Check if this bid is from one of our wallets (using buyerPaymentAddress from WebSocket)
          const incomingPaymentAddress = message.buyerPaymentAddress;
          if (isOurPaymentAddress(incomingPaymentAddress)) {
            Logger.info(`[WS] ${tokenId.slice(-8)}: Our own bid (wallet: ${incomingPaymentAddress.slice(0, 10)}...), ignoring`);
            return;
          }

          if (bottomListings.includes(tokenId)) {
            if (incomingBuyerTokenReceiveAddress.toLowerCase() != buyerTokenReceiveAddress.toLowerCase()) {
              let verifiedOfferPrice = +(incomingBidAmount);
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
                const bestOffer = await getBestOffer(tokenId);
                if (!bestOffer?.offers?.length) {
                  // No offers exist - skip counterbid (scheduled loop will handle)
                  Logger.info(`[WS] ${tokenId.slice(-8)}: No offers found, skipping counterbid`);
                  return;
                }

                const topOffer = bestOffer.offers[0];

                // Skip if we already have the top bid (edge case: bidHistory not synced)
                if (topOffer.buyerPaymentAddress === buyerPaymentAddress) {
                  Logger.info(`[WS] ${tokenId.slice(-8)}: We already have top bid, skipping`);
                  return;
                }

                // Use actual top offer price instead of WebSocket event price
                const actualTopPrice = topOffer.price;
                if (actualTopPrice !== verifiedOfferPrice) {
                  Logger.info(`[WS] ${tokenId.slice(-8)}: WebSocket stale (${verifiedOfferPrice}), using actual top ${actualTopPrice}`);
                  verifiedOfferPrice = actualTopPrice;
                }
              }

              // Skip if existing offer already exceeds our maximum bid limit
              if (verifiedOfferPrice > maxOffer) {
                Logger.bidSkipped(collectionSymbol, tokenId, 'Incoming offer exceeds maxBid', verifiedOfferPrice, verifiedOfferPrice, maxOffer);
                return;
              }

              const bidPrice = verifiedOfferPrice + outBidAmount;

              try {
                const userBids = Object.entries(bidHistory).flatMap(([collectionSymbol, bidData]) => {
                  return Object.entries(bidData.ourBids).map(([tokenId, bidInfo]) => ({
                    collectionSymbol,
                    tokenId,
                    price: bidInfo.price,
                    expiration: new Date(bidInfo.expiration).toISOString(),
                  }));
                }).sort((a, b) => a.price - b.price)

                userBids.forEach((bid) => {
                  const givenTimestamp = new Date(bid.expiration);
                  const bidExpiration = new Date();
                  bidExpiration.setMinutes(bidExpiration.getMinutes() + duration);

                  if (givenTimestamp.getTime() >= bidExpiration.getTime()) {
                    Logger.bidCancelled(bid.collectionSymbol, bid.tokenId, 'Expired');
                    delete bidHistory[collectionSymbol].ourBids[bid.tokenId]
                    delete bidHistory[collectionSymbol].topBids[bid.tokenId]
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

                  // Wait if token is already being processed
                  while (processingTokens[tokenId]) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }

                  // Re-check rate limit after waiting - wait again if still rate limited
                  if (isGloballyRateLimited()) {
                    const waitMs = getGlobalResetWaitTime();
                    Logger.queue.waiting(tokenId, Math.ceil(waitMs / 1000));
                    await delay(waitMs + 1000); // +1s buffer
                  }

                  // Mark the token as being processed
                  processingTokens[tokenId] = true;

                  try {
                    const result = await placeBidWithRotation(collection, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey);
                    if (result.success) {
                      recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                      bidHistory[collectionSymbol].topBids[tokenId] = true
                      bidHistory[collectionSymbol].ourBids[tokenId] = {
                        price: bidPrice,
                        expiration: expiration,
                        paymentAddress: result.paymentAddress
                      }
                      Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'COUNTERBID');
                    }
                  } finally {
                    processingTokens[tokenId] = false;
                  }
                }

              } catch (error) {
              }
            }
          }
        }
      } else if (offerType === "COLLECTION") {
        if (message.kind === "coll_offer_created") {
          const collectionSymbol = message.collectionSymbol

          const incomingBidAmount = message.listedPrice
          const ourBidPrice = bidHistory[collectionSymbol].highestCollectionOffer?.price

          const incomingBuyerPaymentAddress = message.buyerPaymentAddress

          // Early exit: Check if this bid is from one of our wallets
          if (isOurPaymentAddress(incomingBuyerPaymentAddress)) {
            Logger.info(`[WS] ${collectionSymbol}: Our own collection offer (wallet: ${incomingBuyerPaymentAddress.slice(0, 10)}...), ignoring`);
            return;
          }

          if (incomingBuyerPaymentAddress.toLowerCase() !== buyerPaymentAddress.toLowerCase() && Number(incomingBidAmount) > Number(ourBidPrice)) {
            Logger.websocket.event('coll_offer_created', collectionSymbol);

            while (processingTokens[collectionSymbol]) {
              Logger.info(`Processing existing collection offer: ${collectionSymbol}`);
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            processingTokens[collectionSymbol] = true

            const bidPrice = +(incomingBidAmount) + outBidAmount
            const offerData = await getBestCollectionOffer(collectionSymbol)
            const ourOffer = offerData?.offers.find((item) => item.btcParams.makerOrdinalReceiveAddress.toLowerCase() === buyerTokenReceiveAddress.toLowerCase())

            if (ourOffer) {
              const offerIds = [ourOffer.id]
              await cancelCollectionOffer(offerIds, publicKey, privateKey)
            }
            const feeSatsPerVbyte = collection.feeSatsPerVbyte || 28
            try {
              if (bidPrice < maxOffer || bidPrice < floorPrice) {
                await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
                bidHistory[collectionSymbol].highestCollectionOffer = {
                  price: bidPrice,
                  buyerPaymentAddress: buyerPaymentAddress
                }
                Logger.collectionOfferPlaced(collectionSymbol, bidPrice);
              }
            } catch (error) {
            } finally {
              delete processingTokens[collectionSymbol]
            }
          }
        }
      }

      if (message.kind === "buying_broadcasted" || message.kind === "offer_accepted_broadcasted" || message.kind === "coll_offer_fulfill_broadcasted") {
        if (incomingBuyerTokenReceiveAddress === buyerTokenReceiveAddress) {
          bidHistory[collectionSymbol].quantity += 1
        }
      }
    } catch (error) {
    }
  }

  async runScheduledTask(item: CollectionData): Promise<void> {
    while (this.isProcessingQueue) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for queue processing to pause
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
    Logger.pacer.cycleStart(pacerStatus.bidsRemaining, BIDS_PER_MINUTE, pacerStatus.windowResetIn);

    const collectionSymbol = item.collectionSymbol
    const traits = item.traits
    const feeSatsPerVbyte = item.feeSatsPerVbyte
    const offerType = item.offerType.toUpperCase()
    const minBid = item.minBid
    const maxBid = item.maxBid
    const bidCount = item.bidCount ?? 20
    const duration = item.duration ?? DEFAULT_OFFER_EXPIRATION
    const outBidMargin = item.outBidMargin ?? DEFAULT_OUTBID_MARGIN
    const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = item.fundingWalletWIF ?? FUNDING_WIF;
    const keyPair = ECPair.fromWIF(privateKey, network);
    const publicKey = keyPair.publicKey.toString('hex');
    const maxBuy = item.quantity ?? 1
    const enableCounterBidding = item.enableCounterBidding ?? false
    const buyerPaymentAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string

    try {

      if (!bidHistory[collectionSymbol]) {
        bidHistory[collectionSymbol] = {
          offerType: "ITEM",
          topOffers: {},
          ourBids: {},
          topBids: {},
          bottomListings: [],
          lastSeenActivity: null,
          quantity: 0
        };
      }

      const quantity = bidHistory[collectionSymbol].quantity
      if (quantity === maxBuy) {
        return
      }

      balance = await getBitcoinBalance(buyerPaymentAddress)
      const collectionData = await collectionDetails(collectionSymbol)
      if (RESTART) {
        const offerData = await getUserOffers(buyerTokenReceiveAddress)
        if (offerData && offerData.offers.length > 0) {
          const offers = offerData.offers
          offers.forEach((item) => {
            if (!bidHistory[item.token.collectionSymbol]) {
              bidHistory[item.token.collectionSymbol] = {
                offerType: "ITEM",
                topOffers: {},
                ourBids: {},
                topBids: {},
                bottomListings: [],
                lastSeenActivity: null,
                quantity: 0
              };
            }
            bidHistory[item.token.collectionSymbol].topBids[item.tokenId] = true
            bidHistory[item.token.collectionSymbol].ourBids[item.tokenId] = {
              price: item.price,
              expiration: item.expirationDate
            }
            bidHistory[collectionSymbol].lastSeenActivity = Date.now()
          })
        }
      }

      let tokens = await retrieveTokens(collectionSymbol, bidCount, traits)
      tokens = tokens.slice(0, bidCount)

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

      bidHistory[collectionSymbol].bottomListings = uniqueBottomListings
      const bottomListings = bidHistory[collectionSymbol].bottomListings

      const currentTime = new Date().getTime();
      const expiration = currentTime + (duration * 60 * 1000);
      const minPrice = Math.round(minBid * CONVERSION_RATE)
      const maxPrice = Math.round(maxBid * CONVERSION_RATE)
      const floorPrice = Number(collectionData?.floorPrice) ?? 0
      const maxFloorBid = item.maxFloorBid
      const minFloorBid = item.minFloorBid
      const minOffer = Math.max(minPrice, Math.round(minFloorBid * floorPrice / 100))
      const maxOffer = Math.min(maxPrice, Math.round(maxFloorBid * floorPrice / 100))

      // Enhanced logging: Show bid calculation details
      Logger.info(`Bid calculations for ${collectionSymbol}:`, {
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

      if ((item.offerType === "ITEM" || item.offerType === "COLLECTION") && !item.traits && maxFloorBid > 100) {
        Logger.warning(`Offer for ${item.collectionSymbol} at ${maxFloorBid}% of floor price (above 100%). Skipping bid.`);
        return
      }

      const userBids = Object.entries(bidHistory).flatMap(([collectionSymbol, bidData]) => {
        return Object.entries(bidData.ourBids).map(([tokenId, bidInfo]) => ({
          collectionSymbol,
          tokenId,
          price: bidInfo.price,
          expiration: new Date(bidInfo.expiration).toISOString(),
        }));
      }).sort((a, b) => a.price - b.price)

      const ourBids = userBids.map((item) => ({ tokenId: item.tokenId, collectionSymbol: item.collectionSymbol })).filter((item) => item.collectionSymbol === collectionSymbol)
      const collectionBottomBids: CollectionBottomBid[] = tokens.map((item) => ({ tokenId: item.id, collectionSymbol: item.collectionSymbol })).filter((item) => item.collectionSymbol === collectionSymbol)
      const tokensToCancel = findTokensToCancel(collectionBottomBids, ourBids)
      const bottomListingBids = combineBidsAndListings(userBids, bottomListings)
      console.log('--------------------------------------------------------------------------------');
      console.log(`BOTTOM LISTING BIDS FOR ${collectionSymbol}`);
      console.table(bottomListingBids)
      console.log('--------------------------------------------------------------------------------');

      if (tokensToCancel.length > 0) {
        await queue.addAll(
          tokensToCancel.map(token => async () => {
            const offerData = await getOffers(token.tokenId, buyerTokenReceiveAddress)
            if (offerData && Number(offerData.total) > 0) {
              const offers = offerData?.offers.filter((item) => item.buyerPaymentAddress === buyerPaymentAddress)
              // Memory leak fix: Use Promise.all instead of forEach for async operations
              await Promise.all(offers.map(async (item) => {
                await cancelBid(
                  item,
                  privateKey,
                  collectionSymbol,
                  item.tokenId,
                  buyerPaymentAddress
                );
                delete bidHistory[collectionSymbol].ourBids[token.tokenId]
                delete bidHistory[collectionSymbol].topBids[token.tokenId]
              }))
            }
          })
        )
      }

      userBids.forEach((bid) => {
        const givenTimestamp = new Date(bid.expiration);
        const bidExpiration = new Date();
        bidExpiration.setMinutes(bidExpiration.getMinutes() + duration);

        if (givenTimestamp.getTime() >= bidExpiration.getTime()) {
          Logger.bidCancelled(collectionSymbol, bid.tokenId, 'Expired');
          delete bidHistory[collectionSymbol].ourBids[bid.tokenId]
          delete bidHistory[collectionSymbol].topBids[bid.tokenId]
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
      let alreadyHaveBids = 0;
      let skippedOfferTooHigh = 0;
      let skippedBidTooHigh = 0;
      let skippedAlreadyOurs = 0;
      let noActionNeeded = 0;          // Existing bid is optimal, no adjustment needed
      let bestOfferIssue = 0;          // bestOffer is null/empty/malformed
      let unhandledPath = 0;           // Token didn't match any known code path

      if (offerType.toUpperCase() === "ITEM") {
        // Check global rate limit before queuing - wait if rate limited
        if (isGloballyRateLimited()) {
          const waitMs = getGlobalResetWaitTime();
          Logger.schedule.rateLimited(collectionSymbol, Math.ceil(waitMs / 1000));
          await delay(waitMs);
        }

        await queue.addAll(
          uniqueListings.sort((a, b) => a.price - b.price)
            .slice(0, bidCount)
            .map(token => async () => {
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

                const bestOffer = await getBestOffer(tokenId);
                const ourExistingOffer = bidHistory[collectionSymbol].ourBids[tokenId]?.expiration > Date.now()

                const currentExpiry = bidHistory[collectionSymbol]?.ourBids[tokenId]?.expiration
              const newExpiry = duration * 60 * 1000
              const offerData = await getOffers(tokenId, buyerTokenReceiveAddress)
              const offer = offerData?.offers.filter((item) => item.buyerPaymentAddress === buyerPaymentAddress)

              if (currentExpiry - Date.now() > newExpiry) {
                if (offer) {
                  // Memory leak fix: Use Promise.all instead of forEach for async operations
                  await Promise.all(offer.map(async (item) => {
                    await cancelBid(
                      item,
                      privateKey,
                      collectionSymbol,
                      tokenId,
                      buyerPaymentAddress
                    );
                    delete bidHistory[collectionSymbol].ourBids[tokenId]
                    delete bidHistory[collectionSymbol].topBids[tokenId]
                  }))
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
                if (bestOffer && bestOffer.offers && bestOffer.offers.length > 0) {
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

                    const bidPrice = currentPrice + (outBidMargin * CONVERSION_RATE)
                    if (bidPrice <= maxOffer) {
                      try {
                        const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress)
                        if (result.success) {
                          recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                          bidHistory[collectionSymbol].topBids[tokenId] = true
                          bidHistory[collectionSymbol].ourBids[tokenId] = {
                            price: bidPrice,
                            expiration: expiration,
                            paymentAddress: result.paymentAddress
                          }
                          Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'OUTBID');
                          newBidsPlaced++;
                        } else {
                          unhandledPath++;
                        }
                      } catch (error) {
                        Logger.error(`Failed to place bid for ${collectionSymbol} ${tokenId}`, error);
                        unhandledPath++;
                      }
                    } else {
                      skippedBidTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Calculated bid exceeds maxBid', currentPrice, bidPrice, maxOffer);
                    }
                  } else {
                    // Top offer is from one of our wallet pool addresses, but not tracked in bidHistory
                    // This indicates an orphaned bid from a previous run
                    skippedAlreadyOurs++;
                    Logger.info(`Token ${tokenId.slice(-8)}: Existing offer from our address (${topOffer?.price} sats) not in bidHistory - orphaned bid`);
                  }
                }
                /*
                 * This condition executes where we don't have an existing offer on a token
                 * and there is no active offer on that token
                 * we bid the minimum on that token
                */
                else {
                  const bidPrice = Math.max(listedPrice * 0.5, minOffer)
                  if (bidPrice <= maxOffer) {
                    try {
                      const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress)
                      if (result.success) {
                        recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                        bidHistory[collectionSymbol].topBids[tokenId] = true
                        bidHistory[collectionSymbol].ourBids[tokenId] = {
                          price: bidPrice,
                          expiration: expiration,
                          paymentAddress: result.paymentAddress
                        }
                        Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'NEW');
                        newBidsPlaced++;
                      } else {
                        unhandledPath++;
                      }
                    } catch (error) {
                      Logger.error(`Failed to place minimum bid for ${collectionSymbol} ${tokenId}`, error);
                      unhandledPath++;
                    }
                  } else {
                    skippedBidTooHigh++;
                    Logger.bidSkipped(collectionSymbol, tokenId, 'Calculated bid exceeds maxBid', bidPrice, bidPrice, maxOffer);
                  }
                }
              }
              // Catch-all for unhandled paths in !ourExistingOffer block
              else if (!ourExistingOffer) {
                unhandledPath++;
                Logger.warning(`Token ${tokenId.slice(-8)}: No existing offer but didn't match any bid placement condition`);
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
                  const [topOffer, secondTopOffer] = bestOffer.offers
                  const bestPrice = topOffer.price

                  if (!isOurPaymentAddress(topOffer.buyerPaymentAddress)) {
                    const currentPrice = topOffer.price

                    // Skip if existing offer already exceeds our maximum bid limit
                    if (currentPrice > maxOffer) {
                      skippedOfferTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Existing offer exceeds maxBid', currentPrice, currentPrice, maxOffer);
                      return;
                    }

                    const bidPrice = currentPrice + (outBidMargin * CONVERSION_RATE)

                    if (bidPrice <= maxOffer) {
                      try {
                        const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress)
                        if (result.success) {
                          recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                          bidHistory[collectionSymbol].topBids[tokenId] = true
                          bidHistory[collectionSymbol].ourBids[tokenId] = {
                            price: bidPrice,
                            expiration: expiration,
                            paymentAddress: result.paymentAddress
                          }
                          Logger.bidPlaced(collectionSymbol, tokenId, bidPrice, 'OUTBID');
                          newBidsPlaced++;
                        }
                      } catch (error) {
                        Logger.error(`Failed to outbid for ${collectionSymbol} ${tokenId}`, error);
                      }
                    } else {
                      skippedBidTooHigh++;
                      Logger.bidSkipped(collectionSymbol, tokenId, 'Calculated bid exceeds maxBid', currentPrice, bidPrice, maxOffer);
                    }

                  } else {
                    if (secondTopOffer) {
                      const secondBestPrice = secondTopOffer.price
                      const outBidAmount = outBidMargin * CONVERSION_RATE
                      if (bestPrice - secondBestPrice > outBidAmount) {
                        const bidPrice = secondBestPrice + outBidAmount

                        if (bidPrice <= maxOffer) {
                          try {
                            const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress)
                            if (result.success) {
                              recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration,
                                paymentAddress: result.paymentAddress
                              }
                              Logger.bidAdjusted(collectionSymbol, tokenId, bestPrice, bidPrice);
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
                      const bidPrice = Math.max(minOffer, listedPrice * 0.5)
                      if (bestPrice !== bidPrice) { // self adjust bids.
                        if (bidPrice <= maxOffer) {
                          try {
                            const result = await placeBidWithRotation(item, tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey, sellerReceiveAddress)
                            if (result.success) {
                              recentBids.set(tokenId, Date.now());  // Record bid time for deduplication
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration,
                                paymentAddress: result.paymentAddress
                              }
                              Logger.bidAdjusted(collectionSymbol, tokenId, bestPrice, bidPrice);
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
                }
              }
              } catch (error) {
                console.error(`[CRITICAL] Token ${tokenId.slice(-8)} crashed:`, error);
                unhandledPath++;
              }
            })
        )

      } else if (offerType.toUpperCase() === "COLLECTION") {
        const bestOffer = await getBestCollectionOffer(collectionSymbol)
        if (bestOffer && bestOffer.offers.length > 0) {

          const [topOffer, secondTopOffer] = bestOffer.offers
          const bestPrice = topOffer.price.amount

          bidHistory[collectionSymbol].highestCollectionOffer = {
            price: bestPrice,
            buyerPaymentAddress: topOffer.btcParams.makerPaymentAddress
          };

          const ourOffer = bestOffer.offers.find((item) => item.btcParams.makerPaymentAddress.toLowerCase() === buyerPaymentAddress.toLowerCase()) as ICollectionOffer

          if (topOffer.btcParams.makerPaymentAddress !== buyerPaymentAddress) {
            try {
              if (ourOffer) {
                const offerIds = [ourOffer.id]
                await cancelCollectionOffer(offerIds, publicKey, privateKey)
              }
            } catch (error) {
            }

            const currentPrice = topOffer.price.amount
            const bidPrice = currentPrice + (outBidMargin * CONVERSION_RATE)

            if (bidPrice <= maxOffer) {
              try {
                if (bidPrice < floorPrice) {
                  await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
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
              const outBidAmount = outBidMargin * CONVERSION_RATE
              if (bestPrice - secondBestPrice > outBidAmount) {
                const bidPrice = secondBestPrice + outBidAmount

                try {
                  if (ourOffer) {
                    const offerIds = [ourOffer.id]
                    await cancelCollectionOffer(offerIds, publicKey, privateKey)
                  }

                } catch (error) {
                }

                if (bidPrice <= maxOffer) {
                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
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
                    await cancelCollectionOffer(offerIds, publicKey, privateKey)
                  }
                } catch (error) {
                  Logger.error(`Failed to cancel collection offer for ${collectionSymbol}`, error);
                }

                if (bidPrice <= maxOffer) {
                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
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
              await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
              bidHistory[collectionSymbol].offerType = "COLLECTION"

              bidHistory[collectionSymbol].highestCollectionOffer = {
                price: bidPrice,
                buyerPaymentAddress: buyerPaymentAddress
              }
            }
          }
        }
      }

      // Log bid placement summary
      const currentActiveBids = Object.keys(bidHistory[collectionSymbol].ourBids).filter(
        tokenId => bidHistory[collectionSymbol].ourBids[tokenId]?.expiration > Date.now()
      ).length;

      Logger.summary.bidPlacement({
        tokensProcessed,
        newBidsPlaced,
        alreadyHaveBids,
        noActionNeeded,
        skippedOfferTooHigh,
        skippedBidTooHigh,
        skippedAlreadyOurs,
        unhandledPath,
        currentActiveBids,
        bidCount,
      });

      RESTART = false
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
    } catch (err) {
      console.log('[WARNING] Error cleaning up old WebSocket:', err);
    }
  }

  ws = new WebSocket(baseEndpoint);


  ws.addEventListener("open", function open() {
    Logger.websocket.connected();

    retryCount = 0;
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
    if (heartbeatIntervalId !== null) {
      clearInterval(heartbeatIntervalId);
    }
    heartbeatIntervalId = setInterval(() => {
      if (ws) {
        ws.send(
          JSON.stringify({
            topic: "nfttools",
            event: "heartbeat",
            payload: {},
            ref: 0,
          })
        );
      }
    }, 10000);

    if (collections.length > 0) {
      subscribeToCollections(collections)
    }

    ws.on("message", function incoming(data: string) {
      if (isValidJSON(data.toString())) {
        const message: CollectOfferActivity = JSON.parse(data);
        eventManager.receiveWebSocketEvent(message)
      }
    });
  });

  ws.addEventListener("close", function close() {
    Logger.websocket.disconnected();
    if (heartbeatIntervalId !== null) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    attemptReconnect();
  });

  ws.addEventListener("error", function error(err) {
    if (ws) {
      ws.close();
    }
  });
}

const MAX_RETRIES: number = 5;

function attemptReconnect(): void {
  if (retryCount < MAX_RETRIES) {
    if (reconnectTimeoutId !== null) {
      clearTimeout(reconnectTimeoutId);
    }
    let delay: number = Math.pow(2, retryCount) * 1000;
    console.log(`Attempting to reconnect in ${delay / 1000} seconds...`);
    reconnectTimeoutId = setTimeout(connectWebSocket, delay);
    retryCount++;
  } else {
    console.log("Max retries reached. Giving up on reconnecting.");
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
      ws.send(JSON.stringify(subscriptionMessage));
      Logger.websocket.subscribed(item.collectionSymbol);
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
  await Promise.all(
    collections.map(item => startCollectionMonitoring(item))
  );
}

// Initialize bid pacer for rate limiting (5 bids/min by default)
initializeBidPacer(BIDS_PER_MINUTE);
Logger.info(`[BID PACER] Initialized with ${BIDS_PER_MINUTE} bids/minute limit`);

// Initialize wallet pool if multi-wallet rotation is enabled
if (ENABLE_WALLET_ROTATION) {
  try {
    if (!fs.existsSync(WALLET_CONFIG_PATH)) {
      Logger.warning(`[WALLET ROTATION] Config file not found at ${WALLET_CONFIG_PATH}`);
      Logger.warning('[WALLET ROTATION] Copy src/config/wallets.example.json to src/config/wallets.json and configure your wallets');
      Logger.warning('[WALLET ROTATION] Continuing with single wallet mode...');
    } else {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));
      if (!walletConfig.wallets || walletConfig.wallets.length === 0) {
        Logger.warning('[WALLET ROTATION] No wallets configured in wallets.json');
        Logger.warning('[WALLET ROTATION] Continuing with single wallet mode...');
      } else {
        initializeWalletPool(walletConfig.wallets, walletConfig.bidsPerMinute || 5, network);
        Logger.success(`[WALLET ROTATION] Initialized wallet pool with ${walletConfig.wallets.length} wallets`);
        Logger.info(`[WALLET ROTATION] Each wallet limited to ${walletConfig.bidsPerMinute || 5} bids/min`);
        Logger.info(`[WALLET ROTATION] Maximum throughput: ${walletConfig.wallets.length * (walletConfig.bidsPerMinute || 5)} bids/min`);
      }
    }
  } catch (error: any) {
    Logger.error(`[WALLET ROTATION] Failed to initialize wallet pool: ${error.message}`);
    Logger.warning('[WALLET ROTATION] Continuing with single wallet mode...');
  }
}

connectWebSocket();

startProcessing();

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function writeBidHistoryToFile() {
  const jsonString = JSON.stringify(bidHistory, null, 2);
  const filePath = 'bidHistory.json';

  fs.writeFile(filePath, jsonString, 'utf-8', (err) => {
    if (err) {
      console.error('Error writing bidHistory to file:', err);
      return;
    }
    console.log('bidHistory has been written to bidHistory.json');
  });
}

// Write comprehensive bot stats for manage CLI to display
function writeBotStatsToFile() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

  // Get bid stats from logger
  const bidStatsData = getBidStatsData();

  // Get pacer status
  const pacerStatus = getBidPacerStatus();

  // Get wallet pool stats if enabled
  let walletPoolData = null;
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const stats = getWalletPoolStats();
    walletPoolData = {
      available: stats.available,
      total: stats.total,
      bidsPerMinute: stats.bidsPerMinute,
      wallets: stats.wallets.map(w => ({
        label: w.label,
        bidCount: w.bidCount,
        isAvailable: w.isAvailable,
        secondsUntilReset: w.secondsUntilReset,
      })),
    };
  }

  // Count total bids being tracked
  let totalBidsTracked = 0;
  for (const collectionSymbol in bidHistory) {
    totalBidsTracked += Object.keys(bidHistory[collectionSymbol].ourBids).length;
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
      bidsUsed: pacerStatus.bidsUsed,
      bidsRemaining: pacerStatus.bidsRemaining,
      windowResetIn: pacerStatus.windowResetIn,
      totalBidsPlaced: pacerStatus.totalBidsPlaced,
      totalWaits: pacerStatus.totalWaits,
      bidsPerMinute: BIDS_PER_MINUTE,
    },
    walletPool: walletPoolData,
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
      connected: ws && ws.readyState === WebSocket.OPEN,
    },
    bidsTracked: totalBidsTracked,
  };

  const jsonString = JSON.stringify(stats, null, 2);
  const filePath = 'botStats.json';

  fs.writeFile(filePath, jsonString, 'utf-8', (err) => {
    if (err) {
      console.error('Error writing botStats to file:', err);
    }
  });
}

// Write bot stats every 30 seconds
const BOT_STATS_WRITE_INTERVAL_MS = 30 * 1000; // 30 seconds
setInterval(writeBotStatsToFile, BOT_STATS_WRITE_INTERVAL_MS);

// Initial write after 5 seconds
setTimeout(writeBotStatsToFile, 5000);

// Memory leak fix: Clean up old bidHistory entries
function cleanupBidHistory() {
  const now = Date.now();
  let totalCleaned = 0;

  // Clean up expired entries from recentBids deduplication map
  let recentBidsCleaned = 0;
  for (const [tokenId, timestamp] of recentBids.entries()) {
    if (now - timestamp > RECENT_BID_COOLDOWN_MS * 2) {  // 2x cooldown for safety margin
      recentBids.delete(tokenId);
      recentBidsCleaned++;
    }
  }
  if (recentBidsCleaned > 0) {
    Logger.info(`[CLEANUP] Removed ${recentBidsCleaned} expired entries from recentBids map`);
  }

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

    // Clean expired ourBids (older than 24 hours or already expired)
    for (const tokenId in collection.ourBids) {
      const bid = collection.ourBids[tokenId];
      if (bid.expiration < now || (now - bid.expiration) > BID_HISTORY_MAX_AGE_MS) {
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

    // Clean old topOffers (older than 24 hours)
    for (const tokenId in collection.topOffers) {
      const lastActivity = collection.lastSeenActivity || 0;
      if (now - lastActivity > BID_HISTORY_MAX_AGE_MS) {
        delete collection.topOffers[tokenId];
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
    Logger.memory.cleanup(totalCleaned);
  }
}

// Start periodic cleanup
setInterval(cleanupBidHistory, BID_HISTORY_CLEANUP_INTERVAL_MS);

// Memory leak fix: Add memory monitoring and alerting
let lastMemoryCheck = { heapUsed: process.memoryUsage().heapUsed, timestamp: Date.now() };
const MEMORY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const MEMORY_WARNING_THRESHOLD_MB = 1500; // Warn if heap exceeds 1.5GB
const MEMORY_GROWTH_RATE_THRESHOLD_MB_PER_MIN = 10; // Warn if growing faster than 10MB/min

function monitorMemoryUsage() {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  const heapTotalMB = memUsage.heapTotal / 1024 / 1024;

  const now = Date.now();
  const timeDiffMin = (now - lastMemoryCheck.timestamp) / 60000;
  const heapGrowthMB = heapUsedMB - (lastMemoryCheck.heapUsed / 1024 / 1024);
  const growthRatePerMin = timeDiffMin > 0 ? heapGrowthMB / timeDiffMin : 0;

  // Count total bids being tracked
  let totalBidsTracked = 0;
  for (const collectionSymbol in bidHistory) {
    totalBidsTracked += Object.keys(bidHistory[collectionSymbol].ourBids).length;
  }

  Logger.memory.status(heapUsedMB, heapTotalMB, eventManager.queue.length, totalBidsTracked);

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
setInterval(monitorMemoryUsage, MEMORY_CHECK_INTERVAL_MS);

// Initial memory check after 1 minute
setTimeout(monitorMemoryUsage, 60000);

// Print bid pacer progress every 30 seconds when queue has pending items
const PACER_PROGRESS_INTERVAL_MS = 30 * 1000; // 30 seconds
setInterval(() => {
  if (queue.size > 0 || queue.pending > 0) {
    const status = getBidPacerStatus();
    Logger.queue.progress(queue.size, queue.pending, status.bidsUsed, BIDS_PER_MINUTE, status.windowResetIn, status.totalBidsPlaced);
  }
}, PACER_PROGRESS_INTERVAL_MS);

// Print bid statistics every 30 minutes
const BID_STATS_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  Logger.printStats();

  // Print pacer stats
  const pacerStatus = getBidPacerStatus();
  console.log('');
  console.log('━'.repeat(60));
  console.log('⏱️  BID PACER STATUS');
  console.log('━'.repeat(60));
  console.log(`  Bids in window:     ${pacerStatus.bidsUsed}/${BIDS_PER_MINUTE}`);
  console.log(`  Window resets in:   ${pacerStatus.windowResetIn}s`);
  console.log(`  Total bids placed:  ${pacerStatus.totalBidsPlaced}`);
  console.log(`  Total waits:        ${pacerStatus.totalWaits}`);
  console.log('━'.repeat(60));

  // Print wallet pool stats if rotation is enabled
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const stats = getWalletPoolStats();
    console.log('');
    console.log('━'.repeat(60));
    console.log('💳 WALLET POOL STATUS');
    console.log('━'.repeat(60));
    console.log(`  Available wallets: ${stats.available}/${stats.total}`);
    console.log(`  Rate limit: ${stats.bidsPerMinute} bids/min per wallet`);
    console.log(`  Max throughput: ${stats.total * stats.bidsPerMinute} bids/min`);
    console.log('');
    stats.wallets.forEach(w => {
      const statusIcon = w.isAvailable ? '✅' : '⏳';
      console.log(`  ${statusIcon} ${w.label}: ${w.bidCount}/${stats.bidsPerMinute} bids (reset in ${w.secondsUntilReset}s)`);
    });
    console.log('━'.repeat(60));
  }
}, BID_STATS_INTERVAL_MS);

process.on('SIGINT', () => {
  Logger.info('Received SIGINT signal. Shutting down...');
  Logger.printStats();
  writeBidHistoryToFile();
  process.exit(0)
});

async function cancelBid(offer: IOffer, privateKey: string, collectionSymbol?: string, tokenId?: string, buyerPaymentAddress?: string) {
  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id)
    if (offerFormat) {
      const signedOfferFormat = signData(offerFormat, privateKey)
      if (signedOfferFormat) {
        await submitCancelOfferData(offer.id, signedOfferFormat)

      }
    }
  } catch (error) {
  }
}



function findTokensToCancel(tokens: CollectionBottomBid[], ourBids: { tokenId: string, collectionSymbol: string }[]): {
  tokenId: string;
  collectionSymbol: string;
}[] {

  const missingBids = ourBids.filter(bid =>
    !tokens.some(token => token.tokenId === bid.tokenId && token.collectionSymbol === bid.collectionSymbol)
  );
  return missingBids;
}

interface CollectionBottomBid {
  tokenId: string;
  collectionSymbol: string
}

interface PlaceBidResult {
  success: boolean;
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
  sellerReceiveAddress?: string
): Promise<PlaceBidResult> {
  let buyerTokenReceiveAddress = fallbackReceiveAddress;
  let buyerPaymentAddress = fallbackPaymentAddress;
  let publicKey = fallbackPublicKey;
  let privateKey = fallbackPrivateKey;
  let walletLabel: string | undefined;

  // If wallet rotation is enabled, try to get a wallet from the pool
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = getAvailableWallet();
    if (!wallet) {
      Logger.wallet.allRateLimited(tokenId);
      return { success: false };
    }

    buyerTokenReceiveAddress = wallet.config.receiveAddress;
    buyerPaymentAddress = wallet.paymentAddress;
    publicKey = wallet.publicKey;
    privateKey = wallet.config.wif;
    walletLabel = wallet.config.label;

    Logger.wallet.using(walletLabel || 'unnamed', tokenId);
  }

  try {
    // Only use global pacer if wallet rotation is disabled
    // When wallet rotation is enabled, the wallet pool handles per-wallet rate limiting
    if (!ENABLE_WALLET_ROTATION || !isWalletPoolInitialized()) {
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
      sellerReceiveAddress
    );

    if (success) {
      // Record to global pacer only if wallet rotation is disabled
      if (!ENABLE_WALLET_ROTATION || !isWalletPoolInitialized()) {
        recordPacerBid();
      }

      // Record to wallet pool if rotation is enabled
      if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
        recordSuccessfulBid(buyerPaymentAddress);
      }
    }

    return {
      success: success === true,
      paymentAddress: success ? buyerPaymentAddress : undefined,
      walletLabel,
    };
  } catch (error: any) {
    // Check for rate limit errors - API returns "Rate limit exceeded, retry in 1 minute"
    // as a string directly in error.response.data, not in error.response.data.error
    const errorData = error?.response?.data;
    const errorMessage = typeof errorData === 'string' ? errorData : errorData?.error || error?.message || '';
    const isRateLimitError =
      error?.response?.status === 429 ||
      errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('too many requests');

    if (isRateLimitError) {
      // Pass error message so pacer can extract retry duration
      onRateLimitError(errorMessage);
      Logger.pacer.error(tokenId);
    }

    return { success: false };
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
  sellerReceiveAddress?: string
) {
  try {
    const price = Math.round(offerPrice)
    // check for current offers and cancel before placing the bid
    await delay(2000);
    const offerData = await getOffers(tokenId, buyerTokenReceiveAddress)

    if (offerData && offerData.offers.length > 0) {
      const offers = offerData.offers
      // Memory leak fix: Use Promise.all instead of forEach for async operations
      await Promise.all(offers.map(async (item) => {
        await cancelBid(item, privateKey)
      }))
    }

    const unsignedOffer = await createOffer(tokenId, price, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, FEE_RATE_TIER, sellerReceiveAddress)
    const signedOffer = await signData(unsignedOffer, privateKey)
    if (signedOffer) {
      await submitSignedOfferOrder(signedOffer, tokenId, offerPrice, expiration, buyerPaymentAddress, buyerTokenReceiveAddress, publicKey, FEE_RATE_TIER, privateKey, sellerReceiveAddress)
      return true
    }

  } catch (error: any) {
    console.error(`[PLACEBID ERROR] Token ${tokenId.slice(-8)}: ${error?.message || error}`);

    // Log more details about the error
    if (error?.response?.data) {
      console.error(`[PLACEBID API ERROR] Response:`, error.response.data);
    }
    if (error?.response?.status) {
      console.error(`[PLACEBID HTTP STATUS] ${error.response.status}`);
    }

    // Check for rate limit errors - must re-throw so placeBidWithRotation can handle
    const errorData = error?.response?.data;
    const errorMessage = typeof errorData === 'string' ? errorData : errorData?.error || error?.message || '';
    const isRateLimitError =
      error?.response?.status === 429 ||
      errorMessage.toLowerCase().includes('rate limit') ||
      errorMessage.toLowerCase().includes('too many requests');

    if (isRateLimitError) {
      // Re-throw rate limit errors so placeBidWithRotation() can trigger onRateLimitError()
      throw error;
    }

    // Check for "Invalid platform fee address" error - skip this token, don't retry
    if (errorMessage.toLowerCase().includes('invalid platform fee address')) {
      console.log(`[SKIP] Token ${tokenId.slice(-8)}: Invalid platform fee address - skipping`);
      return false;
    }

    // Check for specific error patterns
    if (error?.message?.includes('maximum number of offers')) {
      console.error(`[PLACEBID LIMIT] Hit maximum offer limit!`);
    }
    if (error?.message?.includes('Insufficient funds')) {
      console.error(`[PLACEBID FUNDS] Insufficient funds error`);
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
) {
  const priceSats = Math.ceil(offerPrice)
  const expirationAt = new Date(expiration).toISOString();

  if (offerPrice > Number(balance)) {
    Logger.warning(`Insufficient BTC to place bid for ${collectionSymbol}. Balance: ${balance}, Required: ${offerPrice / 1e8} BTC`);
    return
  }

  const unsignedCollectionOffer = await createCollectionOffer(collectionSymbol, priceSats, expirationAt, feeSatsPerVbyte, publicKey, buyerTokenReceiveAddress, privateKey)


  if (unsignedCollectionOffer) {
    const { signedOfferPSBTBase64, signedCancelledPSBTBase64 } = signCollectionOffer(unsignedCollectionOffer, privateKey)
    await submitCollectionOffer(signedOfferPSBTBase64, collectionSymbol, priceSats, expirationAt, publicKey, buyerTokenReceiveAddress, privateKey, signedCancelledPSBTBase64)
  }

}

function isValidJSON(str: string) {
  try {
    JSON.parse(str);
    return true;
  } catch (e) {
    return false;
  }
}

function combineBidsAndListings(userBids: UserBid[], bottomListings: BottomListing[]) {
  const combinedArray = userBids
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
    .filter(entry => entry !== null);

  return combinedArray.sort((a: any, b: any) => a.listedPrice - b.listedPrice);
}

interface UserBid {
  collectionSymbol: string;
  tokenId: string;
  price: number;
  expiration: string;
}

interface BottomListing {
  id: string;
  price: number;
}

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
  traits: Trait[]
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
