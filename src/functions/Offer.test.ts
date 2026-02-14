import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// Mock the logger to prevent console output during tests
vi.mock('../utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    offer: {
      error: vi.fn(),
      insufficientFunds: vi.fn(),
    },
  },
}));

// Mock axios and bottleneck
vi.mock('../axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../bottleneck', () => ({
  default: {
    schedule: vi.fn().mockImplementation(async (...args: any[]) => {
      // Handle both schedule(fn) and schedule(options, fn) signatures
      const fn = typeof args[0] === 'function' ? args[0] : args[1];
      return fn();
    }),
  },
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

import axiosInstance from '../axios/axiosInstance';

// Generate a valid test WIF deterministically
function generateTestWIF(): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

const TEST_WIF = generateTestWIF();

// Import after mocks
import {
  signData,
  signCollectionOffer,
  signCancelCollectionOfferRequest,
  cancelCollectionOfferRequest,
  submitCancelCollectionOffer,
  cancelCollectionOffer,
  createCollectionOffer,
  submitCollectionOffer,
  createOffer,
  getBestOffer,
  getOffers,
  getBestCollectionOffer,
  retrieveCancelOfferFormat,
  submitCancelOfferData,
  cancelBulkTokenOffers,
  submitSignedOfferOrder,
  getUserOffers,
  RETRY_CONFIG,
} from './Offer';

describe('Offer Signing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('signData', () => {
    it('should throw error for null data', () => {
      expect(() => signData(null, TEST_WIF)).toThrow('Invalid unsigned data');
    });

    it('should throw error for undefined data', () => {
      expect(() => signData(undefined, TEST_WIF)).toThrow('Invalid unsigned data');
    });

    it('should throw error when psbtBase64 is missing', () => {
      const data = { toSignInputs: [0] };
      expect(() => signData(data, TEST_WIF)).toThrow('Invalid unsigned data');
    });

    it('should throw error when toSignInputs is missing', () => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const data = { psbtBase64: psbt.toBase64() };
      expect(() => signData(data, TEST_WIF)).toThrow('Invalid unsigned data');
    });

    it('should sign valid PSBT data', () => {
      const privateKeyBytes = Buffer.alloc(32, 0);
      privateKeyBytes[31] = 1;
      const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      const dummyTxid = '0000000000000000000000000000000000000000000000000000000000000000';

      psbt.addInput({
        hash: dummyTxid,
        index: 0,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });

      psbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 9000,
      });

      const unsignedData = {
        psbtBase64: psbt.toBase64(),
        toSignInputs: [0],
      };

      const result = signData(unsignedData, TEST_WIF);

      // Result should be a base64 string
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');

      // Verify it's valid base64
      const decoded = Buffer.from(result, 'base64');
      expect(decoded.length).toBeGreaterThan(0);
    });

    it('should throw error on signing error', () => {
      const invalidData = {
        psbtBase64: 'invalid_base64_not_a_psbt',
        toSignInputs: [0],
      };

      expect(() => signData(invalidData, TEST_WIF)).toThrow('Failed to sign PSBT');
    });

    it('should throw error for empty toSignInputs array', () => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });

      const data = {
        psbtBase64: psbt.toBase64(),
        toSignInputs: [],
      };

      expect(() => signData(data, TEST_WIF)).toThrow('toSignInputs is empty');
    });
  });

  describe('signCollectionOffer', () => {
    it('should throw error when no offers in data', () => {
      const data = { offers: [] };
      expect(() => signCollectionOffer(data as any, TEST_WIF)).toThrow('No offers returned from API to sign');
    });

    it('should throw error when offers array is missing', () => {
      const data = {};
      expect(() => signCollectionOffer(data as any, TEST_WIF)).toThrow('No offers returned from API to sign');
    });

    it('should throw error for undefined data', () => {
      expect(() => signCollectionOffer(undefined as any, TEST_WIF)).toThrow();
    });

    it('should throw error for null data', () => {
      expect(() => signCollectionOffer(null as any, TEST_WIF)).toThrow();
    });

    it('should sign collection offer with valid PSBT', () => {
      const privateKeyBytes = Buffer.alloc(32, 0);
      privateKeyBytes[31] = 1;
      const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const dummyTxid = '0000000000000000000000000000000000000000000000000000000000000000';

      psbt.addInput({
        hash: dummyTxid,
        index: 0,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });

      psbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 9000,
      });

      const unsignedData = {
        offers: [{
          psbtBase64: psbt.toBase64(),
          transactionFeeSats: 1000,
        }],
      };

      const result = signCollectionOffer(unsignedData as any, TEST_WIF);

      expect(result).toHaveProperty('signedOfferPSBTBase64');
      expect(typeof result.signedOfferPSBTBase64).toBe('string');
    });

    it('should sign cancel PSBT if provided', () => {
      const privateKeyBytes = Buffer.alloc(32, 0);
      privateKeyBytes[31] = 1;
      const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const cancelPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const dummyTxid = '0000000000000000000000000000000000000000000000000000000000000000';

      // Setup main PSBT
      psbt.addInput({
        hash: dummyTxid,
        index: 0,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });
      psbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 9000,
      });

      // Setup cancel PSBT
      cancelPsbt.addInput({
        hash: dummyTxid,
        index: 1,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 5000,
        },
      });
      cancelPsbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 4000,
      });

      const unsignedData = {
        offers: [{
          psbtBase64: psbt.toBase64(),
          cancelPsbtBase64: cancelPsbt.toBase64(),
          transactionFeeSats: 1000,
        }],
      };

      const result = signCollectionOffer(unsignedData as any, TEST_WIF);

      expect(result.signedOfferPSBTBase64).toBeDefined();
      expect(result.signedCancelledPSBTBase64).toBeDefined();
    });

    it('should sign with 2 inputs when available', () => {
      const privateKeyBytes = Buffer.alloc(32, 0);
      privateKeyBytes[31] = 1;
      const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const dummyTxid = '0000000000000000000000000000000000000000000000000000000000000000';

      // Add 2 inputs
      psbt.addInput({
        hash: dummyTxid,
        index: 0,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });
      psbt.addInput({
        hash: dummyTxid,
        index: 1,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });

      psbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 18000,
      });

      const unsignedData = {
        offers: [{
          psbtBase64: psbt.toBase64(),
          transactionFeeSats: 2000,
        }],
      };

      const result = signCollectionOffer(unsignedData as any, TEST_WIF);

      expect(result).toHaveProperty('signedOfferPSBTBase64');
      expect(typeof result.signedOfferPSBTBase64).toBe('string');
    });
  });

  describe('signCancelCollectionOfferRequest', () => {
    it('should sign cancel request PSBT', () => {
      const privateKeyBytes = Buffer.alloc(32, 0);
      privateKeyBytes[31] = 1;
      const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
      const dummyTxid = '0000000000000000000000000000000000000000000000000000000000000000';

      psbt.addInput({
        hash: dummyTxid,
        index: 0,
        witnessUtxo: {
          script: bitcoin.payments.p2wpkh({
            pubkey: keyPair.publicKey,
            network: bitcoin.networks.bitcoin,
          }).output!,
          value: 10000,
        },
      });

      psbt.addOutput({
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        value: 9000,
      });

      const unsignedData = {
        psbtBase64: psbt.toBase64(),
      };

      const result = signCancelCollectionOfferRequest(unsignedData as any, TEST_WIF);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('Offer API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_KEY = 'test-api-key';
  });

  afterEach(() => {
    delete process.env.API_KEY;
  });

  describe('cancelCollectionOfferRequest', () => {
    it('should fetch cancel offer request', async () => {
      const mockResponse = { psbtBase64: 'base64data' };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await cancelCollectionOfferRequest(['offer1'], 'publicKey123');

      expect(result).toEqual(mockResponse);
      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/cancel',
        expect.objectContaining({
          params: {
            offerIds: ['offer1'],
            makerPublicKey: 'publicKey123',
            makerPaymentType: 'p2wpkh',
          },
        })
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      await expect(cancelCollectionOfferRequest(['offer1'], 'publicKey123'))
        .rejects.toThrow('API error');
    });
  });

  describe('submitCancelCollectionOffer', () => {
    it('should submit cancel collection offer', async () => {
      const mockResponse = { success: true };
      vi.mocked(axiosInstance.post).mockResolvedValueOnce({ data: mockResponse });

      const result = await submitCancelCollectionOffer(['offer1'], 'publicKey123', 'signedPsbt');

      expect(result).toEqual({ data: mockResponse });
      expect(axiosInstance.post).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/collection-offers/psbt/cancel',
        expect.objectContaining({
          makerPublicKey: 'publicKey123',
          offerIds: ['offer1'],
          signedPsbtBase64: 'signedPsbt',
        }),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.post).mockRejectedValueOnce(new Error('API error'));

      await expect(submitCancelCollectionOffer(['offer1'], 'publicKey123', 'signedPsbt'))
        .rejects.toThrow('API error');
    });
  });

  describe('cancelCollectionOffer', () => {
    it('should return false when cancelCollectionOfferRequest returns null', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      const result = await cancelCollectionOffer(['offer1'], 'publicKey123', TEST_WIF);

      expect(result).toBe(false);
    });
  });

  describe('createCollectionOffer', () => {
    it('should throw safety error if price exceeds maxAllowedPrice', async () => {
      await expect(
        createCollectionOffer(
          'test-collection',
          100000,
          '2024-12-31T00:00:00Z',
          10,
          'publicKey',
          'receiveAddress',
          TEST_WIF,
          50000 // maxAllowedPrice lower than priceSats
        )
      ).rejects.toThrow('[SAFETY]');
    });
  });

  describe('createOffer', () => {
    it('should throw safety error if price exceeds maxAllowedPrice', async () => {
      await expect(
        createOffer(
          'token123i0',
          100000,
          Date.now() + 3600000,
          'bc1preceive',
          'bc1qpayment',
          'publicKey123',
          'halfHour',
          50000 // maxAllowedPrice lower than price
        )
      ).rejects.toThrow('[SAFETY]');
    });

    it('should call API when price is within maxAllowedPrice', async () => {
      const mockResponse = { psbtBase64: 'base64', toSignInputs: [0] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await createOffer(
        'token123i0',
        50000,
        Date.now() + 3600000,
        'bc1preceive',
        'bc1qpayment',
        'publicKey123',
        'halfHour',
        100000 // maxAllowedPrice higher than price
      );

      expect(result).toEqual(mockResponse);
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      await expect(
        createOffer(
          'token123i0',
          50000,
          Date.now() + 3600000,
          'bc1preceive',
          'bc1qpayment',
          'publicKey123',
          'halfHour'
        )
      ).rejects.toThrow();
    });

    it('should not include sellerReceiveAddress in params', async () => {
      const mockResponse = { psbtBase64: 'base64', toSignInputs: [0] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      await createOffer(
        'token123i0',
        50000,
        Date.now() + 3600000,
        'bc1preceive',
        'bc1qpayment',
        'publicKey123',
        'halfHour'
      );

      const callArgs = vi.mocked(axiosInstance.get).mock.calls[0];
      const params = callArgs[1]?.params;
      expect(params).not.toHaveProperty('sellerReceiveAddress');
    });
  });

  describe('getBestOffer', () => {
    it('should fetch best offer for a token', async () => {
      const mockResponse = { total: '1', offers: [{ id: 'offer1', price: 50000 }] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await getBestOffer('token123i0');

      expect(result).toEqual(mockResponse);
      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/offers/',
        expect.objectContaining({
          params: expect.objectContaining({
            status: 'valid',
            limit: 2,
            offset: 0,
            sortBy: 'priceDesc',
            token_id: 'token123i0',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      await expect(getBestOffer('token123i0')).rejects.toThrow('API error');
    });
  });

  describe('getOffers', () => {
    it('should fetch offers for a token', async () => {
      const mockResponse = { total: '2', offers: [{ id: 'offer1' }, { id: 'offer2' }] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await getOffers('token123i0');

      expect(result).toEqual(mockResponse);
    });

    it('should include wallet address filter when provided', async () => {
      const mockResponse = { total: '1', offers: [{ id: 'offer1' }] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      await getOffers('token123i0', 'bc1pbuyer');

      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/offers/',
        expect.objectContaining({
          params: expect.objectContaining({
            wallet_address_buyer: 'bc1pbuyer',
          }),
        })
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      await expect(getOffers('token123i0')).rejects.toThrow('API error');
    });
  });

  describe('getBestCollectionOffer', () => {
    it('should fetch collection offers', async () => {
      const mockResponse = { total: '1', offers: [{ id: 'col-offer1' }] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await getBestCollectionOffer('test-collection');

      expect(result).toEqual(mockResponse);
    });

    it('should return null on 404 (no offers)', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce({ response: { status: 404 } });

      const result = await getBestCollectionOffer('test-collection');

      expect(result).toBeNull();
    });

    it('should throw on other API errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('Server error'));

      await expect(getBestCollectionOffer('test-collection')).rejects.toThrow();
    });
  });

  describe('retrieveCancelOfferFormat', () => {
    it('should fetch cancel offer format', async () => {
      const mockResponse = { psbtBase64: 'base64', toSignInputs: [0] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await retrieveCancelOfferFormat('offer123');

      expect(result).toEqual(mockResponse);
      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel?offerId=offer123',
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      await expect(retrieveCancelOfferFormat('offer123')).rejects.toThrow('API error');
    });
  });

  describe('submitCancelOfferData', () => {
    it('should submit cancel offer data', async () => {
      vi.mocked(axiosInstance.post).mockResolvedValueOnce({ data: { ok: true } });

      const result = await submitCancelOfferData('offer123', 'signedPsbt');

      expect(result).toBe(true);
      expect(axiosInstance.post).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/offers/cancel',
        { offerId: 'offer123', signedPSBTBase64: 'signedPsbt' },
        expect.any(Object)
      );
    });

    it('should return false when ok is not true', async () => {
      vi.mocked(axiosInstance.post).mockResolvedValueOnce({ data: {} });

      const result = await submitCancelOfferData('offer123', 'signedPsbt');

      expect(result).toBe(false);
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.post).mockRejectedValueOnce(new Error('API error'));

      await expect(submitCancelOfferData('offer123', 'signedPsbt')).rejects.toThrow('API error');
    });
  });

  describe('cancelBulkTokenOffers', () => {
    it('should return failed result on error (not throw)', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValueOnce(new Error('API error'));

      const result = await cancelBulkTokenOffers(['token1'], 'bc1preceive', TEST_WIF);

      expect(result.successful).toEqual([]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].tokenId).toBe('token1');
      expect(result.failed[0].error).toBe('API error');
    });
  });

  describe('submitSignedOfferOrder', () => {
    it('should exist as a function', () => {
      expect(typeof submitSignedOfferOrder).toBe('function');
    });
  });

  describe('getUserOffers', () => {
    it('should lowercase the payment address', async () => {
      vi.clearAllMocks();
      const mockResponse = { total: '0', offers: [] };
      vi.mocked(axiosInstance.get).mockResolvedValueOnce({ data: mockResponse });

      await getUserOffers('BC1QPAYMENT');

      expect(axiosInstance.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            wallet_address_buyer: 'bc1qpayment',
          }),
        })
      );
    });
  });

  describe('RETRY_CONFIG', () => {
    it('should have correct default values', () => {
      expect(RETRY_CONFIG.maxRetries).toBe(3);
      expect(RETRY_CONFIG.baseDelayMs).toBe(2500);
    });

    it('should calculate exponential backoff correctly', () => {
      expect(RETRY_CONFIG.getDelayMs(1)).toBe(2500);
      expect(RETRY_CONFIG.getDelayMs(2)).toBe(5000);
      expect(RETRY_CONFIG.getDelayMs(3)).toBe(10000);
    });
  });
});
