import fs from "fs"
import * as bitcoin from "bitcoinjs-lib"
import { config } from "dotenv"

import { ICollectionOffer, IOffer, cancelCollectionOffer, getBestCollectionOffer, getUserOffers, retrieveCancelOfferFormat, signData, submitCancelOfferData } from "./functions/Offer";
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import {
  initializeWalletPool,
  getWalletByPaymentAddress,
  isWalletPoolInitialized,
  WalletConfig
} from "./utils/walletPool";
import {
  deduplicateAddresses,
  formatAddressForLog,
  hasValidOffers,
  isUnknownWalletOffer,
  createAddressSet,
  getOfferLogInfo,
} from "./utils/cancelLogic";
import {
  getAllOurPaymentAddresses,
  getAllOurReceiveAddresses,
} from "./utils/walletHelpers";

config()

const FUNDING_WIF = process.env.FUNDING_WIF as string;
const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS as string
const network = bitcoin.networks.bitcoin;

// Multi-wallet rotation configuration
const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './config/wallets.json';

// Initialize wallet pool for cancellation lookup
if (ENABLE_WALLET_ROTATION) {
  try {
    if (fs.existsSync(WALLET_CONFIG_PATH)) {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));
      if (walletConfig.groups) {
        const allWallets: WalletConfig[] = [];
        for (const groupName of Object.keys(walletConfig.groups)) {
          const group = walletConfig.groups[groupName];
          if (group.wallets && group.wallets.length > 0) {
            allWallets.push(...group.wallets);
          }
        }
        if (allWallets.length > 0) {
          initializeWalletPool(allWallets, 5, network);
          console.log(`[WALLET ROTATION] Initialized wallet pool with ${allWallets.length} wallets for cancellation`);
        }
      }
    }
  } catch (error: any) {
    console.error(`[WALLET ROTATION] Failed to initialize wallet pool: ${error.message}`);
  }
}


import path from "path"

const filePath = path.join(process.cwd(), 'config/collections.json')
const collections: CollectionData[] = JSON.parse(fs.readFileSync(filePath, "utf-8"))

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);



// Get all unique receive addresses to check for offers
function getReceiveAddressesToCheck(): { address: string; privateKey: string; publicKey: string; paymentAddress: string; label?: string }[] {
  const addresses: { address: string; privateKey: string; publicKey: string; paymentAddress: string; label?: string }[] = [];
  const seenAddresses = new Set<string>();

  // If wallet rotation is enabled, add all wallet receive addresses from groups
  if (ENABLE_WALLET_ROTATION && fs.existsSync(WALLET_CONFIG_PATH)) {
    try {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));
      for (const groupName of Object.keys(walletConfig.groups || {})) {
        const group = walletConfig.groups[groupName];
        for (const wallet of group.wallets || []) {
          if (!seenAddresses.has(wallet.receiveAddress.toLowerCase())) {
            const keyPair = ECPair.fromWIF(wallet.wif, network);
            addresses.push({
              address: wallet.receiveAddress,
              privateKey: wallet.wif,
              publicKey: keyPair.publicKey.toString('hex'),
              paymentAddress: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string,
              label: wallet.label
            });
            seenAddresses.add(wallet.receiveAddress.toLowerCase());
          }
        }
      }
    } catch (error) {
      console.error('[WALLET ROTATION] Failed to load wallet config for cancellation');
    }
  }

  // Add addresses from collection configs (for non-rotation mode or mixed setups)
  for (const collection of collections) {
    const receiveAddress = collection.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = collection.fundingWalletWIF ?? FUNDING_WIF;

    if (!seenAddresses.has(receiveAddress.toLowerCase())) {
      const keyPair = ECPair.fromWIF(privateKey, network);
      addresses.push({
        address: receiveAddress,
        privateKey: privateKey,
        publicKey: keyPair.publicKey.toString('hex'),
        paymentAddress: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: network }).address as string
      });
      seenAddresses.add(receiveAddress.toLowerCase());
    }
  }

  return addresses;
}

// Cancel all ITEM offers for all configured addresses
async function cancelAllItemOffers() {
  const addresses = getReceiveAddressesToCheck();

  for (const addr of addresses) {
    const labelStr = addr.label ? ` (${addr.label})` : '';
    console.log(`\n[CHECKING] ${addr.address.slice(0, 10)}...${labelStr}`);

    try {
      const offerData = await getUserOffers(addr.address);

      if (offerData && Array.isArray(offerData.offers) && offerData.offers.length > 0) {
        const offers = offerData.offers;
        console.log('--------------------------------------------------------------------------------');
        console.log(`${offers.length} OFFERS FOUND FOR ${addr.address}${labelStr}`);
        console.log('--------------------------------------------------------------------------------');

        const cancelOps = offers.map(offer => {
          const collectionSymbol = offer.token.collectionSymbol;
          const tokenId = offer.token.id;
          return cancelBid(offer, addr.privateKey, collectionSymbol, tokenId, addr.paymentAddress);
        });

        const results = await Promise.allSettled(cancelOps);
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
          console.error(`Failed to cancel ${failed.length} of ${results.length} offers`);
        }
      } else {
        console.log(`No offers found for ${addr.address.slice(0, 10)}...${labelStr}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error checking offers for ${addr.address}: ${errorMessage}`);
      // Continue with next address instead of stopping
    }
  }
}

