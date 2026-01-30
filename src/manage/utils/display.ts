import chalk = require('chalk');

// ASCII box characters
const BOX = {
  topLeft: '╔',
  topRight: '╗',
  bottomLeft: '╚',
  bottomRight: '╝',
  horizontal: '═',
  vertical: '║',
  middleLeft: '╠',
  middleRight: '╣',
};

/**
 * Display the main header with ASCII art box
 */
export function showHeader(): void {
  const width = 65;
  const title = 'ORDINALS BID BOT - MANAGEMENT CONSOLE';
  const padding = Math.floor((width - title.length - 2) / 2);

  console.log(chalk.cyan(BOX.topLeft + BOX.horizontal.repeat(width - 2) + BOX.topRight));
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(padding) + chalk.bold.white(title) + ' '.repeat(width - padding - title.length - 2) + chalk.cyan(BOX.vertical));
  console.log(chalk.cyan(BOX.middleLeft + BOX.horizontal.repeat(width - 2) + BOX.middleRight));
}

/**
 * Display status bar with bot state, wallet count, and collection count
 */
export function showStatusBar(botStatus: 'RUNNING' | 'STOPPED', walletCount: number, collectionCount: number): void {
  const width = 65;
  const statusIcon = botStatus === 'RUNNING' ? chalk.green('●') : chalk.red('●');
  const statusText = botStatus === 'RUNNING' ? chalk.green('RUNNING') : chalk.red('STOPPED');

  const statusLine = `  Bot Status: ${statusIcon} ${statusText}    Wallets: ${walletCount}    Collections: ${collectionCount}`;
  const padding = width - stripAnsi(statusLine).length - 2;

  console.log(chalk.cyan(BOX.vertical) + statusLine + ' '.repeat(Math.max(0, padding)) + chalk.cyan(BOX.vertical));
  console.log(chalk.cyan(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight));
  console.log('');
}

/**
 * Display a section header
 */
export function showSectionHeader(title: string): void {
  console.log('');
  console.log(chalk.dim('━'.repeat(50)));
  console.log(chalk.bold(`  ${title}`));
  console.log(chalk.dim('━'.repeat(50)));
  console.log('');
}

/**
 * Display a table using simple formatting
 */
export function showTable(headers: string[], rows: string[][], columnWidths?: number[]): void {
  const widths = columnWidths || headers.map((h, i) => {
    const maxContent = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
    return Math.min(maxContent + 2, 30);
  });

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' │ ');
  console.log(chalk.bold('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐'));
  console.log(chalk.bold('│ ' + headerLine + ' │'));
  console.log(chalk.bold('├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤'));

  // Rows
  rows.forEach(row => {
    const rowLine = row.map((cell, i) => (cell || '').padEnd(widths[i])).join(' │ ');
    console.log('│ ' + rowLine + ' │');
  });

  console.log('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

/**
 * Display success message
 */
export function showSuccess(message: string): void {
  console.log(chalk.green('✓ ' + message));
}

/**
 * Display error message
 */
export function showError(message: string): void {
  console.log(chalk.red('✗ ' + message));
}

/**
 * Display warning message
 */
export function showWarning(message: string): void {
  console.log(chalk.yellow('⚠ ' + message));
}

/**
 * Display info message
 */
export function showInfo(message: string): void {
  console.log(chalk.blue('ℹ ' + message));
}

/**
 * Display a loading spinner (returns stop function)
 */
export async function withSpinner<T>(message: string, fn: () => Promise<T>): Promise<T> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let stopped = false;

  const interval = setInterval(() => {
    if (!stopped) {
      process.stdout.write(`\r${chalk.cyan(frames[i])} ${message}`);
      i = (i + 1) % frames.length;
    }
  }, 80);

  try {
    const result = await fn();
    stopped = true;
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
    return result;
  } catch (error) {
    stopped = true;
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
    throw error;
  }
}

/**
 * Format BTC amount
 */
export function formatBTC(satoshis: number): string {
  return (satoshis / 100000000).toFixed(8) + ' BTC';
}

/**
 * Format short address
 */
export function formatAddress(address: string, length: number = 8): string {
  if (address.length <= length * 2) return address;
  return address.slice(0, length) + '...' + address.slice(-length);
}

/**
 * Strip ANSI codes from string for length calculation
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Display a box with important information
 */
export function showImportantBox(lines: string[]): void {
  const maxLength = Math.max(...lines.map(l => l.length));
  const width = maxLength + 4;

  console.log(chalk.yellow('━'.repeat(width)));
  lines.forEach(line => {
    const padding = width - line.length - 2;
    console.log(chalk.yellow('  ' + line + ' '.repeat(Math.max(0, padding))));
  });
  console.log(chalk.yellow('━'.repeat(width)));
}

/**
 * Display transaction preview
 */
export function showTransactionPreview(
  from: string,
  recipients: Array<{ label: string; address: string; amount: number }>,
  fee: number,
  remaining?: number
): void {
  console.log('');
  showSectionHeader('TRANSACTION PREVIEW');

  console.log(`  From:      ${formatAddress(from, 12)}`);
  console.log('');
  console.log('  To:');

  let subtotal = 0;
  recipients.forEach(r => {
    console.log(`    ${r.label.padEnd(12)} →  ${formatBTC(r.amount)}`);
    subtotal += r.amount;
  });

  console.log('');
  console.log(`  Subtotal:     ${formatBTC(subtotal)}`);
  console.log(`  Network Fee:  ${formatBTC(fee)}`);
  console.log(chalk.dim('  ─────────────────────────────────'));
  console.log(chalk.bold(`  Total:        ${formatBTC(subtotal + fee)}`));

  if (remaining !== undefined) {
    console.log(`  Remaining:    ${formatBTC(remaining)}`);
  }
  console.log('');
}

/**
 * Display collection summary
 */
export function showCollectionSummary(config: {
  symbol: string;
  minBid: number;
  maxBid: number;
  minFloorBid: number;
  maxFloorBid: number;
  bidCount: number;
  duration: number;
  enableCounterBidding: boolean;
  offerType: string;
  quantity?: number;
}): void {
  showSectionHeader('COLLECTION SUMMARY');

  console.log(`  Symbol:        ${chalk.bold(config.symbol)}`);
  console.log(`  Min Bid:       ${config.minBid} BTC`);
  console.log(`  Max Bid:       ${config.maxBid} BTC`);
  console.log(`  Floor Range:   ${config.minFloorBid}% - ${config.maxFloorBid}%`);
  console.log(`  Bid Count:     ${config.bidCount} items`);
  console.log(`  Duration:      ${config.duration} minutes`);
  console.log(`  Offer Type:    ${config.offerType}`);
  console.log(`  Counter-bid:   ${config.enableCounterBidding ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled')}`);
  if (config.quantity) {
    console.log(`  Max to Win:    ${config.quantity}`);
  }
  console.log('');
}

/**
 * Clear terminal screen
 */
export function clearScreen(): void {
  console.clear();
}
