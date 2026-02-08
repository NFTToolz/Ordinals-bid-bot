import { start, isRunning, getStatus } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showError,
  showWarning,
} from '../../utils/display';
import { followLogsUntilExit } from './logs';

export async function startBot(): Promise<void> {
  showSectionHeader('START BOT');

  // Check if already running
  if (isRunning()) {
    const status = getStatus();
    showWarning('Bot is already running!');
    console.log('');
    console.log(`  PID: ${status.pid}`);
    console.log(`  Uptime: ${status.uptime}`);
    console.log('');
    console.log('Use "Stop bot" first if you want to restart.');
    return;
  }

  console.log('Starting bot...');
  console.log('');

  const result = start();

  if (result.success) {
    showSuccess('Bot started successfully!');
    console.log('');
    console.log(`  PID: ${result.pid}`);
    console.log(`  Log file: bot.log`);
    await followLogsUntilExit();
  } else {
    showError(`Failed to start bot: ${result.error}`);
  }

  console.log('');
}
