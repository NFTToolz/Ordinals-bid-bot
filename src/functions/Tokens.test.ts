import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLimit } from './Tokens';

// Mock dependencies before importing
vi.mock('../axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../bottleneck', () => ({
  default: {
    schedule: vi.fn().mockImplementation(async (fn: () => Promise<any>) => fn()),
  },
}));

vi.mock('../utils/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// Import after mocks
import axiosInstance from '../axios/axiosInstance';
import limiter from '../bottleneck';
import { retrieveTokens, ITokenData } from './Tokens';

describe('Tokens Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  describe('getLimit', () => {
    it('should return 3x bidCount for normal values', () => {
      expect(getLimit(25)).toBe(75);
      expect(getLimit(30)).toBe(90);
    });

    it('should enforce minimum of 60', () => {
      expect(getLimit(10)).toBe(60);
      expect(getLimit(15)).toBe(60);
      expect(getLimit(19)).toBe(60);
    });

    it('should enforce maximum of 100', () => {
      expect(getLimit(40)).toBe(100);
      expect(getLimit(50)).toBe(100);
      expect(getLimit(100)).toBe(100);
    });

    it('should return exactly 60 for bidCount of 20', () => {
      expect(getLimit(20)).toBe(60);
    });

    it('should return exactly 100 for bidCount of 34 or higher', () => {
      expect(getLimit(34)).toBe(100);
      expect(getLimit(33)).toBe(99);
    });

    it('should handle edge case of zero', () => {
      expect(getLimit(0)).toBe(60);
    });

    it('should handle negative values (edge case)', () => {
      expect(getLimit(-10)).toBe(60);
    });

    it('should handle fractional values', () => {
      expect(getLimit(25.5)).toBe(76.5);
    });
  });

  describe('retrieveTokens', () => {
    const mockTokensResponse = {
      tokens: [
        {
          id: 'token1i0',
          collectionSymbol: 'test-collection',
          listed: true,
          listedPrice: 50000,
          owner: 'bc1qowner1',
          inscriptionNumber: 1001,
          chain: 'btc',
          contentURI: 'https://example.com/1',
          contentType: 'image/png',
          contentBody: '',
          contentPreviewURI: 'https://example.com/preview/1',
          genesisTransaction: 'tx1',
          genesisTransactionBlockTime: '2024-01-01T00:00:00Z',
          genesisTransactionBlockHash: 'hash1',
          genesisTransactionBlockHeight: 100000,
          meta: { name: 'Token 1', attributes: [], high_res_img_url: '' },
          location: 'loc1',
          locationBlockHeight: 100001,
          locationBlockTime: '2024-01-02T00:00:00Z',
          locationBlockHash: 'hash2',
          output: 'output1',
          outputValue: 546,
          listedAt: '2024-01-01T00:00:00Z',
          listedMakerFeeBp: 200,
          listedSellerReceiveAddress: 'bc1qseller1',
          listedForMint: false,
          collection: {},
          itemType: 'inscription',
          sat: 123456789,
          satName: 'sat1',
          satRarity: 'common',
          satBlockHeight: 1,
          satBlockTime: '2009-01-03T00:00:00Z',
          satributes: [],
        },
        {
          id: 'token2i0',
          collectionSymbol: 'test-collection',
          listed: true,
          listedPrice: 60000,
          owner: 'bc1qowner2',
          inscriptionNumber: 1002,
          chain: 'btc',
          contentURI: 'https://example.com/2',
          contentType: 'image/png',
          contentBody: '',
          contentPreviewURI: 'https://example.com/preview/2',
          genesisTransaction: 'tx2',
          genesisTransactionBlockTime: '2024-01-01T00:00:00Z',
          genesisTransactionBlockHash: 'hash3',
          genesisTransactionBlockHeight: 100000,
          meta: { name: 'Token 2', attributes: [], high_res_img_url: '' },
          location: 'loc2',
          locationBlockHeight: 100002,
          locationBlockTime: '2024-01-03T00:00:00Z',
          locationBlockHash: 'hash4',
          output: 'output2',
          outputValue: 546,
          listedAt: '2024-01-02T00:00:00Z',
          listedMakerFeeBp: 200,
          listedSellerReceiveAddress: 'bc1qseller2',
          listedForMint: false,
          collection: {},
          itemType: 'inscription',
          sat: 234567890,
          satName: 'sat2',
          satRarity: 'uncommon',
          satBlockHeight: 2,
          satBlockTime: '2009-01-04T00:00:00Z',
          satributes: [],
        },
        {
          id: 'token3i0',
          collectionSymbol: 'test-collection',
          listed: false, // Not listed
          listedPrice: 0,
          owner: 'bc1qowner3',
          inscriptionNumber: 1003,
          chain: 'btc',
          contentURI: 'https://example.com/3',
          contentType: 'image/png',
          contentBody: '',
          contentPreviewURI: 'https://example.com/preview/3',
          genesisTransaction: 'tx3',
          genesisTransactionBlockTime: '2024-01-01T00:00:00Z',
          genesisTransactionBlockHash: 'hash5',
          genesisTransactionBlockHeight: 100000,
          meta: { name: 'Token 3', attributes: [], high_res_img_url: '' },
          location: 'loc3',
          locationBlockHeight: 100003,
          locationBlockTime: '2024-01-04T00:00:00Z',
          locationBlockHash: 'hash6',
          output: 'output3',
          outputValue: 546,
          listedAt: '',
          listedMakerFeeBp: 0,
          listedSellerReceiveAddress: '',
          listedForMint: false,
          collection: {},
          itemType: 'inscription',
          sat: 345678901,
          satName: 'sat3',
          satRarity: 'rare',
          satBlockHeight: 3,
          satBlockTime: '2009-01-05T00:00:00Z',
          satributes: [],
        },
      ],
    };

    describe('without traits', () => {
      it('should retrieve tokens and filter only listed ones', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const result = await retrieveTokens('test-collection', 20);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        expect(result![0].id).toBe('token1i0');
        expect(result![1].id).toBe('token2i0');
      });

      it('should use correct API URL for tokens endpoint', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        await retrieveTokens('test-collection', 20);

        expect(axiosInstance.get).toHaveBeenCalledWith(
          'https://nfttools.pro/magiceden/v2/ord/btc/tokens',
          expect.objectContaining({
            params: expect.objectContaining({
              collectionSymbol: 'test-collection',
              limit: 60, // 3x20 = 60
              offset: 0,
              sortBy: 'priceAsc',
              minPrice: 0,
              maxPrice: 0,
              disablePendingTransactions: true,
            }),
          })
        );
      });

      it('should use correct limit based on bidCount', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        await retrieveTokens('test-collection', 35);

        expect(axiosInstance.get).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            params: expect.objectContaining({
              limit: 100, // 3x35 = 105, capped at 100
            }),
          })
        );
      });

      it('should include API key in headers', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        await retrieveTokens('test-collection', 20);

        // API_KEY is read at module load time from env, verify headers object exists
        const call = vi.mocked(axiosInstance.get).mock.calls[0];
        expect(call[1]).toHaveProperty('headers');
        expect(call[1]?.headers).toHaveProperty('X-NFT-API-Key');
      });

      it('should throw on API error', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API Error'));

        await expect(retrieveTokens('test-collection', 20)).rejects.toThrow('API Error');
      });

      it('should throw on error with response data', async () => {
        const error = {
          response: { data: { message: 'Rate limited' } },
          message: 'Request failed',
        };
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(error);

        await expect(retrieveTokens('test-collection', 20)).rejects.toThrow();
      });

      it('should handle empty tokens response', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: { tokens: [] } });

        const result = await retrieveTokens('test-collection', 20);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(0);
      });

      it('should use limiter.schedule for rate limiting', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        await retrieveTokens('test-collection', 20);

        expect(limiter.schedule).toHaveBeenCalled();
      });

      it('should use default bidCount of 20 if not provided', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        await retrieveTokens('test-collection');

        expect(axiosInstance.get).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            params: expect.objectContaining({
              limit: 60, // default 20 * 3 = 60
            }),
          })
        );
      });
    });

    describe('with traits', () => {
      it('should use attributes endpoint when traits provided', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const traits = [{ traitType: 'Background', value: 'Blue' }];
        await retrieveTokens('test-collection', 20, traits);

        expect(axiosInstance.get).toHaveBeenCalledWith(
          'https://nfttools.pro/magiceden/v2/ord/btc/attributes',
          expect.objectContaining({
            params: expect.objectContaining({
              collectionSymbol: 'test-collection',
              disablePendingTransactions: true,
              offset: 0,
              sortBy: 'priceAsc',
            }),
          })
        );
      });

      it('should handle single trait object (not array)', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const trait = { traitType: 'Background', value: 'Blue' };
        const result = await retrieveTokens('test-collection', 20, trait);

        expect(result).not.toBeNull();
        expect(axiosInstance.get).toHaveBeenCalledWith(
          'https://nfttools.pro/magiceden/v2/ord/btc/attributes',
          expect.any(Object)
        );
      });

      it('should encode traits as JSON in attributes parameter', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const traits = [{ traitType: 'Background', value: 'Blue' }];
        await retrieveTokens('test-collection', 20, traits);

        const call = vi.mocked(axiosInstance.get).mock.calls[0];
        const params = call[1]?.params;
        expect(params.attributes).toBeDefined();
        // The attributes should be URL-encoded JSON
        expect(typeof params.attributes).toBe('string');
      });

      it('should filter only listed tokens from traits response', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const traits = [{ traitType: 'Background', value: 'Blue' }];
        const result = await retrieveTokens('test-collection', 20, traits);

        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        expect(result!.every(t => t.listed)).toBe(true);
      });

      it('should handle multiple traits', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokensResponse });

        const traits = [
          { traitType: 'Background', value: 'Blue' },
          { traitType: 'Eyes', value: 'Laser' },
        ];
        await retrieveTokens('test-collection', 20, traits);

        expect(axiosInstance.get).toHaveBeenCalledWith(
          'https://nfttools.pro/magiceden/v2/ord/btc/attributes',
          expect.any(Object)
        );
      });

      it('should throw on traits API error', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API Error'));

        const traits = [{ traitType: 'Background', value: 'Blue' }];
        await expect(retrieveTokens('test-collection', 20, traits)).rejects.toThrow('API Error');
      });
    });

    describe('error scenarios', () => {
      it('should throw on network errors', async () => {
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('Network Error'));

        await expect(retrieveTokens('test-collection', 20)).rejects.toThrow('Network Error');
      });

      it('should throw on 429 rate limit errors', async () => {
        const error = {
          response: { status: 429, data: { message: 'Rate limited' } },
          message: 'Request failed with status code 429',
        };
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(error);

        await expect(retrieveTokens('test-collection', 20)).rejects.toThrow();
      });

      it('should throw on 500 server errors', async () => {
        const error = {
          response: { status: 500, data: { message: 'Internal server error' } },
          message: 'Request failed with status code 500',
        };
        vi.mocked(axiosInstance.get).mockRejectedValueOnce(error);

        await expect(retrieveTokens('test-collection', 20)).rejects.toThrow();
      });

      it('should return empty array on malformed response data', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: null });

        // Defensive coding: returns empty array instead of crashing
        const result = await retrieveTokens('test-collection', 20);
        expect(result).toEqual([]);
      });

      it('should return empty array on undefined tokens in response', async () => {
        vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: { tokens: undefined } });

        // Defensive coding: returns empty array instead of crashing
        const result = await retrieveTokens('test-collection', 20);
        expect(result).toEqual([]);
      });
    });
  });
});
