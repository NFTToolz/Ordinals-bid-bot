import { loadCollections, removeCollection } from '../../services/CollectionService';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  withSpinner,
} from '../../utils/display';
import { promptSelect, promptConfirm, promptDangerousConfirm } from '../../utils/prompts';
import { cancelOffersForCollection } from '../bot/cancel';

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

  // Confirm
  const confirm = await promptConfirm(
    `Remove "${selectedSymbol}" from config?`,
    false
  );

  if (!confirm) {
    showWarning('Collection not removed');
    return;
  }

  // Cancel bids before removing (need collection config for wallet info)
  if (cancelBids) {
    console.log('');
    const result = await withSpinner(
      `Canceling offers for ${selectedSymbol}...`,
      () => cancelOffersForCollection(selectedSymbol, collection.offerType)
    );

    if (result.itemOffersCanceled > 0 || result.collectionOffersCanceled > 0) {
      showSuccess(
        `Canceled ${result.itemOffersCanceled} item offer(s) and ${result.collectionOffersCanceled} collection offer(s)`
      );
    } else {
      showInfo('No active offers found for this collection');
    }

    if (result.errors.length > 0) {
      console.log('');
      showWarning(`${result.errors.length} error(s) during cancellation:`);
      result.errors.forEach((err) => showError(`  ${err}`));
    }
  }

  // Remove
  const success = removeCollection(selectedSymbol);

  if (success) {
    console.log('');
    showSuccess(`Collection "${selectedSymbol}" removed!`);
    console.log('');

    if (!cancelBids) {
      console.log('Existing bids will expire naturally.');
    }

    console.log('Use "Restart bot" to apply changes immediately.');
  } else {
    showError('Failed to remove collection');
  }

  console.log('');
}
