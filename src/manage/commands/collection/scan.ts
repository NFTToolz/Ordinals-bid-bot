import {
  getPopularCollections,
  loadCollections,
  createDefaultConfig,
  addCollection,
  CollectionSearchResult,
} from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showError,
  showInfo,
  showTable,
  formatBTC,
  withSpinner,
} from '../../utils/display';
import { promptNumber, promptConfirm, promptMultiSelect } from '../../utils/prompts';
import { getBestCollectionOffer, getBestOffer } from '../../../functions/Offer';
import { retrieveTokens } from '../../../functions/Tokens';

export async function scanCollections(): Promise<void> {
  showSectionHeader('SCAN FOR OPPORTUNITIES');

  // Get minimum volume filter
  const minVolume = await promptNumber('Minimum 24h volume in BTC (0 to cancel):', 0.1);

  if (minVolume <= 0) {
    return;
  }

  console.log('');

  // Fetch with retry
  let collections: CollectionSearchResult[] = [];
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const label = attempt === 1
        ? 'Fetching top 50 collections by volume...'
        : `Retrying... (attempt ${attempt}/${maxAttempts})`;

      collections = await withSpinner(label, () => getPopularCollections(50, 15000));
      break;
    } catch (error: any) {
      if (attempt < maxAttempts) {
        showWarning('Request timed out, retrying...');
      } else {
        console.log('');
        showError('Could not reach Magic Eden API');
        console.log('');
        console.log('  Possible causes:');
        console.log('  - API proxy may be temporarily down');
        console.log('  - Network connectivity issue');
        console.log('  - API key may be invalid');
        console.log('');
        console.log('  Try again in a few minutes, or check API_KEY in .env');
        return;
      }
    }
  }

  if (collections.length === 0) {
    showWarning('No collections returned from Magic Eden');
    return;
  }

  showSuccess(`Fetched ${collections.length} collections`);

  // Filter by volume
  const filtered = collections.filter(c => (c.volume24h || 0) >= minVolume * 1e8);

  if (filtered.length === 0) {
    showWarning(`No collections with 24h volume >= ${minVolume} BTC`);
    console.log('');
    console.log('Try lowering the volume filter.');
    return;
  }

  // Check config status
  const configured = loadCollections();
  const configuredSymbols = new Set(configured.map(c => c.collectionSymbol));
  const results = filtered.map(c => ({
    ...c,
    isConfigured: configuredSymbols.has(c.symbol),
  }));

  const configuredCount = results.filter(r => r.isConfigured).length;
  const newCount = results.length - configuredCount;
  showSuccess(`${results.length} match volume filter (${configuredCount} configured, ${newCount} new)`);
  console.log('');

  const headers = ['Symbol', 'Floor Price', '24h Volume', 'Status'];
  const rows = results.map(c => [
    c.symbol.length > 25 ? c.symbol.slice(0, 22) + '...' : c.symbol,
    formatBTC(c.floorPrice),
    formatBTC(c.volume24h || 0),
    c.isConfigured ? 'Configured' : 'Available',
  ]);

  showTable(headers, rows, [28, 18, 18, 12]);

  // Ask user if they want detailed bid opportunity analysis
  console.log('');
  const fetchOpportunities = await promptConfirm(
    `Fetch detailed bid opportunities for ${results.length} collections?`,
    true
  );

  if (fetchOpportunities) {
    console.log('');
    const opportunities = await fetchBidOpportunities(results);

    if (opportunities.length > 0) {
      // Sort by spread % descending (biggest opportunity first), nulls last
      opportunities.sort((a, b) => {
        if (a.spreadPct === null && b.spreadPct === null) return 0;
        if (a.spreadPct === null) return 1;
        if (b.spreadPct === null) return -1;
        return b.spreadPct - a.spreadPct;
      });

      console.log('');
      const oppHeaders = ['Collection', 'Floor', 'Best Offer', 'Spread', 'Spread %', 'Listed', 'No Offer %'];
      const oppRows = opportunities.map(o => [
        o.symbol.length > 20 ? o.symbol.slice(0, 17) + '...' : o.symbol,
        formatBTC(o.floorPrice),
        o.bestOffer !== null ? formatBTC(o.bestOffer) : 'None',
        o.spread !== null ? formatBTC(o.spread) : '\u2014',
        o.spreadPct !== null ? o.spreadPct.toFixed(1) + '%' : '\u2014',
        o.listedCount >= 100 ? '100+' : String(o.listedCount),
        o.noOfferPct !== null ? o.noOfferPct.toFixed(0) + '%' : '\u2014',
      ]);

      showTable(oppHeaders, oppRows, [20, 18, 18, 18, 10, 8, 12]);
    }
  }

  // Check for new opportunities
  const newCollections = results.filter(c => !c.isConfigured);

  if (newCollections.length === 0) {
    console.log('');
    showSuccess('All matching collections are already configured!');
    return;
  }

  console.log('');
  console.log(`${newCollections.length} collection(s) not yet configured.`);

  // Ask if user wants to add any
  const addSome = await promptConfirm('Would you like to add any to your config?', true);

  if (!addSome) {
    return;
  }

  // Let user select which to add
  const choices = newCollections.map(c => ({
    name: `${c.symbol} (Floor: ${formatBTC(c.floorPrice)}, Vol: ${formatBTC(c.volume24h || 0)})`,
    value: c.symbol,
  }));

  const selected = await promptMultiSelect<string>(
    'Select collections to add:',
    choices as any
  );

  if (selected.length === 0) {
    showWarning('No collections selected');
    return;
  }

  // Add each selected collection
  console.log('');
  console.log(`Adding ${selected.length} collection(s)...`);
  console.log('');

  for (const symbol of selected) {
    const scanResult = filtered.find(c => c.symbol === symbol);
    const config = createDefaultConfig(symbol, scanResult?.floorPrice || 0);
    addCollection(config);
    showSuccess(`Added ${symbol}`);
  }

  console.log('');
  showSuccess(`${selected.length} collection(s) added with default settings`);
  console.log('');
  console.log('Tip: Use "Edit collection" to fine-tune bid parameters.');
}

