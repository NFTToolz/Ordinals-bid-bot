import axiosInstance from "../axios/axiosInstance";
import * as bitcoin from "bitcoinjs-lib"
import { ECPairInterface, ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { config } from "dotenv"
import limiter from "../bottleneck";
import Logger from "../utils/logger";

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

config()

const api_key = process.env.API_KEY as string;

const headers = {
  'Content-Type': 'application/json',
  'X-NFT-API-Key': api_key,
}


export async function cancelCollectionOfferRequest(offerIds: string[], makerPublicKey: string) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/cancel';
  const params = {
    offerIds,
    makerPublicKey,
    makerPaymentType: 'p2wpkh'
  };
  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<ICancelCollectionOfferRequest>(url, { params, headers }))
    return data

  } catch (error: any) {
    Logger.offer.error('cancelCollectionOfferRequest', offerIds.join(','), error?.message || 'Unknown error', error?.response?.status, error?.response?.data);
    return null;
  }
}

export function signCancelCollectionOfferRequest(unsignedData: ICancelCollectionOfferRequest, privateKey: string) {
  const psbtBase64 = unsignedData.psbtBase64
  const offerPsbt = bitcoin.Psbt.fromBase64(psbtBase64);
  const keyPair: ECPairInterface = ECPair.fromWIF(privateKey, network)

  offerPsbt.signInput(0, keyPair);
  const signedPsbtBase64 = offerPsbt.toBase64();

  return signedPsbtBase64
}

export async function submitCancelCollectionOffer(
  offerIds: string[],
  makerPublicKey: string,
  signedPsbtBase64: string
) {
  try {
    const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/cancel';
    const data = {
      makerPublicKey,
      offerIds,
      signedPsbtBase64,
      makerPaymentType: 'p2wpkh'
    };

    const response = await limiter.schedule(() => axiosInstance.post<ICancelOfferResponse>(url, data, { headers }))

    Logger.info(`[OFFER] Collection offer cancelled: ${offerIds.join(',')}`);

    return response

  } catch (error: any) {
    Logger.offer.error('submitCancelCollectionOffer', offerIds.join(','), error?.message || 'Unknown error', error?.response?.status, error?.response?.data);
    return null;
  }
}

export async function cancelCollectionOffer(
  offerIds: string[],
  makerPublicKey: string,
  privateKey: string
): Promise<boolean> {
  try {
    const unsignedData = await cancelCollectionOfferRequest(offerIds, makerPublicKey)

    if (unsignedData) {
      const signedData = signCancelCollectionOfferRequest(unsignedData, privateKey)
      const result = await submitCancelCollectionOffer(offerIds, makerPublicKey, signedData)
      return result !== null;
    }
    return false;
  } catch (error: any) {
    Logger.offer.error('cancelCollectionOffer', offerIds.join(','), error?.message || 'Unknown error', error?.response?.status, error?.response?.data);
    return false;
  }
}

