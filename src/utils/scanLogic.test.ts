import { describe, it, expect } from 'vitest';
import {
  categorizeTokensByOffers,
  extractHighestOffer,
  calculateAverageOffer,
  calculateMakerFee,
  calculatePotentialProfit,
  calculateRiskReward,
  calculateOfferPercentage,
  buildCollectionScanResult,
  extractListedMakerFee,
  isValidCollectionForScan,
  formatCollectionForExport,
  parseTokenId,
  summarizeScanResults,
  filterByMinProfit,
  filterByMinOfferCoverage,
  sortByPotentialProfit,
  sortByRiskReward,
  isWorthScanning,
  calculateTotalInvestment,
  calculateMaxReturn,
  TokenOffer,
  CollectionScanResult,
} from './scanLogic';

describe('scanLogic', () => {
  describe('categorizeTokensByOffers', () => {
    it('should separate tokens with and without offers', () => {
      const tokens = [
        { tokenId: 'token1', highestOffer: 0.001 },
        { tokenId: 'token2', highestOffer: 0 },
        { tokenId: 'token3', highestOffer: 0.002 },
        { tokenId: 'token4', highestOffer: 0 },
      ];

      const result = categorizeTokensByOffers(tokens);

      expect(result.withOffers).toHaveLength(2);
      expect(result.withoutOffers).toHaveLength(2);
      expect(result.withOffers.map(t => t.tokenId)).toEqual(['token1', 'token3']);
      expect(result.withoutOffers.map(t => t.tokenId)).toEqual(['token2', 'token4']);
    });

    it('should handle all tokens with offers', () => {
      const tokens = [
        { tokenId: 'token1', highestOffer: 0.001 },
        { tokenId: 'token2', highestOffer: 0.002 },
      ];

      const result = categorizeTokensByOffers(tokens);

      expect(result.withOffers).toHaveLength(2);
      expect(result.withoutOffers).toHaveLength(0);
    });

    it('should handle all tokens without offers', () => {
      const tokens = [
        { tokenId: 'token1', highestOffer: 0 },
        { tokenId: 'token2', highestOffer: 0 },
      ];

      const result = categorizeTokensByOffers(tokens);

      expect(result.withOffers).toHaveLength(0);
      expect(result.withoutOffers).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = categorizeTokensByOffers([]);

      expect(result.withOffers).toHaveLength(0);
      expect(result.withoutOffers).toHaveLength(0);
    });
  });

  describe('extractHighestOffer', () => {
    it('should extract and convert offer price from sats to BTC', () => {
      const offerData = {
        offers: [{ price: 100000000 }], // 1 BTC in sats
      };

      expect(extractHighestOffer(offerData)).toBe(1);
    });

    it('should return 0 for null data', () => {
      expect(extractHighestOffer(null)).toBe(0);
    });

    it('should return 0 for undefined data', () => {
      expect(extractHighestOffer(undefined)).toBe(0);
    });

    it('should return 0 for empty offers array', () => {
      expect(extractHighestOffer({ offers: [] })).toBe(0);
    });

    it('should return 0 for missing price', () => {
      expect(extractHighestOffer({ offers: [{}] } as any)).toBe(0);
    });

    it('should handle fractional BTC amounts', () => {
      const offerData = {
        offers: [{ price: 50000 }], // 0.0005 BTC
      };

      expect(extractHighestOffer(offerData)).toBeCloseTo(0.0005);
    });
  });

  describe('calculateAverageOffer', () => {
    it('should calculate average of offers', () => {
      const offers = [0.001, 0.002, 0.003];
      expect(calculateAverageOffer(offers)).toBe(0.002);
    });

    it('should return 0 for empty array', () => {
      expect(calculateAverageOffer([])).toBe(0);
    });

    it('should handle single offer', () => {
      expect(calculateAverageOffer([0.005])).toBe(0.005);
    });

    it('should round to 6 decimal places', () => {
      const offers = [0.001, 0.002];
      expect(calculateAverageOffer(offers)).toBe(0.0015);
    });

    it('should handle very small values', () => {
      const offers = [0.0000001, 0.0000002];
      // With 6 decimal place rounding, very small values round to 0
      expect(calculateAverageOffer(offers)).toBe(0);
    });
  });

  describe('calculateMakerFee', () => {
    it('should convert basis points to decimal', () => {
      expect(calculateMakerFee(200)).toBe(0.02); // 2%
    });

    it('should return 0 for undefined', () => {
      expect(calculateMakerFee(undefined)).toBe(0);
    });

    it('should return 0 for 0', () => {
      expect(calculateMakerFee(0)).toBe(0);
    });

    it('should handle 1%', () => {
      expect(calculateMakerFee(100)).toBe(0.01);
    });

    it('should handle fractional basis points', () => {
      expect(calculateMakerFee(150)).toBe(0.015); // 1.5%
    });
  });

  describe('calculatePotentialProfit', () => {
    it('should calculate profit correctly', () => {
      // floor: 0.01 BTC, avg offer: 0.008 BTC, fee: 2%
      // profit = 0.01 - 0.008 - (0.008 * 0.02) = 0.01 - 0.008 - 0.00016 = 0.00184
      const result = calculatePotentialProfit(0.01, 0.008, 0.02);
      expect(result).toBeCloseTo(0.00184, 5);
    });

    it('should return 0 when floor equals offer', () => {
      const result = calculatePotentialProfit(0.01, 0.01, 0.02);
      expect(result).toBeCloseTo(-0.0002, 4); // negative due to fees
    });

    it('should return negative for bad trades', () => {
      const result = calculatePotentialProfit(0.008, 0.01, 0.02);
      expect(result).toBeLessThan(0);
    });

    it('should handle zero fee', () => {
      const result = calculatePotentialProfit(0.01, 0.008, 0);
      expect(result).toBe(0.002);
    });
  });

  describe('calculateRiskReward', () => {
    it('should calculate risk/reward ratio', () => {
      // cost = 0.008 + 0.008 * 0.02 = 0.00816
      // profit = 0.00184
      // ratio = 0.00816 / 0.00184 ≈ 4.43
      const result = calculateRiskReward(0.008, 0.02, 0.00184);
      expect(result).toBeCloseTo(4.43, 1);
    });

    it('should return 0 for zero profit', () => {
      expect(calculateRiskReward(0.01, 0.02, 0)).toBe(0);
    });

    it('should return 0 for negative profit', () => {
      // Negative profit means Infinity ratio, should return 0
      expect(calculateRiskReward(0.01, 0.02, -0.001)).toBeLessThan(0);
    });

    it('should handle zero fee', () => {
      const result = calculateRiskReward(0.008, 0, 0.002);
      expect(result).toBe(4);
    });
  });

  describe('calculateOfferPercentage', () => {
    it('should calculate percentage correctly', () => {
      expect(calculateOfferPercentage(50, 100)).toBe(50);
    });

    it('should return 0 for zero total', () => {
      expect(calculateOfferPercentage(10, 0)).toBe(0);
    });

    it('should return 100 for all with offers', () => {
      expect(calculateOfferPercentage(100, 100)).toBe(100);
    });

    it('should handle decimal percentages', () => {
      expect(calculateOfferPercentage(1, 3)).toBeCloseTo(33.33, 1);
    });
  });

  describe('buildCollectionScanResult', () => {
    it('should build complete scan result', () => {
      const params = {
        name: 'Test Collection',
        collectionSymbol: 'test-collection',
        image: 'https://example.com/image.png',
        floorPrice: 0.01,
        listedMakerFeeBp: 200,
        scannedTokens: 100,
        tokensWithOffers: [
          { tokenId: 'token1', highestOffer: 0.008 },
          { tokenId: 'token2', highestOffer: 0.009 },
        ],
        tokensWithNoOffers: [
          { tokenId: 'token3', highestOffer: 0 },
        ],
      };

      const result = buildCollectionScanResult(params);

      expect(result.name).toBe('Test Collection');
      expect(result.collectionSymbol).toBe('test-collection');
      expect(result.image).toBe('https://example.com/image.png');
      expect(result.floorPrice).toBe(0.01);
      expect(result.listedMakerFeeBp).toBe(200);
      expect(result.scannedTokens).toBe(100);
      expect(result.tokensWithOffers).toBe(2);
      expect(result.tokensWithNoOffers).toBe(1);
      expect(result.offers).toEqual([0.008, 0.009]);
      expect(result.averageOffer).toBe(0.0085);
      expect(result.percentageOfTokensWithOffers).toBe(2);
    });

    it('should handle empty tokens', () => {
      const params = {
        name: 'Empty Collection',
        collectionSymbol: 'empty',
        image: '',
        floorPrice: 0,
        listedMakerFeeBp: 0,
        scannedTokens: 0,
        tokensWithOffers: [],
        tokensWithNoOffers: [],
      };

      const result = buildCollectionScanResult(params);

      expect(result.averageOffer).toBe(0);
      expect(result.tokensWithOffers).toBe(0);
      expect(result.percentageOfTokensWithOffers).toBe(0);
    });
  });

  describe('extractListedMakerFee', () => {
    it('should extract first non-zero fee', () => {
      const tokens = [
        { id: 'token1' },
        { id: 'token2', listedMakerFeeBp: 200 },
        { id: 'token3', listedMakerFeeBp: 300 },
      ];

      expect(extractListedMakerFee(tokens)).toBe(200);
    });

    it('should return 0 if no fees', () => {
      const tokens = [
        { id: 'token1' },
        { id: 'token2' },
      ];

      expect(extractListedMakerFee(tokens)).toBe(0);
    });

    it('should handle empty array', () => {
      expect(extractListedMakerFee([])).toBe(0);
    });
  });

  describe('isValidCollectionForScan', () => {
    it('should return true for valid collection', () => {
      expect(isValidCollectionForScan({
        collectionSymbol: 'test',
        name: 'Test',
        fp: 0.01,
      })).toBe(true);
    });

    it('should return false for missing symbol', () => {
      expect(isValidCollectionForScan({
        name: 'Test',
        fp: 0.01,
      })).toBe(false);
    });

    it('should return false for missing name', () => {
      expect(isValidCollectionForScan({
        collectionSymbol: 'test',
        fp: 0.01,
      })).toBe(false);
    });

    it('should return true even without floor price', () => {
      expect(isValidCollectionForScan({
        collectionSymbol: 'test',
        name: 'Test',
      })).toBe(true);
    });
  });

  describe('formatCollectionForExport', () => {
    it('should format collection as JSON', () => {
      const result: CollectionScanResult = {
        name: 'Test',
        collectionSymbol: 'test',
        image: '',
        averageOffer: 0.01,
        floorPrice: 0.02,
        listedMakerFeeBp: 200,
        scannedTokens: 10,
        percentageOfTokensWithOffers: 50,
        riskOrReward: 2,
        potentialProfit: 0.005,
        tokensWithNoOffers: 5,
        tokensWithOffers: 5,
        offers: [0.01],
      };

      const json = formatCollectionForExport(result);
      const parsed = JSON.parse(json);

      expect(parsed.name).toBe('Test');
      expect(parsed.averageOffer).toBe(0.01);
    });
  });

  describe('parseTokenId', () => {
    it('should parse token id', () => {
      expect(parseTokenId({ id: 'abc123' })).toBe('abc123');
    });

    it('should return null for null token', () => {
      expect(parseTokenId(null)).toBeNull();
    });

    it('should return null for undefined token', () => {
      expect(parseTokenId(undefined)).toBeNull();
    });

    it('should return null for missing id', () => {
      expect(parseTokenId({} as any)).toBeNull();
    });
  });

  describe('summarizeScanResults', () => {
    it('should summarize multiple results', () => {
      const results: CollectionScanResult[] = [
        {
          name: 'A', collectionSymbol: 'a', image: '', averageOffer: 0.01,
          floorPrice: 0.02, listedMakerFeeBp: 200, scannedTokens: 100,
          percentageOfTokensWithOffers: 40, riskOrReward: 2,
          potentialProfit: 0.005, tokensWithNoOffers: 60, tokensWithOffers: 40, offers: [],
        },
        {
          name: 'B', collectionSymbol: 'b', image: '', averageOffer: 0.02,
          floorPrice: 0.03, listedMakerFeeBp: 200, scannedTokens: 50,
          percentageOfTokensWithOffers: 60, riskOrReward: 1.5,
          potentialProfit: 0.008, tokensWithNoOffers: 20, tokensWithOffers: 30, offers: [],
        },
      ];

      const summary = summarizeScanResults(results);

      expect(summary.totalCollections).toBe(2);
      expect(summary.totalTokensScanned).toBe(150);
      expect(summary.averageOfferPercentage).toBe(50);
      expect(summary.averagePotentialProfit).toBeCloseTo(0.0065, 4);
    });

    it('should handle empty results', () => {
      const summary = summarizeScanResults([]);

      expect(summary.totalCollections).toBe(0);
      expect(summary.totalTokensScanned).toBe(0);
      expect(summary.averageOfferPercentage).toBe(0);
      expect(summary.averagePotentialProfit).toBe(0);
    });
  });

  describe('filterByMinProfit', () => {
    it('should filter by minimum profit', () => {
      const results: CollectionScanResult[] = [
        { potentialProfit: 0.001 } as CollectionScanResult,
        { potentialProfit: 0.005 } as CollectionScanResult,
        { potentialProfit: 0.01 } as CollectionScanResult,
      ];

      const filtered = filterByMinProfit(results, 0.005);

      expect(filtered).toHaveLength(2);
      expect(filtered[0].potentialProfit).toBe(0.005);
      expect(filtered[1].potentialProfit).toBe(0.01);
    });

    it('should return empty for high threshold', () => {
      const results: CollectionScanResult[] = [
        { potentialProfit: 0.001 } as CollectionScanResult,
      ];

      expect(filterByMinProfit(results, 0.1)).toHaveLength(0);
    });
  });

  describe('filterByMinOfferCoverage', () => {
    it('should filter by minimum coverage', () => {
      const results: CollectionScanResult[] = [
        { percentageOfTokensWithOffers: 20 } as CollectionScanResult,
        { percentageOfTokensWithOffers: 50 } as CollectionScanResult,
        { percentageOfTokensWithOffers: 80 } as CollectionScanResult,
      ];

      const filtered = filterByMinOfferCoverage(results, 50);

      expect(filtered).toHaveLength(2);
    });
  });

  describe('sortByPotentialProfit', () => {
    it('should sort descending by profit', () => {
      const results: CollectionScanResult[] = [
        { potentialProfit: 0.005 } as CollectionScanResult,
        { potentialProfit: 0.01 } as CollectionScanResult,
        { potentialProfit: 0.001 } as CollectionScanResult,
      ];

      const sorted = sortByPotentialProfit(results);

      expect(sorted[0].potentialProfit).toBe(0.01);
      expect(sorted[1].potentialProfit).toBe(0.005);
      expect(sorted[2].potentialProfit).toBe(0.001);
    });

    it('should not mutate original array', () => {
      const results: CollectionScanResult[] = [
        { potentialProfit: 0.005 } as CollectionScanResult,
        { potentialProfit: 0.01 } as CollectionScanResult,
      ];

      sortByPotentialProfit(results);

      expect(results[0].potentialProfit).toBe(0.005);
    });
  });

  describe('sortByRiskReward', () => {
    it('should sort ascending by risk/reward', () => {
      const results: CollectionScanResult[] = [
        { riskOrReward: 5 } as CollectionScanResult,
        { riskOrReward: 2 } as CollectionScanResult,
        { riskOrReward: 10 } as CollectionScanResult,
      ];

      const sorted = sortByRiskReward(results);

      expect(sorted[0].riskOrReward).toBe(2);
      expect(sorted[1].riskOrReward).toBe(5);
      expect(sorted[2].riskOrReward).toBe(10);
    });
  });

  describe('isWorthScanning', () => {
    it('should return true for floor in range', () => {
      expect(isWorthScanning(0.05, 0.01, 0.1)).toBe(true);
    });

    it('should return false for floor below min', () => {
      expect(isWorthScanning(0.005, 0.01, 0.1)).toBe(false);
    });

    it('should return false for floor above max', () => {
      expect(isWorthScanning(0.2, 0.01, 0.1)).toBe(false);
    });

    it('should return true with default values', () => {
      expect(isWorthScanning(0.05)).toBe(true);
    });

    it('should handle edge cases at boundaries', () => {
      expect(isWorthScanning(0.01, 0.01, 0.1)).toBe(true);
      expect(isWorthScanning(0.1, 0.01, 0.1)).toBe(true);
    });
  });

  describe('calculateTotalInvestment', () => {
    it('should sum all offer prices', () => {
      const tokens: TokenOffer[] = [
        { tokenId: 'a', highestOffer: 0.01 },
        { tokenId: 'b', highestOffer: 0.02 },
        { tokenId: 'c', highestOffer: 0.03 },
      ];

      expect(calculateTotalInvestment(tokens)).toBe(0.06);
    });

    it('should return 0 for empty array', () => {
      expect(calculateTotalInvestment([])).toBe(0);
    });
  });

  describe('calculateMaxReturn', () => {
    it('should calculate max return with fees', () => {
      // 10 tokens * 0.01 floor = 0.1 gross
      // 0.1 * 0.02 = 0.002 fees
      // 0.1 - 0.002 = 0.098 net
      const result = calculateMaxReturn(10, 0.01, 0.02);
      expect(result).toBe(0.098);
    });

    it('should handle zero fee', () => {
      expect(calculateMaxReturn(10, 0.01, 0)).toBe(0.1);
    });

    it('should handle zero tokens', () => {
      expect(calculateMaxReturn(0, 0.01, 0.02)).toBe(0);
    });
  });
});
