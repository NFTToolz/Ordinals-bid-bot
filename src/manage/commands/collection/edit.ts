import {
  loadCollections,
  updateCollection,
  validateCollection,
  CollectionConfig,
} from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showCollectionSummary,
} from '../../utils/display';
import {
  promptSelect,
  promptBTC,
  promptFloorPercentage,
  promptInteger,
  promptConfirm,
} from '../../utils/prompts';

export async function editCollection(): Promise<void> {
  showSectionHeader('EDIT COLLECTION');

  const collections = loadCollections();

  if (collections.length === 0) {
    showWarning('No collections configured');
    return;
  }

  // Select collection
  const choices = collections.map(c => ({
    name: `${c.collectionSymbol} (${c.minBid}-${c.maxBid} BTC, ${c.offerType})`,
    value: c.collectionSymbol,
  }));

  choices.push({ name: 'Cancel', value: '__cancel__' });

  const selectedSymbol = await promptSelect<string>(
    'Select collection to edit:',
    choices
  );

  if (selectedSymbol === '__cancel__') {
    return;
  }

  const collection = collections.find(c => c.collectionSymbol === selectedSymbol);
  if (!collection) {
    showError('Collection not found');
    return;
  }

  // Show current config
  console.log('');
  console.log('Current configuration:');
  showCollectionSummary({
    symbol: collection.collectionSymbol,
    minBid: collection.minBid,
    maxBid: collection.maxBid,
    minFloorBid: collection.minFloorBid,
    maxFloorBid: collection.maxFloorBid,
    bidCount: collection.bidCount,
    duration: collection.duration,
    enableCounterBidding: collection.enableCounterBidding,
    offerType: collection.offerType,
    quantity: collection.quantity,
  });

  // Select field to edit
  const editLoop = async () => {
    while (true) {
      const field = await promptSelect<string>(
        'What would you like to change?',
        [
          { name: `Min Bid (${collection.minBid} BTC)`, value: 'minBid' },
          { name: `Max Bid (${collection.maxBid} BTC)`, value: 'maxBid' },
          { name: `Min Floor % (${collection.minFloorBid}%)`, value: 'minFloorBid' },
          { name: `Max Floor % (${collection.maxFloorBid}%)`, value: 'maxFloorBid' },
          { name: `Bid Count (${collection.bidCount})`, value: 'bidCount' },
          { name: `Duration (${collection.duration} min)`, value: 'duration' },
          { name: `Counter-Bidding (${collection.enableCounterBidding ? 'Enabled' : 'Disabled'})`, value: 'counterBidding' },
          { name: `Offer Type (${collection.offerType})`, value: 'offerType' },
          { name: `Quantity (${collection.quantity})`, value: 'quantity' },
          { name: `Loop Interval (${collection.scheduledLoop || 60}s)`, value: 'scheduledLoop' },
          { name: `Outbid Margin (${collection.outBidMargin} BTC)`, value: 'outBidMargin' },
          { name: '── Save and exit ──', value: '__save__' },
          { name: '── Cancel ──', value: '__cancel__' },
        ]
      );

      if (field === '__save__') {
        return true;
      }

      if (field === '__cancel__') {
        return false;
      }

      // Edit the field
      switch (field) {
        case 'minBid':
          collection.minBid = await promptBTC('New minimum bid (BTC):', collection.minBid);
          break;

        case 'maxBid':
          collection.maxBid = await promptBTC('New maximum bid (BTC):', collection.maxBid);
          break;

        case 'minFloorBid':
          collection.minFloorBid = await promptFloorPercentage('New minimum floor %:', collection.minFloorBid);
          break;

        case 'maxFloorBid':
          collection.maxFloorBid = await promptFloorPercentage('New maximum floor %:', collection.maxFloorBid);
          break;

        case 'bidCount':
          collection.bidCount = await promptInteger('New bid count:', collection.bidCount);
          break;

        case 'duration':
          collection.duration = await promptInteger('New duration (minutes):', collection.duration);
          break;

        case 'counterBidding':
          collection.enableCounterBidding = await promptConfirm(
            'Enable counter-bidding?',
            collection.enableCounterBidding
          );
          break;

        case 'offerType':
          collection.offerType = await promptSelect<'ITEM' | 'COLLECTION'>(
            'Offer type:',
            [
              { name: 'ITEM', value: 'ITEM' },
              { name: 'COLLECTION', value: 'COLLECTION' },
            ]
          );
          break;

        case 'quantity':
          collection.quantity = await promptInteger('New quantity:', collection.quantity);
          break;

        case 'scheduledLoop':
          collection.scheduledLoop = await promptInteger('Loop interval (seconds):', collection.scheduledLoop || 60);
          break;

        case 'outBidMargin':
          collection.outBidMargin = await promptBTC('Outbid margin (BTC):', collection.outBidMargin);
          break;

        default:
          // Unexpected value (e.g., from pressing Escape) - treat as cancel
          return false;
      }

      console.log('');
    }
  };

  const shouldSave = await editLoop();

  if (!shouldSave) {
    showWarning('Changes discarded');
    return;
  }

  // Validate
  const errors = validateCollection(collection);
  if (errors.length > 0) {
    showError('Invalid configuration:');
    errors.forEach(e => console.log(`  • ${e}`));
    return;
  }

  // Show updated config
  console.log('');
  console.log('Updated configuration:');
  showCollectionSummary({
    symbol: collection.collectionSymbol,
    minBid: collection.minBid,
    maxBid: collection.maxBid,
    minFloorBid: collection.minFloorBid,
    maxFloorBid: collection.maxFloorBid,
    bidCount: collection.bidCount,
    duration: collection.duration,
    enableCounterBidding: collection.enableCounterBidding,
    offerType: collection.offerType,
    quantity: collection.quantity,
  });

  // Confirm
  const confirm = await promptConfirm('Save changes?', true);

  if (!confirm) {
    showWarning('Changes discarded');
    return;
  }

  // Save
  const success = updateCollection(selectedSymbol, collection);

  if (success) {
    showSuccess('Collection updated!');
    console.log('');
    console.log('Changes will take effect on the next bidding cycle.');
    console.log('Use "Restart bot" to apply changes immediately.');
  } else {
    showError('Failed to update collection');
  }

  console.log('');
}