export async function createCollectionOffer(
  collectionSymbol: string,
  priceSats: number,
  expirationAt: string,
  feeSatsPerVbyte: number,
  makerPublicKey: string,
  makerReceiveAddress: string,
  privateKey: string,
  maxAllowedPrice?: number  // Safety cap - last line of defense against overbidding
) {
  // Defensive validation - throw error if price exceeds max before any API call
  if (maxAllowedPrice !== undefined && priceSats > maxAllowedPrice) {
    throw new Error(`[SAFETY] Collection offer price ${priceSats} sats exceeds maximum allowed ${maxAllowedPrice} sats for ${collectionSymbol}`);
  }

  const params = {
    collectionSymbol,
    quantity: 1,
    priceSats,
    expirationAt,
    feeSatsPerVbyte,
    makerPublicKey,
    makerPaymentType: 'p2wpkh',
    makerReceiveAddress
  };
  let errorOccurred = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  do {
    try {
      const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/create'
      const { data } = await limiter.schedule(() => axiosInstance.get<ICollectionOfferResponseData>(url, { params, headers }))
      return data
    } catch (error: any) {
      if (error.response?.data?.error === "Only 1 collection offer allowed per collection.") {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          Logger.error(`[COLLECTION OFFER] Max retries (${MAX_RETRIES}) reached for ${collectionSymbol}, aborting`);
          throw new Error(`Max retries reached for collection offer: ${collectionSymbol}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait before retrying
        const offerData = await getBestCollectionOffer(collectionSymbol);

        const userOffer = offerData?.offers.find((item) => item.btcParams.makerOrdinalReceiveAddress.toLowerCase() === makerReceiveAddress.toLowerCase())
        if (userOffer) {
          await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey)
        }
        errorOccurred = true;
      } else {
        Logger.offer.error('createCollectionOffer', collectionSymbol, error?.message || 'Unknown error', error?.response?.status, error?.response?.data);
        errorOccurred = false;
        throw error;
      }
    }
  } while (errorOccurred);
}

export async function submitCollectionOffer(
  signedPsbtBase64: string,
  collectionSymbol: string,
  priceSats: number,
  expirationAt: string,
  makerPublicKey: string,
  makerReceiveAddress: string,
  privateKey: string,
  signedCancelPsbtBase64?: string,
) {

  const data = {
    collectionSymbol,
    quantity: 1,
    priceSats,
    expirationAt,
    makerPublicKey,
    makerPaymentType: 'p2wpkh',
    makerReceiveAddress,
    offers: [
      {
        signedPsbtBase64,
        signedCancelPsbtBase64
      }
    ]
  }


  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/create'
  let errorOccurred = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;
  do {
    try {
      const { data: requestData } = await limiter.schedule(() => axiosInstance.post<ISubmitCollectionOfferResponse>(url, data, { headers }))
      Logger.info(`[OFFER] Collection offer submitted for ${collectionSymbol}`);
      return requestData
    } catch (error: any) {
      Logger.offer.error('submitCollectionOffer', collectionSymbol, error?.message || 'Unknown error', error?.response?.status, error?.response?.data);
      if (error.response?.data?.error === "Only 1 collection offer allowed per collection.") {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          Logger.error(`[COLLECTION OFFER] Max retries (${MAX_RETRIES}) reached for submit ${collectionSymbol}, aborting`);
          throw new Error(`Max retries reached for submit collection offer: ${collectionSymbol}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait before retrying
        const offerData = await getBestCollectionOffer(collectionSymbol);

        const userOffer = offerData?.offers.find((item) => item.btcParams.makerOrdinalReceiveAddress.toLowerCase() === makerReceiveAddress.toLowerCase())
        if (userOffer) {
          await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey)
        }
        errorOccurred = true;
      } else {
        errorOccurred = false;
        throw error;
      }
    }
  } while (errorOccurred);
}
// sign collection offerData

export function signCollectionOffer(unsignedData: ICollectionOfferResponseData, privateKey: string) {
  if (!unsignedData?.offers?.length) {
    throw new Error('No offers returned from API to sign');
  }
  const offers = unsignedData.offers[0]
  const offerPsbt = bitcoin.Psbt.fromBase64(offers.psbtBase64);
  const keyPair: ECPairInterface = ECPair.fromWIF(privateKey, network)
  const toSignInputs: any[] = offerPsbt.data.inputs

  let cancelPsbt, signedCancelledPSBTBase64;

  if (toSignInputs.length > 1) {
    const inputs = [0, 1]
    console.log('SIGN 2 INPUTS');
    for (let index of inputs) {
      offerPsbt.signInput(index, keyPair);
      offerPsbt.finalizeInput(index);

    }
    offerPsbt.signAllInputs(keyPair)

    if (offers.cancelPsbtBase64) {
      cancelPsbt = bitcoin.Psbt.fromBase64(offers.cancelPsbtBase64);
      for (let index of inputs) {
        cancelPsbt.signInput(index, keyPair);
        cancelPsbt.finalizeInput(index);
      }
      cancelPsbt.signAllInputs(keyPair)
      signedCancelledPSBTBase64 = cancelPsbt.toBase64();
    }

  } else {
    console.log('SIGN 1 INPUTS');
    offerPsbt.signInput(0, keyPair);
    if (offers.cancelPsbtBase64) {
      cancelPsbt = bitcoin.Psbt.fromBase64(offers.cancelPsbtBase64);
      cancelPsbt.signInput(0, keyPair);
      signedCancelledPSBTBase64 = cancelPsbt.toBase64();
    }
  }


  const signedOfferPSBTBase64 = offerPsbt.toBase64();

  return { signedOfferPSBTBase64, signedCancelledPSBTBase64 };
}

