import { loadCollections, fetchCollectionInfo, CollectionConfig } from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showError,
  showTable,
  formatBTC,
  withSpinner,
} from '../../utils/display';

export async function listCollections(): Promise<void> {
  showSectionHeader('COLLECTIONS');

  const collections = loadCollections();

  if (collections.length === 0) {
    showWarning('No collections configured');
    console.log('');
    console.log('Use "Add collection" to add a collection to bid on.');
    return;
  }

  console.log(`Found ${collections.length} collection(s):`);
  console.log('');

  // Fetch floor prices
  console.log('Fetching floor prices...');

  const floorPrices = new Map<string, number>();

  for (const collection of collections) {
    try {
      const info = await fetchCollectionInfo(collection.collectionSymbol);
      if (info) {
        floorPrices.set(collection.collectionSymbol, info.floorPrice);
      }
    } catch (error) {
      // Skip
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('');

  const headers = ['Symbol', 'Min Bid', 'Max Bid', 'Floor %', 'Bid Count', 'Type', 'Counter-Bid'];
  const rows: string[][] = collections.map(c => {
    const floorPrice = floorPrices.get(c.collectionSymbol);
    const floorStr = floorPrice ? `${c.minFloorBid}-${c.maxFloorBid}%` : `${c.minFloorBid}-${c.maxFloorBid}%`;

    return [
      c.collectionSymbol.length > 20 ? c.collectionSymbol.slice(0, 17) + '...' : c.collectionSymbol,
      `${c.minBid} BTC`,
      `${c.maxBid} BTC`,
      floorStr,
      c.bidCount.toString(),
      c.offerType,
      c.enableCounterBidding ? 'Yes' : 'No',
    ];
  });

  showTable(headers, rows, [22, 12, 12, 12, 10, 12, 12]);

  // Show floor prices
  if (floorPrices.size > 0) {
    console.log('');
    console.log('Current Floor Prices:');
    collections.forEach(c => {
      const floor = floorPrices.get(c.collectionSymbol);
      if (floor) {
        console.log(`  ${c.collectionSymbol}: ${formatBTC(floor)}`);
      }
    });
  }

  console.log('');
}
