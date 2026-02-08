import fs from "fs"
import * as bitcoin from "bitcoinjs-lib"
import { config } from "dotenv"
import path from "path"

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
import { isEncryptedFormat, decryptData } from "./manage/services/WalletGenerator";
import { promptPasswordStdin } from "./utils/promptPassword";
import { getFundingWIF, setFundingWIF, hasReceiveAddress, setReceiveAddress, getReceiveAddress } from "./utils/fundingWallet";
import Logger from "./utils/logger";

config()

let TOKEN_RECEIVE_ADDRESS: string = process.env.TOKEN_RECEIVE_ADDRESS as string
const network = bitcoin.networks.bitcoin;

// Multi-wallet rotation configuration
const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './config/wallets.json';

const filePath = path.join(process.cwd(), 'config/collections.json')
const collections: CollectionData[] = JSON.parse(fs.readFileSync(filePath, "utf-8"))

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// Holds the already-decrypted wallet config parsed in main()
let parsedWalletConfig: Record<string, unknown> | null = null;

// Get all unique receive addresses to check for offers
function getReceiveAddressesToCheck(): { address: string; privateKey: string; publicKey: string; paymentAddress: string; label?: string }[] {
  const addresses: { address: string; privateKey: string; publicKey: string; paymentAddress: string; label?: string }[] = [];
  const seenAddresses = new Set<string>();

  // If wallet rotation is enabled, use the already-decrypted wallet config from main()
  if (ENABLE_WALLET_ROTATION && parsedWalletConfig) {
    try {
      const groups = parsedWalletConfig.groups as Record<string, { wallets: Array<{ receiveAddress: string; wif: string; label?: string }> }> | undefined;
      for (const groupName of Object.keys(groups || {})) {
        const group = groups![groupName];
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
      Logger.error('[CANCEL] Failed to load wallet config for cancellation');
    }
  }

  // Add addresses from collection configs (for non-rotation mode or mixed setups)
  for (const collection of collections) {
    const receiveAddress = collection.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = collection.fundingWalletWIF ?? getFundingWIF();

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
    Logger.info(`[CANCEL] Checking ${addr.address.slice(0, 10)}...${labelStr}`);

    try {
      // addr.address is the taproot receive address (bc1p...) — required by the ME API
      const offerData = await getUserOffers(addr.address);

      if (offerData && Array.isArray(offerData.offers) && offerData.offers.length > 0) {
        const offers = offerData.offers;
        Logger.info(`[CANCEL] ${offers.length} offers found for ${addr.address.slice(0, 10)}...${labelStr}`);

        const cancelOps = offers.map(offer => {
          const collectionSymbol = offer.token.collectionSymbol;
          const tokenId = offer.token.id;
          return cancelBid(offer, addr.privateKey, collectionSymbol, tokenId, addr.paymentAddress);
        });

        const results = await Promise.allSettled(cancelOps);
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
          Logger.error(`[CANCEL] Failed to cancel ${failed.length} of ${results.length} offers`);
        }
      } else {
        Logger.info(`[CANCEL] No offers found for ${addr.address.slice(0, 10)}...${labelStr}`);
      }
    } catch (error: unknown) {
      Logger.error(`[CANCEL] Error checking offers for ${addr.address.slice(0, 10)}...`, error);
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
      const privateKey = item.fundingWalletWIF ?? getFundingWIF();
      const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const keyPair = ECPair.fromWIF(privateKey, network);
      const publicKey = keyPair.publicKey.toString('hex');

      const bestOffers = await getBestCollectionOffer(item.collectionSymbol);
      if (!bestOffers?.offers?.length) {
        Logger.info(`[CANCEL] No collection offers found for ${item.collectionSymbol}`);
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
        Logger.success(`[CANCEL] Cancelled collection offer for ${item.collectionSymbol}`);
      }
    }
  }
}

// Reset bot data files (bid history)
function resetBotData(): { historyReset: boolean } {
  const dataDir = path.join(process.cwd(), 'data');
  let historyReset = false;

  const historyPath = path.join(dataDir, 'bidHistory.json');
  if (fs.existsSync(historyPath)) {
    fs.unlinkSync(historyPath);
    historyReset = true;
  }

  return { historyReset };
}

// Main execution
async function main() {
  // Load funding WIF from wallets.json if available
  if (fs.existsSync(WALLET_CONFIG_PATH)) {
    let walletConfigContent = fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8');
    if (isEncryptedFormat(walletConfigContent)) {
      Logger.info('[STARTUP] Wallets file is encrypted — password required');
      const password = await promptPasswordStdin('[STARTUP] Enter wallets encryption password: ');
      try {
        walletConfigContent = decryptData(walletConfigContent, password);
      } catch {
        Logger.error('[STARTUP] Wrong password — could not decrypt wallets.json');
        process.exit(1);
      }
      Logger.success('[STARTUP] Wallets file decrypted successfully');
    }

    const walletConfig = JSON.parse(walletConfigContent);
    parsedWalletConfig = walletConfig;

    // Extract funding WIF and receive address from wallets.json if present
    if (walletConfig.fundingWallet?.wif) {
      setFundingWIF(walletConfig.fundingWallet.wif);
      Logger.success('[STARTUP] Funding WIF loaded from wallets.json');
    }
    if (walletConfig.fundingWallet?.receiveAddress) {
      setReceiveAddress(walletConfig.fundingWallet.receiveAddress);
      Logger.success('[STARTUP] Token receive address loaded from wallets.json');
    }

    // Resolve TOKEN_RECEIVE_ADDRESS: wallets.json > .env > warning
    if (hasReceiveAddress()) {
      TOKEN_RECEIVE_ADDRESS = getReceiveAddress();
    } else if (process.env.TOKEN_RECEIVE_ADDRESS) {
      Logger.warning('[STARTUP] TOKEN_RECEIVE_ADDRESS loaded from .env (deprecated — migrate to wallets.json)');
      TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS;
    }

    // Initialize wallet pool for cancellation lookup
    if (ENABLE_WALLET_ROTATION) {
      try {
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
            Logger.info(`[STARTUP] Initialized wallet pool with ${allWallets.length} wallets for cancellation`);
          }
        }
      } catch (error: unknown) {
        Logger.error('[STARTUP] Failed to initialize wallet pool', error);
      }
    }
  }

  Logger.header('CANCELLING ALL OFFERS');
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    Logger.info('[CANCEL] Multi-wallet mode — checking all wallet addresses');
  }

  await cancelAllItemOffers();
  await cancelCollectionOffers();

  // Reset bid history
  const resetResult = resetBotData();
  if (resetResult.historyReset) {
    Logger.info('[CANCEL] Bot data reset — bid history cleared');
  }

  Logger.header('CANCELLATION COMPLETE');
}

main().catch((error: unknown) => Logger.error('[CANCEL] Fatal error', error));

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
      Logger.debug(`[CANCEL] Using wallet "${wallet.config.label}" for cancellation`);
    } else if (!ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())) {
      // Bid was placed by unknown wallet (not in any of our wallet groups), skip
      Logger.warning(`[CANCEL] Skipping — bid placed by unknown wallet: ${offer.buyerPaymentAddress.slice(0, 10)}...`);
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
    Logger.success(`[CANCEL] ${collectionSymbol} ${tokenId.length > 20 ? tokenId.slice(0, 8) + '...' + tokenId.slice(-6) : tokenId}`);
  } catch (error: unknown) {
    Logger.error(`[CANCEL] Failed to cancel ${collectionSymbol} ${tokenId.length > 20 ? tokenId.slice(0, 8) + '...' + tokenId.slice(-6) : tokenId}`, error);
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