export async function createOffer(
  tokenId: string,
  price: number,
  expiration: number,
  buyerTokenReceiveAddress: string,
  buyerPaymentAddress: string,
  publicKey: string,
  feerateTier: string,
  sellerReceiveAddress?: string,
  maxAllowedPrice?: number  // Safety cap - last line of defense against overbidding
) {
  // Defensive validation - throw error if price exceeds max before any API call
  if (maxAllowedPrice !== undefined && price > maxAllowedPrice) {
    throw new Error(`[SAFETY] Bid price ${price} sats exceeds maximum allowed ${maxAllowedPrice} sats for token ${tokenId}`);
  }

  const baseURL = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create';
  const params = {
    tokenId: tokenId,
    price: price,
    expirationDate: expiration,
    buyerTokenReceiveAddress: buyerTokenReceiveAddress,
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    feerateTier: feerateTier,
    ...(sellerReceiveAddress && { sellerReceiveAddress })
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get(baseURL, { params, headers }))
    return data
  } catch (error: any) {
    console.error(`[CREATE_OFFER ERROR] Token ${tokenId.slice(-8)}: ${error?.message || error}`);

    // Log API response details if available
    if (error?.response?.data) {
      const errorMessage = error.response.data?.error || '';

      // Check for specific error patterns
      if (errorMessage.includes('maximum number of offers')) {
        console.error(`[CREATE_OFFER] 🚨 Hit maximum offer limit!`);
      }

      // Parse and display insufficient funds with breakdown
      if (errorMessage.includes('Insufficient funds')) {
        // Parse: "Insufficient funds. Required 16634 sats, found 0 sats."
        const match = errorMessage.match(/Required (\d+) sats, found (\d+) sats/);
        if (match) {
          const required = parseInt(match[1], 10);
          const available = parseInt(match[2], 10);
          Logger.offer.insufficientFunds(tokenId, price, required, available);
        } else {
          // Fallback if parsing fails
          console.error(`[CREATE_OFFER API] Response:`, error.response.data);
        }
      } else {
        // Log other errors normally
        console.error(`[CREATE_OFFER API] Response:`, error.response.data);
      }
    }
    if (error?.response?.status) {
      console.error(`[CREATE_OFFER HTTP] Status: ${error.response.status}`);
    }

    // Re-throw the error so placeBid can handle it
    throw error;
  }
}

export function signData(unsignedData: any, privateKey: string) {
  if (typeof unsignedData !== "undefined") {
    const psbt = bitcoin.Psbt.fromBase64(unsignedData.psbtBase64);
    const keyPair: ECPairInterface = ECPair.fromWIF(privateKey, network)

    for (let index of unsignedData.toSignInputs) {
      psbt.signInput(index, keyPair);
      psbt.finalizeInput(index);
    }
    psbt.signAllInputs(keyPair)

    const signedBuyingPSBTBase64 = psbt.toBase64();
    return signedBuyingPSBTBase64;
  }
}

async function cancelBid(offer: IOffer, privateKey: string, collectionSymbol?: string, tokenId?: string, buyerPaymentAddress?: string): Promise<boolean> {
  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id)
    if (offerFormat) {
      const signedOfferFormat = signData(offerFormat, privateKey)
      if (signedOfferFormat) {
        const result = await submitCancelOfferData(offer.id, signedOfferFormat)
        return result === true;
      }
    }
    return false;
  } catch (error: any) {
    Logger.error(`[CANCEL] Failed to cancel bid ${offer.id}`, error?.message || error);
    return false;
  }
}


