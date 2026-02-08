import { restart, isRunning, getStatus } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
  withSpinner,
} from '../../utils/display';
import { promptConfirm } from '../../utils/prompts';
import { followLogsUntilExit } from './logs';
import { resetBotData } from './cancel';

export async function restartBot(): Promise<void> {
  showSectionHeader('RESTART BOT');

  const wasRunning = isRunning();

  if (wasRunning) {
    const status = getStatus();
    console.log('Bot is currently running:');
    console.log(`  PID: ${status.pid}`);
    console.log(`  Uptime: ${status.uptime}`);
    console.log('');

    const confirm = await promptConfirm('Restart the bot?', true);

    if (!confirm) {
      showWarning('Restart cancelled');
      return;
    }
  } else {
    console.log('Bot is not currently running.');
    console.log('');

    const confirm = await promptConfirm('Start the bot?', true);

    if (!confirm) {
      showWarning('Start cancelled');
      return;
    }
  }

  console.log('');

  // Reset stale stats/history so the manage console doesn't show old data
  if (wasRunning) {
    resetBotData();
  }

  const result = await withSpinner(
    wasRunning ? 'Restarting bot...' : 'Starting bot...',
    () => restart()
  );

  if (result.success) {
    showSuccess(wasRunning ? 'Bot restarted successfully!' : 'Bot started successfully!');
    console.log('');
    console.log(`  PID: ${result.pid}`);
    console.log(`  Log file: bot.log`);
    await followLogsUntilExit();
  } else {
    showError(`Failed to restart bot: ${result.error}`);
  }

  console.log('');
}
