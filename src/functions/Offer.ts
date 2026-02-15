import axiosInstance from "../axios/axiosInstance";
import * as bitcoin from "bitcoinjs-lib"
import { ECPairInterface, ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { config } from "dotenv"
import limiter from "../bottleneck";
import Logger from "../utils/logger";
import { getErrorMessage, getErrorResponseData, getErrorStatus, InsufficientFundsError } from "../utils/errorUtils";
import { getAllOurReceiveAddresses } from "../utils/walletHelpers";

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);
const network = bitcoin.networks.bitcoin;

config()

/**
 * Centralized retry configuration for offer-related API operations.
 * Prevents code duplication and provides consistent retry behavior.
 */
export const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 2500,
  /**
   * Calculate delay for exponential backoff
   * @param attempt - Current attempt number (1-based)
   * @returns Delay in milliseconds
   */
  getDelayMs(attempt: number): number {
    // Exponential backoff: 2500ms, 5000ms, 10000ms
    return this.baseDelayMs * Math.pow(2, attempt - 1);
  }
};

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

  } catch (error: unknown) {
    Logger.offer.error('cancelCollectionOfferRequest', offerIds.join(','), getErrorMessage(error), getErrorStatus(error), getErrorResponseData(error));
    throw error;
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

  } catch (error: unknown) {
    Logger.offer.error('submitCancelCollectionOffer', offerIds.join(','), getErrorMessage(error), getErrorStatus(error), getErrorResponseData(error));
    throw error;
  }
}

