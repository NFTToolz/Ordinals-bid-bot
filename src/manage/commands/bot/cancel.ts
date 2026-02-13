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
  withProgressSpinner,
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
import {
  loadWallets,
  isGroupsFormat,
  getAllWalletsFromGroups,
  WalletConfig,
} from '../../services/WalletGenerator';
import { getErrorMessage } from '../../../utils/errorUtils';

import { getFundingWIF, getReceiveAddress } from '../../../utils/fundingWallet';

config();

const network = bitcoin.networks.bitcoin;

const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';

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

interface FetchOfferCountsResult {
  counts: WalletOfferCounts[];
  fetchedOffers: Map<string, IOffer[]>;
}

export type CancelProgressCallback = (canceled: number, detail?: string) => void;

// Reset bot data files (bid history)
export function resetBotData(): { historyReset: boolean } {
  const dataDir = path.join(process.cwd(), 'data');
  let historyReset = false;

  const historyPath = path.join(dataDir, 'bidHistory.json');
  if (fs.existsSync(historyPath)) {
    fs.unlinkSync(historyPath);
    historyReset = true;
  }

  return { historyReset };
}

function getReceiveAddressesToCheck(collections: CollectionConfig[]): AddressInfo[] {
  const addresses: AddressInfo[] = [];
  const seenAddresses = new Set<string>();

  // If wallet rotation is enabled, add all wallet receive addresses
  if (ENABLE_WALLET_ROTATION) {
    try {
      const walletsData = loadWallets();
      if (walletsData) {
        let configWallets: WalletConfig[] = [];
        if (isGroupsFormat(walletsData)) {
          configWallets = getAllWalletsFromGroups();
        } else if (walletsData.wallets?.length > 0) {
          configWallets = walletsData.wallets;
        }

        for (const wallet of configWallets) {
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
    const receiveAddress = collection.tokenReceiveAddress ?? getReceiveAddress();
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
  addresses: AddressInfo[],
  prefetchedOffers?: Map<string, IOffer[]>,
  onProgress?: CancelProgressCallback
): Promise<{ canceled: number; errors: string[] }> {
  let canceled = 0;
  const errors: string[] = [];

  for (const addr of addresses) {
    try {
      let offers: IOffer[];
      if (prefetchedOffers?.has(addr.address)) {
        offers = prefetchedOffers.get(addr.address)!;
      } else {
        const offerData = await getUserOffers(addr.address);
        offers = offerData?.offers ?? [];
      }

      if (offers.length > 0) {
        const cancelOps = offers.map((offer: IOffer) =>
          cancelBid(offer, addr.privateKey, addr.paymentAddress).then((success) => {
            if (success) {
              canceled++;
              onProgress?.(canceled, addr.label);
            }
            return success;
          })
        );

        await Promise.all(cancelOps);
      }
    } catch (error: unknown) {
      errors.push(`Failed to check offers for ${addr.address.slice(0, 10)}...: ${getErrorMessage(error)}`);
      // Continue with next address instead of stopping
    }
  }

  return { canceled, errors };
}

async function cancelAllCollectionOffers(
  collections: CollectionConfig[],
  onProgress?: CancelProgressCallback,
  runningCount = 0
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
      const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? getReceiveAddress();
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
          onProgress?.(runningCount + canceled, item.collectionSymbol);
        }
      } catch (error: unknown) {
        errors.push(`Failed to cancel collection offer for ${item.collectionSymbol}: ${getErrorMessage(error)}`);
      }
    }
  }

  return { canceled, errors };
}

function ensureWalletPoolInitialized(): void {
  if (!ENABLE_WALLET_ROTATION) return;

  try {
    const walletsData = loadWallets();
    if (!walletsData) return;

    if (isGroupsFormat(walletsData)) {
      const allWallets: WalletConfig[] = [];
      for (const groupName of Object.keys(walletsData.groups)) {
        const group = walletsData.groups[groupName];
        if (group.wallets?.length > 0) {
          allWallets.push(...group.wallets);
        }
      }
      if (allWallets.length > 0) {
        initializeWalletPool(allWallets, walletsData.groups[Object.keys(walletsData.groups)[0]]?.bidsPerMinute || 5, network);
      }
    } else if (walletsData.wallets?.length > 0) {
      initializeWalletPool(walletsData.wallets, walletsData.bidsPerMinute || 5, network);
    }
  } catch (error) {
    // Failed to initialize wallet pool
  }
}

async function fetchOfferCounts(): Promise<FetchOfferCountsResult> {
  const collections = loadCollections();
  ensureWalletPoolInitialized();
  const addresses = getReceiveAddressesToCheck(collections);
  const counts: WalletOfferCounts[] = [];
  const fetchedOffers = new Map<string, IOffer[]>();

  for (const addr of addresses) {
    let itemOffers = 0;
    let collectionOffers = 0;

    // Count item offers
    try {
      const offerData = await getUserOffers(addr.address);
      const offers = offerData?.offers;
      if (Array.isArray(offers)) {
        itemOffers = offers.length;
        fetchedOffers.set(addr.address, offers);
      }
    } catch {
      // Default to 0
    }

    // Count collection offers for COLLECTION-type collections matching this wallet
    const ourReceiveAddresses = getAllOurReceiveAddresses();
    const collectionTypeConfigs = collections.filter(c => c.offerType === 'COLLECTION');
    for (const col of collectionTypeConfigs) {
      const colReceiveAddress = col.tokenReceiveAddress ?? getReceiveAddress();
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

  return { counts, fetchedOffers };
}

export async function performCancellation(
  prefetchedOffers?: Map<string, IOffer[]>,
  onProgress?: CancelProgressCallback
): Promise<CancelResult> {
  const collections = loadCollections();

  ensureWalletPoolInitialized();

  const addresses = getReceiveAddressesToCheck(collections);
  const itemResult = await cancelAllItemOffers(addresses, prefetchedOffers, onProgress);
  const collectionResult = await cancelAllCollectionOffers(collections, onProgress, itemResult.canceled);

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
      errors.push(`Failed to check offers for ${addr.address.slice(0, 10)}...: ${getErrorMessage(error)}`);
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
      errors.push(`Failed to cancel collection offer for ${collectionSymbol}: ${getErrorMessage(error)}`);
    }
  }

  return { itemOffersCanceled, collectionOffersCanceled, errors };
}

export async function cancelOffers(): Promise<void> {
  showSectionHeader('CANCEL ALL OFFERS');

  const { counts, fetchedOffers } = await withSpinner('Checking active offers...', fetchOfferCounts);

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

  const result = await withProgressSpinner(
    `Canceling offers [0/${total}]...`,
    (update) => performCancellation(fetchedOffers, (canceled) => {
      update(`Canceling offers [${canceled}/${total}]...`);
    })
  );

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

  // Reset bid history
  const resetResult = resetBotData();
  if (resetResult.historyReset) {
    showSuccess('Reset bid history');
  }

  console.log('');
}
