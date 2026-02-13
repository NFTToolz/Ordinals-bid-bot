import { isRunning, notifyBotReload } from '../services/BotProcessManager';
import { showInfo, showSuccess, showWarning } from './display';

/**
 * After a collection config change, notify the running bot to hot-reload.
 * If the bot is not running, shows an informational message instead.
 */
export async function notifyBotOfConfigChange(): Promise<void> {
  if (!isRunning()) {
    showInfo('Changes saved. Start the bot to apply.');
    return;
  }

  const result = await notifyBotReload();

  if (result === null) {
    showWarning('Bot is running but reload API is unreachable. Restart the bot to apply changes.');
    return;
  }

  if (result.success) {
    const parts: string[] = [];
    if (result.added && result.added.length > 0) parts.push(`${result.added.length} added`);
    if (result.removed && result.removed.length > 0) parts.push(`${result.removed.length} removed`);
    if (result.modified && result.modified.length > 0) parts.push(`${result.modified.length} updated`);

    if (parts.length > 0) {
      showSuccess(`Bot reloaded: ${parts.join(', ')}`);
    } else {
      showInfo('Bot reloaded — no changes detected.');
    }
  } else {
    showWarning('Bot rejected reload:');
    if (result.errors) {
      for (const err of result.errors) {
        console.log(`  • ${err}`);
      }
    }
  }
}
