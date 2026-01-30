import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const COLLECTIONS_FILE_PATH = path.join(process.cwd(), 'config/collections.json');
const MAGIC_EDEN_API = 'https://api-mainnet.magiceden.dev/v2';

export interface CollectionConfig {
  collectionSymbol: string;
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  bidCount: number;
  duration: number;
  scheduledLoop?: number;
  enableCounterBidding: boolean;
  outBidMargin: number;
  offerType: 'ITEM' | 'COLLECTION';
  quantity: number;
  feeSatsPerVbyte?: number;
  traits?: Array<{ traitType: string; value: string }>;
  fundingWalletWIF?: string;
  tokenReceiveAddress?: string;
}

export interface CollectionInfo {
  symbol: string;
  name: string;
  description?: string;
  imageURI?: string;
  floorPrice: number;
  totalVolume?: number;
  owners?: number;
  totalSupply?: number;
  listedCount?: number;
}

export interface CollectionSearchResult {
  symbol: string;
  name: string;
  floorPrice: number;
  volume24h?: number;
}

/**
 * Load collections from config file
 */
export function loadCollections(): CollectionConfig[] {
  try {
    if (!fs.existsSync(COLLECTIONS_FILE_PATH)) {
      return [];
    }
    const content = fs.readFileSync(COLLECTIONS_FILE_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return [];
  }
}

/**
 * Save collections to config file
 */
export function saveCollections(collections: CollectionConfig[]): void {
  // Create backup
  if (fs.existsSync(COLLECTIONS_FILE_PATH)) {
    const backupPath = COLLECTIONS_FILE_PATH + '.backup';
    fs.copyFileSync(COLLECTIONS_FILE_PATH, backupPath);
  }

  fs.writeFileSync(COLLECTIONS_FILE_PATH, JSON.stringify(collections, null, '\t'));
}

/**
 * Add a new collection
 */
export function addCollection(collection: CollectionConfig): void {
  const existing = loadCollections();

  // Check for duplicate
  const existingIndex = existing.findIndex(
    c => c.collectionSymbol === collection.collectionSymbol
  );

  if (existingIndex >= 0) {
    // Update existing
    existing[existingIndex] = collection;
  } else {
    existing.push(collection);
  }

  saveCollections(existing);
}

/**
 * Update an existing collection
 */
export function updateCollection(
  symbol: string,
  updates: Partial<CollectionConfig>
): boolean {
  const existing = loadCollections();
  const index = existing.findIndex(c => c.collectionSymbol === symbol);

  if (index < 0) {
    return false;
  }

  existing[index] = { ...existing[index], ...updates };
  saveCollections(existing);
  return true;
}

/**
 * Remove a collection
 */
export function removeCollection(symbol: string): boolean {
  const existing = loadCollections();
  const filtered = existing.filter(c => c.collectionSymbol !== symbol);

  if (filtered.length === existing.length) {
    return false;
  }

  saveCollections(filtered);
  return true;
}

/**
 * Get collection by symbol
 */
export function getCollection(symbol: string): CollectionConfig | null {
  const collections = loadCollections();
  return collections.find(c => c.collectionSymbol === symbol) || null;
}

/**
 * Validate collection config
 */
export function validateCollection(config: Partial<CollectionConfig>): string[] {
  const errors: string[] = [];

  if (!config.collectionSymbol) {
    errors.push('Collection symbol is required');
  }

  if (config.minBid !== undefined && config.minBid < 0) {
    errors.push('Minimum bid must be positive');
  }

  if (config.maxBid !== undefined && config.maxBid < 0) {
    errors.push('Maximum bid must be positive');
  }

  if (
    config.minBid !== undefined &&
    config.maxBid !== undefined &&
    config.minBid > config.maxBid
  ) {
    errors.push('Minimum bid cannot exceed maximum bid');
  }

  if (config.minFloorBid !== undefined && config.minFloorBid < 0) {
    errors.push('Minimum floor bid percentage must be positive');
  }

  if (config.maxFloorBid !== undefined && config.maxFloorBid < 0) {
    errors.push('Maximum floor bid percentage must be positive');
  }

  if (
    config.minFloorBid !== undefined &&
    config.maxFloorBid !== undefined &&
    config.minFloorBid > config.maxFloorBid
  ) {
    errors.push('Minimum floor bid cannot exceed maximum floor bid');
  }

  // Check for > 100% floor bid only for non-trait ITEM/COLLECTION offers
  if (
    config.maxFloorBid !== undefined &&
    config.maxFloorBid > 100 &&
    (!config.traits || config.traits.length === 0)
  ) {
    errors.push('Maximum floor bid cannot exceed 100% for non-trait offers');
  }

  if (config.bidCount !== undefined && config.bidCount < 1) {
    errors.push('Bid count must be at least 1');
  }

  if (config.duration !== undefined && config.duration < 1) {
    errors.push('Duration must be at least 1 minute');
  }

  if (config.quantity !== undefined && config.quantity < 1) {
    errors.push('Quantity must be at least 1');
  }

  return errors;
}

/**
 * Fetch collection info from Magic Eden
 */
export async function fetchCollectionInfo(symbol: string): Promise<CollectionInfo | null> {
  try {
    // Use the ordinals API endpoint
    const response = await axios.get(
      `https://api-mainnet.magiceden.dev/v2/ord/btc/stat?collectionSymbol=${symbol}`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    const data = response.data;

    return {
      symbol: data.symbol || symbol,
      name: data.name || symbol,
      description: data.description,
      imageURI: data.imageURI,
      floorPrice: data.floorPrice || 0,
      totalVolume: data.totalVolume,
      owners: data.owners,
      totalSupply: data.supply,
      listedCount: data.listed,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Search collections on Magic Eden
 */
export async function searchCollections(query: string): Promise<CollectionSearchResult[]> {
  try {
    const response = await axios.get(
      `https://api-mainnet.magiceden.dev/v2/ord/btc/collections?limit=20`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    const collections = response.data.collections || response.data || [];

    // Filter by query
    const filtered = collections.filter((c: any) =>
      c.symbol?.toLowerCase().includes(query.toLowerCase()) ||
      c.name?.toLowerCase().includes(query.toLowerCase())
    );

    return filtered.slice(0, 10).map((c: any) => ({
      symbol: c.symbol,
      name: c.name || c.symbol,
      floorPrice: c.floorPrice || 0,
      volume24h: c.volume24h,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Get popular collections
 */
export async function getPopularCollections(limit: number = 20): Promise<CollectionSearchResult[]> {
  try {
    const response = await axios.get(
      `https://api-mainnet.magiceden.dev/v2/ord/btc/collections?limit=${limit}&sortBy=volume`,
      {
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    const collections = response.data.collections || response.data || [];

    return collections.map((c: any) => ({
      symbol: c.symbol,
      name: c.name || c.symbol,
      floorPrice: c.floorPrice || 0,
      volume24h: c.volume24h,
    }));
  } catch (error) {
    return [];
  }
}

/**
 * Create default collection config
 */
export function createDefaultConfig(symbol: string, floorPrice: number = 0): CollectionConfig {
  return {
    collectionSymbol: symbol,
    minBid: 0.0001,
    maxBid: floorPrice > 0 ? (floorPrice / 1e8) * 0.95 : 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    bidCount: 20,
    duration: 60,
    scheduledLoop: 60,
    enableCounterBidding: true,
    outBidMargin: 0.00001,
    offerType: 'ITEM',
    quantity: 1,
    feeSatsPerVbyte: 28,
  };
}
