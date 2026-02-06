import {
  searchCollections,
  fetchCollectionInfo,
  addCollection,
  createDefaultConfig,
  validateCollection,
  CollectionConfig,
} from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showCollectionSummary,
  formatBTC,
  withSpinner,
} from '../../utils/display';
import {
  promptText,
  promptBTC,
  promptFloorPercentage,
  promptInteger,
  promptConfirm,
  promptSelect,
} from '../../utils/prompts';

export async function addCollectionCommand(): Promise<void> {
  showSectionHeader('ADD COLLECTION');

  // Get collection symbol or search
  const query = await promptText('Enter collection symbol or search term (empty to cancel):');

  if (!query.trim()) {
    return;
  }

  // Search Magic Eden
  console.log('');
  console.log('Searching Magic Eden...');

  const searchResults = await withSpinner(
    'Searching...',
    () => searchCollections(query)
  );

  let selectedSymbol: string;
  let floorPrice = 0;

  if (searchResults.length > 0) {
    const choices = searchResults.map(r => ({
      name: `${r.name} (Floor: ${formatBTC(r.floorPrice)})`,
      value: r.symbol,
    }));

    choices.push({ name: '[Enter custom symbol]', value: '__custom__' });
    choices.push({ name: '← Back', value: '__cancel__' });

    const selected = await promptSelect<string>(
      'Select collection:',
      choices
    );

    if (selected === '__cancel__') {
      return;
    }

    if (selected === '__custom__') {
      selectedSymbol = await promptText('Enter collection symbol:');
    } else {
      selectedSymbol = selected;
      const match = searchResults.find(r => r.symbol === selected);
      if (match) {
        floorPrice = match.floorPrice;
      }
    }
  } else {
    showWarning('No collections found matching that query');
    const useCustom = await promptConfirm('Enter symbol manually?', true);

    if (!useCustom) {
      return;
    }

    selectedSymbol = await promptText('Enter collection symbol:');
  }

  // Fetch collection info if we don't have floor price
  if (floorPrice === 0) {
    console.log('');
    console.log('Fetching collection info...');

    const info = await fetchCollectionInfo(selectedSymbol);
    if (info) {
      floorPrice = info.floorPrice;
      console.log(`  Name: ${info.name}`);
      console.log(`  Floor: ${formatBTC(floorPrice)}`);
      if (info.listedCount) {
        console.log(`  Listed: ${info.listedCount}`);
      }
    }
  }

  // Get configuration
  console.log('');
  console.log('Configure bidding parameters:');
  console.log('');

  const minBid = await promptBTC(
    'Minimum bid (BTC):',
    0.0001
  );

  const maxBid = await promptBTC(
    'Maximum bid (BTC):',
    floorPrice > 0 ? Math.floor(floorPrice * 0.95) / 1e8 : 0.01
  );

  const minFloorBid = await promptFloorPercentage(
    'Minimum floor % (e.g., 50):',
    50
  );

  const maxFloorBid = await promptFloorPercentage(
    'Maximum floor % (e.g., 95):',
    95
  );

  const bidCount = await promptInteger(
    'Number of items to bid on:',
    20
  );

  const duration = await promptInteger(
    'Offer duration (minutes):',
    60
  );

  const enableCounterBidding = await promptConfirm(
    'Enable counter-bidding?',
    true
  );

  const offerType = await promptSelect<'ITEM' | 'COLLECTION' | '__cancel__'>(
    'Offer type:',
    [
      { name: 'ITEM (bid on individual items)', value: 'ITEM' },
      { name: 'COLLECTION (collection-wide offer)', value: 'COLLECTION' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (offerType === '__cancel__') {
    return;
  }

  const quantity = await promptInteger(
    'Max items to win:',
    1
  );

  // Build config
  const config: CollectionConfig = {
    collectionSymbol: selectedSymbol,
    minBid,
    maxBid,
    minFloorBid,
    maxFloorBid,
    bidCount,
    duration,
    scheduledLoop: 60,
    enableCounterBidding,
    outBidMargin: 0.00001,
    offerType,
    quantity,
    feeSatsPerVbyte: 28,
  };

  // Validate
  const errors = validateCollection(config);
  if (errors.length > 0) {
    showError('Invalid configuration:');
    errors.forEach(e => console.log(`  • ${e}`));
    return;
  }

  // Show summary
  showCollectionSummary({
    symbol: config.collectionSymbol,
    floorPrice,
    minBid: config.minBid,
    maxBid: config.maxBid,
    minFloorBid: config.minFloorBid,
    maxFloorBid: config.maxFloorBid,
    bidCount: config.bidCount,
    duration: config.duration,
    enableCounterBidding: config.enableCounterBidding,
    offerType: config.offerType,
    quantity: config.quantity,
  });

  // Confirm
  const confirm = await promptConfirm('Confirm and add collection?', true);

  if (!confirm) {
    showWarning('Collection not added');
    return;
  }

  // Save
  addCollection(config);
  showSuccess(`Collection "${selectedSymbol}" added to config!`);
  console.log('');
  console.log('The bot will start bidding on this collection on the next cycle.');
  console.log('Use "Restart bot" to apply changes immediately.');
  console.log('');
}
