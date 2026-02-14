import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock modules with factory functions - these are hoisted
vi.mock('../axios/axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../bottleneck', () => ({
  default: {
    schedule: vi.fn(),
  },
}));

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

// Import mocked modules to access their mock functions
import axiosInstance from '../axios/axiosInstance';
import limiter from '../bottleneck';

// Import the functions under test
import { getBestOffer, getOffers, getBestCollectionOffer, createOffer } from './Offer';

// Sample responses
const sampleOfferResponse = {
  total: '2',
  offers: [
    {
      id: 'offer-1',
      tokenId: 'token123i0',
      price: 45000,
      buyerReceiveAddress: 'bc1pbuyer1',
      buyerPaymentAddress: 'bc1qbuyer1',
      expirationDate: Date.now() + 3600000,
      isValid: true,
    },
  ],
};

const sampleCollectionOfferResponse = {
  total: '1',
  offers: [
    {
      id: 'col-offer-1',
      collectionSymbol: 'test-collection',
      status: 'valid',
    },
  ],
};

const sampleCreateOfferResponse = {
  psbtBase64: 'cHNidP8B...',
  toSignInputs: [0],
};

describe('Offer API Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup schedule mock to execute the callback
    vi.mocked(limiter.schedule).mockImplementation((async (cb: () => Promise<any>) => cb()) as any);
  });

  describe('getBestOffer', () => {
    it('should fetch best offer for a token', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleOfferResponse });

      const result = await getBestOffer('token123i0');

      expect(result).toEqual(sampleOfferResponse);
      expect(limiter.schedule).toHaveBeenCalled();
    });

    it('should throw on API error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Server error'));

      await expect(getBestOffer('token123i0')).rejects.toThrow('Server error');
    });

    it('should pass correct parameters', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleOfferResponse });

      await getBestOffer('token123i0');

      expect(axiosInstance.get).toHaveBeenCalledWith(
        'https://nfttools.pro/magiceden/v2/ord/btc/offers/',
        expect.objectContaining({
          params: expect.objectContaining({
            status: 'valid',
            limit: 2,
            sortBy: 'priceDesc',
            token_id: 'token123i0',
          }),
        })
      );
    });
  });

  describe('getOffers', () => {
    it('should fetch offers for a token', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleOfferResponse });

      const result = await getOffers('token123i0');

      expect(result).toEqual(sampleOfferResponse);
    });

    it('should filter by buyer address if provided', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleOfferResponse });

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

    it('should throw on error', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Not found'));

      await expect(getOffers('token123i0')).rejects.toThrow('Not found');
    });
  });

  describe('getBestCollectionOffer', () => {
    it('should fetch collection offers', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCollectionOfferResponse });

      const result = await getBestCollectionOffer('test-collection');

      expect(result).toEqual(sampleCollectionOfferResponse);
    });

    it('should throw on API errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Server error'));

      await expect(getBestCollectionOffer('test-collection')).rejects.toThrow('Server error');
    });

    it('should return null on 404 (no offers)', async () => {
      const error = { response: { status: 404 } };
      vi.mocked(axiosInstance.get).mockRejectedValue(error);

      const result = await getBestCollectionOffer('test-collection');

      expect(result).toBeNull();
    });
  });

  describe('createOffer', () => {
    const validParams = {
      tokenId: 'token123i0',
      price: 50000,
      expiration: Date.now() + 3600000,
      buyerTokenReceiveAddress: 'bc1preceive',
      buyerPaymentAddress: 'bc1qpayment',
      publicKey: '02abc123',
      feerateTier: 'halfHour',
    };

    it('should create an offer successfully', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCreateOfferResponse });

      const result = await createOffer(
        validParams.tokenId,
        validParams.price,
        validParams.expiration,
        validParams.buyerTokenReceiveAddress,
        validParams.buyerPaymentAddress,
        validParams.publicKey,
        validParams.feerateTier
      );

      expect(result).toEqual(sampleCreateOfferResponse);
    });

    it('should throw error if price exceeds maxAllowedPrice', async () => {
      await expect(
        createOffer(
          validParams.tokenId,
          50000,
          validParams.expiration,
          validParams.buyerTokenReceiveAddress,
          validParams.buyerPaymentAddress,
          validParams.publicKey,
          validParams.feerateTier,
          40000 // maxAllowedPrice - lower than price
        )
      ).rejects.toThrow('[SAFETY]');
    });

    it('should allow price at maxAllowedPrice', async () => {
      vi.mocked(axiosInstance.get).mockResolvedValue({ data: sampleCreateOfferResponse });

      const result = await createOffer(
        validParams.tokenId,
        50000,
        validParams.expiration,
        validParams.buyerTokenReceiveAddress,
        validParams.buyerPaymentAddress,
        validParams.publicKey,
        validParams.feerateTier,
        50000 // maxAllowedPrice equals price
      );

      expect(result).toEqual(sampleCreateOfferResponse);
    });

    it('should re-throw API errors', async () => {
      vi.mocked(axiosInstance.get).mockRejectedValue(new Error('Server error'));

      await expect(
        createOffer(
          validParams.tokenId,
          validParams.price,
          validParams.expiration,
          validParams.buyerTokenReceiveAddress,
          validParams.buyerPaymentAddress,
          validParams.publicKey,
          validParams.feerateTier
        )
      ).rejects.toThrow();
    });
  });
});