// Cancel COLLECTION offers
async function cancelCollectionOffers() {
  const uniqueCollections = collections.filter(
    (collection, index, self) =>
      index === self.findIndex((c) => c.tokenReceiveAddress === collection.tokenReceiveAddress && c.offerType === collection.offerType)
  );

  for (const item of uniqueCollections) {
    if (item.offerType === "COLLECTION") {
      const privateKey = item.fundingWalletWIF ?? FUNDING_WIF;
      const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const keyPair = ECPair.fromWIF(privateKey, network);
      const publicKey = keyPair.publicKey.toString('hex');

      const bestOffers = await getBestCollectionOffer(item.collectionSymbol);
      if (!bestOffers?.offers?.length) {
        console.log(`No collection offers found for ${item.collectionSymbol}`);
        continue;
      }
      // Check all our receive addresses from all wallets (supports wallet groups)
      const ourReceiveAddresses = getAllOurReceiveAddresses();
      const ourOffers = bestOffers.offers.find((offer) =>
        ourReceiveAddresses.has(offer.btcParams.makerOrdinalReceiveAddress.toLowerCase())
      ) as ICollectionOffer;

      if (ourOffers) {
        const offerIds = [ourOffers.id];
        await cancelCollectionOffer(offerIds, publicKey, privateKey);
        console.log(`Cancelled collection offer for ${item.collectionSymbol}`);
      }
    }
  }
}

// Reset bot data files (bid history and stats)
function resetBotData(): { historyReset: boolean; statsReset: boolean } {
  const dataDir = path.join(process.cwd(), 'data');
  let historyReset = false;
  let statsReset = false;

  const historyPath = path.join(dataDir, 'bidHistory.json');
  if (fs.existsSync(historyPath)) {
    fs.unlinkSync(historyPath);
    historyReset = true;
  }

  const statsPath = path.join(dataDir, 'botStats.json');
  if (fs.existsSync(statsPath)) {
    fs.unlinkSync(statsPath);
    statsReset = true;
  }

  return { historyReset, statsReset };
}

// Main execution
async function main() {
  console.log('================================================================================');
  console.log('CANCELLING ALL OFFERS');
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    console.log('[WALLET ROTATION] Multi-wallet mode enabled - checking all wallet addresses');
  }
  console.log('================================================================================');

  await cancelAllItemOffers();
  await cancelCollectionOffers();

  // Reset bid history and stats
  const resetResult = resetBotData();
  if (resetResult.historyReset || resetResult.statsReset) {
    console.log('\n--------------------------------------------------------------------------------');
    console.log('BOT DATA RESET');
    if (resetResult.historyReset) {
      console.log('  - Bid history cleared');
    }
    if (resetResult.statsReset) {
      console.log('  - Bot stats cleared');
    }
    console.log('--------------------------------------------------------------------------------');
  }

  console.log('\n================================================================================');
  console.log('CANCELLATION COMPLETE');
  console.log('================================================================================');
}

main().catch(console.error);

async function cancelBid(offer: IOffer, privateKey: string, collectionSymbol: string, tokenId: string, buyerPaymentAddress: string) {
  // Determine which private key to use for signing the cancellation
  let signingKey = privateKey;

  // Get all our payment addresses for ownership check (supports wallet groups)
  const ourPaymentAddresses = getAllOurPaymentAddresses();

  // If wallet rotation is enabled, try to find the wallet that placed this bid
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = getWalletByPaymentAddress(offer.buyerPaymentAddress);
    if (wallet) {
      signingKey = wallet.config.wif;
      console.log(`[WALLET ROTATION] Using wallet "${wallet.config.label}" for cancellation`);
    } else if (!ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())) {
      // Bid was placed by unknown wallet (not in any of our wallet groups), skip
      console.log(`[WALLET ROTATION] Skipping cancellation - bid placed by unknown wallet: ${offer.buyerPaymentAddress.slice(0, 10)}...`);
      return;
    }
  } else if (!ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())) {
    // Without wallet rotation, only cancel our own bids
    return;
  }

  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id)
    const signedOfferFormat = signData(offerFormat, signingKey)
    await submitCancelOfferData(offer.id, signedOfferFormat)
    console.log('--------------------------------------------------------------------------------');
    console.log(`CANCELLED OFFER FOR ${collectionSymbol} ${tokenId}`);
    console.log('--------------------------------------------------------------------------------');
  } catch (error: any) {
    console.error(`Failed to cancel offer for ${collectionSymbol} ${tokenId}: ${error.message}`);
  }
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
  fundingWalletWIF?: string;
  tokenReceiveAddress?: string;
  scheduledLoop?: number;
  counterbidLoop?: number;
  offerType: "ITEM" | "COLLECTION";
  feeSatsPerVbyte?: number;
}