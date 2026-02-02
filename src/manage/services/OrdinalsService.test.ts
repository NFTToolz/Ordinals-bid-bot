import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatInscription,
  formatMagicEdenToken,
  getInscriptions,
  getAllInscriptions,
  getInscriptionsForAddresses,
  getInscriptionById,
  getInscriptionContent,
  hasInscriptions,
  checkAddressesForInscriptions,
  getTokensFromMagicEden,
  getAllTokensFromMagicEden,
  getTokensForAddressesFromMagicEden,
  Inscription,
  MagicEdenToken,
} from './OrdinalsService';

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock axiosInstance
vi.mock('../../axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

import axios from 'axios';
import axiosInstance from '../../axios/axiosInstance';

describe('OrdinalsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  const createMockInscription = (overrides: Partial<Inscription> = {}): Inscription => ({
    id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefi0',
    number: 12345,
    address: 'bc1qtest',
    genesis_address: 'bc1qgenesis',
    genesis_block_height: 100000,
    genesis_block_hash: '0000000000000000000000000000000000000000000000000000000000000000',
    genesis_tx_id: '0000000000000000000000000000000000000000000000000000000000000000',
    genesis_fee: '1000',
    genesis_timestamp: 1700000000,
    tx_id: '0000000000000000000000000000000000000000000000000000000000000001',
    location: 'txid:0:0',
    output: 'txid:0',
    value: '10000',
    offset: '0',
    sat_ordinal: '1234567890',
    sat_rarity: 'common',
    sat_coinbase_height: 0,
    mime_type: 'text/plain',
    content_type: 'text/plain',
    content_length: 100,
    timestamp: 1700000000,
    curse_type: null,
    recursive: false,
    recursion_refs: null,
    ...overrides,
  });

  const createMockToken = (overrides: Partial<MagicEdenToken> = {}): MagicEdenToken => ({
    id: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefi0',
    contentType: 'image/png',
    outputValue: 10000,
    satRarity: 'common',
    listed: false,
    ...overrides,
  });

  describe('formatInscription', () => {
    it('should truncate inscription ID correctly', () => {
      const inscription = createMockInscription();
      const formatted = formatInscription(inscription);
      expect(formatted.id).toBe('12345678...abcdefi0');
    });

    it('should format inscription number with hash', () => {
      const inscription = createMockInscription({ number: 42 });
      const formatted = formatInscription(inscription);
      expect(formatted.number).toBe('#42');
    });

    it('should clean up content type - remove charset', () => {
      const inscription = createMockInscription({ content_type: 'text/html;charset=utf-8' });
      const formatted = formatInscription(inscription);
      expect(formatted.type).toBe('html');
    });

    it('should extract subtype from MIME type', () => {
      const inscription = createMockInscription({ content_type: 'image/png' });
      const formatted = formatInscription(inscription);
      expect(formatted.type).toBe('png');
    });

    it('should handle model/gltf+json → gltf', () => {
      const inscription = createMockInscription({ content_type: 'model/gltf+json' });
      const formatted = formatInscription(inscription);
      expect(formatted.type).toBe('gltf');
    });

    it('should convert text/plain to "text"', () => {
      const inscription = createMockInscription({ content_type: 'text/plain' });
      const formatted = formatInscription(inscription);
      expect(formatted.type).toBe('text');
    });

    it('should handle application/json', () => {
      const inscription = createMockInscription({ content_type: 'application/json' });
      const formatted = formatInscription(inscription);
      expect(formatted.type).toBe('json');
    });

    it('should preserve sat rarity', () => {
      const inscription = createMockInscription({ sat_rarity: 'uncommon' });
      const formatted = formatInscription(inscription);
      expect(formatted.rarity).toBe('uncommon');
    });

    it('should format value as BTC with 8 decimal places', () => {
      const inscription = createMockInscription({ value: '100000000' });
      const formatted = formatInscription(inscription);
      expect(formatted.value).toBe('1.00000000 BTC');
    });

    it('should format small value correctly', () => {
      const inscription = createMockInscription({ value: '10000' });
      const formatted = formatInscription(inscription);
      expect(formatted.value).toBe('0.00010000 BTC');
    });

    it('should handle very small values (dust)', () => {
      const inscription = createMockInscription({ value: '546' });
      const formatted = formatInscription(inscription);
      expect(formatted.value).toBe('0.00000546 BTC');
    });
  });

  describe('formatMagicEdenToken', () => {
    it('should truncate ID correctly', () => {
      const token = createMockToken();
      const formatted = formatMagicEdenToken(token);
      expect(formatted.id).toBe('12345678...abcdefi0');
    });

    it('should use collection name if available', () => {
      const token = createMockToken({
        collection: { symbol: 'test-sym', name: 'Test Collection' },
      });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.collection).toBe('Test Collect..');
    });

    it('should fallback to collectionSymbol if no collection name', () => {
      const token = createMockToken({ collectionSymbol: 'test-symbol' });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.collection).toBe('test-symbol');
    });

    it('should show "-" if no collection info', () => {
      const token = createMockToken();
      const formatted = formatMagicEdenToken(token);
      expect(formatted.collection).toBe('-');
    });

    it('should use displayName if available', () => {
      const token = createMockToken({ displayName: 'Cool NFT #123' });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.name).toBe('Cool NFT #123');
    });

    it('should fallback to meta.name if no displayName', () => {
      const token = createMockToken({ meta: { name: 'Meta Name' } });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.name).toBe('Meta Name');
    });

    it('should truncate long names', () => {
      const token = createMockToken({
        displayName: 'This is a very long name that needs truncation',
      });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.name).toBe('This is a ve..');
    });

    it('should use truncated ID as name if no name available', () => {
      const token = createMockToken();
      const formatted = formatMagicEdenToken(token);
      expect(formatted.name).toBe('1234567890ab..');
    });

    it('should clean content type correctly', () => {
      const token = createMockToken({ contentType: 'text/html;charset=utf-8' });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.type).toBe('html');
    });

    it('should handle missing content type', () => {
      const token = createMockToken({ contentType: undefined as any });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.type).toBe('unknown');
    });

    it('should format outputValue as BTC', () => {
      const token = createMockToken({ outputValue: 100000000 });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.value).toBe('1.00000000');
    });

    it('should show listed price when listed', () => {
      const token = createMockToken({ listed: true, listedPrice: 50000000 });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.listedPrice).toBe('0.50000');
    });

    it('should show "-" for listed price when not listed', () => {
      const token = createMockToken({ listed: false, listedPrice: 50000000 });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.listedPrice).toBe('-');
    });

    it('should show last sale price when available', () => {
      const token = createMockToken({ lastSalePrice: 25000000 });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.lastSalePrice).toBe('0.25000');
    });

    it('should show "-" for last sale price when not available', () => {
      const token = createMockToken();
      const formatted = formatMagicEdenToken(token);
      expect(formatted.lastSalePrice).toBe('-');
    });

    it('should preserve satRarity', () => {
      const token = createMockToken({ satRarity: 'rare' });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.rarity).toBe('rare');
    });

    it('should default to "common" for missing satRarity', () => {
      const token = createMockToken({ satRarity: undefined as any });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.rarity).toBe('common');
    });

    it('should include full token in fullToken property', () => {
      const token = createMockToken();
      const formatted = formatMagicEdenToken(token);
      expect(formatted.fullToken).toBe(token);
    });

    it('should truncate long collection names', () => {
      const token = createMockToken({
        collection: { symbol: 'test', name: 'Very Long Collection Name' },
      });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.collection).toBe('Very Long Co..');
    });

    it('should not truncate short collection names', () => {
      const token = createMockToken({
        collection: { symbol: 'test', name: 'Short' },
      });
      const formatted = formatMagicEdenToken(token);
      expect(formatted.collection).toBe('Short');
    });
  });

  describe('getInscriptions', () => {
    it('should fetch inscriptions from Hiro API', async () => {
      const mockResults = [createMockInscription(), createMockInscription({ number: 12346 })];
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { results: mockResults, total: 2 },
      });

      const result = await getInscriptions('bc1qtest', 60, 0);

      expect(result.results).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.hiro.so/ordinals/v1/inscriptions',
        expect.objectContaining({
          params: { address: 'bc1qtest', limit: 60, offset: 0 },
        })
      );
    });

    it('should throw error on API failure', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('API Error'));

      await expect(getInscriptions('bc1qtest')).rejects.toThrow('API Error');
    });

    it('should use default limit and offset', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [], total: 0 } });

      await getInscriptions('bc1qtest');

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: { address: 'bc1qtest', limit: 60, offset: 0 },
        })
      );
    });
  });

  describe('getAllInscriptions', () => {
    it('should fetch all inscriptions with pagination', async () => {
      const page1 = Array(60).fill(null).map((_, i) => createMockInscription({ number: i }));
      const page2 = [createMockInscription({ number: 60 })];

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { results: page1, total: 61 } })
        .mockResolvedValueOnce({ data: { results: page2, total: 61 } });

      const result = await getAllInscriptions('bc1qtest');

      expect(result).toHaveLength(61);
      expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('should stop when no more results', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [], total: 0 } });

      const result = await getAllInscriptions('bc1qtest');

      expect(result).toHaveLength(0);
      expect(axios.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getInscriptionsForAddresses', () => {
    it('should fetch inscriptions for multiple addresses', async () => {
      const inscription1 = createMockInscription({ number: 1 });
      const inscription2 = createMockInscription({ number: 2 });

      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { results: [inscription1], total: 1 } })
        .mockResolvedValueOnce({ data: { results: [inscription2], total: 1 } });

      const result = await getInscriptionsForAddresses(['addr1', 'addr2']);

      expect(result).toHaveLength(2);
      expect(result[0].address).toBe('addr1');
      expect(result[1].address).toBe('addr2');
    });

    it('should call progress callback', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { results: [], total: 0 } });

      const progressFn = vi.fn();
      await getInscriptionsForAddresses(['addr1', 'addr2'], progressFn);

      expect(progressFn).toHaveBeenCalledWith(1, 2);
      expect(progressFn).toHaveBeenCalledWith(2, 2);
    });
  });

  describe('getInscriptionById', () => {
    it('should fetch inscription by ID', async () => {
      const inscription = createMockInscription();
      vi.mocked(axios.get).mockResolvedValueOnce({ data: inscription });

      const result = await getInscriptionById('test-id');

      expect(result).toEqual(inscription);
      expect(axios.get).toHaveBeenCalledWith('https://api.hiro.so/ordinals/v1/inscriptions/test-id');
    });

    it('should return null on error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'));

      const result = await getInscriptionById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getInscriptionContent', () => {
    it('should fetch inscription content as buffer', async () => {
      const content = 'Hello World';
      vi.mocked(axios.get).mockResolvedValueOnce({ data: Buffer.from(content) });

      const result = await getInscriptionContent('test-id');

      expect(result).toBeInstanceOf(Buffer);
      expect(result?.toString()).toBe(content);
    });

    it('should return null on error', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('Not found'));

      const result = await getInscriptionContent('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('hasInscriptions', () => {
    it('should return true when inscriptions exist', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [], total: 5 } });

      const result = await hasInscriptions('bc1qtest');

      expect(result).toBe(true);
    });

    it('should return false when no inscriptions', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { results: [], total: 0 } });

      const result = await hasInscriptions('bc1qtest');

      expect(result).toBe(false);
    });
  });

  describe('checkAddressesForInscriptions', () => {
    it('should check multiple addresses', async () => {
      vi.mocked(axios.get)
        .mockResolvedValueOnce({ data: { results: [], total: 5 } })
        .mockResolvedValueOnce({ data: { results: [], total: 0 } });

      const result = await checkAddressesForInscriptions(['addr1', 'addr2']);

      expect(result.get('addr1')).toBe(true);
      expect(result.get('addr2')).toBe(false);
    });

    it('should call progress callback', async () => {
      vi.mocked(axios.get).mockResolvedValue({ data: { results: [], total: 0 } });

      const progressFn = vi.fn();
      await checkAddressesForInscriptions(['addr1', 'addr2'], progressFn);

      expect(progressFn).toHaveBeenCalledWith(1, 2);
      expect(progressFn).toHaveBeenCalledWith(2, 2);
    });
  });

  describe('getTokensFromMagicEden', () => {
    it('should fetch tokens from Magic Eden API', async () => {
      const mockTokens = [createMockToken(), createMockToken({ id: 'token2' })];
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: { tokens: mockTokens } });

      const result = await getTokensFromMagicEden('bc1qtest');

      expect(result.tokens).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it('should throw if API_KEY not configured', async () => {
      delete process.env.API_KEY;

      await expect(getTokensFromMagicEden('bc1qtest')).rejects.toThrow('API_KEY not configured');
    });

    it('should set hasMore to true when reaching limit', async () => {
      const mockTokens = Array(100).fill(null).map(() => createMockToken());
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: { tokens: mockTokens } });

      const result = await getTokensFromMagicEden('bc1qtest', 100);

      expect(result.hasMore).toBe(true);
    });

    it('should handle API errors with context', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce({
        response: { data: { message: 'Invalid address' } },
      });

      await expect(getTokensFromMagicEden('invalid')).rejects.toThrow('Magic Eden API error: Invalid address');
    });

    it('should handle response as array', async () => {
      const mockTokens = [createMockToken()];
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockTokens });

      const result = await getTokensFromMagicEden('bc1qtest');

      expect(result.tokens).toHaveLength(1);
    });
  });

  describe('getAllTokensFromMagicEden', () => {
    it('should fetch all tokens with pagination', async () => {
      const page1 = Array(100).fill(null).map(() => createMockToken());
      const page2 = [createMockToken()];

      vi.mocked(axiosInstance.get)
        .mockResolvedValueOnce({ data: { tokens: page1 } })
        .mockResolvedValueOnce({ data: { tokens: page2 } });

      const result = await getAllTokensFromMagicEden('bc1qtest');

      expect(result).toHaveLength(101);
      expect(axiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('should stop when hasMore is false', async () => {
      const tokens = [createMockToken()];
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: { tokens } });

      const result = await getAllTokensFromMagicEden('bc1qtest');

      expect(result).toHaveLength(1);
      expect(axiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTokensForAddressesFromMagicEden', () => {
    it('should fetch tokens for multiple addresses', async () => {
      vi.mocked(axiosInstance.get)
        .mockResolvedValueOnce({ data: { tokens: [createMockToken()] } })
        .mockResolvedValueOnce({ data: { tokens: [createMockToken(), createMockToken()] } });

      const result = await getTokensForAddressesFromMagicEden(['addr1', 'addr2']);

      expect(result).toHaveLength(2);
      expect(result[0].address).toBe('addr1');
      expect(result[0].total).toBe(1);
      expect(result[1].address).toBe('addr2');
      expect(result[1].total).toBe(2);
    });

    it('should call progress callback', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: { tokens: [] } });

      const progressFn = vi.fn();
      await getTokensForAddressesFromMagicEden(['addr1', 'addr2'], progressFn);

      expect(progressFn).toHaveBeenCalledWith(1, 2);
      expect(progressFn).toHaveBeenCalledWith(2, 2);
    });
  });
});
