import { getLogs, followLogs, clearLogs, isRunning } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  getSeparatorWidth,
} from '../../utils/display';
import { promptInteger, promptConfirm, promptSelect } from '../../utils/prompts';
import chalk = require('chalk');

export async function followLogsUntilExit(): Promise<void> {
  console.log('');
  console.log('Following logs... (Press Enter to return to menu)');
  console.log('━'.repeat(getSeparatorWidth()));

  let stopFollowing: (() => void) | null = null;

  // Start following
  stopFollowing = followLogs(line => {
    if (line.includes('[ERROR]') || line.includes('Error')) {
      console.log(chalk.red(line));
    } else if (line.includes('[WARNING]') || line.includes('Warning')) {
      console.log(chalk.yellow(line));
    } else if (line.includes('[SUCCESS]') || line.includes('[OK]')) {
      console.log(chalk.green(line));
    } else if (line.includes('[BID]') || line.includes('placed')) {
      console.log(chalk.cyan(line));
    } else {
      console.log(line);
    }
  });

  // Wait for Enter key
  await new Promise<void>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
      if (stopFollowing) {
        stopFollowing();
      }
      console.log('');
      console.log('━'.repeat(getSeparatorWidth()));
      console.log('Stopped following logs.');
    };

    const onData = (key: Buffer) => {
      // Enter key (carriage return or newline)
      if (key[0] === 13 || key[0] === 10) {
        cleanup();
        resolve();
      }
      // Also handle Ctrl+C as fallback
      if (key[0] === 3) {
        cleanup();
        resolve();
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function viewLogs(): Promise<void> {
  showSectionHeader('VIEW LOGS');

  // Check if bot is running
  const running = isRunning();
  console.log(`Bot status: ${running ? chalk.green('Running') : chalk.red('Stopped')}`);
  console.log('');

  // Options
  const action = await promptSelect<'recent' | 'follow' | 'clear' | '__cancel__'>(
    'What would you like to do?',
    [
      { name: 'View recent logs', value: 'recent' },
      { name: 'Follow logs (live)', value: 'follow' },
      { name: 'Clear logs', value: 'clear' },
      { name: '← Back', value: '__cancel__' },
    ]
  );

  if (action === '__cancel__') {
    return;
  }

  if (action === 'recent') {
    const lines = await promptInteger('How many lines? (0 to cancel)', 50);

    if (lines === 0) {
      return;
    }

    const logs = getLogs(lines);

    if (logs.length === 0) {
      showWarning('No logs found');
      console.log('');
      console.log('The bot may not have been started yet.');
      return;
    }

    console.log('');
    console.log('━'.repeat(getSeparatorWidth()));

    logs.forEach(line => {
      // Color code log lines
      if (line.includes('[ERROR]') || line.includes('Error')) {
        console.log(chalk.red(line));
      } else if (line.includes('[WARNING]') || line.includes('Warning')) {
        console.log(chalk.yellow(line));
      } else if (line.includes('[SUCCESS]') || line.includes('[OK]')) {
        console.log(chalk.green(line));
      } else if (line.includes('[BID]') || line.includes('placed')) {
        console.log(chalk.cyan(line));
      } else {
        console.log(line);
      }
    });

    console.log('━'.repeat(getSeparatorWidth()));
    console.log('');

  } else if (action === 'follow') {
    await followLogsUntilExit();

  } else if (action === 'clear') {
    const confirm = await promptConfirm('Clear all logs?', false);

    if (confirm) {
      clearLogs();
      showSuccess('Logs cleared');
    } else {
      showWarning('Clear cancelled');
    }
  }

  console.log('');
}