interface OpportunityData {
  symbol: string;
  floorPrice: number;
  bestOffer: number | null;
  spread: number | null;
  spreadPct: number | null;
  listedCount: number;
  noOfferPct: number | null;
}

async function fetchBidOpportunities(
  collections: Array<CollectionSearchResult & { isConfigured: boolean }>
): Promise<OpportunityData[]> {
  const results: OpportunityData[] = [];
  let completed = 0;

  await withSpinner(`Analyzing ${collections.length} collections...`, async () => {
    const promises = collections.map(async (c) => {
      try {
        const [offerData, tokens] = await Promise.all([
          getBestCollectionOffer(c.symbol).catch(() => null),
          retrieveTokens(c.symbol, 100).catch(() => []),
        ]);

        const floorPrice = c.floorPrice;
        const bestOffer = offerData?.offers?.[0]?.price?.amount ?? null;
        const listedCount = tokens.length;

        let spread: number | null = null;
        let spreadPct: number | null = null;

        if (bestOffer !== null && floorPrice > 0) {
          spread = floorPrice - bestOffer;
          spreadPct = (spread / floorPrice) * 100;
        }

        // Sample up to 10 cheapest tokens for item-level offer coverage
        const sample = tokens.slice(0, 10);
        let noOfferPct: number | null = null;
        if (sample.length > 0) {
          const offerChecks = await Promise.all(
            sample.map(t => getBestOffer(t.id).catch(() => null))
          );
          const noOfferCount = offerChecks.filter(
            r => r === null || r.offers.length === 0
          ).length;
          noOfferPct = (noOfferCount / sample.length) * 100;
        }

        results.push({ symbol: c.symbol, floorPrice, bestOffer, spread, spreadPct, listedCount, noOfferPct });
      } catch {
        results.push({
          symbol: c.symbol,
          floorPrice: c.floorPrice,
          bestOffer: null,
          spread: null,
          spreadPct: null,
          listedCount: 0,
          noOfferPct: null,
        });
      }
      completed++;
    });

    await Promise.all(promises);
  });

  showSuccess(`Analyzed ${results.length} collections`);
  const withOffers = results.filter(r => r.bestOffer !== null).length;
  showInfo(`${withOffers} have active collection offers, ${results.length - withOffers} have none`);

  return results;
}
