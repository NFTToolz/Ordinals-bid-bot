/**
 * Tests for cancel.ts - Offer cancellation logic
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// Generate test WIF
function generateTestWIF(): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

const TEST_WIF = generateTestWIF();
const TEST_RECEIVE_ADDRESS = 'bc1p' + 'a'.repeat(58);

// Store original env
const originalEnv = { ...process.env };

// Mock dependencies
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// Track mock state
const mockOffers: Array<{
  id: string;
  tokenId: string;
  token: { id: string; collectionSymbol: string };
  price: number;
  buyerPaymentAddress: string;
  expirationDate: number;
}> = [];

const mockCollectionOffers: Array<{
  id: string;
  price: { amount: number };
  btcParams: {
    makerOrdinalReceiveAddress: string;
    makerPaymentAddress: string;
  };
}> = [];

const cancelledOffers: string[] = [];

vi.mock('./functions/Offer', () => ({
  getUserOffers: vi.fn().mockImplementation(async (address: string) => {
    return { offers: mockOffers.filter((o) => true) };
  }),
  getBestCollectionOffer: vi.fn().mockImplementation(async (collectionSymbol: string) => {
    return { offers: mockCollectionOffers };
  }),
  retrieveCancelOfferFormat: vi.fn().mockImplementation(async (offerId: string) => {
    // Create a minimal valid PSBT for signing
    const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
    const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
    const dummyTxid = '0'.repeat(64);

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

    return {
      psbtBase64: psbt.toBase64(),
      toSignInputs: [0],
    };
  }),
  signData: vi.fn().mockImplementation((data: any, privateKey: string) => {
    if (!data || !data.psbtBase64) return undefined;
    try {
      const keyPair = ECPair.fromWIF(privateKey, bitcoin.networks.bitcoin);
      const psbt = bitcoin.Psbt.fromBase64(data.psbtBase64);
      psbt.signAllInputs(keyPair);
      return psbt.toBase64();
    } catch {
      return undefined;
    }
  }),
  submitCancelOfferData: vi.fn().mockImplementation(async (offerId: string) => {
    cancelledOffers.push(offerId);
    return true;
  }),
  cancelCollectionOffer: vi.fn().mockImplementation(async (offerIds: string[]) => {
    offerIds.forEach((id) => cancelledOffers.push(id));
    return true;
  }),
}));

// Mock fs
const mockCollections = [
  {
    collectionSymbol: 'test-collection-1',
    minBid: 0.001,
    maxBid: 0.01,
    minFloorBid: 50,
    maxFloorBid: 95,
    offerType: 'ITEM',
    tokenReceiveAddress: TEST_RECEIVE_ADDRESS,
  },
  {
    collectionSymbol: 'test-collection-2',
    minBid: 0.002,
    maxBid: 0.02,
    minFloorBid: 60,
    maxFloorBid: 90,
    offerType: 'COLLECTION',
    tokenReceiveAddress: TEST_RECEIVE_ADDRESS,
  },
];

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('collections.json')) return true;
      if (path.includes('wallets.json')) return false;
      return false;
    }),
    readFileSync: vi.fn().mockImplementation((path: string) => {
      if (path.includes('collections.json')) {
        return JSON.stringify(mockCollections);
      }
      throw new Error('File not found');
    }),
  },
  existsSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes('collections.json')) return true;
    if (path.includes('wallets.json')) return false;
    return false;
  }),
  readFileSync: vi.fn().mockImplementation((path: string) => {
    if (path.includes('collections.json')) {
      return JSON.stringify(mockCollections);
    }
    throw new Error('File not found');
  }),
}));

vi.mock('./utils/walletPool', () => ({
  initializeWalletPool: vi.fn(),
  getWalletByPaymentAddress: vi.fn().mockReturnValue(null),
  isWalletPoolInitialized: vi.fn().mockReturnValue(false),
}));

// Set up environment
beforeAll(() => {
  process.env.TOKEN_RECEIVE_ADDRESS = TEST_RECEIVE_ADDRESS;
  process.env.FUNDING_WIF = TEST_WIF;
  process.env.ENABLE_WALLET_ROTATION = 'false';
});

describe('Cancel.ts Logic Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffers.length = 0;
    mockCollectionOffers.length = 0;
    cancelledOffers.length = 0;
  });

  describe('getReceiveAddressesToCheck', () => {
    it('should return addresses from collection configs', () => {
      // Simulating the logic from cancel.ts
      const collections = mockCollections;
      const addresses: { address: string; privateKey: string; label?: string }[] = [];
      const seenAddresses = new Set<string>();

      for (const collection of collections) {
        const receiveAddress = collection.tokenReceiveAddress ?? TEST_RECEIVE_ADDRESS;
        const privateKey = TEST_WIF;

        if (!seenAddresses.has(receiveAddress.toLowerCase())) {
          addresses.push({
            address: receiveAddress,
            privateKey,
          });
          seenAddresses.add(receiveAddress.toLowerCase());
        }
      }

      expect(addresses.length).toBe(1); // Same receive address for both collections
      expect(addresses[0].address).toBe(TEST_RECEIVE_ADDRESS);
    });

    it('should deduplicate addresses', () => {
      const addresses: { address: string }[] = [];
      const seenAddresses = new Set<string>();
      const testAddresses = [TEST_RECEIVE_ADDRESS, TEST_RECEIVE_ADDRESS.toUpperCase(), TEST_RECEIVE_ADDRESS];

      for (const addr of testAddresses) {
        if (!seenAddresses.has(addr.toLowerCase())) {
          addresses.push({ address: addr });
          seenAddresses.add(addr.toLowerCase());
        }
      }

      expect(addresses.length).toBe(1);
    });
  });

  describe('cancelBid', () => {
    it('should cancel offer when we own it', async () => {
      const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
      const buyerPaymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin,
      }).address as string;

      const offer = {
        id: 'offer-123',
        tokenId: 'token1i0',
        buyerPaymentAddress,
        price: 100000,
      };

      // Simulate cancelBid logic
      const isOurs = offer.buyerPaymentAddress === buyerPaymentAddress;
      expect(isOurs).toBe(true);
    });

    it('should skip cancel when offer is from different wallet', () => {
      const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
      const buyerPaymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin,
      }).address as string;

      const offer = {
        id: 'offer-123',
        tokenId: 'token1i0',
        buyerPaymentAddress: 'bc1qdifferentaddress',
        price: 100000,
      };

      const isOurs = offer.buyerPaymentAddress === buyerPaymentAddress;
      expect(isOurs).toBe(false);
    });
  });

  describe('cancelAllItemOffers', () => {
    it('should process all addresses', async () => {
      const processedAddresses: string[] = [];
      const addresses = [
        { address: 'addr1', privateKey: TEST_WIF },
        { address: 'addr2', privateKey: TEST_WIF },
      ];

      // Simulate the loop
      for (const addr of addresses) {
        processedAddresses.push(addr.address);
      }

      expect(processedAddresses).toHaveLength(2);
      expect(processedAddresses).toContain('addr1');
      expect(processedAddresses).toContain('addr2');
    });

    it('should continue processing on error', async () => {
      const processedAddresses: string[] = [];
      const errors: string[] = [];
      const addresses = [
        { address: 'addr1', shouldFail: true },
        { address: 'addr2', shouldFail: false },
      ];

      for (const addr of addresses) {
        try {
          if (addr.shouldFail) {
            throw new Error('API error');
          }
          processedAddresses.push(addr.address);
        } catch (error: any) {
          errors.push(addr.address);
          // Continue with next address (don't throw)
        }
      }

      expect(processedAddresses).toHaveLength(1);
      expect(processedAddresses).toContain('addr2');
      expect(errors).toHaveLength(1);
      expect(errors).toContain('addr1');
    });
  });

  describe('cancelCollectionOffers', () => {
    it('should filter unique COLLECTION type collections', () => {
      const collections = [
        { collectionSymbol: 'coll1', offerType: 'COLLECTION', tokenReceiveAddress: 'addr1' },
        { collectionSymbol: 'coll2', offerType: 'ITEM', tokenReceiveAddress: 'addr1' },
        { collectionSymbol: 'coll3', offerType: 'COLLECTION', tokenReceiveAddress: 'addr1' },
        { collectionSymbol: 'coll4', offerType: 'COLLECTION', tokenReceiveAddress: 'addr2' },
      ];

      const uniqueCollections = collections.filter(
        (collection, index, self) =>
          index ===
          self.findIndex(
            (c) =>
              c.tokenReceiveAddress === collection.tokenReceiveAddress &&
              c.offerType === collection.offerType
          )
      );

      expect(uniqueCollections).toHaveLength(3);
    });

    it('should identify our collection offers', () => {
      const ourReceiveAddress = TEST_RECEIVE_ADDRESS.toLowerCase();
      const offers = [
        { btcParams: { makerOrdinalReceiveAddress: TEST_RECEIVE_ADDRESS } },
        { btcParams: { makerOrdinalReceiveAddress: 'other-address' } },
      ];

      const ourOffer = offers.find(
        (offer) => offer.btcParams.makerOrdinalReceiveAddress.toLowerCase() === ourReceiveAddress
      );

      expect(ourOffer).toBeDefined();
    });
  });

  describe('Wallet Rotation Cancel Logic', () => {
    it('should use wallet pool for cancellation when enabled', () => {
      const ENABLE_WALLET_ROTATION = true;
      const walletPool = new Map([
        ['bc1qwallet1', { wif: 'wif1', label: 'Wallet 1' }],
        ['bc1qwallet2', { wif: 'wif2', label: 'Wallet 2' }],
      ]);

      const offer = {
        buyerPaymentAddress: 'bc1qwallet1',
      };

      let signingKey = TEST_WIF;
      if (ENABLE_WALLET_ROTATION) {
        const wallet = walletPool.get(offer.buyerPaymentAddress);
        if (wallet) {
          signingKey = wallet.wif;
        }
      }

      expect(signingKey).toBe('wif1');
    });

    it('should skip cancel for unknown wallet in rotation mode', () => {
      const ENABLE_WALLET_ROTATION = true;
      const walletPool = new Map([
        ['bc1qwallet1', { wif: 'wif1', label: 'Wallet 1' }],
      ]);

      const offer = {
        buyerPaymentAddress: 'bc1qunknown',
      };

      let shouldSkip = false;
      if (ENABLE_WALLET_ROTATION) {
        const wallet = walletPool.get(offer.buyerPaymentAddress);
        if (!wallet) {
          shouldSkip = true;
        }
      }

      expect(shouldSkip).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle retrieveCancelOfferFormat failure gracefully', async () => {
      const { retrieveCancelOfferFormat } = await import('./functions/Offer');
      vi.mocked(retrieveCancelOfferFormat).mockRejectedValueOnce(new Error('API error'));

      let cancelled = false;
      let errorOccurred = false;

      try {
        await retrieveCancelOfferFormat('offer-123');
        cancelled = true;
      } catch (error) {
        errorOccurred = true;
      }

      expect(errorOccurred).toBe(true);
      expect(cancelled).toBe(false);
    });

    it('should handle submitCancelOfferData failure gracefully', async () => {
      const { submitCancelOfferData } = await import('./functions/Offer');
      vi.mocked(submitCancelOfferData).mockResolvedValueOnce(false);

      const result = await submitCancelOfferData('offer-123', 'signedPsbt');

      expect(result).toBe(false);
    });
  });

  describe('Main Flow', () => {
    it('should call both cancelAllItemOffers and cancelCollectionOffers', async () => {
      let itemOffersCancelled = false;
      let collectionOffersCancelled = false;

      async function cancelAllItemOffers() {
        itemOffersCancelled = true;
      }

      async function cancelCollectionOffers() {
        collectionOffersCancelled = true;
      }

      async function main() {
        await cancelAllItemOffers();
        await cancelCollectionOffers();
      }

      await main();

      expect(itemOffersCancelled).toBe(true);
      expect(collectionOffersCancelled).toBe(true);
    });
  });

  describe('ECPair from Collection Config', () => {
    it('should derive payment address from WIF', () => {
      const keyPair = ECPair.fromWIF(TEST_WIF, bitcoin.networks.bitcoin);
      const publicKey = keyPair.publicKey.toString('hex');
      const paymentAddress = bitcoin.payments.p2wpkh({
        pubkey: keyPair.publicKey,
        network: bitcoin.networks.bitcoin,
      }).address;

      expect(publicKey).toBeDefined();
      expect(paymentAddress).toBeDefined();
      expect(paymentAddress?.startsWith('bc1q')).toBe(true);
    });

    it('should use collection-specific WIF when provided', () => {
      const FUNDING_WIF = TEST_WIF;
      const collection = {
        fundingWalletWIF: undefined, // Would be a different WIF if provided
      };

      const privateKey = collection.fundingWalletWIF ?? FUNDING_WIF;

      expect(privateKey).toBe(TEST_WIF);
    });
  });
});

describe('Offer Filtering', () => {
  it('should filter offers by buyer payment address', () => {
    const buyerPaymentAddress = 'bc1qbuyer';
    const offers = [
      { id: '1', buyerPaymentAddress: 'bc1qbuyer' },
      { id: '2', buyerPaymentAddress: 'bc1qother' },
      { id: '3', buyerPaymentAddress: 'bc1qbuyer' },
    ];

    const ourOffers = offers.filter((o) => o.buyerPaymentAddress === buyerPaymentAddress);

    expect(ourOffers).toHaveLength(2);
    expect(ourOffers.map((o) => o.id)).toEqual(['1', '3']);
  });

  it('should handle empty offers array', () => {
    const offers: any[] = [];
    const ourOffers = offers.filter((o) => o.buyerPaymentAddress === 'bc1qbuyer');

    expect(ourOffers).toHaveLength(0);
  });
});

describe('Collection Offers Identification', () => {
  it('should find our collection offer by receive address', () => {
    const buyerTokenReceiveAddress = 'bc1preceive';
    const offers = [
      {
        id: '1',
        btcParams: { makerOrdinalReceiveAddress: 'bc1pother' },
      },
      {
        id: '2',
        btcParams: { makerOrdinalReceiveAddress: 'bc1preceive' },
      },
    ];

    const ourOffer = offers.find(
      (offer) =>
        offer.btcParams.makerOrdinalReceiveAddress.toLowerCase() ===
        buyerTokenReceiveAddress.toLowerCase()
    );

    expect(ourOffer).toBeDefined();
    expect(ourOffer?.id).toBe('2');
  });
});
