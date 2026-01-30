import { getLogs, followLogs, clearLogs, isRunning } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
} from '../../utils/display';
import { promptInteger, promptConfirm, promptSelect } from '../../utils/prompts';
import chalk = require('chalk');

export async function viewLogs(): Promise<void> {
  showSectionHeader('VIEW LOGS');

  // Check if bot is running
  const running = isRunning();
  console.log(`Bot status: ${running ? chalk.green('Running') : chalk.red('Stopped')}`);
  console.log('');

  // Options
  const action = await promptSelect<'recent' | 'follow' | 'clear'>(
    'What would you like to do?',
    [
      { name: 'View recent logs', value: 'recent' },
      { name: 'Follow logs (live)', value: 'follow' },
      { name: 'Clear logs', value: 'clear' },
    ]
  );

  if (action === 'recent') {
    const lines = await promptInteger('How many lines?', 50);

    const logs = getLogs(lines);

    if (logs.length === 0) {
      showWarning('No logs found');
      console.log('');
      console.log('The bot may not have been started yet.');
      return;
    }

    console.log('');
    console.log('━'.repeat(80));

    logs.forEach(line => {
      // Color code log lines
      if (line.includes('[ERROR]') || line.includes('Error')) {
        console.log(chalk.red(line));
      } else if (line.includes('[WARNING]') || line.includes('Warning')) {
        console.log(chalk.yellow(line));
      } else if (line.includes('[SUCCESS]') || line.includes('✓')) {
        console.log(chalk.green(line));
      } else if (line.includes('[BID]') || line.includes('placed')) {
        console.log(chalk.cyan(line));
      } else {
        console.log(line);
      }
    });

    console.log('━'.repeat(80));
    console.log('');

  } else if (action === 'follow') {
    console.log('');
    console.log('Following logs... (Press Ctrl+C to stop)');
    console.log('━'.repeat(80));

    // Set up signal handler
    let stopFollowing: (() => void) | null = null;

    const cleanup = () => {
      if (stopFollowing) {
        stopFollowing();
      }
      console.log('');
      console.log('━'.repeat(80));
      console.log('Stopped following logs.');
      process.removeListener('SIGINT', cleanup);
    };

    process.on('SIGINT', cleanup);

    // Start following
    stopFollowing = followLogs(line => {
      // Color code log lines
      if (line.includes('[ERROR]') || line.includes('Error')) {
        console.log(chalk.red(line));
      } else if (line.includes('[WARNING]') || line.includes('Warning')) {
        console.log(chalk.yellow(line));
      } else if (line.includes('[SUCCESS]') || line.includes('✓')) {
        console.log(chalk.green(line));
      } else if (line.includes('[BID]') || line.includes('placed')) {
        console.log(chalk.cyan(line));
      } else {
        console.log(line);
      }
    });

    // Wait indefinitely (until Ctrl+C)
    await new Promise<void>(() => {});

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
