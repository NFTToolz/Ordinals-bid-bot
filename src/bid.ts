import { config } from "dotenv"
import fs from "fs"
import * as bitcoin from "bitcoinjs-lib";
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import PQueue from "p-queue"
import { getBitcoinBalance } from "./utils";
import { ICollectionOffer, IOffer, cancelCollectionOffer, createCollectionOffer, createOffer, getBestCollectionOffer, getBestOffer, getOffers, getUserOffers, retrieveCancelOfferFormat, signCollectionOffer, signData, submitCancelOfferData, submitCollectionOffer, submitSignedOfferOrder } from "./functions/Offer";
import { OfferPlaced, collectionDetails } from "./functions/Collection";
import { retrieveTokens } from "./functions/Tokens";
import axiosInstance from "./axios/axiosInstance";
import limiter from "./bottleneck";
import WebSocket from 'ws';


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

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

const DEFAULT_LOOP = Number(process.env.DEFAULT_LOOP) ?? 30
let RESTART = true

// Define a global map to track processing tokens
const processingTokens: Record<string, boolean> = {};

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
        expiration: number
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

const queue = new PQueue({
  concurrency: 1.5 * RATE_LIMIT
});

let ws: WebSocket;
let heartbeatIntervalId: NodeJS.Timeout | null = null;
let reconnectTimeoutId: NodeJS.Timeout | null = null;
let retryCount: number = 0;

class EventManager {
  queue: any[];
  isScheduledRunning: boolean;
  isProcessingQueue: boolean;


  constructor() {
    this.queue = [];
    this.isScheduledRunning = false;
    this.isProcessingQueue = false;
  }

  async receiveWebSocketEvent(event: CollectOfferActivity): Promise<void> {
    this.queue.push(event);
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
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
        console.log('\x1b[31m%s\x1b[0m', `WARNING: Making an offer for ${collection.collectionSymbol} at ${maxFloorBid}% of floor price, which is higher than the floor price. Skip Bid`);
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
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
          if (bottomListings.includes(tokenId)) {
            if (incomingBuyerTokenReceiveAddress.toLowerCase() != buyerTokenReceiveAddress.toLowerCase()) {
              const bidPrice = +(incomingBidAmount) + outBidAmount
              console.log('---------------------------------------------------------------------------------------------');
              console.log(`COUNTERBID CURRENT OFFER ${(+incomingBidAmount / 1e8)} OUR OFFER ${(bidPrice / 1e8)} FOR ${collectionSymbol} ${tokenId}`);
              console.log('---------------------------------------------------------------------------------------------');

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
                    console.log('REMOVE EXPIRED BIDS');
                    delete bidHistory[collectionSymbol].ourBids[bid.tokenId]
                    delete bidHistory[collectionSymbol].topBids[bid.tokenId]
                  }
                })

                if (bidPrice <= maxOffer) {

                  let status;
                  // Wait if token is already being processed
                  while (processingTokens[tokenId]) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                  }

                  // Mark the token as being processed
                  processingTokens[tokenId] = true;

