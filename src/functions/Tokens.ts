import { config } from "dotenv"
import axiosInstance from "../axios/axiosInstance"
import { Trait, transformTrait } from "../utils/traits.utils";
import limiter from "../bottleneck";


config()

const API_KEY = process.env.API_KEY as string;
const headers = {
  'X-NFT-API-Key': API_KEY,
}

export async function retrieveTokens(collectionSymbol: string, bidCount: number = 20, traits?: Trait[] | Trait) {
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

      const tokens = data.tokens.filter(item => item.listed === true)

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
      const tokens = data.tokens.filter(item => item.listed === true)
      return tokens
    }
  } catch (error: any) {
    console.log('retrieveTokens: ', error?.response?.data);
    return []
  }
}

export async function getTokenByTraits(collectionSymbol: string, bidCount: number = 20, traits: Trait[]) {
  const limit = bidCount >= 20 ? bidCount : 20
  const traitsArray: Trait[] = Array.isArray(traits) ? traits : [traits]


  const transformedTraits = transformTrait(traitsArray)

  const transformedAttributes = {
    "attributes": transformedTraits
  }

  const params = {
    attributes: encodeURIComponent(JSON.stringify(transformedAttributes)),
    collectionSymbol: collectionSymbol,
    disablePendingTransactions: true,
    // limit: limit,
    offset: 0,
    sortBy: 'priceAsc'
  };

  const url = 'https://nfttools.pro/magiceden/v2/ord/btc/attributes';

  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<IToken>(url, { params, headers }))
    const tokens = data.tokens

    return tokens
  } catch (error: any) {
    console.log('getTokenByTraits', error.response.data);
    return []
  }
}

export async function getToken(tokenId: string) {
  try {
    const { data } = await limiter.schedule(() => axiosInstance.get<Inscription>(`https://nfttools.pro/magiceden/v2/ord/btc/tokens/${tokenId}`, { headers }))

    return data
  } catch (error) {
    console.log('getToken', error);
  }
}

export interface IToken {
  tokens: ITokenData[]
}

function getLimit(bidCount: number): number {
  const quotient = Math.floor((bidCount + 19) / 20);

  return Math.min(quotient * 20, 100);
}

interface Attribute { }

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
  collection: object; // You may want to define a more specific type for `collection`
  itemType: string;
  sat: number;
  satName: string;
  satRarity: string;
  satBlockHeight: number;
  satBlockTime: string;
  satributes: any[]; // You may want to define a more specific type for `satributes`
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