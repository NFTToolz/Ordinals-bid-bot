import fs from 'fs';
import * as bitcoin from 'bitcoinjs-lib';
import { config } from 'dotenv';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
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
import { loadCollections, CollectionConfig } from '../../services/CollectionService';

config();

const FUNDING_WIF = process.env.FUNDING_WIF as string;
const TOKEN_RECEIVE_ADDRESS = process.env.TOKEN_RECEIVE_ADDRESS as string;
const network = bitcoin.networks.bitcoin;

const ENABLE_WALLET_ROTATION = process.env.ENABLE_WALLET_ROTATION === 'true';
const WALLET_CONFIG_PATH = process.env.WALLET_CONFIG_PATH || './src/config/wallets.json';

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

function getReceiveAddressesToCheck(collections: CollectionConfig[]): AddressInfo[] {
  const addresses: AddressInfo[] = [];
  const seenAddresses = new Set<string>();

  // If wallet rotation is enabled, add all wallet receive addresses
  if (ENABLE_WALLET_ROTATION && fs.existsSync(WALLET_CONFIG_PATH)) {
    try {
      const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));
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
    } catch (error) {
      // Failed to load wallet config
    }
  }

  // Add addresses from collection configs
  for (const collection of collections) {
    const receiveAddress = collection.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
    const privateKey = collection.fundingWalletWIF ?? FUNDING_WIF;

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

  // If wallet rotation is enabled, try to find the wallet that placed this bid
  if (ENABLE_WALLET_ROTATION && isWalletPoolInitialized()) {
    const wallet = getWalletByPaymentAddress(offer.buyerPaymentAddress);
    if (wallet) {
      signingKey = wallet.config.wif;
    } else if (offer.buyerPaymentAddress !== buyerPaymentAddress) {
      return false;
    }
  } else if (offer.buyerPaymentAddress !== buyerPaymentAddress) {
    return false;
  }

  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id);
    const signedOfferFormat = signData(offerFormat, signingKey);
    if (signedOfferFormat) {
      await submitCancelOfferData(offer.id, signedOfferFormat);
      return true;
    }
  } catch (error) {
    // Failed to cancel
  }
  return false;
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

      if (offers && offers.length > 0) {
        const cancelOps = offers.map((offer: IOffer) =>
          cancelBid(offer, addr.privateKey, addr.paymentAddress)
        );

        const results = await Promise.all(cancelOps);
        canceled += results.filter(Boolean).length;
      }
    } catch (error: any) {
      errors.push(`Failed to check offers for ${addr.address.slice(0, 10)}...: ${error.message}`);
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
          c.tokenReceiveAddress === collection.tokenReceiveAddress &&
          c.offerType === collection.offerType
      )
  );

  for (const item of uniqueCollections) {
    if (item.offerType === 'COLLECTION') {
      const privateKey = item.fundingWalletWIF ?? FUNDING_WIF;
      const buyerTokenReceiveAddress = item.tokenReceiveAddress ?? TOKEN_RECEIVE_ADDRESS;
      const keyPair = ECPair.fromWIF(privateKey, network);
      const publicKey = keyPair.publicKey.toString('hex');

      try {
        const bestOffers = await getBestCollectionOffer(item.collectionSymbol);
        const ourOffer = bestOffers?.offers.find(
          (offer: ICollectionOffer) =>
            offer.btcParams.makerOrdinalReceiveAddress.toLowerCase() ===
            buyerTokenReceiveAddress.toLowerCase()
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

async function performCancellation(): Promise<CancelResult> {
  const collections = loadCollections();

  // Initialize wallet pool if needed
  if (ENABLE_WALLET_ROTATION) {
    try {
      if (fs.existsSync(WALLET_CONFIG_PATH)) {
        const walletConfig = JSON.parse(fs.readFileSync(WALLET_CONFIG_PATH, 'utf-8'));
        if (walletConfig.wallets?.length > 0) {
          initializeWalletPool(walletConfig.wallets, walletConfig.bidsPerMinute || 5, network);
        }
      }
    } catch (error) {
      // Failed to initialize wallet pool
    }
  }

  const addresses = getReceiveAddressesToCheck(collections);
  const itemResult = await cancelAllItemOffers(addresses);
  const collectionResult = await cancelAllCollectionOffers(collections);

  return {
    itemOffersCanceled: itemResult.canceled,
    collectionOffersCanceled: collectionResult.canceled,
    errors: [...itemResult.errors, ...collectionResult.errors],
  };
}

export async function cancelOffers(): Promise<void> {
  showSectionHeader('CANCEL ALL OFFERS');

  showWarning('This will cancel ALL active item and collection offers.');
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

  console.log('');
}