                  try {
                    status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey);
                    if (status === true) {
                      bidHistory[collectionSymbol].topBids[tokenId] = true
                      bidHistory[collectionSymbol].ourBids[tokenId] = {
                        price: bidPrice,
                        expiration: expiration
                      }
                    }
                  } finally {
                    processingTokens[tokenId] = false;
                  }
                  if (status === true) {
                    bidHistory[collectionSymbol].topBids[tokenId] = true
                    bidHistory[collectionSymbol].ourBids[tokenId] = {
                      price: bidPrice,
                      expiration: expiration
                    }
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
          if (incomingBuyerPaymentAddress.toLowerCase() !== buyerPaymentAddress.toLowerCase() && Number(incomingBidAmount) > Number(ourBidPrice)) {
            console.log(`COUNTERBID FOR ${collectionSymbol} COLLECTION OFFER`);

            while (processingTokens[collectionSymbol]) {
              console.log(`Processing existing collection offer: ${collectionSymbol}`.toUpperCase());
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
    console.log('Scheduled task is waiting for queue to complete.');
    while (this.isProcessingQueue) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for queue processing to pause
    }
    console.log('Scheduled task running...');
    this.isScheduledRunning = true;
    this.processScheduledLoop(item);
    console.log('Scheduled task completed.');
    this.isScheduledRunning = false;
  }

  async processScheduledLoop(item: CollectionData) {

    console.log('----------------------------------------------------------------------');
    console.log(`START AUTOBID SCHEDULE FOR ${item.collectionSymbol}`);
    console.log('----------------------------------------------------------------------');

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


      if (minFloorBid > maxFloorBid) {
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
        console.log('\x1b[31m%s\x1b[0m', `WARNING: Min floor bid ${item.minFloorBid} % for ${item.collectionSymbol} > max floor bid ${item.maxFloorBid} %. Skip Bid`);
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
        return
      }

      if ((item.offerType === "ITEM" || item.offerType === "COLLECTION") && !item.traits && maxFloorBid > 100) {
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
        console.log('\x1b[31m%s\x1b[0m', `WARNING: Making an offer for ${item.collectionSymbol} at ${maxFloorBid}% of floor price, which is higher than the floor price. Skip Bid`);
        console.log('\x1b[31m%s\x1b[0m', `-----------------------------------------------------------------------------------------------------------------------------------`);
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
              offers.forEach(async (item) => {
                await cancelBid(
                  item,
                  privateKey,
                  collectionSymbol,
                  item.tokenId,
                  buyerPaymentAddress
                );
                delete bidHistory[collectionSymbol].ourBids[token.tokenId]
                delete bidHistory[collectionSymbol].topBids[token.tokenId]
              })
            }
          })
        )
      }

      userBids.forEach((bid) => {
        const givenTimestamp = new Date(bid.expiration);
        const bidExpiration = new Date();
        bidExpiration.setMinutes(bidExpiration.getMinutes() + duration);

        if (givenTimestamp.getTime() >= bidExpiration.getTime()) {
          console.log('REMOVE EXPIRED BIDS');
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

      if (offerType.toUpperCase() === "ITEM") {
        await queue.addAll(
          uniqueListings.sort((a, b) => a.price - b.price)
            .slice(0, bidCount)
            .map(token => async () => {
              const { id: tokenId, price: listedPrice } = token

              const bestOffer = await getBestOffer(tokenId);
              const ourExistingOffer = bidHistory[collectionSymbol].ourBids[tokenId]?.expiration > Date.now()
              const currentExpiry = bidHistory[collectionSymbol]?.ourBids[tokenId]?.expiration
              const newExpiry = duration * 60 * 1000
              const offerData = await getOffers(tokenId, buyerTokenReceiveAddress)
              const offer = offerData?.offers.filter((item) => item.buyerPaymentAddress === buyerPaymentAddress)

              if (currentExpiry - Date.now() > newExpiry) {
                if (offer) {
                  offer.forEach(async (item) => {
                    await cancelBid(
                      item,
                      privateKey,
                      collectionSymbol,
                      tokenId,
                      buyerPaymentAddress
                    );
                    delete bidHistory[collectionSymbol].ourBids[tokenId]
                    delete bidHistory[collectionSymbol].topBids[tokenId]
                  })
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

                if (bestOffer && Number(bestOffer.total) > 0) {
                  const topOffer = bestOffer.offers[0]
                  /*
                   * This condition executes where we don't have an existing offer on a token
                   * And there's a current offer on that token
                   * we outbid the current offer on the token if the calculated bid price is less than our max bid amount
                  */
                  if (topOffer?.buyerPaymentAddress !== buyerPaymentAddress) {
                    const currentPrice = topOffer.price
                    const bidPrice = currentPrice + (outBidMargin * CONVERSION_RATE)
                    if (bidPrice <= maxOffer) {


                      if (RESTART || !enableCounterBidding) {
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        console.log(`OUTBID CURRENT OFFER ${currentPrice / 1e8} BTC OUR OFFER ${bidPrice / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        try {
                          const status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey)
                          if (status === true) {
                            bidHistory[collectionSymbol].topBids[tokenId] = true
                            bidHistory[collectionSymbol].ourBids[tokenId] = {
                              price: bidPrice,
                              expiration: expiration
                            }
                          }
                        } catch (error) {
                        }
                      }

                    } else {
                      console.log('-----------------------------------------------------------------------------------------------------------------------------');
                      console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                      console.log('-----------------------------------------------------------------------------------------------------------------------------');
                    }
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
                      const status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey)
                      if (status === true) {
                        bidHistory[collectionSymbol].topBids[tokenId] = true
                        bidHistory[collectionSymbol].ourBids[tokenId] = {
                          price: bidPrice,
                          expiration: expiration
                        }
                      }

                    } catch (error) {
                    }
                  } else {
                    console.log('-----------------------------------------------------------------------------------------------------------------------------');
                    console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                    console.log('-----------------------------------------------------------------------------------------------------------------------------');
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
                if (bestOffer && Number(bestOffer.total) > 0) {
                  const [topOffer, secondTopOffer] = bestOffer.offers
                  const bestPrice = topOffer.price

                  if (topOffer.buyerPaymentAddress !== buyerPaymentAddress) {
                    const currentPrice = topOffer.price
                    const bidPrice = currentPrice + (outBidMargin * CONVERSION_RATE)

                    if (bidPrice <= maxOffer) {

                      if (RESTART || !enableCounterBidding) {
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        console.log(`OUTBID CURRENT OFFER ${currentPrice / 1e8} BTC OUR OFFER ${bidPrice / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        try {
                          const status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey)
                          if (status === true) {
                            bidHistory[collectionSymbol].topBids[tokenId] = true
                            bidHistory[collectionSymbol].ourBids[tokenId] = {
                              price: bidPrice,
                              expiration: expiration
                            }
                          }
                        } catch (error) {
                        }
                      }
                    } else {
                      console.log('-----------------------------------------------------------------------------------------------------------------------------');
                      console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                      console.log('-----------------------------------------------------------------------------------------------------------------------------');

                    }

                  } else {
                    if (secondTopOffer) {
                      const secondBestPrice = secondTopOffer.price
                      const outBidAmount = outBidMargin * CONVERSION_RATE
                      if (bestPrice - secondBestPrice > outBidAmount) {
                        const bidPrice = secondBestPrice + outBidAmount

                        if (bidPrice <= maxOffer) {
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');
                          console.log(`ADJUST OUR CURRENT OFFER ${bestPrice / 1e8} BTC TO ${bidPrice / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');

                          try {
                            const status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey)
                            if (status === true) {
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration
                              }
                            }
                          } catch (error) {
                          }
                        } else {
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');
                          console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        }
                      }
                    } else {
                      const bidPrice = Math.max(minOffer, listedPrice * 0.5)
                      if (bestPrice !== bidPrice) { // self adjust bids.
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        console.log(`ADJUST OUR CURRENT OFFER ${bestPrice / 1e8} BTC TO ${bidPrice / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                        console.log('-----------------------------------------------------------------------------------------------------------------------------');

                        if (bidPrice <= maxOffer) {
                          try {
                            const status = await placeBid(tokenId, bidPrice, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, privateKey)
                            if (status === true) {
                              bidHistory[collectionSymbol].topBids[tokenId] = true
                              bidHistory[collectionSymbol].ourBids[tokenId] = {
                                price: bidPrice,
                                expiration: expiration
                              }
                            }
                          } catch (error) {
                          }
                        } else {
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');
                          console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol} ${tokenId}`);
                          console.log('-----------------------------------------------------------------------------------------------------------------------------');
                        }

                      } else if (bidPrice > maxOffer) {
                        console.log('\x1b[31m%s\x1b[0m', '🛑 CURRENT PRICE IS GREATER THAN MAX OFFER!!! 🛑');
                      }
                    }
                  }
                }
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
              console.log('-----------------------------------------------------------------------------------------------------------------------------');
              console.log(`OUTBID CURRENT COLLECTION OFFER ${currentPrice / 1e8} BTC OUR OFFER ${bidPrice / 1e8} BTC FOR ${collectionSymbol}`);
              console.log('-----------------------------------------------------------------------------------------------------------------------------');

              try {
                if (bidPrice < floorPrice) {
                  await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
                  bidHistory[collectionSymbol].offerType = "COLLECTION"

                  bidHistory[collectionSymbol].highestCollectionOffer = {
                    price: bidPrice,
                    buyerPaymentAddress: buyerPaymentAddress
                  }
                }

              } catch (error) {
              }

            } else {
              console.log('-----------------------------------------------------------------------------------------------------------------------------');
              console.log(`CALCULATED COLLECTION OFFER PRICE ${bidPrice} IS GREATER THAN MAX BID ${maxOffer} FOR ${collectionSymbol}`);
              console.log('-----------------------------------------------------------------------------------------------------------------------------');
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
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
                  console.log(`ADJUST OUR CURRENT COLLECTION OFFER ${bestPrice / 1e8} BTC TO ${bidPrice / 1e8} BTC FOR ${collectionSymbol}`);
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
                      bidHistory[collectionSymbol].offerType = "COLLECTION"
                      bidHistory[collectionSymbol].highestCollectionOffer = {
                        price: bidPrice,
                        buyerPaymentAddress: buyerPaymentAddress
                      }
                    }
                  } catch (error) {
                  }
                } else {
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
                  console.log(`CALCULATED COLLECTION OFFER PRICE ${bidPrice} IS GREATER THAN MAX BID ${maxOffer} FOR ${collectionSymbol}`);
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
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
                }

                console.log('-----------------------------------------------------------------------------------------------------------------------------');
                console.log(`ADJUST OUR CURRENT COLLECTION OFFER ${bestPrice / 1e8} BTC TO ${bidPrice / 1e8} BTC FOR ${collectionSymbol} `);
                console.log('-----------------------------------------------------------------------------------------------------------------------------');

                if (bidPrice <= maxOffer) {

                  try {
                    if (bidPrice < floorPrice) {
                      await placeCollectionBid(bidPrice, expiration, collectionSymbol, buyerTokenReceiveAddress, publicKey, privateKey, feeSatsPerVbyte)
                      bidHistory[collectionSymbol].offerType = "COLLECTION"
                      bidHistory[collectionSymbol].highestCollectionOffer = {
                        price: bidPrice,
                        buyerPaymentAddress: buyerPaymentAddress
                      }
                    }
                  } catch (error) {
                  }
                } else {
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
                  console.log(`CALCULATED BID PRICE ${bidPrice / 1e8} BTC IS GREATER THAN MAX BID ${maxOffer / 1e8} BTC FOR ${collectionSymbol}`);
                  console.log('-----------------------------------------------------------------------------------------------------------------------------');
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

      RESTART = false
    } catch (error) {
      throw error
    }
  }
}

const eventManager = new EventManager();

function connectWebSocket(): void {
  const baseEndpoint: string = 'wss://wss-mainnet.magiceden.io/CJMw7IPrGPUb13adEQYW2ASbR%2FIWToagGUCr02hWp1oWyLAtf5CS0XF69WNXj0MbO6LEQLrFQMQoEqlX7%2Fny2BP08wjFc9MxzEmM5v2c5huTa3R1DPqGSbuO2TXKEEneIc4FMEm5ZJruhU8y4cyfIDzGqhWDhxK3iRnXtYzI0FGG1%2BMKyx9WWOpp3lLA3Gm2BgNpHHp3wFEas5TqVdJn0GtBrptg8ZEveG8c44CGqfWtEsS0iI8LZDR7tbrZ9fZpbrngDaimEYEH6MgvhWPTlKrsGw%3D%3D'

  ws = new WebSocket(baseEndpoint);


  ws.addEventListener("open", function open() {
    console.log("Connected to Magic Eden Websocket");

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
    console.log("Disconnected from OpenSea Stream API");
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
      console.log('----------------------------------------------------------------------');
      console.log(`SUBSCRIBED TO COLLECTION: ${item.collectionSymbol}`);
      console.log('----------------------------------------------------------------------');
    }

  });
}

async function startProcessing() {
  collections.map(async (item) => {
    const loop = (item.scheduledLoop || DEFAULT_LOOP) * 1000
    while (true) {
      await eventManager.runScheduledTask(item);
      await delay(loop)
    }
  })
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

process.on('SIGINT', () => {
  console.log('Received SIGINT signal. Writing bidHistory to file...');
  writeBidHistoryToFile();
  process.exit(0)
});

async function getCollectionActivity(
  collectionSymbol: string,
  lastSeenTimestamp: number | null = null
): Promise<{ lists: OfferPlaced[]; offers: OfferPlaced[]; soldTokens: OfferPlaced[]; latestTimestamp: number | null }> {
  const url = "https://nfttools.pro/magiceden/v2/ord/btc/activities";
  const params: any = {
    limit: 100,
    collectionSymbol,
    kind: ["list", "offer_placed", "buying_broadcasted", "offer_accepted_broadcasted"],
  };

  try {
    let lists: OfferPlaced[] = [];
    let offers: OfferPlaced[] = [];
    let soldTokens: OfferPlaced[] = [];
    let response;
    let offset = 0;
    let latestTimestamp = lastSeenTimestamp;

    do {
      params.offset = offset;
      response = await limiter.schedule({ priority: 5 }, () =>
        axiosInstance.get(url, { params, headers })
      );

      for (const activity of response.data.activities) {
        const activityTimestamp = new Date(activity.createdAt).getTime();

        if (lastSeenTimestamp !== null && activityTimestamp <= (lastSeenTimestamp - 10 * 1000)) {
          // Activity has already been seen, break the loop
          return { lists, offers, soldTokens, latestTimestamp };
        }

        if (activity.kind === "list") {
          lists.push(activity);
        } else if (activity.kind === "offer_placed") {
          offers.push(activity);
        } else if (activity.kind === "buying_broadcasted" || activity.kind === "offer_accepted_broadcasted") {
          soldTokens.push(activity)
        }

        if (lists.length + offers.length === params.limit) {
          break;
        }
      }

      offset += response.data.activities.length;
    } while (lists.length + offers.length < params.limit);

    if (response.data.activities.length > 0) {
      latestTimestamp = new Date(response.data.activities[0].createdAt).getTime();
    }

    return { lists, offers, soldTokens, latestTimestamp };
  } catch (error: any) {
    console.error("Error fetching collection activity:", error.response);
    return { lists: [], offers: [], soldTokens: [], latestTimestamp: lastSeenTimestamp };
  }
}


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

async function placeBid(
  tokenId: string,
  offerPrice: number,
  expiration: number,
  buyerTokenReceiveAddress: string,
  buyerPaymentAddress: string,
  publicKey: string,
  privateKey: string,
) {
  try {
    const price = Math.round(offerPrice)
    // check for current offers and cancel before placing the bid
    await delay(2000);
    const offerData = await getOffers(tokenId, buyerTokenReceiveAddress)

    if (offerData && offerData.offers.length > 0) {
      const offers = offerData.offers
      offers.forEach(async (item) => {
        await cancelBid(item, privateKey)
      })
    }

    const unsignedOffer = await createOffer(tokenId, price, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, FEE_RATE_TIER)
    const signedOffer = await signData(unsignedOffer, privateKey)
    if (signedOffer) {
      await submitSignedOfferOrder(signedOffer, tokenId, offerPrice, expiration, buyerPaymentAddress, buyerTokenReceiveAddress, publicKey, FEE_RATE_TIER, privateKey)
      return true
    }

  } catch (error) {
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
    console.log('INSUFFICIENT BTC TO PLACE BID');
    return
  }

  console.log('-----------------------------------------------------------------------------------');
  console.log(`CREATE COLLECTION OFFER FOR ${collectionSymbol} @ ${priceSats / 1e8} BTC`);
  console.log('-----------------------------------------------------------------------------------');

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

const findNewListings = (newBottomListing: Listing[], oldBottomListings: Listing[]): Listing[] => {
  return newBottomListing.filter((newListing) => {
    return !oldBottomListings.some((oldListing) => oldListing.id === newListing.id);
  });
};

function removeDuplicateTokens(newBottomListings: Token[]): Token[] {
  const idMap = new Map<string, boolean>();
  const uniqueTokens: Token[] = [];

  for (const token of newBottomListings) {
    if (!idMap.has(token.id)) {
      idMap.set(token.id, true);
      uniqueTokens.push(token);
    }
  }

  return uniqueTokens;
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

interface Listing {
  id: string
  price: number
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
