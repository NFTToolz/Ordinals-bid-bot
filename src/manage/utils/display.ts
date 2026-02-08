import chalk = require('chalk');
import { VERSION_STRING, getUpdateStatus } from '../../utils/version';

// Cache the header width to ensure consistency between header and status bar
let cachedHeaderWidth: number | null = null;

/**
 * Get the terminal width, clamped between min and max values
 */
export function getTerminalWidth(minWidth = 70, maxWidth = 150): number {
  const cols = process.stdout.columns || 80;
  return Math.min(Math.max(cols, minWidth), maxWidth);
}

/**
 * Get the width for the header/status bar box
 * Cached to ensure header and status bar use the same width
 * Uses a fixed width of 69 to avoid line-wrapping issues with Unicode characters
 */
export function getHeaderWidth(): number {
  if (cachedHeaderWidth === null) {
    // Fixed width of 69 - just enough for the ASCII art content (64 chars)
    // plus borders and minimal padding. This avoids wrapping issues.
    cachedHeaderWidth = 69;
  }
  return cachedHeaderWidth;
}

/**
 * Reset the cached header width (call when terminal might have resized)
 */
export function resetHeaderWidth(): void {
  cachedHeaderWidth = null;
}

/**
 * Get width for separator lines (terminal width minus margin)
 */
export function getSeparatorWidth(): number {
  // Leave 4 chars margin for clean appearance
  return getTerminalWidth(50, 120) - 4;
}

/**
 * Calculate the visual display width of a string
 * Most terminals render these characters as single-width
 */
export function getDisplayWidth(str: string): number {
  return str.length;
}

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
 * Display the main header with fancy ASCII art banner
 * Width dynamically matches terminal size for alignment with status bar
 */
export function showHeader(): void {
  // Reset and recalculate width at the start of each header display
  resetHeaderWidth();
  const width = getHeaderWidth();

  // ASCII art for "ORDINALS"
  const ordinals = [
    ' ██████╗ ██████╗ ██████╗ ██╗███╗   ██╗ █████╗ ██╗     ███████╗',
    '██╔═══██╗██╔══██╗██╔══██╗██║████╗  ██║██╔══██╗██║     ██╔════╝',
    '██║   ██║██████╔╝██║  ██║██║██╔██╗ ██║███████║██║     ███████╗',
    '██║   ██║██╔══██╗██║  ██║██║██║╚██╗██║██╔══██║██║     ╚════██║',
    '╚██████╔╝██║  ██║██████╔╝██║██║ ╚████║██║  ██║███████╗███████║',
    ' ╚═════╝ ╚═╝  ╚═╝╚═════╝ ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚══════╝╚══════╝',
  ];

  // ASCII art for "BID BOT"
  const bidbot = [
    '        ██████╗ ██╗██████╗     ██████╗  ██████╗ ████████╗',
    '        ██╔══██╗██║██╔══██╗    ██╔══██╗██╔═══██╗╚══██╔══╝',
    '        ██████╔╝██║██║  ██║    ██████╔╝██║   ██║   ██║   ',
    '        ██╔══██╗██║██║  ██║    ██╔══██╗██║   ██║   ██║   ',
    '        ██████╔╝██║██████╔╝    ██████╔╝╚██████╔╝   ██║   ',
    '        ╚═════╝ ╚═╝╚═════╝     ╚═════╝  ╚═════╝    ╚═╝   ',
  ];

  const subtitle = 'Management Console';

  // Top border
  console.log(chalk.cyan(BOX.topLeft + BOX.horizontal.repeat(width - 2) + BOX.topRight));

  // Empty line
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(width - 2) + chalk.cyan(BOX.vertical));

  // ORDINALS ASCII art
  for (const line of ordinals) {
    const displayWidth = getDisplayWidth(line);
    const padding = Math.floor((width - 2 - displayWidth) / 2);
    const rightPadding = width - 2 - padding - displayWidth;
    console.log(chalk.cyan(BOX.vertical) + ' '.repeat(Math.max(0, padding)) + chalk.bold.cyan(line) + ' '.repeat(Math.max(0, rightPadding)) + chalk.cyan(BOX.vertical));
  }

  // Empty line between words
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(width - 2) + chalk.cyan(BOX.vertical));

  // BID BOT ASCII art
  for (const line of bidbot) {
    const displayWidth = getDisplayWidth(line);
    const padding = Math.floor((width - 2 - displayWidth) / 2);
    const rightPadding = width - 2 - padding - displayWidth;
    console.log(chalk.cyan(BOX.vertical) + ' '.repeat(Math.max(0, padding)) + chalk.bold.white(line) + ' '.repeat(Math.max(0, rightPadding)) + chalk.cyan(BOX.vertical));
  }

  // Empty line
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(width - 2) + chalk.cyan(BOX.vertical));

  // Subtitle with dashes (ASCII-safe, renders consistently as single-width)
  const subtitleLine = `- ${subtitle} -`;
  const subtitleDisplayWidth = getDisplayWidth(subtitleLine);
  const subtitlePadding = Math.floor((width - 2 - subtitleDisplayWidth) / 2);
  const subtitleRightPadding = width - 2 - subtitlePadding - subtitleDisplayWidth;
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(Math.max(0, subtitlePadding)) + chalk.yellow(subtitleLine) + ' '.repeat(Math.max(0, subtitleRightPadding)) + chalk.cyan(BOX.vertical));

  // Version line
  const versionLine = `v${VERSION_STRING}`;
  const versionDisplayWidth = getDisplayWidth(versionLine);
  const versionPadding = Math.floor((width - 2 - versionDisplayWidth) / 2);
  const versionRightPadding = width - 2 - versionPadding - versionDisplayWidth;
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(Math.max(0, versionPadding)) + chalk.green(versionLine) + ' '.repeat(Math.max(0, versionRightPadding)) + chalk.cyan(BOX.vertical));

  // Update notification (if available)
  const updateInfo = getUpdateStatus();
  if (updateInfo?.updateAvailable) {
    const countLabel = updateInfo.commitsBehind > 0
      ? `${updateInfo.commitsBehind} new`
      : 'new version';
    const updateLine = `Update available! (${countLabel})`;
    const updateDisplayWidth = getDisplayWidth(updateLine);
    const updatePadding = Math.floor((width - 2 - updateDisplayWidth) / 2);
    const updateRightPadding = width - 2 - updatePadding - updateDisplayWidth;
    console.log(chalk.cyan(BOX.vertical) + ' '.repeat(Math.max(0, updatePadding)) + chalk.yellow(updateLine) + ' '.repeat(Math.max(0, updateRightPadding)) + chalk.cyan(BOX.vertical));
  }

  // Empty line
  console.log(chalk.cyan(BOX.vertical) + ' '.repeat(width - 2) + chalk.cyan(BOX.vertical));

  // Bottom border (middle style to connect to status bar)
  console.log(chalk.cyan(BOX.middleLeft + BOX.horizontal.repeat(width - 2) + BOX.middleRight));
}