export async function cancelCollectionOffer(
  offerIds: string[],
  makerPublicKey: string,
  privateKey: string
): Promise<boolean> {
  try {
    const unsignedData = await cancelCollectionOfferRequest(offerIds, makerPublicKey)
    const signedData = signCancelCollectionOfferRequest(unsignedData, privateKey)
    await submitCancelCollectionOffer(offerIds, makerPublicKey, signedData)
    return true;
  } catch (error: unknown) {
    Logger.offer.error('cancelCollectionOffer', offerIds.join(','), getErrorMessage(error), getErrorStatus(error), getErrorResponseData(error));
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
    priceSats: Math.floor(priceSats),
    expirationAt,
    feeSatsPerVbyte: Math.floor(feeSatsPerVbyte),
    makerPublicKey,
    makerPaymentType: 'p2wpkh',
    makerReceiveAddress
  };
  let errorOccurred = false;
  let retryCount = 0;
  do {
    try {
      const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/create'
      const { data } = await limiter.schedule(() => axiosInstance.get<ICollectionOfferResponseData>(url, { params, headers }))
      return data
    } catch (error: unknown) {
      const responseError = getErrorResponseData(error);
      const errorStr = responseError && typeof responseError === 'object' && responseError !== null && 'error' in responseError
        ? String((responseError as { error: unknown }).error)
        : '';
      if (errorStr === "Only 1 collection offer allowed per collection.") {
        retryCount++;
        if (retryCount >= RETRY_CONFIG.maxRetries) {
          Logger.error(`[COLLECTION OFFER] Max retries (${RETRY_CONFIG.maxRetries}) reached for ${collectionSymbol}, aborting`);
          throw new Error(`Max retries reached for collection offer: ${collectionSymbol}`);
        }
        const delayMs = RETRY_CONFIG.getDelayMs(retryCount);
        Logger.info(`[COLLECTION OFFER] Retry ${retryCount}/${RETRY_CONFIG.maxRetries} for ${collectionSymbol}, waiting ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs)); // Exponential backoff

        // FIX: Wrap getBestCollectionOffer in try/catch to prevent unexpected breaks from retry loop
        let offerData;
        try {
          offerData = await getBestCollectionOffer(collectionSymbol);
        } catch (fetchError: unknown) {
          Logger.error(`[COLLECTION OFFER] Failed to fetch offers during retry for ${collectionSymbol}`, getErrorMessage(fetchError));
          // Continue retry loop - we'll try again on next iteration
          errorOccurred = true;
          continue;
        }

        // FIX: Add null check - if offerData is null/undefined, skip cancellation check
        if (!offerData?.offers) {
          Logger.warning(`[COLLECTION OFFER] No offer data available for ${collectionSymbol}, skipping cancellation check`);
          errorOccurred = true;
          continue;
        }

        // Check for existing offers from ANY of our wallet group addresses (not just the current wallet)
        const ourReceiveAddresses = getAllOurReceiveAddresses();
        const userOffer = offerData.offers.find((item) => ourReceiveAddresses.has(item.btcParams.makerOrdinalReceiveAddress.toLowerCase()))
        if (userOffer) {
          const cancelled = await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey);
          if (!cancelled) {
            Logger.error(`[COLLECTION OFFER] Failed to cancel existing offer for ${collectionSymbol}, aborting retry`);
            throw new Error(`Failed to cancel existing collection offer for ${collectionSymbol}`);
          }
        }
        errorOccurred = true;
      } else {
        Logger.offer.error('createCollectionOffer', collectionSymbol, getErrorMessage(error), getErrorStatus(error), getErrorResponseData(error));
        // Parse "Insufficient funds" and throw typed error for retry logic
        if (errorStr.includes('Insufficient funds')) {
          const match = errorStr.match(/Required (\d+) sats, found (\d+) sats/);
          if (match) {
            throw new InsufficientFundsError(parseInt(match[1], 10), parseInt(match[2], 10));
          }
        }
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
  do {
    try {
      const { data: requestData } = await limiter.schedule(() => axiosInstance.post<ISubmitCollectionOfferResponse>(url, data, { headers }))
      Logger.info(`[OFFER] Collection offer submitted for ${collectionSymbol}`);
      return requestData
    } catch (error: unknown) {
      Logger.offer.error('submitCollectionOffer', collectionSymbol, getErrorMessage(error), getErrorStatus(error), getErrorResponseData(error));
      const submitResponseError = getErrorResponseData(error);
      const submitErrorStr = submitResponseError && typeof submitResponseError === 'object' && submitResponseError !== null && 'error' in submitResponseError
        ? String((submitResponseError as { error: unknown }).error)
        : '';
      if (submitErrorStr === "Only 1 collection offer allowed per collection.") {
        retryCount++;
        if (retryCount >= RETRY_CONFIG.maxRetries) {
          Logger.error(`[COLLECTION OFFER] Max retries (${RETRY_CONFIG.maxRetries}) reached for submit ${collectionSymbol}, aborting`);
          throw new Error(`Max retries reached for submit collection offer: ${collectionSymbol}`);
        }
        const delayMs = RETRY_CONFIG.getDelayMs(retryCount);
        Logger.info(`[COLLECTION OFFER] Submit retry ${retryCount}/${RETRY_CONFIG.maxRetries} for ${collectionSymbol}, waiting ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs)); // Exponential backoff

        // FIX: Wrap getBestCollectionOffer in try/catch to prevent unexpected breaks from retry loop
        let offerData;
        try {
          offerData = await getBestCollectionOffer(collectionSymbol);
        } catch (fetchError: unknown) {
          Logger.error(`[COLLECTION OFFER] Failed to fetch offers during submit retry for ${collectionSymbol}`, getErrorMessage(fetchError));
          // Continue retry loop - we'll try again on next iteration
          errorOccurred = true;
          continue;
        }

        // FIX: Add null check - if offerData is null/undefined, skip cancellation check
        if (!offerData?.offers) {
          Logger.warning(`[COLLECTION OFFER] No offer data available for submit ${collectionSymbol}, skipping cancellation check`);
          errorOccurred = true;
          continue;
        }

        // Check for existing offers from ANY of our wallet group addresses (not just the current wallet)
        const ourReceiveAddresses = getAllOurReceiveAddresses();
        const userOffer = offerData.offers.find((item) => ourReceiveAddresses.has(item.btcParams.makerOrdinalReceiveAddress.toLowerCase()))
        if (userOffer) {
          const cancelled = await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey);
          if (!cancelled) {
            Logger.error(`[COLLECTION OFFER] Failed to cancel existing offer for ${collectionSymbol}, aborting submit retry`);
            throw new Error(`Failed to cancel existing collection offer for submit: ${collectionSymbol}`);
          }
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
  const inputCount = offerPsbt.data.inputs.length;

  let cancelPsbt, signedCancelledPSBTBase64;

  if (inputCount > 1) {
    const inputs = [0, 1]
    Logger.info('[SIGN] Signing 2 inputs');
    for (let index of inputs) {
      offerPsbt.signInput(index, keyPair);
    }

    if (offers.cancelPsbtBase64) {
      cancelPsbt = bitcoin.Psbt.fromBase64(offers.cancelPsbtBase64);
      for (let index of inputs) {
        cancelPsbt.signInput(index, keyPair);
      }
      signedCancelledPSBTBase64 = cancelPsbt.toBase64();
    }

  } else {
    Logger.info('[SIGN] Signing 1 input');
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
  maxAllowedPrice?: number  // Safety cap - last line of defense against overbidding
) {
  // Defensive validation - throw error if price exceeds max before any API call
  if (maxAllowedPrice !== undefined && price > maxAllowedPrice) {
    throw new Error(`[SAFETY] Bid price ${price} sats exceeds maximum allowed ${maxAllowedPrice} sats for token ${tokenId}`);
  }

  const baseURL = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create';
  const params = {
    tokenId: tokenId,
    price: Math.floor(price),
    expirationDate: Math.floor(expiration),
    buyerTokenReceiveAddress: buyerTokenReceiveAddress,
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    feerateTier: feerateTier,
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get(baseURL, { params, headers }))
    return data
  } catch (error: unknown) {
    Logger.error(`[CREATE_OFFER] Token ${tokenId.slice(-8)}: ${getErrorMessage(error)}`);

    // Log API response details if available
    const responseData = getErrorResponseData(error);
    if (responseData) {
      const errorMessage = typeof responseData === 'object' && responseData !== null && 'error' in responseData
        ? String((responseData as { error: unknown }).error)
        : '';

      // Check for specific error patterns
      if (errorMessage.includes('maximum number of offers')) {
        Logger.error(`[CREATE_OFFER] Hit maximum offer limit!`);
      }

      // Parse and display insufficient funds with breakdown
      if (errorMessage.includes('Insufficient funds')) {
        // Parse: "Insufficient funds. Required 16634 sats, found 0 sats."
        const match = errorMessage.match(/Required (\d+) sats, found (\d+) sats/);
        if (match) {
          const required = parseInt(match[1], 10);
          const available = parseInt(match[2], 10);
          Logger.offer.insufficientFunds(tokenId, price, required, available);
          throw new InsufficientFundsError(required, available);
        } else {
          // Fallback if parsing fails
          Logger.error(`[CREATE_OFFER] API Response:`, responseData);
        }
      } else {
        // Log other errors normally
        Logger.error(`[CREATE_OFFER] API Response:`, responseData);
      }
    }
    const status = getErrorStatus(error);
    if (status) {
      Logger.error(`[CREATE_OFFER] HTTP Status: ${status}`);
    }

    // Re-throw the error so placeBid can handle it
    throw error;
  }
}

export interface UnsignedPsbtData {
  psbtBase64: string;
  toSignInputs: number[];
  toSignSigHash?: number;
  toSignOrdinalInputs?: number[];
}

export function signData(unsignedData: UnsignedPsbtData, privateKey: string): string {
  // Validate unsignedData has required properties (null, undefined, or missing fields)
  if (!unsignedData || !unsignedData.psbtBase64 || !unsignedData.toSignInputs) {
    throw new Error('[SIGN] Invalid unsigned data: missing psbtBase64 or toSignInputs');
  }

  if (unsignedData.toSignInputs.length === 0) {
    throw new Error('[SIGN] toSignInputs is empty');
  }

  try {
    const psbt = bitcoin.Psbt.fromBase64(unsignedData.psbtBase64);
    const keyPair: ECPairInterface = ECPair.fromWIF(privateKey, network)

    for (let index of unsignedData.toSignInputs) {
      psbt.signInput(index, keyPair);
      // No finalizeInput — ME expects partial signatures
    }
    // No signAllInputs — only sign the inputs ME specifies

    const signedBuyingPSBTBase64 = psbt.toBase64();
    return signedBuyingPSBTBase64;
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    Logger.error('[SIGN] Failed to sign PSBT:', errorMsg);
    throw new Error(`[SIGN] Failed to sign PSBT: ${errorMsg}`);
  }
}

async function cancelBid(offer: IOffer, privateKey: string, collectionSymbol?: string, tokenId?: string, buyerPaymentAddress?: string): Promise<boolean> {
  try {
    const offerFormat = await retrieveCancelOfferFormat(offer.id)
    if (!offerFormat) {
      Logger.warning(`[CANCEL] No cancel format returned for offer ${offer.id}`);
      return false;
    }
    const signedOfferFormat = signData(offerFormat, privateKey)
    const result = await submitCancelOfferData(offer.id, signedOfferFormat)
    return result === true;
  } catch (error: unknown) {
    Logger.error(`[CANCEL] Failed to cancel bid ${offer.id}`, getErrorMessage(error));
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
  privateKey: string
) {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create';
  const data = {
    signedPSBTBase64: signedPSBTBase64,
    feerateTier: feerateTier,
    tokenId: tokenId,
    price: Math.floor(price),
    expirationDate: Math.floor(expiration).toString(),
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    buyerReceiveAddress: buyerReceiveAddress,
  };

  let errorOccurred = false;
  let retryCount = 0;

  do {
    try {
      const response = await limiter.schedule(() => axiosInstance.post(url, data, { headers }));
      return response.data;
    } catch (error: unknown) {
      const offerResponseError = getErrorResponseData(error);
      const offerErrorStr = offerResponseError && typeof offerResponseError === 'object' && offerResponseError !== null && 'error' in offerResponseError
        ? String((offerResponseError as { error: unknown }).error)
        : '';
      if (offerErrorStr === "You already have an offer for this token") {
        retryCount++;
        if (retryCount >= RETRY_CONFIG.maxRetries) {
          Logger.error(`[OFFER] Max retries (${RETRY_CONFIG.maxRetries}) reached for submitSignedOfferOrder token ${tokenId}, aborting`);
          throw new Error(`Max retries reached for submitSignedOfferOrder: ${tokenId}`);
        }
        const delayMs = RETRY_CONFIG.getDelayMs(retryCount);
        Logger.info(`[OFFER] Submit retry ${retryCount}/${RETRY_CONFIG.maxRetries} for token ${tokenId}, waiting ${delayMs}ms`);
        await new Promise(resolve => setTimeout(resolve, delayMs)); // Exponential backoff
        try {
          const offerData = await getOffers(tokenId, buyerReceiveAddress);
          if (offerData.offers.length > 0) {
            let allCancelled = true;
            for (const item of offerData.offers) {
              const cancelled = await cancelBid(item, privateKey);
              if (!cancelled) {
                allCancelled = false;
                Logger.warning(`[OFFER] Failed to cancel offer ${item.id} for token ${tokenId}`);
              }
            }
            if (!allCancelled) {
              Logger.error(`[OFFER] Not all offers cancelled for ${tokenId}, aborting retry`);
              throw new Error(`Failed to cancel all existing offers for token: ${tokenId}`);
            }
          }
        } catch (offerError: unknown) {
          const status = getErrorStatus(offerError);
          // Transient errors (5xx, 429) - continue retry loop instead of aborting
          if (status !== undefined && (status >= 500 || status === 429)) {
            Logger.warning(`[OFFER] Transient error (${status}) fetching offers for ${tokenId}, will retry`);
            await new Promise(r => setTimeout(r, 1000));
            errorOccurred = true;
            continue;
          }
          // Non-retryable errors - abort
          Logger.error(`[OFFER] API error fetching offers for ${tokenId}, aborting retry: ${getErrorMessage(offerError)}`);
          throw offerError;
        }
        errorOccurred = true;  // Signal to retry
      } else {
        errorOccurred = false;
        throw error;  // Rethrow other types of errors that are not handled specifically
      }
    }
  } while (errorOccurred);
}


/**
 * Get best collection offer from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns CollectionOfferData on success, null if no offers exist (404)
 */
export async function getBestCollectionOffer(collectionSymbol: string): Promise<CollectionOfferData | null> {
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
  } catch (error: unknown) {
    // 404 means no offers exist - return null (not an error)
    if (getErrorStatus(error) === 404) {
      return null;
    }
    Logger.error(`[COLLECTION OFFER] getBestCollectionOffer error for ${collectionSymbol}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
  }
}

/**
 * Get best offer for a token from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns OfferData on success (may have empty offers array if no offers exist)
 */
export async function getBestOffer(tokenId: string): Promise<OfferData> {
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
  } catch (error: unknown) {
    Logger.error(`[BEST OFFER] getBestOffer error for ${tokenId.slice(-8)}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
  }
}


export interface BulkCancelResult {
  successful: string[];
  failed: { tokenId: string; error: string }[];
}

export async function cancelBulkTokenOffers(
  tokenIds: string[],
  buyerTokenReceiveAddress: string,
  privateKey: string
): Promise<BulkCancelResult> {
  const results: BulkCancelResult = { successful: [], failed: [] };

  for (const token of tokenIds) {
    try {
      const offerData = await getOffers(token, buyerTokenReceiveAddress)
      const offer = offerData?.offers?.[0]
      if (offer) {
        const offerFormat = await retrieveCancelOfferFormat(offer.id)
        if (!offerFormat) {
          Logger.warning(`[CANCEL BULK] No cancel format returned for offer ${offer.id}, skipping`);
          results.failed.push({ tokenId: token, error: 'No cancel format returned' });
          continue;
        }
        const signedOfferFormat = signData(offerFormat, privateKey)
        await submitCancelOfferData(offer.id, signedOfferFormat)
        Logger.info(`[CANCEL BULK] Cancelled offer for ${offer.token.collectionSymbol} ${offer.token.id}`);
        results.successful.push(token);
      } else {
        // No offer found - consider this a success (nothing to cancel)
        results.successful.push(token);
      }
    } catch (error: unknown) {
      Logger.error(`[CANCEL BULK] Failed to cancel offer for ${token}`, getErrorMessage(error));
      results.failed.push({ tokenId: token, error: getErrorMessage(error) });
    }
  }

  return results;
}

/**
 * Get offers for a token from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns OfferData on success (may have empty offers array if no offers exist)
 */
export async function getOffers(tokenId: string, buyerTokenReceiveAddress?: string): Promise<OfferData> {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/';

  interface GetOffersParams {
    status: string;
    limit: number;
    sortBy: string;
    token_id: string;
    wallet_address_buyer?: string;
  }

  const params: GetOffersParams = {
    status: 'valid',
    limit: 100,
    sortBy: 'priceDesc',
    token_id: tokenId,
    ...(buyerTokenReceiveAddress && { wallet_address_buyer: buyerTokenReceiveAddress }),
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<OfferData>(url, { params, headers }))
    return data
  } catch (error: unknown) {
    Logger.error(`[GET OFFERS] getOffers error for ${tokenId.slice(-8)}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
  }
}


/**
 * Retrieve the cancel offer format from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns Cancel offer format data on success
 */
export async function retrieveCancelOfferFormat(offerId: string) {
  const url = `https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel?offerId=${offerId}`
  try {
    const { data } = await limiter.schedule({ priority: 5 }, () =>
      axiosInstance.get(url, { headers })
    );
    return data
  } catch (error: unknown) {
    Logger.error(`[CANCEL] retrieveCancelOfferFormat error for ${offerId}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
  }
}

/**
 * Submit cancel offer data to the API.
 * @throws Error on API failure so caller can decide on retry strategy
 * @returns true if cancellation was successful, false if API returned ok=false
 */
export async function submitCancelOfferData(offerId: string, signedPSBTBase64: string): Promise<boolean> {
  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel';
  const data = {
    offerId: offerId,
    signedPSBTBase64: signedPSBTBase64
  };
  try {
    const response = await limiter.schedule(() => axiosInstance.post(url, data, { headers }))
    return response?.data?.ok ?? false;
  } catch (error: unknown) {
    // Log the error for debugging, then re-throw so caller can handle appropriately
    Logger.error(`[CANCEL] submitCancelOfferData error for ${offerId}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
  }
}

/**
 * Get all offers for a user by the address used as buyerTokenReceiveAddress.
 * When CENTRALIZE_RECEIVE_ADDRESS=true, this is the taproot receive address (bc1p...).
 * When CENTRALIZE_RECEIVE_ADDRESS=false, this is the payment address (bc1q...),
 * since the bot sets buyerTokenReceiveAddress = buyerPaymentAddress.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns UserOffer on success (may have empty offers array if no offers exist)
 */
export async function getUserOffers(buyerReceiveAddress: string): Promise<UserOffer> {
  try {
    const url = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/';
    const params = {
      status: 'valid',
      limit: 100,
      offset: 0,
      sortBy: 'priceDesc',
      wallet_address_buyer: buyerReceiveAddress.toLowerCase()
    };

    const { data } = await limiter.schedule(() => axiosInstance.get<UserOffer>(url, { params, headers }))
    return data
  } catch (error: unknown) {
    Logger.error(`[OFFERS] getUserOffers error for ${buyerReceiveAddress}`, getErrorResponseData(error) || getErrorMessage(error));
    throw error;
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
  token: Token;
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
  fees: { pct: number; name: string; address?: string }[];
  btcParams: {
    makerOrdinalReceiveAddress: string;
    makerPaymentAddress: string;
    pendingDeposits: unknown[];
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