export async function submitSignedOfferOrder(
  signedPSBTBase64: string,
  tokenId: string,
  price: number,
  expiration: number,
  buyerPaymentAddress: string,
  buyerReceiveAddress: string,
  publicKey: string,
  feerateTier: string,
  privateKey: string,
  sellerReceiveAddress?: string
) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create';
  const data = {
    signedPSBTBase64: signedPSBTBase64,
    feerateTier: feerateTier,
    tokenId: tokenId,
    price: price,
    expirationDate: expiration.toString(),
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    buyerReceiveAddress: buyerReceiveAddress,
    ...(sellerReceiveAddress && { sellerReceiveAddress })
  };

  let errorOccurred = false;
  let retryCount = 0;
  const MAX_RETRIES = 3;

  do {
    try {
      const response = await limiter.schedule(() => axiosInstance.post(url, data, { headers }));
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.error === "You already have an offer for this token") {
        retryCount++;
        if (retryCount >= MAX_RETRIES) {
          Logger.error(`[OFFER] Max retries (${MAX_RETRIES}) reached for submitSignedOfferOrder token ${tokenId}, aborting`);
          throw new Error(`Max retries reached for submitSignedOfferOrder: ${tokenId}`);
        }
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait before retrying
        const offerData = await getOffers(tokenId, buyerReceiveAddress);
        if (offerData && offerData.offers.length > 0) {
          for (const item of offerData.offers) {
            await cancelBid(item, privateKey);
          }
        }
        errorOccurred = true;  // Signal to retry
      } else {
        errorOccurred = false;
        throw error;  // Rethrow other types of errors that are not handled specifically
      }
    }
  } while (errorOccurred);
}


export async function getBestCollectionOffer(collectionSymbol: string) {
  const url = `https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/collection/${collectionSymbol}`;
  const params = {
    sort: 'priceDesc',
    status: ['valid'],
    limit: 100,
    offset: 0
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<CollectionOfferData>(url, { params, headers }));
    return data
  } catch (error: any) {
    Logger.error(`[COLLECTION OFFER] getBestCollectionOffer error for ${collectionSymbol}`, error?.response?.data || error?.message);
  }

}

export async function getBestOffer(tokenId: string) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/';
  const params = {
    status: 'valid',
    limit: 2,
    offset: 0,
    sortBy: 'priceDesc',
    token_id: tokenId
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<OfferData>(url, { params, headers }));
    return data
  } catch (error: any) {
    Logger.error(`[BEST OFFER] getBestOffer error for ${tokenId.slice(-8)}`, error?.response?.data || error?.message);
    return undefined;
  }

}


export async function cancelBulkTokenOffers(tokenIds: string[], buyerTokenReceiveAddress: string, privateKey: string) {
  try {
    for (const token of tokenIds) {
      const offerData = await getOffers(token, buyerTokenReceiveAddress)
      const offer = offerData?.offers[0]
      if (offer) {
        const offerFormat = await retrieveCancelOfferFormat(offer.id)
        const signedOfferFormat = signData(offerFormat, privateKey)

        if (signedOfferFormat) {
          await submitCancelOfferData(offer.id, signedOfferFormat)
          console.log('--------------------------------------------------------------------------------');
          console.log(`CANCELLED OFFER FOR ${offer.token.collectionSymbol} ${offer.token.id}`);
          console.log('--------------------------------------------------------------------------------');
        }
      }
    }
  } catch (error: any) {
    Logger.error(`[CANCEL BULK] Failed to cancel bulk offers`, error?.message || error);
    throw error;
  }
}

export async function getOffers(tokenId: string, buyerTokenReceiveAddress?: string) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/';

  let params: any = {
    status: 'valid',
    limit: 100,
    sortBy: 'priceDesc',
    token_id: tokenId
  };

  if (buyerTokenReceiveAddress) {
    params = {
      status: 'valid',
      limit: 100,
      sortBy: 'priceDesc',
      token_id: tokenId,
      wallet_address_buyer: buyerTokenReceiveAddress
    };
  }

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<OfferData>(url, { params, headers }))
    return data
  } catch (error: any) {
    Logger.error(`[GET OFFERS] getOffers error for ${tokenId.slice(-8)}`, error?.response?.data || error?.message);
    return { total: '0', offers: [] };
  }
}


export async function retrieveCancelOfferFormat(offerId: string) {
  const url = `https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel?offerId=${offerId}`
  try {

    const { data } = await limiter.schedule({ priority: 5 }, () =>
      axiosInstance.get(url, { headers })
    );
    return data
  } catch (error: any) {
    Logger.error(`[CANCEL] retrieveCancelOfferFormat error for ${offerId}`, error?.response?.data || error?.message);
    return null;
  }
}