/**
 * Display status bar with bot state, wallet count, and collection count
 */
export function showStatusBar(botStatus: 'RUNNING' | 'STOPPED', walletCount: number, collectionCount: number): void {
  const width = getHeaderWidth();
  const statusIcon = botStatus === 'RUNNING' ? chalk.green('*') : chalk.red('*');
  const statusText = botStatus === 'RUNNING' ? chalk.green('RUNNING') : chalk.red('STOPPED');

  const statusLine = `  Bot Status: ${statusIcon} ${statusText}    Wallets: ${walletCount}    Collections: ${collectionCount}`;
  const padding = width - stripAnsi(statusLine).length - 2;

  console.log(chalk.cyan(BOX.vertical) + statusLine + ' '.repeat(Math.max(0, padding)) + chalk.cyan(BOX.vertical));
  console.log(chalk.cyan(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight));
  console.log('');
}

export interface EnhancedStatusData {
  botStatus: 'RUNNING' | 'STOPPED';
  walletCount: number;
  collectionCount: number;
  totalBalance: number;
  activeOfferCount: number;
  pendingTxCount: number;
  dataFreshness?: 'fresh' | 'stale' | 'unavailable';
  lastRefreshAgoSec?: number;
}

/**
 * Display enhanced status bar with two rows of information
 */
