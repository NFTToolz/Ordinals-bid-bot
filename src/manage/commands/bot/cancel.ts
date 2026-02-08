import fs from 'fs';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { config } from 'dotenv';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showTable,
  formatAddress,
  withSpinner,
} from '../../utils/display';
import { promptConfirm } from '../../utils/prompts';
import {
  ICollectionOffer,
  IOffer,
  cancelCollectionOffer,
  getBestCollectionOffer,
  getUserOffers,
  retrieveCancelOfferFormat,
  signData,
  submitCancelOfferData,
} from '../../../functions/Offer';
import {
  initializeWalletPool,
  getWalletByPaymentAddress,
  isWalletPoolInitialized,
} from '../../../utils/walletPool';
import {
  getAllOurPaymentAddresses,
  getAllOurReceiveAddresses,
} from '../../../utils/walletHelpers';
import { loadCollections, CollectionConfig } from '../../services/CollectionService';

import { getFundingWIF } from '../../../utils/fundingWallet';

config();

const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS as string;
const network = bitcoin.networks.bitcoin;

const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './config/wallets.json';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

interface AddressInfo {
  address: string;
  privateKey: string;
  publicKey: string;
  paymentAddress: string;
  label?: string;
}

interface CancelResult {
  itemOffersCanceled: number;
  collectionOffersCanceled: number;
  errors: string[];
}

interface WalletOfferCounts {
  label: string;
  address: string;
  itemOffers: number;
  collectionOffers: number;
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

function getReceiveAddressesToCheck(collections: CollectionConfig[]): AddressInfo[] {
  const addresses: AddressInfo[] = [];
  const seenAddresses = new Set<string>();

  // If wallet rotation is enabled, add all wallet receive addresses
  if (ENABLE_WALLET_ROTATION && fs.existsSync(WALLET_CONFIG_PATH)) {
    try {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));

      // Handle groups format
      if (walletConfig.groups && typeof walletConfig.groups === 'object') {
        for (const groupName of Object.keys(walletConfig.groups)) {
          const group = walletConfig.groups[groupName];
          for (const wallet of group.wallets || []) {
            if (!seenAddresses.has(wallet.receiveAddress.toLowerCase())) {
              const keyPair = ECPair.fromWIF(wallet.wif, network);
              addresses.push({
                address: wallet.receiveAddress,
                privateKey: wallet.wif,
                publicKey: keyPair.publicKey.toString('hex'),
                paymentAddress: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address as string,
                label: wallet.label,
              });
              seenAddresses.add(wallet.receiveAddress.toLowerCase());
            }
          }
        }
      } else {
        // Fallback for legacy flat wallets array
        for (const wallet of walletConfig.wallets || []) {
          if (!seenAddresses.has(wallet.receiveAddress.toLowerCase())) {
            const keyPair = ECPair.fromWIF(wallet.wif, network);
            addresses.push({
              address: wallet.receiveAddress,
              privateKey: wallet.wif,
              publicKey: keyPair.publicKey.toString('hex'),
              paymentAddress: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address as string,
              label: wallet.label,
            });
            seenAddresses.add(wallet.receiveAddress.toLowerCase());
          }
        }
      }
    } catch (error) {
      // Failed to load wallet config
    }
  }

  // Add addresses from collection configs
  for (const collection of collections) {
    const receiveAddress = collection.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = collection.fundingWalletWIF ?? getFundingWIF();

    if (!seenAddresses.has(receiveAddress.toLowerCase())) {
      const keyPair = ECPair.fromWIF(privateKey, network);
      addresses.push({
        address: receiveAddress,
        privateKey: privateKey,
        publicKey: keyPair.publicKey.toString('hex'),
        paymentAddress: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address as string,
      });
      seenAddresses.add(receiveAddress.toLowerCase());
    }
  }

  return addresses;
}

async function cancelBid(
  offer: IOffer,
  privateKey: string,
  buyerPaymentAddress: string
): Promise<boolean> {
  let signingKey = privateKey;

  // Get all our payment addresses for ownership check (supports wallet groups)
  const ourPaymentAddresses = getAllOurPaymentAddresses();

  // If wallet rotation is enabled, try to find the wallet that placed this bid
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = getWalletByPaymentAddress(offer.buyerPaymentAddress);
    if (wallet) {
      signingKey = wallet.config.wif;
    } else if (!ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())) {
      // Bid was placed by unknown wallet (not in any of our wallet groups), skip
      return false;
    }
  } else if (!ourPaymentAddresses.has(offer.buyerPaymentAddress.toLowerCase())) {
    // Without wallet rotation, only cancel our own bids
    return false;
  }

  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id);
    const signedOfferFormat = signData(offerFormat, signingKey);
    await submitCancelOfferData(offer.id, signedOfferFormat);
    return true;
  } catch (error) {
    // Failed to cancel - error already logged by signData or submitCancelOfferData
    return false;
  }
}

