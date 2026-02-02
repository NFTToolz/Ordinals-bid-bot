import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateCollection,
  createDefaultConfig,
  loadCollections,
  saveCollections,
  addCollection,
  updateCollection,
  removeCollection,
  getCollection,
  fetchCollectionInfo,
  searchCollections,
  getPopularCollections,
  assignWalletGroup,
  getCollectionsWithoutGroup,
  getCollectionsByGroup,
  CollectionConfig,
} from './CollectionService';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

import * as fs from 'fs';
import axios from 'axios';

describe('CollectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateCollection', () => {
    it('should return error when collectionSymbol is missing', () => {
      const config: Partial<CollectionConfig> = { minBid: 0.001, maxBid: 0.002 };
      const errors = validateCollection(config);
      expect(errors).toContain('Collection symbol is required');
    });

    it('should return error when collectionSymbol is empty string', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: '' };
      const errors = validateCollection(config);
      expect(errors).toContain('Collection symbol is required');
    });

    it('should return error when minBid is negative', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minBid: -0.001 };
      const errors = validateCollection(config);
      expect(errors).toContain('Minimum bid must be positive');
    });

    it('should return error when maxBid is negative', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', maxBid: -0.001 };
      const errors = validateCollection(config);
      expect(errors).toContain('Maximum bid must be positive');
    });

    it('should return error when minBid exceeds maxBid', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minBid: 0.002, maxBid: 0.001 };
      const errors = validateCollection(config);
      expect(errors).toContain('Minimum bid cannot exceed maximum bid');
    });

    it('should return error when minFloorBid is negative', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minFloorBid: -10 };
      const errors = validateCollection(config);
      expect(errors).toContain('Minimum floor bid percentage must be positive');
    });

    it('should return error when maxFloorBid is negative', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', maxFloorBid: -10 };
      const errors = validateCollection(config);
      expect(errors).toContain('Maximum floor bid percentage must be positive');
    });

    it('should return error when minFloorBid exceeds maxFloorBid', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minFloorBid: 90, maxFloorBid: 50 };
      const errors = validateCollection(config);
      expect(errors).toContain('Minimum floor bid cannot exceed maximum floor bid');
    });

    it('should return error when maxFloorBid exceeds 100% for non-trait offers', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', maxFloorBid: 105, traits: [] };
      const errors = validateCollection(config);
      expect(errors).toContain('Maximum floor bid cannot exceed 100% for non-trait offers');
    });

    it('should allow maxFloorBid over 100% when traits are configured', () => {
      const config: Partial<CollectionConfig> = {
        collectionSymbol: 'test',
        maxFloorBid: 150,
        traits: [{ traitType: 'Background', value: 'Gold' }],
      };
      const errors = validateCollection(config);
      expect(errors).not.toContain('Maximum floor bid cannot exceed 100% for non-trait offers');
    });

    it('should return error when bidCount is less than 1', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', bidCount: 0 };
      const errors = validateCollection(config);
      expect(errors).toContain('Bid count must be at least 1');
    });

    it('should return error when duration is less than 1', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', duration: 0 };
      const errors = validateCollection(config);
      expect(errors).toContain('Duration must be at least 1 minute');
    });

    it('should return error when quantity is less than 1', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', quantity: 0 };
      const errors = validateCollection(config);
      expect(errors).toContain('Quantity must be at least 1');
    });

    it('should return empty array for valid configuration', () => {
      const config: Partial<CollectionConfig> = {
        collectionSymbol: 'test',
        minBid: 0.001,
        maxBid: 0.01,
        minFloorBid: 50,
        maxFloorBid: 95,
        bidCount: 20,
        duration: 60,
        quantity: 1,
      };
      const errors = validateCollection(config);
      expect(errors).toEqual([]);
    });

    it('should return multiple errors for multiple issues', () => {
      const config: Partial<CollectionConfig> = {
        minBid: -0.001,
        maxBid: -0.001,
        bidCount: 0,
      };
      const errors = validateCollection(config);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should allow zero minBid (free bids)', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minBid: 0 };
      const errors = validateCollection(config);
      expect(errors).not.toContain('Minimum bid must be positive');
    });

    it('should allow zero maxBid', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', maxBid: 0 };
      const errors = validateCollection(config);
      expect(errors).not.toContain('Maximum bid must be positive');
    });

    it('should allow zero minFloorBid', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', minFloorBid: 0 };
      const errors = validateCollection(config);
      expect(errors).not.toContain('Minimum floor bid percentage must be positive');
    });

    it('should allow maxFloorBid at exactly 100% for non-trait offers', () => {
      const config: Partial<CollectionConfig> = { collectionSymbol: 'test', maxFloorBid: 100 };
      const errors = validateCollection(config);
      expect(errors).not.toContain('Maximum floor bid cannot exceed 100% for non-trait offers');
    });
  });

  describe('createDefaultConfig', () => {
    it('should create config with default values for symbol only', () => {
      const config = createDefaultConfig('test-collection');
      expect(config.collectionSymbol).toBe('test-collection');
      expect(config.minBid).toBe(0.0001);
      expect(config.maxBid).toBe(0.01);
      expect(config.minFloorBid).toBe(50);
      expect(config.maxFloorBid).toBe(95);
      expect(config.bidCount).toBe(20);
      expect(config.duration).toBe(60);
      expect(config.scheduledLoop).toBe(60);
      expect(config.enableCounterBidding).toBe(true);
      expect(config.outBidMargin).toBe(0.00001);
      expect(config.offerType).toBe('ITEM');
      expect(config.quantity).toBe(1);
      expect(config.feeSatsPerVbyte).toBe(28);
    });

    it('should calculate maxBid based on floor price', () => {
      const floorPriceSats = 100000000;
      const config = createDefaultConfig('test-collection', floorPriceSats);
      expect(config.maxBid).toBe(0.95);
    });

    it('should handle small floor prices', () => {
      const floorPriceSats = 10000;
      const config = createDefaultConfig('test-collection', floorPriceSats);
      expect(config.maxBid).toBeCloseTo(0.000095, 6);
    });

    it('should not include walletGroup when not provided', () => {
      const config = createDefaultConfig('test-collection');
      expect(config.walletGroup).toBeUndefined();
    });

    it('should include walletGroup when provided', () => {
      const config = createDefaultConfig('test-collection', 0, 'main-wallets');
      expect(config.walletGroup).toBe('main-wallets');
    });

    it('should use default maxBid when floor price is 0', () => {
      const config = createDefaultConfig('test-collection', 0);
      expect(config.maxBid).toBe(0.01);
    });

    it('should handle very large floor prices', () => {
      const floorPriceSats = 10000000000;
      const config = createDefaultConfig('expensive-collection', floorPriceSats);
      expect(config.maxBid).toBe(95);
    });

    it('should create valid configuration that passes validation', () => {
      const config = createDefaultConfig('valid-collection', 100000000);
      const errors = validateCollection(config);
      expect(errors).toEqual([]);
    });
  });

  describe('loadCollections', () => {
    it('should return empty array when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = loadCollections();
      expect(result).toEqual([]);
    });

    it('should load and parse collections from file', () => {
      const mockCollections = [
        createDefaultConfig('collection-1'),
        createDefaultConfig('collection-2'),
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCollections));

      const result = loadCollections();
      expect(result).toHaveLength(2);
      expect(result[0].collectionSymbol).toBe('collection-1');
    });

    it('should return empty array on parse error', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const result = loadCollections();
      expect(result).toEqual([]);
    });
  });

  describe('saveCollections', () => {
    it('should create backup before saving', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      saveCollections([createDefaultConfig('test')]);

      expect(fs.copyFileSync).toHaveBeenCalled();
    });

    it('should not create backup if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      saveCollections([createDefaultConfig('test')]);

      expect(fs.copyFileSync).not.toHaveBeenCalled();
    });

    it('should write collections to file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const collections = [createDefaultConfig('test')];
      saveCollections(collections);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData).toHaveLength(1);
    });
  });

  describe('addCollection', () => {
    it('should add new collection', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const newCollection = createDefaultConfig('new-collection');
      addCollection(newCollection);

      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].collectionSymbol).toBe('new-collection');
    });

    it('should update existing collection', () => {
      const existing = [createDefaultConfig('existing')];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const updatedCollection = { ...createDefaultConfig('existing'), maxBid: 0.05 };
      addCollection(updatedCollection);

      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].maxBid).toBe(0.05);
    });
  });

  describe('updateCollection', () => {
    it('should update existing collection', () => {
      const existing = [createDefaultConfig('existing')];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = updateCollection('existing', { maxBid: 0.05 });

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData[0].maxBid).toBe(0.05);
    });

    it('should return false for non-existent collection', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = updateCollection('nonexistent', { maxBid: 0.05 });
      expect(result).toBe(false);
    });
  });

  describe('removeCollection', () => {
    it('should remove existing collection', () => {
      const existing = [createDefaultConfig('to-remove'), createDefaultConfig('to-keep')];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = removeCollection('to-remove');

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData).toHaveLength(1);
      expect(writtenData[0].collectionSymbol).toBe('to-keep');
    });

    it('should return false for non-existent collection', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = removeCollection('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('getCollection', () => {
    it('should return collection by symbol', () => {
      const existing = [createDefaultConfig('target')];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = getCollection('target');

      expect(result).not.toBeNull();
      expect(result?.collectionSymbol).toBe('target');
    });

    it('should return null for non-existent collection', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = getCollection('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('fetchCollectionInfo', () => {
    it('should fetch collection info from API', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          symbol: 'test-collection',
          name: 'Test Collection',
          description: 'A test collection',
          floorPrice: 50000,
          totalVolume: 100,
          owners: 500,
          supply: 1000,
          listed: 150,
        },
      });

      const result = await fetchCollectionInfo('test-collection');

      expect(result).not.toBeNull();
      expect(result?.symbol).toBe('test-collection');
      expect(result?.name).toBe('Test Collection');
      expect(result?.floorPrice).toBe(50000);
    });

    it('should return null on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));

      const result = await fetchCollectionInfo('test-collection');
      expect(result).toBeNull();
    });

    it('should use symbol as fallback for missing name', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { symbol: 'test' },
      });

      const result = await fetchCollectionInfo('test');
      expect(result?.name).toBe('test');
    });

    it('should handle missing floor price', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { symbol: 'test', name: 'Test' },
      });

      const result = await fetchCollectionInfo('test');
      expect(result?.floorPrice).toBe(0);
    });
  });

  describe('searchCollections', () => {
    it('should search collections by query', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          collections: [
            { symbol: 'test-1', name: 'Test One', floorPrice: 1000 },
            { symbol: 'other', name: 'Other', floorPrice: 2000 },
            { symbol: 'test-2', name: 'Test Two', floorPrice: 3000 },
          ],
        },
      });

      const result = await searchCollections('test');

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('test-1');
      expect(result[1].symbol).toBe('test-2');
    });

    it('should return empty array on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));

      const result = await searchCollections('test');
      expect(result).toEqual([]);
    });

    it('should handle response as direct array', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: [{ symbol: 'test', name: 'Test', floorPrice: 1000 }],
      });

      const result = await searchCollections('test');
      expect(result).toHaveLength(1);
    });

    it('should limit results to 10', async () => {
      const collections = Array(20).fill(null).map((_, i) => ({
        symbol: `test-${i}`,
        name: `Test ${i}`,
        floorPrice: 1000,
      }));
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { collections } });

      const result = await searchCollections('test');
      expect(result).toHaveLength(10);
    });
  });

  describe('getPopularCollections', () => {
    it('should fetch popular collections', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: {
          collections: [
            { symbol: 'popular-1', name: 'Popular One', floorPrice: 5000, volume24h: 100 },
            { symbol: 'popular-2', name: 'Popular Two', floorPrice: 4000, volume24h: 80 },
          ],
        },
      });

      const result = await getPopularCollections(20);

      expect(result).toHaveLength(2);
      expect(result[0].symbol).toBe('popular-1');
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('limit=20'),
        expect.any(Object)
      );
    });

    it('should return empty array on API error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));

      const result = await getPopularCollections();
      expect(result).toEqual([]);
    });
  });

  describe('assignWalletGroup', () => {
    it('should assign wallet group to collection', () => {
      const existing = [createDefaultConfig('test')];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = assignWalletGroup('test', 'main-group');

      expect(result).toBe(true);
      const writtenData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(writtenData[0].walletGroup).toBe('main-group');
    });

    it('should return false for non-existent collection', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = assignWalletGroup('nonexistent', 'main-group');
      expect(result).toBe(false);
    });
  });

  describe('getCollectionsWithoutGroup', () => {
    it('should return collections without wallet group', () => {
      const collections = [
        { ...createDefaultConfig('with-group'), walletGroup: 'main' },
        createDefaultConfig('without-group'),
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(collections));

      const result = getCollectionsWithoutGroup();

      expect(result).toHaveLength(1);
      expect(result[0].collectionSymbol).toBe('without-group');
    });
  });

  describe('getCollectionsByGroup', () => {
    it('should return collections for specific wallet group', () => {
      const collections = [
        { ...createDefaultConfig('collection-1'), walletGroup: 'group-a' },
        { ...createDefaultConfig('collection-2'), walletGroup: 'group-b' },
        { ...createDefaultConfig('collection-3'), walletGroup: 'group-a' },
      ];
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(collections));

      const result = getCollectionsByGroup('group-a');

      expect(result).toHaveLength(2);
      expect(result[0].collectionSymbol).toBe('collection-1');
      expect(result[1].collectionSymbol).toBe('collection-3');
    });

    it('should return empty array when no collections in group', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = getCollectionsByGroup('nonexistent-group');
      expect(result).toEqual([]);
    });
  });
});
