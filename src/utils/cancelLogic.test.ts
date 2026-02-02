import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Offer Filtering
  filterOurOffers,
  filterOthersOffers,
  isOurOffer,
  isUnknownWalletOffer,

  // Offer Grouping
  groupOffersByCollection,
  groupOffersByWallet,
  countOffersByCollection,

  // Retry Logic
  shouldRetryCancel,
  calculateRetryDelay,
  isRateLimitError,

  // Address Functions
  deduplicateAddresses,
  createAddressSet,
  addressesMatch,

  // Collection Filtering
  getUniqueCollectionOfferConfigs,
  getUniqueReceiveAddresses,

  // Offer Validation
  hasValidOffers,
  getOfferLogInfo,
  formatAddressForLog,

  // Cancel Operation Helpers
  prepareCancelOperations,
  countSettledResults,
  getFailedResults,

  // Types
  CollectionData,
} from './cancelLogic';

import { IOffer } from '../functions/Offer';

// Helper to create mock IOffer objects
function createMockOffer(overrides: Partial<IOffer> = {}): IOffer {
  return {
    id: 'offer123',
    tokenId: 'token456',
    sellerReceiveAddress: 'sellerReceive',
    sellerOrdinalsAddress: 'sellerOrdinals',
    price: 1000000,
    buyerReceiveAddress: 'buyerReceive',
    buyerPaymentAddress: 'buyerPayment',
    expirationDate: Date.now() + 60000,
    isValid: true,
    token: {
      id: 'token456',
      collectionSymbol: 'test-collection',
      // Add other required token fields with defaults
    } as any,
    ...overrides,
  };
}