async function cancelAllItemOffers(
  addresses: AddressInfo[]
): Promise<{ canceled: number; errors: string[] }> {
  let canceled = 0;
  const errors: string[] = [];

  for (const addr of addresses) {
    try {
      const offerData = await getUserOffers(addr.address);
      const offers = offerData?.offers;

      if (Array.isArray(offers) && offers.length > 0) {
        const cancelOps = offers.map((offer: IOffer) =>
          cancelBid(offer, addr.privateKey, addr.paymentAddress)
        );

        const results = await Promise.all(cancelOps);
        canceled += results.filter(Boolean).length;
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to check offers for ${addr.address.slice(0, 10)}...: ${errorMessage}`);
      // Continue with next address instead of stopping
    }
  }

  return { canceled, errors };
}

async function cancelAllCollectionOffers(
  collections: CollectionConfig[]
): Promise<{ canceled: number; errors: string[] }> {
  let canceled = 0;
  const errors: string[] = [];

  const uniqueCollections = collections.filter(
    (collection, index, self) =>
      index === self.findIndex(
        (c) =>
          (c.tokenReceiveAddress || '').toLowerCase() === (collection.tokenReceiveAddress || '').toLowerCase() &&
          c.offerType === collection.offerType
      )
  );

  for (const item of uniqueCollections) {
    if (item.offerType === 'COLLECTION') {
      const privateKey = item.fundingWalletWIF ?? getFundingWIF();
      const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const keyPair = ECPair.fromWIF(privateKey, network);
      const publicKey = keyPair.publicKey.toString('hex');

      try {
        const bestOffers = await getBestCollectionOffer(item.collectionSymbol);
        // Check all our receive addresses from all wallets (supports wallet groups)
        const ourReceiveAddresses = getAllOurReceiveAddresses();
        const ourOffer = bestOffers?.offers?.find(
          (offer: ICollectionOffer) =>
            ourReceiveAddresses.has(offer.btcParams.makerOrdinalReceiveAddress.toLowerCase())
        ) as ICollectionOffer | undefined;

        if (ourOffer) {
          await cancelCollectionOffer([ourOffer.id], publicKey, privateKey);
          canceled++;
        }
      } catch (error: any) {
        errors.push(`Failed to cancel collection offer for ${item.collectionSymbol}: ${error.message}`);
      }
    }
  }

  return { canceled, errors };
}

function ensureWalletPoolInitialized(): void {
  if (!ENABLE_WALLET_ROTATION) return;

  try {
    if (fs.existsSync(WALLET_CONFIG_PATH)) {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));

      // Handle groups format
      if (walletConfig.groups && typeof walletConfig.groups === 'object') {
        const allWallets: any[] = [];
        for (const groupName of Object.keys(walletConfig.groups)) {
          const group = walletConfig.groups[groupName];
          if (group.wallets?.length > 0) {
            allWallets.push(...group.wallets);
          }
        }
        if (allWallets.length > 0) {
          initializeWalletPool(allWallets, walletConfig.bidsPerMinute || 5, network);
        }
      } else if (walletConfig.wallets?.length > 0) {
        // Fallback for legacy flat wallets array
        initializeWalletPool(walletConfig.wallets, walletConfig.bidsPerMinute || 5, network);
      }
    }
  } catch (error) {
    // Failed to initialize wallet pool
  }
}

async function fetchOfferCounts(): Promise<WalletOfferCounts[]> {
  const collections = loadCollections();
  ensureWalletPoolInitialized();
  const addresses = getReceiveAddressesToCheck(collections);
  const counts: WalletOfferCounts[] = [];

  for (const addr of addresses) {
    let itemOffers = 0;
    let collectionOffers = 0;

    // Count item offers
    try {
      const offerData = await getUserOffers(addr.address);
      const offers = offerData?.offers;
      if (Array.isArray(offers)) {
        itemOffers = offers.length;
      }
    } catch {
      // Default to 0
    }

    // Count collection offers for COLLECTION-type collections matching this wallet
    const ourReceiveAddresses = getAllOurReceiveAddresses();
    const collectionTypeConfigs = collections.filter(c => c.offerType === 'COLLECTION');
    for (const col of collectionTypeConfigs) {
      const colReceiveAddress = col.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      if (colReceiveAddress.toLowerCase() !== addr.address.toLowerCase()) continue;
      try {
        const bestOffers = await getBestCollectionOffer(col.collectionSymbol);
        const ourOffer = bestOffers?.offers?.find(
          (offer: ICollectionOffer) =>
            ourReceiveAddresses.has(offer.btcParams.makerOrdinalReceiveAddress.toLowerCase())
        );
        if (ourOffer) {
          collectionOffers++;
        }
      } catch {
        // Default to 0
      }
    }

    if (itemOffers > 0 || collectionOffers > 0) {
      counts.push({
        label: addr.label || '',
        address: addr.address,
        itemOffers,
        collectionOffers,
      });
    }
  }

  return counts;
}

async function performCancellation(): Promise<CancelResult> {
  const collections = loadCollections();

  ensureWalletPoolInitialized();

  const addresses = getReceiveAddressesToCheck(collections);
  const itemResult = await cancelAllItemOffers(addresses);
  const collectionResult = await cancelAllCollectionOffers(collections);

  return {
    itemOffersCanceled: itemResult.canceled,
    collectionOffersCanceled: collectionResult.canceled,
    errors: [...itemResult.errors, ...collectionResult.errors],
  };
}

export async function cancelOffersForCollection(
  collectionSymbol: string,
  offerType: string
): Promise<CancelResult> {
  const collections = loadCollections();

  ensureWalletPoolInitialized();

  let itemOffersCanceled = 0;
  let collectionOffersCanceled = 0;
  const errors: string[] = [];

  // Cancel item offers for this collection
  const addresses = getReceiveAddressesToCheck(collections);
  for (const addr of addresses) {
    try {
      const offerData = await getUserOffers(addr.address);
      const offers = offerData?.offers;

      if (Array.isArray(offers) && offers.length > 0) {
        const collectionOffers = offers.filter(
          (offer: IOffer) => offer.token?.collectionSymbol === collectionSymbol
        );

        for (const offer of collectionOffers) {
          const success = await cancelBid(offer, addr.privateKey, addr.paymentAddress);
          if (success) {
            itemOffersCanceled++;
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to check offers for ${addr.address.slice(0, 10)}...: ${errorMessage}`);
    }
  }

  // Cancel collection offer if offerType is COLLECTION
  if (offerType === 'COLLECTION') {
    try {
      const bestOffers = await getBestCollectionOffer(collectionSymbol);
      const ourReceiveAddresses = getAllOurReceiveAddresses();
      const ourOffer = bestOffers?.offers?.find(
        (offer: ICollectionOffer) =>
          ourReceiveAddresses.has(offer.btcParams.makerOrdinalReceiveAddress.toLowerCase())
      ) as ICollectionOffer | undefined;

      if (ourOffer) {
        // Determine the correct private key for cancellation
        const collection = collections.find(c => c.collectionSymbol === collectionSymbol);
        const privateKey = collection?.fundingWalletWIF ?? getFundingWIF();
        const keyPair = ECPair.fromWIF(privateKey, network);
        const publicKey = keyPair.publicKey.toString('hex');

        const success = await cancelCollectionOffer([ourOffer.id], publicKey, privateKey);
        if (success) {
          collectionOffersCanceled++;
        } else {
          errors.push(`Failed to cancel collection offer for ${collectionSymbol}`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to cancel collection offer for ${collectionSymbol}: ${errorMessage}`);
    }
  }

  return { itemOffersCanceled, collectionOffersCanceled, errors };
}

export async function cancelOffers(): Promise<void> {
  showSectionHeader('CANCEL ALL OFFERS');

  const counts = await withSpinner('Checking active offers...', fetchOfferCounts);

  const totalItem = counts.reduce((sum, c) => sum + c.itemOffers, 0);
  const totalCollection = counts.reduce((sum, c) => sum + c.collectionOffers, 0);
  const total = totalItem + totalCollection;

  if (total === 0) {
    showInfo('No active offers found');
    return;
  }

  console.log('');
  showTable(
    ['Wallet', 'Address', 'Item Offers', 'Collection Offers'],
    counts.map(c => [
      c.label || '-',
      formatAddress(c.address),
      String(c.itemOffers),
      String(c.collectionOffers),
    ])
  );
  console.log('');

  showWarning(`Found ${total} active offer(s): ${totalItem} item, ${totalCollection} collection.`);
  console.log('');

  const confirm = await promptConfirm('Are you sure you want to cancel all offers?', false);

  if (!confirm) {
    showWarning('Cancellation aborted');
    return;
  }

  console.log('');

  const result = await withSpinner('Canceling all offers...', performCancellation);

  console.log('');

  if (result.itemOffersCanceled > 0 || result.collectionOffersCanceled > 0) {
    showSuccess(
      `Canceled ${result.itemOffersCanceled} item offer(s) and ${result.collectionOffersCanceled} collection offer(s)`
    );
  } else {
    showInfo('No active offers to cancel');
  }

  if (result.errors.length > 0) {
    console.log('');
    showWarning(`${result.errors.length} error(s) occurred:`);
    result.errors.forEach((err) => showError(`  ${err}`));
  }

  // Reset bid history and stats
  const resetResult = resetBotData();
  if (resetResult.historyReset || resetResult.statsReset) {
    const resetItems: string[] = [];
    if (resetResult.historyReset) resetItems.push('bid history');
    if (resetResult.statsReset) resetItems.push('bot stats');
    showSuccess(`Reset ${resetItems.join(' and ')}`);
  }

  console.log('');
}
