import { getStatus, getBotRuntimeStats } from '../../services/BotProcessManager';
import {
  showSectionHeader,
  getSeparatorWidth,
} from '../../utils/display';
import { hasFundingWIF, hasReceiveAddress } from '../../../utils/fundingWallet';
import chalk = require('chalk');

export async function viewStatus(): Promise<void> {
  showSectionHeader('BOT STATUS');

  const status = getStatus();

  // Bot Status
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('  BOT STATUS');
  console.log('━'.repeat(getSeparatorWidth()));

  if (status.running) {
    console.log(`  Status:   ${chalk.green('RUNNING')}`);
    console.log(`  PID:      ${status.pid}`);
    console.log(`  Uptime:   ${status.uptime}`);
    if (status.startedAt) {
      console.log(`  Started:  ${status.startedAt.toLocaleString()}`);
    }
  } else {
    console.log(`  Status:   ${chalk.red('STOPPED')}`);
  }

  console.log('');

  // System Health (from API, only when running)
  if (status.running) {
    const runtimeStats = await getBotRuntimeStats();

    if (runtimeStats) {
      console.log('━'.repeat(getSeparatorWidth()));
      console.log('  SYSTEM HEALTH');
      console.log('━'.repeat(getSeparatorWidth()));

      const mem = runtimeStats.memory;
      const memColor = mem.percentage > 80 ? chalk.red : mem.percentage > 60 ? chalk.yellow : chalk.green;
      console.log(`  Memory:      ${memColor(mem.heapUsedMB + ' MB')} / ${mem.heapTotalMB} MB (${mem.percentage}%)`);
      console.log(`  Queue:       ${runtimeStats.queue.size} events`);

      const wsStatus = runtimeStats.websocket.connected
        ? chalk.green('Connected')
        : chalk.red('Disconnected');
      console.log(`  WebSocket:   ${wsStatus}`);

      const lastUpdateSec = Math.floor((Date.now() - runtimeStats.timestamp) / 1000);
      console.log(`  Last update: ${lastUpdateSec}s ago`);
      console.log('');
    }
  }

  // Environment (always shown)
  console.log('━'.repeat(getSeparatorWidth()));
  console.log('  ENVIRONMENT');
  console.log('━'.repeat(getSeparatorWidth()));

  const envChecks = [
    { name: 'FUNDING_WIF', set: hasFundingWIF() },
    { name: 'TOKEN_RECEIVE_ADDRESS', set: hasReceiveAddress() },
    { name: 'API_KEY', set: !!process.env.API_KEY },
    { name: 'ENABLE_WALLET_ROTATION', set: process.env.ENABLE_WALLET_ROTATION === 'true' },
  ];

  envChecks.forEach(check => {
    const icon = check.set ? chalk.green('[OK]') : chalk.red('[X]');
    console.log(`  ${icon} ${check.name}`);
  });

  console.log('');
}
