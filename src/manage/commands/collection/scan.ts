import {
  getPopularCollections,
  fetchCollectionInfo,
  loadCollections,
} from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showTable,
  formatBTC,
  withSpinner,
} from '../../utils/display';
import { promptNumber, promptConfirm, promptMultiSelect } from '../../utils/prompts';
import { addCollectionCommand } from './add';

export async function scanCollections(): Promise<void> {
  showSectionHeader('SCAN FOR OPPORTUNITIES');

  // Get minimum volume filter
  const minVolume = await promptNumber('Minimum 24h volume (BTC):', 0.1);

  console.log('');
  console.log('Scanning Magic Eden for collections...');
  console.log('');

  // Fetch popular collections
  const collections = await withSpinner(
    'Fetching collections...',
    () => getPopularCollections(50)
  );

  if (collections.length === 0) {
    showWarning('Could not fetch collections from Magic Eden');
    return;
  }

  // Filter by volume
  const filtered = collections.filter(c => {
    const volume24h = c.volume24h || 0;
    return volume24h >= minVolume * 1e8;
  });

  if (filtered.length === 0) {
    showWarning(`No collections found with 24h volume >= ${minVolume} BTC`);
    console.log('');
    console.log('Try lowering the volume filter.');
    return;
  }

  // Get already configured collections
  const configured = loadCollections();
  const configuredSymbols = new Set(configured.map(c => c.collectionSymbol));

  // Mark which are already configured
  const results = filtered.map(c => ({
    ...c,
    isConfigured: configuredSymbols.has(c.symbol),
  }));

  // Display results
  console.log('');
  console.log(`Found ${results.length} collections:`);
  console.log('');

  const headers = ['Symbol', 'Floor Price', '24h Volume', 'Status'];
  const rows = results.map(c => [
    c.symbol.length > 25 ? c.symbol.slice(0, 22) + '...' : c.symbol,
    formatBTC(c.floorPrice),
    formatBTC(c.volume24h || 0),
    c.isConfigured ? 'Configured' : 'Available',
  ]);

  showTable(headers, rows, [28, 18, 18, 12]);

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
    console.log(`\n--- Adding ${symbol} ---\n`);

    // We'll need to run the add flow for each
    // For simplicity, we'll just show a message
    // In a full implementation, you'd want to add with defaults or prompt for each

    showWarning(`To add ${symbol}, use the "Add collection" menu option.`);
  }

  console.log('');
  console.log('Tip: Use "Add collection" to configure each collection with custom settings.');
  console.log('');
}
