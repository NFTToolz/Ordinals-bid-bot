import { loadCollections, fetchCollectionInfo } from '../../services/CollectionService';
import {
  showSectionHeader,
  showWarning,
  formatBTC,
  withSpinner,
  getSeparatorWidth,
} from '../../utils/display';
import { TableColumn, TableData } from '../../utils/table';
import { showInteractiveTable } from '../../utils/interactiveTable';

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
  const floorPrices = new Map<string, number>();

  await withSpinner('Fetching floor prices...', async () => {
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
  });

  console.log('');

  // Build table data for interactive display
  const columns: TableColumn[] = [
    { key: 'symbol', label: 'Symbol', width: 24 },
    { key: 'minBid', label: 'Min Bid', width: 14, align: 'right' },
    { key: 'maxBid', label: 'Max Bid', width: 14, align: 'right' },
    { key: 'floorRange', label: 'Floor %', width: 12 },
    { key: 'bidCount', label: 'Bid Count', width: 10, align: 'right' },
    { key: 'type', label: 'Type', width: 12 },
    { key: 'counterBid', label: 'Counter-Bid', width: 12 },
    { key: 'floor', label: 'Floor Price', width: 18, align: 'right' },
    { key: 'floorSats', label: 'Floor Sats', width: 14, align: 'right' },
  ];

  const rows = collections.map(c => {
    const floorPrice = floorPrices.get(c.collectionSymbol);

    return {
      symbol: c.collectionSymbol.length > 22 ? c.collectionSymbol.slice(0, 19) + '...' : c.collectionSymbol,
      fullSymbol: c.collectionSymbol,
      minBid: `${c.minBid} BTC`,
      minBidValue: c.minBid,
      maxBid: `${c.maxBid} BTC`,
      maxBidValue: c.maxBid,
      floorRange: `${c.minFloorBid}-${c.maxFloorBid}%`,
      bidCount: c.bidCount,
      type: c.offerType,
      counterBid: c.enableCounterBidding ? 'Yes' : 'No',
      floor: floorPrice ? formatBTC(floorPrice) : '-',
      floorSats: floorPrice || 0,
      walletGroup: c.walletGroup || 'default',
    };
  });

  const tableData: TableData = { columns, rows };

  // Show summary
  const totalBidCount = collections.reduce((sum, c) => sum + c.bidCount, 0);
  const collectionsWithFloor = collections.filter(c => floorPrices.has(c.collectionSymbol));
  const avgFloor = collectionsWithFloor.length > 0
    ? collectionsWithFloor.reduce((sum, c) => sum + (floorPrices.get(c.collectionSymbol) || 0), 0) / collectionsWithFloor.length
    : 0;

  console.log('━'.repeat(getSeparatorWidth()));
  console.log(`  Collections:        ${collections.length}`);
  console.log(`  Total Bid Slots:    ${totalBidCount}`);
  if (avgFloor > 0) {
    console.log(`  Avg Floor Price:    ${formatBTC(avgFloor)}`);
  }
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('');

  // Show interactive table
  await showInteractiveTable(tableData, {
    title: 'COLLECTION CONFIGURATION',
    pageSize: 15,
    allowSort: true,
    allowExport: true,
    exportBaseName: 'collections',
  });
}
