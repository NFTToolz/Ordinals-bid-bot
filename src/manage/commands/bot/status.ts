import { getStatus, getStats, isRunning, getBotRuntimeStats } from '../../services/BotProcessManager';
import { loadCollections } from '../../services/CollectionService';
import { loadWallets } from '../../services/WalletGenerator';
import {
  showSectionHeader,
  showSuccess,
  showWarning,
  showTable,
} from '../../utils/display';
import chalk = require('chalk');

export async function viewStatus(): Promise<void> {
  showSectionHeader('BOT STATUS & STATS');

  const status = getStatus();
  const stats = getStats();
  const runtimeStats = getBotRuntimeStats();
  const collections = loadCollections();
  const wallets = loadWallets();

  // Bot Status
  console.log('━'.repeat(50));
  console.log('  BOT STATUS');
  console.log('━'.repeat(50));

  if (status.running) {
    console.log(`  Status:   ${chalk.green('● RUNNING')}`);
    console.log(`  PID:      ${status.pid}`);
    console.log(`  Uptime:   ${status.uptime}`);
    if (status.startedAt) {
      console.log(`  Started:  ${status.startedAt.toLocaleString()}`);
    }
  } else {
    console.log(`  Status:   ${chalk.red('● STOPPED')}`);
  }

  console.log('');

  // Session Statistics (from runtime stats)
  if (runtimeStats) {
    console.log('━'.repeat(50));
    console.log('  SESSION STATISTICS (since bot start)');
    console.log('━'.repeat(50));

    const bs = runtimeStats.bidStats;
    const totalActions = bs.bidsPlaced + bs.bidsSkipped;
    const successRate = totalActions > 0
      ? ((bs.bidsPlaced / totalActions) * 100).toFixed(1)
      : '0.0';

    console.log(`  Bids Placed:     ${chalk.green(bs.bidsPlaced.toString())}`);
    console.log(`  Bids Skipped:    ${chalk.yellow(bs.bidsSkipped.toString())}`);
    console.log(`  Bids Adjusted:   ${chalk.blue(bs.bidsAdjusted.toString())}`);
    console.log(`  Bids Cancelled:  ${chalk.yellow(bs.bidsCancelled.toString())}`);
    console.log(`  Errors:          ${bs.errors > 0 ? chalk.red(bs.errors.toString()) : bs.errors}`);
    console.log(`  Success Rate:    ${chalk.cyan(successRate + '%')}`);
    console.log('');

    // Rate Limiter
    console.log('━'.repeat(50));
    console.log('  RATE LIMITER');
    console.log('━'.repeat(50));

    const pacer = runtimeStats.pacer;
    const usedColor = pacer.bidsUsed >= pacer.bidsPerMinute ? chalk.red : chalk.green;
    console.log(`  Bids this window:  ${usedColor(pacer.bidsUsed.toString())}/${pacer.bidsPerMinute}`);
    console.log(`  Window resets in:  ${pacer.windowResetIn}s`);
    console.log(`  Total waits:       ${pacer.totalWaits}`);
    console.log('');

    // Wallet Pool (if enabled)
    if (runtimeStats.walletPool) {
      const wp = runtimeStats.walletPool;
      console.log('━'.repeat(50));
      console.log(`  WALLET POOL (${wp.available} available / ${wp.total} total)`);
      console.log('━'.repeat(50));

      wp.wallets.forEach(w => {
        const statusIcon = w.isAvailable ? chalk.green('●') : chalk.yellow('⏸');
        const bidInfo = `${w.bidCount}/${wp.bidsPerMinute} bids`;
        const resetInfo = !w.isAvailable ? chalk.dim(` (reset ${w.secondsUntilReset}s)`) : '';
        console.log(`  ${statusIcon} ${w.label}: ${bidInfo}${resetInfo}`);
      });
      console.log('');
    }

    // System
    console.log('━'.repeat(50));
    console.log('  SYSTEM');
    console.log('━'.repeat(50));

    const mem = runtimeStats.memory;
    const memColor = mem.percentage > 80 ? chalk.red : mem.percentage > 60 ? chalk.yellow : chalk.green;
    console.log(`  Memory:      ${memColor(mem.heapUsedMB + ' MB')} / ${mem.heapTotalMB} MB (${mem.percentage}%)`);
    console.log(`  Queue:       ${runtimeStats.queue.size} events`);

    const wsStatus = runtimeStats.websocket.connected
      ? chalk.green('● Connected')
      : chalk.red('● Disconnected');
    console.log(`  WebSocket:   ${wsStatus}`);

    const lastUpdateSec = Math.floor((Date.now() - runtimeStats.timestamp) / 1000);
    console.log(`  Last update: ${lastUpdateSec}s ago`);
    console.log('');
  }

  // Configuration
  console.log('━'.repeat(50));
  console.log('  CONFIGURATION');
  console.log('━'.repeat(50));
  console.log(`  Collections:  ${collections.length}`);
  console.log(`  Wallets:      ${wallets?.wallets.length || 0} (+ Main Wallet)`);
  console.log('');

  // Active Collections
  if (collections.length > 0) {
    console.log('━'.repeat(50));
    console.log('  ACTIVE COLLECTIONS');
    console.log('━'.repeat(50));

    const headers = ['Collection', 'Type', 'Bid Range', 'Counter-Bid'];
    const rows = collections.map(c => [
      c.collectionSymbol.length > 20 ? c.collectionSymbol.slice(0, 17) + '...' : c.collectionSymbol,
      c.offerType,
      `${c.minBid}-${c.maxBid} BTC`,
      c.enableCounterBidding ? 'Yes' : 'No',
    ]);

    showTable(headers, rows, [24, 12, 18, 12]);
  }

  // Bid History (if available)
  if (stats.bidHistory && Object.keys(stats.bidHistory).length > 0) {
    console.log('');
    console.log('━'.repeat(50));
    console.log('  BID ACTIVITY');
    console.log('━'.repeat(50));

    for (const [symbol, data] of Object.entries(stats.bidHistory) as any) {
      const ourBids = Object.keys(data.ourBids || {}).length;
      const topBids = Object.values(data.topBids || {}).filter(Boolean).length;

      console.log(`  ${symbol}:`);
      console.log(`    Active bids: ${ourBids}`);
      console.log(`    Top bids:    ${topBids}`);
      console.log(`    Items won:   ${data.quantity || 0}`);
    }
  }

  // Environment Status
  console.log('');
  console.log('━'.repeat(50));
  console.log('  ENVIRONMENT');
  console.log('━'.repeat(50));

  const envChecks = [
    { name: 'FUNDING_WIF', set: !!process.env.FUNDING_WIF },
    { name: 'TOKEN_RECEIVE_ADDRESS', set: !!process.env.TOKEN_RECEIVE_ADDRESS },
    { name: 'API_KEY', set: !!process.env.API_KEY },
    { name: 'ENABLE_WALLET_ROTATION', set: process.env.ENABLE_WALLET_ROTATION === 'true' },
    { name: 'ENABLE_ADDRESS_ROTATION', set: process.env.ENABLE_ADDRESS_ROTATION === 'true' },
  ];

  envChecks.forEach(check => {
    const icon = check.set ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon} ${check.name}`);
  });

  console.log('');
}