export function showEnhancedStatusBar(status: EnhancedStatusData): void {
  const width = getHeaderWidth();
  const statusIcon = status.botStatus === 'RUNNING' ? chalk.green('*') : chalk.red('*');
  const statusText = status.botStatus === 'RUNNING' ? chalk.green('RUNNING') : chalk.red('STOPPED');

  // First row: Bot status, wallets, collections
  const line1 = `  Bot: ${statusIcon} ${statusText}    Wallets: ${status.walletCount}     Collections: ${status.collectionCount}`;
  const padding1 = width - stripAnsi(line1).length - 2;

  // Second row: Balance, offers, pending
  const balanceStr = formatBTC(status.totalBalance);
  let freshnessTag = '';
  if (status.dataFreshness === 'stale') {
    freshnessTag = chalk.yellow(' [stale]');
  } else if (status.dataFreshness === 'unavailable') {
    freshnessTag = chalk.red(' [offline]');
  }
  const line2 = `  Balance: ${balanceStr}    Offers: ${status.activeOfferCount}    Pending: ${status.pendingTxCount}${freshnessTag}`;
  const padding2 = width - stripAnsi(line2).length - 2;

  console.log(chalk.cyan(BOX.vertical) + line1 + ' '.repeat(Math.max(0, padding1)) + chalk.cyan(BOX.vertical));
  console.log(chalk.cyan(BOX.vertical) + line2 + ' '.repeat(Math.max(0, padding2)) + chalk.cyan(BOX.vertical));
  console.log(chalk.cyan(BOX.bottomLeft + BOX.horizontal.repeat(width - 2) + BOX.bottomRight));
  console.log('');
}

export type MenuLevel = 'main' | 'wallet-hub' | 'wallets' | 'wallet-groups' | 'collections' | 'bot' | 'bidding-stats' | 'settings';

const MENU_LABELS: Record<MenuLevel, string> = {
  'main': 'Main Menu',
  'wallet-hub': 'Wallets',
  'wallets': 'Individual Wallets',
  'wallet-groups': 'Wallet Groups',
  'collections': 'Collections',
  'bot': 'Bot Control',
  'bidding-stats': 'Bidding Stats',
  'settings': 'Settings',
};

/**
 * Display breadcrumb navigation showing current menu location
 */
export function showBreadcrumb(levels: MenuLevel[]): void {
  const breadcrumb = levels.map((level, i) => {
    const label = MENU_LABELS[level];
    if (i === levels.length - 1) {
      return chalk.bold.white(label);
    }
    return chalk.dim(label);
  }).join(chalk.dim(' > '));

  console.log(chalk.dim('  ') + breadcrumb);
  console.log('');
}

/**
 * Display a section header
 */
export function showSectionHeader(title: string, width?: number): void {
  const separatorWidth = width ?? getSeparatorWidth();
  console.log('');
  console.log(chalk.dim('━'.repeat(separatorWidth)));
  console.log(chalk.bold(`  ${title}`));
  console.log(chalk.dim('━'.repeat(separatorWidth)));
  console.log('');
}

/**
 * Display a table using simple formatting
 */
export function showTable(headers: string[], rows: string[][], columnWidths?: number[]): void {
  const widths = columnWidths || headers.map((h, i) => {
    const maxContent = Math.max(h.length, ...rows.map(r => stripAnsi(r[i] || '').length));
    return Math.min(maxContent + 2, 30);
  });

  // ANSI-aware pad: pads based on visible width, preserving color codes
  const padCell = (text: string, width: number): string => {
    const visible = stripAnsi(text).length;
    return visible >= width ? text : text + ' '.repeat(width - visible);
  };

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(' │ ');
  console.log(chalk.bold('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐'));
  console.log(chalk.bold('│ ' + headerLine + ' │'));
  console.log(chalk.bold('├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤'));

  // Rows
  rows.forEach(row => {
    const rowLine = row.map((cell, i) => padCell(cell || '', widths[i])).join(' │ ');
    console.log('│ ' + rowLine + ' │');
  });

  console.log('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

/**
 * Display success message
 */
export function showSuccess(message: string): void {
  console.log(chalk.green('[OK] ' + message));
}

/**
 * Display error message
 */
export function showError(message: string): void {
  console.log(chalk.red('[ERR] ' + message));
}

/**
 * Display warning message
 */
export function showWarning(message: string): void {
  console.log(chalk.yellow('[!] ' + message));
}

/**
 * Display info message
 */
export function showInfo(message: string): void {
  console.log(chalk.blue('[i] ' + message));
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
export function stripAnsi(str: string): string {
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
  floorPrice?: number;
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
  console.log(`  Floor Price:   ${config.floorPrice ? formatBTC(config.floorPrice) : '-'}`);
  console.log(`  Min Bid:       ${config.minBid} BTC`);
  console.log(`  Max Bid:       ${config.maxBid} BTC`);
  console.log(`  Floor Range:   ${config.minFloorBid}% - ${config.maxFloorBid}%`);
  console.log(`  Bid Count:     ${config.bidCount} items`);
  console.log(`  Duration:      ${config.duration} minutes`);
  console.log(`  Offer Type:    ${config.offerType}`);
  console.log(`  Counter-bid:   ${config.enableCounterBidding ? chalk.green('Enabled') : chalk.red('Disabled')}`);
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
