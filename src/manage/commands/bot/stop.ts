import { stop, isRunning, getStatus } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  withSpinner,
} from '../../utils/display';
import { promptConfirm } from '../../utils/prompts';

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
  }

  console.log('');
}
