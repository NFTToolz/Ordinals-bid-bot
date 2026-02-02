import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules with factory functions - these are hoisted
vi.mock('../axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../bottleneck', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

// Import mocked modules to access their mock functions
import axiosInstance from '../axios/axiosInstance';
import limiter from '../bottleneck';

// Import the functions under test
import { collectionDetails, fetchCollections } from './Collection';

// Sample responses
const sampleCollectionDetails = {
  totalVolume: '100.5',
  owners: '500',
  supply: '1000',
  floorPrice: '50000',
  totalListed: '150',
  pendingTransactions: '5',
  inscriptionNumberMin: '10000',
  inscriptionNumberMax: '11000',
  symbol: 'test-collection',
};

const sampleCollectionsResponse = {
  collections: [
    { symbol: 'collection-1', name: 'Collection One', volume: 100 },
    { symbol: 'collection-2', name: 'Collection Two', volume: 50 },
  ],
};

describe('Collection API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup schedule mock to execute the callback
    vi.mocked(limiter.schedule).mockImplementation((async (cb: () => Promise<any>) => cb()) as any);
    // Suppress console output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('collectionDetails', () => {
    it('should fetch and return collection details', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCollectionDetails });

      const result = await collectionDetails('test-collection');

      expect(result).toEqual(sampleCollectionDetails);
      expect(limiter.schedule).toHaveBeenCalled();
    });

    it('should return null on 404 (collection not found)', async () => {
      const error = { response: { status: 404 } };
      vi.mocked(axiosInstance.get).mockRejectedValue(error);

      const result = await collectionDetails('nonexistent-collection');

      expect(result).toBeNull();
    });

    it('should throw on non-404 API errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Internal server error'));

      await expect(collectionDetails('test-collection')).rejects.toThrow('Internal server error');
    });

    it('should call correct API endpoint', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCollectionDetails });

      await collectionDetails('my-collection');

      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/stat?collectionSymbol=my-collection',
        expect.any(Object)
      );
    });

    it('should throw on server errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Internal server error'));

      await expect(collectionDetails('test-collection')).rejects.toThrow('Internal server error');
    });

    it('should throw on network errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Network error'));

      await expect(collectionDetails('test-collection')).rejects.toThrow('Network error');
    });
  });

  describe('fetchCollections', () => {
    it('should fetch collections list', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCollectionsResponse });

      const result = await fetchCollections();

      expect(result).toEqual(sampleCollectionsResponse);
    });

    it('should throw on error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Server error'));

      await expect(fetchCollections()).rejects.toThrow('Server error');
    });

    it('should use correct parameters for sorting', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCollectionsResponse });

      await fetchCollections();

      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden_stats/collection_stats/search/bitcoin',
        expect.objectContaining({
          params: expect.objectContaining({
            window: '7d',
            limit: 100,
            offset: 0,
            sort: 'volume',
            direction: 'desc',
          }),
        })
      );
    });

    it('should throw on rate limit errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Too many requests'));

      await expect(fetchCollections()).rejects.toThrow('Too many requests');
    });
  });
});
