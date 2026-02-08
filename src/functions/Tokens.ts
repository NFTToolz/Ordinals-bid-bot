import { config } from "dotenv"
import axiosInstance from "../axios/axiosInstance"
import { Trait, transformTrait } from "../utils/traits.utils";
import limiter from "../bottleneck";
import Logger from "../utils/logger";


config()

const API_KEY = process.env.API_KEY as string;
const headers = {
  'X-NFT-API-Key': API_KEY,
}

/**
 * Retrieve tokens for a collection from API.
 * @throws Error on API failure (network error, server error, etc.)
 * @returns Array of listed tokens on success (may be empty if no tokens match)
 */
export async function retrieveTokens(collectionSymbol: string, bidCount: number = 20, traits?: Trait[] | Trait): Promise<ITokenData[]> {
  try {

    const limit = getLimit(bidCount)
    if (!traits) {

      const url = `https://nfttools.pro/magiceden/v2/ord/btc/tokens`;
      const params = {
        limit: limit,
        offset: 0,
        sortBy: 'priceAsc',
        minPrice: 0,
        maxPrice: 0,
        collectionSymbol: collectionSymbol,
        disablePendingTransactions: true
      };

      const { data } = await limiter.schedule(() => axiosInstance.get<IToken>(url, { params, headers }));

      const tokens = (data?.tokens ?? []).filter(item => item.listed === true)

      return tokens
    } else {
      const traitsArray: Trait[] = Array.isArray(traits) ? traits : [traits]

      const transformedTraits = transformTrait(traitsArray)

      const transformedAttributes = {
        "attributes": transformedTraits
      }

      const params = {
        attributes: encodeURIComponent(JSON.stringify(transformedAttributes)),
        collectionSymbol: collectionSymbol,
        disablePendingTransactions: true,
        offset: 0,
        sortBy: 'priceAsc'
      };

      const url = 'https://nfttools.pro/magiceden/v2/ord/btc/attributes';

      const { data } = await limiter.schedule(() => axiosInstance.get<IToken>(url, { params, headers }))
      const tokens = (data?.tokens ?? []).filter(item => item.listed === true)
      return tokens
    }
  } catch (error: unknown) {
    const err = error as { response?: { data?: unknown }; message?: string };
    Logger.error(`[TOKENS] retrieveTokens error for ${collectionSymbol}`, err?.response?.data || err?.message);
    throw error;
  }
}

export interface IToken {
  tokens: ITokenData[]
}

export function getLimit(bidCount: number): number {
  // Fetch 3x bidCount to have buffer for skipped tokens (when best offer > maxOffer)
  // Minimum 60 tokens, maximum 100 (API limit)
  return Math.min(Math.max(bidCount * 3, 60), 100);
}

interface Attribute {
  trait_type: string;
  value: string;
}

interface Meta {
  name: string;
  attributes: Attribute[];
  high_res_img_url: string;
}



export interface ITokenData {
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
  meta: Meta;
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
  collection: Collection;
  itemType: string;
  sat: number;
  satName: string;
  satRarity: string;
  satBlockHeight: number;
  satBlockTime: string;
  satributes: string[];
}


interface Inscription {
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
  collection: Collection;
  itemType: string;
  sat: number;
  satName: string;
  satRarity: string;
  satBlockHeight: number;
  satBlockTime: string;
  satributes: string[];
  displayName: string;
}

interface Collection {
  symbol: string;
  name: string;
  imageURI: string;
  chain: string;
  inscriptionIcon: string;
  description: string;
  supply: number;
  twitterLink: string;
  discordLink: string;
  websiteLink: string;
  createdAt: string;
  overrideContentType: string;
  disableRichThumbnailGeneration: boolean;
  labels: string[];
  enableCollectionOffer: boolean;
}