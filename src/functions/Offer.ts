import axiosInstance from "../axios/axiosInstance";
import * as bitcoin from "bitcoinjs-lib"
import { ECPairInterface, ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';
import { config } from "dotenv"
import limiter from "../bottleneck";

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
    console.log(error.response.data);
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

    console.log(response.data);

    return response

  } catch (error: any) {
    console.log(error.response.data);
  }
}

export async function cancelCollectionOffer(
  offerIds: string[],
  makerPublicKey: string,
  privateKey: string
) {
  try {
    const unsignedData = await cancelCollectionOfferRequest(offerIds, makerPublicKey)

    if (unsignedData) {
      const signedData = signCancelCollectionOfferRequest(unsignedData, privateKey)
      await submitCancelCollectionOffer(offerIds, makerPublicKey, signedData)
    }
  } catch (error) {
    console.log(error);
  }
}

export async function createCollectionOffer(
  collectionSymbol: string,
  priceSats: number,
  expirationAt: string,
  feeSatsPerVbyte: number,
  makerPublicKey: string,
  makerReceiveAddress: string,
  privateKey: string
) {
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
  do {
    try {
      const url = 'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/create'
      const { data } = await limiter.schedule(() => axiosInstance.get<ICollectionOfferResponseData>(url, { params, headers }))
      return data
    } catch (error: any) {
      if (error.response?.data?.error === "Only 1 collection offer allowed per collection.") {
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait before retrying
        const offerData = await getBestCollectionOffer(collectionSymbol);

        const userOffer = offerData?.offers.find((item) => item.btcParams.makerOrdinalReceiveAddress.toLowerCase() === makerReceiveAddress.toLowerCase())
        if (userOffer) {
          await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey)
        }
        errorOccurred = true;
      } else {
        console.log(error.response.data);
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
  do {
    try {
      const { data: requestData } = await limiter.schedule(() => axiosInstance.post<ISubmitCollectionOfferResponse>(url, data, { headers }))
      console.log({ requestData });
      return requestData
    } catch (error: any) {
      console.log('Submit collection offer error from')
      console.log(error.response.data);
      if (error.response?.data?.error === "Only 1 collection offer allowed per collection.") {
        await new Promise(resolve => setTimeout(resolve, 2500)); // Wait before retrying
        const offerData = await getBestCollectionOffer(collectionSymbol);

        const userOffer = offerData?.offers.find((item) => item.btcParams.makerOrdinalReceiveAddress.toLowerCase() === makerReceiveAddress.toLowerCase())
        if (userOffer) {
          await cancelCollectionOffer([userOffer.id], makerPublicKey, privateKey)
        }
        errorOccurred = true;
      } else {
        console.log(error.response.data);
        errorOccurred = false;
        throw error;
      }
    }
  } while (errorOccurred);
}
// sign collection offerData

export function signCollectionOffer(unsignedData: ICollectionOfferResponseData, privateKey: string) {
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
  feerateTier: string
) {
  const baseURL = 'https://nfttools.pro/magiceden/v2/ord/btc/offers/create';
  const params = {
    tokenId: tokenId,
    price: price,
    expirationDate: expiration,
    buyerTokenReceiveAddress: buyerTokenReceiveAddress,
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    feerateTier: feerateTier
  };

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get(baseURL, { params, headers }))
    return data
  } catch (error: any) {
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
    price: price,
    expirationDate: expiration.toString(),
    buyerPaymentAddress: buyerPaymentAddress,
    buyerPaymentPublicKey: publicKey,
    buyerReceiveAddress: buyerReceiveAddress
  };

  let errorOccurred = false;

  do {
    try {
      const response = await limiter.schedule(() => axiosInstance.post(url, data, { headers }));
      return response.data;
    } catch (error: any) {
      if (error.response?.data?.error === "You already have an offer for this token") {
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
    console.log('getBestCollectionOffer: ', error.response.data);
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
  }

}


export async function cancelAllUserOffers(buyerTokenReceiveAddress: string, privateKey: string) {
  try {
    console.log('--------------------------------------------------------------------------------');
    console.log('CANCEL ALL OFFERS!!!');
    console.log('--------------------------------------------------------------------------------');

    const offerData = await getUserOffers(buyerTokenReceiveAddress)

    if (offerData && offerData.offers && offerData.offers.length > 0) {
      const offers = offerData.offers
      console.log('--------------------------------------------------------------------------------');
      console.log('NUMBER OF CURRENT ACTIVE OFFERS: ', offers.length);
      console.log('--------------------------------------------------------------------------------');

      for (const offer of offers) {
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
  } catch (error) {
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
  } catch (error) {
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
  }
}

export async function counterBid(
  offerId: string,
  tokenId: string,
  price: number,
  expiration: number,
  buyerTokenReceiveAddress: string,
  buyerPaymentAddress: string,
  publicKey: string,
  feerateTier: string,
  privateKey: string
) {
  console.log('--------------------------------------------------------------------------------');
  console.log("COUNTER BID");
  console.log('--------------------------------------------------------------------------------');

  const cancelOfferFormat = await retrieveCancelOfferFormat(offerId)

  console.log('--------------------------------------------------------------------------------');
  console.log({ cancelOfferFormat });
  console.log('--------------------------------------------------------------------------------');

  const signedCancelOffer = signData(cancelOfferFormat, privateKey)

  console.log('--------------------------------------------------------------------------------');
  console.log({ signedCancelOffer });
  console.log('--------------------------------------------------------------------------------');

  if (signedCancelOffer) {
    const submitCancelOffer = await submitCancelOfferData(offerId, signedCancelOffer)

    console.log('--------------------------------------------------------------------------------');
    console.log({ submitCancelOffer });
    console.log('--------------------------------------------------------------------------------');

  }

  const unsignedOffer = await createOffer(tokenId, price, expiration, buyerTokenReceiveAddress, buyerPaymentAddress, publicKey, feerateTier)

  console.log('--------------------------------------------------------------------------------');
  console.log({ unsignedOffer });
  console.log('--------------------------------------------------------------------------------');

  const signedOfferData = signData(unsignedOffer, privateKey)

  console.log('--------------------------------------------------------------------------------');
  console.log({ signedOfferData });
  console.log('--------------------------------------------------------------------------------');

  if (signedOfferData) {

    const offerData = await submitSignedOfferOrder(signedOfferData, tokenId, price, expiration, buyerPaymentAddress, buyerTokenReceiveAddress, publicKey, feerateTier, privateKey)

    console.log('--------------------------------------------------------------------------------');
    console.log({ offerData });
    console.log('--------------------------------------------------------------------------------');
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
  } catch (error) {
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