describe('cancelLogic', () => {
  // ============================================================================
  // Offer Filtering Tests
  // ============================================================================
  describe('filterOurOffers', () => {
    it('should filter offers that belong to our addresses', () => {
      const offers: IOffer[] = [
        createMockOffer({ id: 'offer1', buyerPaymentAddress: 'ADDRESS1' }),
        createMockOffer({ id: 'offer2', buyerPaymentAddress: 'address2' }),
        createMockOffer({ id: 'offer3', buyerPaymentAddress: 'ADDRESS3' }),
      ];
      const ourAddresses = new Set(['address1', 'address3']);

      const filtered = filterOurOffers(offers, ourAddresses);

      expect(filtered).toHaveLength(2);
      expect(filtered.map(o => o.id)).toEqual(['offer1', 'offer3']);
    });

    it('should handle empty offers array', () => {
      const filtered = filterOurOffers([], new Set(['address1']));
      expect(filtered).toHaveLength(0);
    });

    it('should handle empty addresses set', () => {
      const offers: IOffer[] = [createMockOffer()];
      const filtered = filterOurOffers(offers, new Set());
      expect(filtered).toHaveLength(0);
    });

    it('should be case-insensitive', () => {
      const offers: IOffer[] = [
        createMockOffer({ buyerPaymentAddress: 'MyAddress' }),
      ];
      const ourAddresses = new Set(['myaddress']);

      const filtered = filterOurOffers(offers, ourAddresses);
      expect(filtered).toHaveLength(1);
    });
  });

  describe('filterOthersOffers', () => {
    it('should filter offers that do not belong to our addresses', () => {
      const offers: IOffer[] = [
        createMockOffer({ id: 'offer1', buyerPaymentAddress: 'address1' }),
        createMockOffer({ id: 'offer2', buyerPaymentAddress: 'other' }),
      ];
      const ourAddresses = new Set(['address1']);

      const filtered = filterOthersOffers(offers, ourAddresses);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('offer2');
    });
  });

  describe('isOurOffer', () => {
    it('should return true for our offer', () => {
      const offer = createMockOffer({ buyerPaymentAddress: 'OurAddress' });
      const ourAddresses = new Set(['ouraddress']);

      expect(isOurOffer(offer, ourAddresses)).toBe(true);
    });

    it('should return false for others offer', () => {
      const offer = createMockOffer({ buyerPaymentAddress: 'theirAddress' });
      const ourAddresses = new Set(['ouraddress']);

      expect(isOurOffer(offer, ourAddresses)).toBe(false);
    });
  });

  describe('isUnknownWalletOffer', () => {
    it('should return false when offer matches known payment address', () => {
      const offer = createMockOffer({ buyerPaymentAddress: 'KnownAddress' });

      expect(isUnknownWalletOffer(offer, 'knownaddress', new Set())).toBe(false);
    });

    it('should return false when offer is in wallet pool', () => {
      const offer = createMockOffer({ buyerPaymentAddress: 'PoolAddress' });

      expect(isUnknownWalletOffer(offer, 'other', new Set(['pooladdress']))).toBe(false);
    });

    it('should return true for unknown wallet', () => {
      const offer = createMockOffer({ buyerPaymentAddress: 'UnknownAddress' });

      expect(isUnknownWalletOffer(offer, 'known', new Set(['pool']))).toBe(true);
    });
  });

  // ============================================================================
  // Offer Grouping Tests
  // ============================================================================
  describe('groupOffersByCollection', () => {
    it('should group offers by collection symbol', () => {
      const offers: IOffer[] = [
        createMockOffer({ id: 'offer1', token: { collectionSymbol: 'col1' } as any }),
        createMockOffer({ id: 'offer2', token: { collectionSymbol: 'col2' } as any }),
        createMockOffer({ id: 'offer3', token: { collectionSymbol: 'col1' } as any }),
      ];

      const grouped = groupOffersByCollection(offers);

      expect(grouped.size).toBe(2);
      expect(grouped.get('col1')).toHaveLength(2);
      expect(grouped.get('col2')).toHaveLength(1);
    });

    it('should handle missing token info', () => {
      const offers: IOffer[] = [
        createMockOffer({ id: 'offer1', token: undefined as any }),
      ];

      const grouped = groupOffersByCollection(offers);

      expect(grouped.get('unknown')).toHaveLength(1);
    });

    it('should handle empty offers array', () => {
      const grouped = groupOffersByCollection([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe('groupOffersByWallet', () => {
    it('should group offers by payment address', () => {
      const offers: IOffer[] = [
        createMockOffer({ id: 'offer1', buyerPaymentAddress: 'Wallet1' }),
        createMockOffer({ id: 'offer2', buyerPaymentAddress: 'wallet1' }), // Same, different case
        createMockOffer({ id: 'offer3', buyerPaymentAddress: 'wallet2' }),
      ];

      const grouped = groupOffersByWallet(offers);

      expect(grouped.size).toBe(2);
      expect(grouped.get('wallet1')).toHaveLength(2);
      expect(grouped.get('wallet2')).toHaveLength(1);
    });
  });

  describe('countOffersByCollection', () => {
    it('should count offers per collection', () => {
      const offers: IOffer[] = [
        createMockOffer({ token: { collectionSymbol: 'col1' } as any }),
        createMockOffer({ token: { collectionSymbol: 'col1' } as any }),
        createMockOffer({ token: { collectionSymbol: 'col2' } as any }),
      ];

      const counts = countOffersByCollection(offers);

      expect(counts.get('col1')).toBe(2);
      expect(counts.get('col2')).toBe(1);
    });
  });

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================
  describe('shouldRetryCancel', () => {
    it('should return false when max retries exceeded', () => {
      const error = new Error('network error');
      expect(shouldRetryCancel(error, 3, 3)).toBe(false);
    });

    it('should return true for network errors', () => {
      expect(shouldRetryCancel(new Error('Network Error'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('ECONNRESET'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('socket hang up'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('ETIMEDOUT'), 0, 3)).toBe(true);
    });

    it('should return true for rate limit errors', () => {
      expect(shouldRetryCancel(new Error('rate limit exceeded'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('429 too many requests'), 0, 3)).toBe(true);
    });

    it('should return true for server errors', () => {
      expect(shouldRetryCancel(new Error('503 Service Unavailable'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('502 Bad Gateway'), 0, 3)).toBe(true);
      expect(shouldRetryCancel(new Error('504 Gateway Timeout'), 0, 3)).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      expect(shouldRetryCancel(new Error('Invalid offer ID'), 0, 3)).toBe(false);
      expect(shouldRetryCancel(new Error('Unauthorized'), 0, 3)).toBe(false);
    });

    it('should handle non-Error objects', () => {
      expect(shouldRetryCancel('network error', 0, 3)).toBe(true);
      expect(shouldRetryCancel('some random error', 0, 3)).toBe(false);
    });
  });

  describe('calculateRetryDelay', () => {
    it('should calculate exponential backoff', () => {
      expect(calculateRetryDelay(0, 1000)).toBe(1000);
      expect(calculateRetryDelay(1, 1000)).toBe(2000);
      expect(calculateRetryDelay(2, 1000)).toBe(4000);
      expect(calculateRetryDelay(3, 1000)).toBe(8000);
    });

    it('should cap at max delay', () => {
      expect(calculateRetryDelay(10, 1000, 30000)).toBe(30000);
    });

    it('should use default values', () => {
      expect(calculateRetryDelay(0)).toBe(1000);
      expect(calculateRetryDelay(5)).toBe(30000); // Capped at default max
    });
  });

  describe('isRateLimitError', () => {
    it('should detect rate limit errors', () => {
      expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
      expect(isRateLimitError(new Error('Too many requests'))).toBe(true);
      expect(isRateLimitError(new Error('Error 429'))).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isRateLimitError(new Error('Network error'))).toBe(false);
      expect(isRateLimitError(new Error('Invalid input'))).toBe(false);
    });
  });

  // ============================================================================
  // Address Functions Tests
  // ============================================================================
  describe('deduplicateAddresses', () => {
    it('should remove duplicate addresses', () => {
      const addresses = [
        { address: 'Address1', privateKey: 'key1' },
        { address: 'address1', privateKey: 'key2' }, // Duplicate
        { address: 'Address2', privateKey: 'key3' },
      ];

      const unique = deduplicateAddresses(addresses);

      expect(unique).toHaveLength(2);
      expect(unique[0].privateKey).toBe('key1'); // First occurrence kept
    });

    it('should handle empty array', () => {
      const unique = deduplicateAddresses([]);
      expect(unique).toHaveLength(0);
    });
  });

  describe('createAddressSet', () => {
    it('should create normalized address set', () => {
      const set = createAddressSet(['Address1', 'ADDRESS2', 'address3']);

      expect(set.has('address1')).toBe(true);
      expect(set.has('address2')).toBe(true);
      expect(set.has('address3')).toBe(true);
      expect(set.has('Address1')).toBe(false); // Original case not preserved
    });
  });

  describe('addressesMatch', () => {
    it('should match addresses case-insensitively', () => {
      expect(addressesMatch('Address1', 'address1')).toBe(true);
      expect(addressesMatch('ADDRESS', 'address')).toBe(true);
    });

    it('should return false for different addresses', () => {
      expect(addressesMatch('address1', 'address2')).toBe(false);
    });
  });

  // ============================================================================
  // Collection Filtering Tests
  // ============================================================================
  describe('getUniqueCollectionOfferConfigs', () => {
    it('should filter COLLECTION type only', () => {
      const collections: CollectionData[] = [
        { collectionSymbol: 'col1', offerType: 'COLLECTION', tokenReceiveAddress: 'addr1' } as CollectionData,
        { collectionSymbol: 'col2', offerType: 'ITEM', tokenReceiveAddress: 'addr2' } as CollectionData,
        { collectionSymbol: 'col3', offerType: 'COLLECTION', tokenReceiveAddress: 'addr3' } as CollectionData,
      ];

      const unique = getUniqueCollectionOfferConfigs(collections);

      expect(unique).toHaveLength(2);
      expect(unique.every(c => c.offerType === 'COLLECTION')).toBe(true);
    });

    it('should deduplicate by receive address', () => {
      const collections: CollectionData[] = [
        { collectionSymbol: 'col1', offerType: 'COLLECTION', tokenReceiveAddress: 'addr1' } as CollectionData,
        { collectionSymbol: 'col2', offerType: 'COLLECTION', tokenReceiveAddress: 'ADDR1' } as CollectionData, // Same
      ];

      const unique = getUniqueCollectionOfferConfigs(collections);

      expect(unique).toHaveLength(1);
    });
  });

  describe('getUniqueReceiveAddresses', () => {
    it('should get unique addresses from collections', () => {
      const collections: CollectionData[] = [
        { collectionSymbol: 'col1', tokenReceiveAddress: 'addr1' } as CollectionData,
        { collectionSymbol: 'col2', tokenReceiveAddress: 'addr1' } as CollectionData, // Same
        { collectionSymbol: 'col3', tokenReceiveAddress: 'addr2' } as CollectionData,
      ];

      const addresses = getUniqueReceiveAddresses(collections, 'default');

      expect(addresses).toHaveLength(2);
      expect(addresses).toContain('addr1');
      expect(addresses).toContain('addr2');
    });

    it('should use default address when not specified', () => {
      const collections: CollectionData[] = [
        { collectionSymbol: 'col1' } as CollectionData,
      ];

      const addresses = getUniqueReceiveAddresses(collections, 'defaultAddr');

      expect(addresses).toContain('defaultaddr');
    });
  });

  // ============================================================================
  // Offer Validation Tests
  // ============================================================================
  describe('hasValidOffers', () => {
    it('should return true for valid offers data', () => {
      expect(hasValidOffers({ offers: [{}], total: 1 })).toBe(true);
    });

    it('should return false for null/undefined', () => {
      expect(hasValidOffers(null)).toBe(false);
      expect(hasValidOffers(undefined)).toBe(false);
    });

    it('should return false for empty offers array', () => {
      expect(hasValidOffers({ offers: [] })).toBe(false);
    });

    it('should return false for non-array offers', () => {
      expect(hasValidOffers({ offers: 'not an array' } as any)).toBe(false);
    });
  });

  describe('getOfferLogInfo', () => {
    it('should extract log info from offer', () => {
      const offer = createMockOffer({
        token: { id: 'token123', collectionSymbol: 'myCollection' } as any,
        price: 500000,
        buyerPaymentAddress: 'paymentAddr',
      });

      const info = getOfferLogInfo(offer);

      expect(info.collectionSymbol).toBe('myCollection');
      expect(info.tokenId).toBe('token123');
      expect(info.price).toBe(500000);
      expect(info.paymentAddress).toBe('paymentAddr');
    });

    it('should handle missing token info', () => {
      const offer = createMockOffer({
        tokenId: 'fallbackId',
        token: undefined as any,
      });

      const info = getOfferLogInfo(offer);

      expect(info.collectionSymbol).toBe('unknown');
      expect(info.tokenId).toBe('fallbackId');
    });
  });

  describe('formatAddressForLog', () => {
    it('should truncate long addresses', () => {
      const formatted = formatAddressForLog('bc1qxyz1234567890abcdef', 10);
      expect(formatted).toBe('bc1qxyz123...');
    });

    it('should not truncate short addresses', () => {
      const formatted = formatAddressForLog('short', 10);
      expect(formatted).toBe('short');
    });
  });

  // ============================================================================
  // Cancel Operation Helpers Tests
  // ============================================================================
  describe('prepareCancelOperations', () => {
    it('should prepare cancel operations with default key', () => {
      const offers: IOffer[] = [
        createMockOffer({
          id: 'offer1',
          token: { id: 'tok1', collectionSymbol: 'col1' } as any,
          buyerPaymentAddress: 'addr1',
        }),
      ];

      const ops = prepareCancelOperations(offers, 'defaultKey');

      expect(ops).toHaveLength(1);
      expect(ops[0].offerId).toBe('offer1');
      expect(ops[0].privateKey).toBe('defaultKey');
      expect(ops[0].collectionSymbol).toBe('col1');
    });

    it('should use wallet key when available', () => {
      const offers: IOffer[] = [
        createMockOffer({ buyerPaymentAddress: 'walletAddr' }),
      ];

      const getWalletKey = (addr: string) =>
        addr === 'walletAddr' ? 'walletKey' : null;

      const ops = prepareCancelOperations(offers, 'defaultKey', getWalletKey);

      expect(ops[0].privateKey).toBe('walletKey');
    });

    it('should fall back to default key when wallet key not found', () => {
      const offers: IOffer[] = [
        createMockOffer({ buyerPaymentAddress: 'unknownAddr' }),
      ];

      const getWalletKey = () => null;

      const ops = prepareCancelOperations(offers, 'defaultKey', getWalletKey);

      expect(ops[0].privateKey).toBe('defaultKey');
    });
  });

  describe('countSettledResults', () => {
    it('should count fulfilled and rejected results', () => {
      const results: PromiseSettledResult<any>[] = [
        { status: 'fulfilled', value: 'ok' },
        { status: 'fulfilled', value: 'ok' },
        { status: 'rejected', reason: 'error' },
      ];

      const counts = countSettledResults(results);

      expect(counts.successful).toBe(2);
      expect(counts.failed).toBe(1);
    });

    it('should handle empty results', () => {
      const counts = countSettledResults([]);
      expect(counts.successful).toBe(0);
      expect(counts.failed).toBe(0);
    });
  });

  describe('getFailedResults', () => {
    it('should extract only rejected results', () => {
      const results: PromiseSettledResult<any>[] = [
        { status: 'fulfilled', value: 'ok' },
        { status: 'rejected', reason: 'error1' },
        { status: 'rejected', reason: 'error2' },
      ];

      const failed = getFailedResults(results);

      expect(failed).toHaveLength(2);
      expect(failed[0].reason).toBe('error1');
      expect(failed[1].reason).toBe('error2');
    });

    it('should return empty array when no failures', () => {
      const results: PromiseSettledResult<any>[] = [
        { status: 'fulfilled', value: 'ok' },
      ];

      const failed = getFailedResults(results);
      expect(failed).toHaveLength(0);
    });
  });
});
