/**
 * Pure functions for collection scanning logic
 * Extracted from scanCollections.ts for testability
 */

export interface TokenOffer {
  tokenId: string;
  highestOffer: number;
}

export interface CollectionScanResult {
  name: string;
  collectionSymbol: string;
  image: string;
  averageOffer: number;
  floorPrice: number;
  listedMakerFeeBp: number;
  scannedTokens: number;
  percentageOfTokensWithOffers: number;
  riskOrReward: number;
  potentialProfit: number;
  tokensWithNoOffers: number;
  tokensWithOffers: number;
  offers: number[];
}

export interface ScannedToken {
  id: string;
  listedMakerFeeBp?: number;
}

export interface TokenOfferData {
  offers?: Array<{ price: number }>;
}

/**
 * Categorize tokens into those with and without offers
 */
export function categorizeTokensByOffers(
  tokens: Array<{ tokenId: string; highestOffer: number }>
): { withOffers: TokenOffer[]; withoutOffers: TokenOffer[] } {
  const withOffers: TokenOffer[] = [];
  const withoutOffers: TokenOffer[] = [];

  for (const token of tokens) {
    if (token.highestOffer === 0) {
      withoutOffers.push(token);
    } else {
      withOffers.push(token);
    }
  }

  return { withOffers, withoutOffers };
}

/**
 * Calculate the highest offer for a token from offer data
 * Converts from sats to BTC
 */
export function extractHighestOffer(offerData: TokenOfferData | null | undefined): number {
  if (!offerData?.offers?.[0]?.price) {
    return 0;
  }
  return offerData.offers[0].price * 0.00000001;
}

/**
 * Calculate average offer price from a list of offers
 * Returns 0 if no offers or calculation results in NaN
 */
export function calculateAverageOffer(offers: number[]): number {
  if (offers.length === 0) {
    return 0;
  }

  const total = offers.reduce((acc, curr) => acc + curr, 0);
  const average = total / offers.length;

  if (isNaN(average)) {
    return 0;
  }

  return Number(average.toFixed(6));
}

/**
 * Calculate the maker fee as a decimal
 * @param listedMakerFeeBp - Fee in basis points (1 bp = 0.01%)
 * @returns Fee as a decimal (e.g., 0.02 for 2%)
 */
export function calculateMakerFee(listedMakerFeeBp: number | undefined): number {
  if (!listedMakerFeeBp) {
    return 0;
  }
  return listedMakerFeeBp / 100 / 100;
}

/**
 * Calculate potential profit from a trade
 * Profit = floor price - average offer - maker fee on the offer
 * @returns Potential profit in BTC, or 0 if calculation results in NaN
 */
export function calculatePotentialProfit(
  floorPrice: number,
  averageOffer: number,
  makerFee: number
): number {
  const profit = floorPrice - averageOffer - (averageOffer * makerFee);

  if (isNaN(profit)) {
    return 0;
  }

  return Number(profit.toFixed(6));
}

/**
 * Calculate risk/reward ratio
 * Risk = cost (average offer + maker fee)
 * Reward = potential profit
 * Ratio = risk / reward
 * @returns Risk/reward ratio, or 0 if calculation results in NaN
 */
export function calculateRiskReward(
  averageOffer: number,
  makerFee: number,
  potentialProfit: number
): number {
  if (potentialProfit === 0) {
    return 0;
  }

  const cost = averageOffer + (averageOffer * makerFee);
  const ratio = cost / potentialProfit;

  if (isNaN(ratio) || !isFinite(ratio)) {
    return 0;
  }

  return ratio;
}

/**
 * Calculate percentage of tokens that have offers
 */
export function calculateOfferPercentage(
  tokensWithOffers: number,
  totalTokens: number
): number {
  if (totalTokens === 0) {
    return 0;
  }
  return (tokensWithOffers / totalTokens) * 100;
}

/**
 * Build the complete collection scan result
 */
