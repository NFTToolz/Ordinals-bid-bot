import { loadCollections, removeCollection } from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
} from '../../utils/display';
import { promptSelect, promptConfirm, promptDangerousConfirm } from '../../utils/prompts';

export async function removeCollectionCommand(): Promise<void> {
  showSectionHeader('REMOVE COLLECTION');

  const collections = loadCollections();

  if (collections.length === 0) {
    showWarning('No collections configured');
    return;
  }

  // Select collection
  const choices = collections.map(c => ({
    name: `${c.collectionSymbol} (${c.offerType})`,
    value: c.collectionSymbol,
  }));

  choices.push({ name: 'Cancel', value: '__cancel__' });

  const selectedSymbol = await promptSelect<string>(
    'Select collection to remove:',
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

  // Show what will be removed
  console.log('');
  console.log('Collection to remove:');
  console.log(`  Symbol: ${collection.collectionSymbol}`);
  console.log(`  Type: ${collection.offerType}`);
  console.log(`  Bid range: ${collection.minBid} - ${collection.maxBid} BTC`);
  console.log('');

  showWarning('This will stop all bidding on this collection.');
  console.log('');

  // Ask about cancelling bids
  const cancelBids = await promptConfirm(
    'Cancel active bids before removing?',
    true
  );

  if (cancelBids) {
    console.log('');
    showWarning('Note: Active bids should be cancelled using "yarn cancel" before removing.');
    console.log('The collection removal will not automatically cancel bids on Magic Eden.');
    console.log('');
  }

  // Confirm
  const confirm = await promptConfirm(
    `Remove "${selectedSymbol}" from config?`,
    false
  );

  if (!confirm) {
    showWarning('Collection not removed');
    return;
  }

  // Remove
  const success = removeCollection(selectedSymbol);

  if (success) {
    showSuccess(`Collection "${selectedSymbol}" removed!`);
    console.log('');

    if (cancelBids) {
      console.log('To cancel existing bids:');
      console.log('  1. Stop the bot if running');
      console.log('  2. Run: yarn cancel');
      console.log('  3. Restart the bot');
    } else {
      console.log('Existing bids will expire naturally.');
    }

    console.log('');
    console.log('Use "Restart bot" to apply changes immediately.');
  } else {
    showError('Failed to remove collection');
  }

  console.log('');
}