export async function submitCancelOfferData(offerId: string, signedPSBTBase64: string) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel';
  const data = {
    offerId: offerId,
    signedPSBTBase64: signedPSBTBase64
  };
  try {
    const response = await limiter.schedule(() => axiosInstance.post(url, data, { headers }))
    return response.data.ok
  } catch (error: any) {
    Logger.error(`[CANCEL] submitCancelOfferData error for ${offerId}`, error?.response?.data || error?.message);
    return false;
  }
}

export async function getUserOffers(buyerPaymentAddress: string) {
  try {
    const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/';
    const params = {
      status: 'valid',
      limit: 100,
      offset: 0,
      sortBy: 'priceDesc',
      wallet_address_buyer: buyerPaymentAddress.toLowerCase()
    };

    const { data } = await limiter.schedule(() => axiosInstance.get<UserOffer>(url, { params, headers }))
    return data
  } catch (error: any) {
    Logger.error(`[OFFERS] getUserOffers error for ${buyerPaymentAddress}`, error?.response?.data || error?.message);
    return null;
  }
}

interface Offer {
  id: string;
  tokenId: string;
  sellerReceiveAddress: string;
  sellerOrdinalsAddress: string;
  price: number;
  buyerReceiveAddress: string;
  buyerPaymentAddress: string;
  expirationDate: number;
  isValid: boolean;
  token: any;
}

interface OfferData {
  total: string;
  offers: Offer[];
}

interface OfferData {
  total: string;
  offers: Offer[];
}

export interface CollectionOfferData {
  total: string;
  offers: ICollectionOffer[];
}

export interface ICollectionOffer {
  chain: string;
  id: string;
  collectionSymbol: string;
  status: string;
  quantity: number;
  price: {
    amount: number;
    currency: string;
    decimals: number;
  };
  maker: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  fees: any[]; // Adjust this type based on the actual structure of the 'fees' property
  btcParams: {
    makerOrdinalReceiveAddress: string;
    makerPaymentAddress: string;
    pendingDeposits: any[]; // Adjust this type based on the actual structure of the 'pendingDeposits' property
  };
}

interface Token {
  id: string;
  contentURI: string;
  contentType: string;
  contentBody: string;
  contentPreviewURI: string;
  genesisTransaction: string;
  genesisTransactionBlockTime: string;
  genesisTransactionBlockHash: string;
  genesisTransactionBlockHeight: number;
  inscriptionNumber: number;
  chain: string;
  meta: {
    name: string;
    attributes: string[];
  };
  location: string;
  locationBlockHeight: number;
  locationBlockTime: string;
  locationBlockHash: string;
  output: string;
  outputValue: number;
  owner: string;
  listed: boolean;
  listedAt: string;
  listedPrice: number;
  listedMakerFeeBp: number;
  listedSellerReceiveAddress: string;
  listedForMint: boolean;
  collectionSymbol: string;
  itemType: string;
  sat: number;
  satName: string;
  satRarity: string;
  satBlockHeight: number;
  satBlockTime: string;
  satributes: string[];
}

export interface IOffer {
  id: string;
  tokenId: string;
  sellerReceiveAddress: string;
  sellerOrdinalsAddress: string;
  price: number;
  buyerReceiveAddress: string;
  buyerPaymentAddress: string;
  expirationDate: number;
  isValid: boolean;
  token: Token;
}

interface UserOffer {
  total: string,
  offers: IOffer[]
}

export interface ICollectionOfferData {
  psbtBase64: string;
  transactionFeeSats: number;
  cancelPsbtBase64: string;
  cancelTransactionFeeSats: number;
}

export interface ICollectionOfferResponseData {
  offers: ICollectionOfferData[];
}

interface ISubmitCollectionOfferResponse {
  offerIds: string[];
}

interface ICancelCollectionOfferRequest {
  offerIds: string[];
  psbtBase64: string;
}

interface ICancelOfferResponse {
  offerIds: string[];
  ok: boolean;
}