export function buildCollectionScanResult(params: {
  name: string;
  collectionSymbol: string;
  image: string;
  floorPrice: number;
  listedMakerFeeBp: number;
  scannedTokens: number;
  tokensWithOffers: TokenOffer[];
  tokensWithNoOffers: TokenOffer[];
}): CollectionScanResult {
  const offers = params.tokensWithOffers.map(t => t.highestOffer);
  const averageOffer = calculateAverageOffer(offers);
  const makerFee = calculateMakerFee(params.listedMakerFeeBp);
  const potentialProfit = calculatePotentialProfit(params.floorPrice, averageOffer, makerFee);
  const percentageOfTokensWithOffers = calculateOfferPercentage(
    params.tokensWithOffers.length,
    params.scannedTokens
  );
  const riskOrReward = calculateRiskReward(averageOffer, makerFee, potentialProfit);

  return {
    name: params.name,
    collectionSymbol: params.collectionSymbol,
    image: params.image,
    averageOffer,
    floorPrice: params.floorPrice,
    listedMakerFeeBp: params.listedMakerFeeBp,
    scannedTokens: params.scannedTokens,
    percentageOfTokensWithOffers,
    riskOrReward,
    potentialProfit,
    tokensWithNoOffers: params.tokensWithNoOffers.length,
    tokensWithOffers: params.tokensWithOffers.length,
    offers,
  };
}

/**
 * Extract the listed maker fee from a list of tokens
 * Uses the first non-zero value found
 */
export function extractListedMakerFee(tokens: ScannedToken[]): number {
  for (const token of tokens) {
    if (token.listedMakerFeeBp) {
      return token.listedMakerFeeBp;
    }
  }
  return 0;
}

/**
 * Validate collection data for scanning
 */
export function isValidCollectionForScan(collection: {
  collectionSymbol?: string;
  name?: string;
  fp?: number;
}): boolean {
  return !!(collection.collectionSymbol && collection.name);
}

/**
 * Format collection data for JSON export
 */
export function formatCollectionForExport(result: CollectionScanResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Parse token ID from token object safely
 */
export function parseTokenId(token: ScannedToken | null | undefined): string | null {
  if (!token?.id) {
    return null;
  }
  return token.id;
}

/**
 * Summarize scan statistics
 */
export interface ScanSummary {
  totalCollections: number;
  totalTokensScanned: number;
  averageOfferPercentage: number;
  averagePotentialProfit: number;
}

export function summarizeScanResults(results: CollectionScanResult[]): ScanSummary {
  if (results.length === 0) {
    return {
      totalCollections: 0,
      totalTokensScanned: 0,
      averageOfferPercentage: 0,
      averagePotentialProfit: 0,
    };
  }

  const totalTokensScanned = results.reduce((acc, r) => acc + r.scannedTokens, 0);
  const avgOfferPercentage = results.reduce((acc, r) => acc + r.percentageOfTokensWithOffers, 0) / results.length;
  const avgProfit = results.reduce((acc, r) => acc + r.potentialProfit, 0) / results.length;

  return {
    totalCollections: results.length,
    totalTokensScanned,
    averageOfferPercentage: Number(avgOfferPercentage.toFixed(2)),
    averagePotentialProfit: Number(avgProfit.toFixed(6)),
  };
}

/**
 * Filter collections by minimum potential profit
 */
export function filterByMinProfit(
  results: CollectionScanResult[],
  minProfit: number
): CollectionScanResult[] {
  return results.filter(r => r.potentialProfit >= minProfit);
}

/**
 * Filter collections by minimum offer coverage percentage
 */
export function filterByMinOfferCoverage(
  results: CollectionScanResult[],
  minPercentage: number
): CollectionScanResult[] {
  return results.filter(r => r.percentageOfTokensWithOffers >= minPercentage);
}

/**
 * Sort collections by potential profit (descending)
 */
export function sortByPotentialProfit(results: CollectionScanResult[]): CollectionScanResult[] {
  return [...results].sort((a, b) => b.potentialProfit - a.potentialProfit);
}

/**
 * Sort collections by risk/reward ratio (ascending - lower is better)
 */
export function sortByRiskReward(results: CollectionScanResult[]): CollectionScanResult[] {
  return [...results].sort((a, b) => a.riskOrReward - b.riskOrReward);
}

/**
 * Check if a collection is worth scanning based on floor price
 */
export function isWorthScanning(
  floorPrice: number,
  minFloorPrice: number = 0,
  maxFloorPrice: number = Infinity
): boolean {
  return floorPrice >= minFloorPrice && floorPrice <= maxFloorPrice;
}

/**
 * Calculate total investment needed to buy all tokens with offers
 */
export function calculateTotalInvestment(tokensWithOffers: TokenOffer[]): number {
  return tokensWithOffers.reduce((acc, t) => acc + t.highestOffer, 0);
}

/**
 * Calculate maximum potential return if all tokens sold at floor
 */
export function calculateMaxReturn(
  tokensCount: number,
  floorPrice: number,
  makerFee: number
): number {
  const grossReturn = tokensCount * floorPrice;
  const fees = grossReturn * makerFee;
  return grossReturn - fees;
}
