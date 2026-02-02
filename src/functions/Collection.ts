import axiosInstance from "../axios/axiosInstance"
import limiter from "../bottleneck";
import Logger from "../utils/logger";

const API_KEY = process.env.API_KEY as string;
const headers = {
  'Content-Type': 'application/json',
  'X-NFT-API-Key': API_KEY,
}

/**
 * Fetch collection details from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns CollectionData on success, null if collection doesn't exist (404)
 */
export async function collectionDetails(collectionSymbol: string): Promise<CollectionData | null> {
  try {
    const url = `https://nfttools.pro/magiceden/v2/ord/btc/stat?collectionSymbol=${collectionSymbol}`
    const { data } = await limiter.schedule(() => axiosInstance.get<CollectionData>(url, { headers }));

    return data

  } catch (error: any) {
    // 404 means collection doesn't exist - return null (not an error)
    if (error?.response?.status === 404) {
      return null;
    }
    // All other errors should be thrown so callers know the API failed
    Logger.error(`[COLLECTION] collectionDetails error for ${collectionSymbol}`, error?.response?.data || error?.message);
    throw error;
  }
}

interface CollectionData {
  totalVolume: string;
  owners: string;
  supply: string;
  floorPrice: string;
  totalListed: string;
  pendingTransactions: string;
  inscriptionNumberMin: string;
  inscriptionNumberMax: string;
  symbol: string;
}
/**
 * Fetch list of collections from API.
 * @throws Error on API failure
 * @returns Collection data array on success
 */
export async function fetchCollections() {
  try {
    const url = 'https://nfttools.pro/magiceden_stats/collection_stats/search/bitcoin';
    const params = {
      window: '7d',
      limit: 100,
      offset: 0,
      sort: 'volume',
      direction: 'desc',
      filter: JSON.stringify({
        timeWindow: '7d',
        collectionType: 'all',
        sortColumn: 'volume',
        sortDirection: 'desc',
        featuredCollection: false
      })
    };

    const { data: collections } = await limiter.schedule(() => axiosInstance.get(url, { params, headers }))
    return collections
  } catch (error: any) {
    Logger.error("[COLLECTION] fetchCollections error", error.response?.data || error.message);
    throw error;
  }
}

interface OfferData {
  activities: OfferPlaced[]
}

export interface Token {
  inscriptionNumber: string;
  contentURI: string;
  contentType: string;
  contentBody: any;
  contentPreviewURI: string;
  meta: object;
  satRarity: string;
  satBlockHeight: number;
  satBlockTime: string;
  domain: any;
}

interface Collection {
  symbol: string;
  name: string;
  imageURI: string;
  chain: string;
  labels: string[];
}

export interface OfferPlaced {
  kind: 'offer_placed' | 'list';
  tokenId: string;
  chain: 'btc';
  collectionSymbol: string;
  collection: Collection;
  token: Token;
  createdAt: string;
  tokenInscriptionNumber: number;
  listedPrice: number;
  oldLocation: string;
  oldOwner: string;
  newOwner: string;
  txValue: number;
  sellerPaymentReceiverAddress: string;
  buyerPaymentAddress: string;
  selectedFeeType: string;
}