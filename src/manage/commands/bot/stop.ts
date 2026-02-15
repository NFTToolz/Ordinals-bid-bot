import { stop, isRunning, getStatus } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  withSpinner,
  withProgressSpinner,
} from '../../utils/display';
import { promptConfirm } from '../../utils/prompts';
import { performCancellation, resetBotData, fetchOfferCounts } from './cancel';

export async function stopBot(): Promise<void> {
  showSectionHeader('STOP BOT');

  // Check if running
  if (!isRunning()) {
    showWarning('Bot is not running');
    return;
  }

  const status = getStatus();
  console.log('Bot is currently running:');
  console.log(`  PID: ${status.pid}`);
  console.log(`  Uptime: ${status.uptime}`);
  console.log('');

  const confirm = await promptConfirm('Stop the bot?', true);

  if (!confirm) {
    showWarning('Stop cancelled');
    return;
  }

  console.log('');

  const result = await withSpinner(
    'Stopping bot (graceful shutdown)...',
    () => stop(10000)
  );

  if (result.success) {
    showSuccess('Bot stopped successfully!');
  } else {
    showError(`Failed to stop bot: ${result.error}`);
    console.log('');
    return;
  }

  console.log('');

  const cancelConfirm = await promptConfirm('Cancel all active bids?', true);

  if (!cancelConfirm) {
    return;
  }

  console.log('');

  const { counts, fetchedOffers, warnings } = await withSpinner('Checking active offers...', fetchOfferCounts);
  const total = counts.reduce((s, c) => s + c.itemOffers + c.collectionOffers, 0);

  if (total === 0) {
    if (warnings.length > 0) {
      showWarning('Could not fully check for active offers:');
      warnings.forEach((w) => showWarning(`  ${w}`));
      console.log('');
      showInfo('No offers found, but results may be incomplete due to errors above');
    } else {
      showInfo('No active offers to cancel');
    }
  } else {
    if (warnings.length > 0) {
      showWarning('Some checks failed (results may be incomplete):');
      warnings.forEach((w) => showWarning(`  ${w}`));
      console.log('');
    }
    const cancelResult = await withProgressSpinner(
      `Canceling offers [0/${total}]...`,
      (update) => performCancellation(fetchedOffers, (canceled) => {
        update(`Canceling offers [${canceled}/${total}]...`);
      })
    );

    console.log('');

    if (cancelResult.itemOffersCanceled > 0 || cancelResult.collectionOffersCanceled > 0) {
      showSuccess(
        `Canceled ${cancelResult.itemOffersCanceled} item offer(s) and ${cancelResult.collectionOffersCanceled} collection offer(s)`
      );
    } else {
      showInfo('No active offers to cancel');
    }

    if (cancelResult.errors.length > 0) {
      console.log('');
      showWarning(`${cancelResult.errors.length} error(s) occurred:`);
      cancelResult.errors.forEach((err) => showError(`  ${err}`));
    }
  }

  // Reset bid history
  const resetResult = resetBotData();
  if (resetResult.historyReset) {
    showSuccess('Reset bid history');
  }

  console.log('');
}
