import { fetchBotRuntimeStatsFromApi, BotRuntimeStats, BidHistoryEntry } from '../../services/BotProcessManager';
import { satsToBTC } from '../../../utils/bidLogic';
import {
  showSectionHeader,
  showTable,
  showWarning,
  showInfo,
  formatAddress,
  withSpinner,
} from '../../utils/display';
import { withLiveRefresh } from '../../utils/liveRefresh';
import chalk = require('chalk');
import inquirer = require('inquirer');

/**
 * Render the overview dashboard (pure output, no fetching).
 */
function renderOverview(stats: BotRuntimeStats): void {
  // SESSION STATISTICS
  showSectionHeader('SESSION STATISTICS');
  const bs = stats.bidStats;
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

  // RATE LIMITER
  showSectionHeader('RATE LIMITER');
  const pacer = stats.pacer;
  const usedColor = pacer.bidsUsed >= pacer.bidsPerMinute ? chalk.red : chalk.green;
  console.log(`  Bids this window:  ${usedColor(pacer.bidsUsed.toString())}/${pacer.bidsPerMinute}`);
  console.log(`  Window resets in:  ${pacer.windowResetIn}s`);
  console.log(`  Total waits:       ${pacer.totalWaits}`);
  console.log('');

  // WALLET GROUPS or WALLET POOL
  if (stats.walletGroups) {
    const wg = stats.walletGroups;
    showSectionHeader(`WALLET GROUPS (${wg.groupCount} group(s), ${wg.totalWallets} wallets)`);

    for (const group of wg.groups) {
      console.log(`  ${chalk.bold(group.name)} (${group.available}/${group.total} available, ${group.bidsPerMinute} bids/min)`);
      group.wallets.forEach(w => {
        const statusIcon = w.isAvailable ? chalk.green('*') : chalk.yellow('-');
        const bidInfo = `${w.bidsInWindow}/${group.bidsPerMinute} bids`;
        const resetInfo = !w.isAvailable ? chalk.dim(` (reset ${w.secondsUntilReset}s)`) : '';
        console.log(`    ${statusIcon} ${w.label}: ${bidInfo}${resetInfo}`);
      });
    }
    console.log('');
  } else if (stats.walletPool) {
    const wp = stats.walletPool;
    showSectionHeader(`WALLET POOL (${wp.available} available / ${wp.total} total)`);

    wp.wallets.forEach(w => {
      const statusIcon = w.isAvailable ? chalk.green('*') : chalk.yellow('-');
      const bidInfo = `${w.bidsInWindow}/${wp.bidsPerMinute} bids`;
      const resetInfo = !w.isAvailable ? chalk.dim(` (reset ${w.secondsUntilReset}s)`) : '';
      console.log(`  ${statusIcon} ${w.label}: ${bidInfo}${resetInfo}`);
    });
    console.log('');
  }

  // ACTIVE COLLECTIONS TABLE
  const collections = stats.collections || [];
  const bidHistory = stats.bidHistory || {};

  if (collections.length > 0) {
    showSectionHeader('ACTIVE COLLECTIONS');

    const headers = ['Collection', 'Type', 'Bid Range', 'Active', 'Top', 'Won'];
    const rows = collections.map(c => {
      const history = bidHistory[c.collectionSymbol];
      const activeBids = history ? Object.keys(history.ourBids || {}).length : 0;
      const topBids = history ? Object.values(history.topBids || {}).filter(Boolean).length : 0;
      const won = history?.quantity || 0;

      return [
        c.collectionSymbol.length > 20 ? c.collectionSymbol.slice(0, 17) + '...' : c.collectionSymbol,
        c.offerType,
        `${c.minBid}-${c.maxBid}`,
        activeBids.toString(),
        topBids.toString(),
        won.toString(),
      ];
    });

    showTable(headers, rows, [22, 12, 16, 8, 6, 6]);
  } else {
    showInfo('No collections configured.');
  }
}

/**
 * Bidding Stats > Overview
 * Session stats, rate limiter, wallet pool, and active collections table.
 * Auto-refreshes every 5s with live keypress controls.
 */
export async function viewStatsOverview(): Promise<void> {
  const stats = await withSpinner('Fetching live stats...', () => fetchBotRuntimeStatsFromApi());

  if (!stats) {
    showWarning('Bot is not running.');
    return;
  }

  await withLiveRefresh({
    render: async () => {
      const fresh = await fetchBotRuntimeStatsFromApi();
      if (!fresh) {
        showWarning('Bot stopped — press Enter to exit.');
        return;
      }
      renderOverview(fresh);
    },
  });
}

/**
 * Format relative time from an expiration timestamp.
 */
function formatRelativeTime(expirationMs: number): string {
  const diffMs = expirationMs - Date.now();

  if (diffMs <= 0) return chalk.red('expired');

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }
  return `in ${minutes}m`;
}

/**
 * Render collection detail view (pure output, no fetching).
 */
function renderDetail(
  config: NonNullable<BotRuntimeStats['collections']>[number],
  history: BidHistoryEntry | undefined,
  marketData: { floorBTC: string; supply: string; totalListed: string } | null,
): void {
  // COLLECTION CONFIG
  showSectionHeader('COLLECTION CONFIG');
  console.log(`  Offer Type:       ${config.offerType}`);
  console.log(`  Bid Range:        ${config.minBid} - ${config.maxBid} BTC`);
  console.log(`  Floor% Range:     ${config.minFloorBid}% - ${config.maxFloorBid}%`);
  console.log(`  Bid Count Target: ${config.bidCount}`);
  console.log(`  Duration:         ${config.duration} min`);
  console.log(`  Outbid Margin:    ${config.outBidMargin} BTC`);
  console.log(`  Counter-bid:      ${config.enableCounterBidding ? chalk.green('Enabled') : chalk.red('Disabled')}`);
  console.log(`  Max Wins:         ${config.quantity}`);
  if (config.walletGroup) {
    console.log(`  Wallet Group:     ${config.walletGroup}`);
  }
  console.log('');

  // LIVE MARKET DATA (cached)
  showSectionHeader('MARKET DATA');
  if (marketData) {
    console.log(`  Floor Price:  ${marketData.floorBTC} BTC`);
    console.log(`  Supply:       ${marketData.supply}`);
    console.log(`  Listed:       ${marketData.totalListed}`);
  } else {
    console.log(`  ${chalk.dim('[unavailable]')}`);
  }
  console.log('');

  // BID STATUS + TABLE
  if (history) {
    const ourBids = history.ourBids || {};
    const topBids = history.topBids || {};
    const activeBidCount = Object.keys(ourBids).length;
    const topBidCount = Object.values(topBids).filter(Boolean).length;
    const topPct = activeBidCount > 0 ? Math.round((topBidCount / activeBidCount) * 100) : 0;

    showSectionHeader('BID STATUS');
    console.log(`  Active Bids: ${activeBidCount}/${config.bidCount} target    Top Bids: ${topBidCount}/${activeBidCount} (${topPct}%)`);
    console.log('');

    if (activeBidCount > 0) {
      const showWalletCol = process.env.ENABLE_WALLET_ROTATION === 'true';

      const headers = showWalletCol
        ? ['Token', 'Price', 'Expiry', 'Top?', 'Wallet']
        : ['Token', 'Price', 'Expiry', 'Top?'];

      const MAX_DISPLAY = 20;
      const allEntries = Object.entries(ourBids).sort((a, b) => b[1].price - a[1].price);
      const displayEntries = allEntries.slice(0, MAX_DISPLAY);

      const rows = displayEntries.map(([tokenId, bid]) => {
          const priceBTC = satsToBTC(bid.price) + ' BTC';
          const expiry = formatRelativeTime(bid.expiration);
          const isTop = topBids[tokenId] ? chalk.green('Yes') : chalk.red('No');
          const row = [
            formatAddress(tokenId, 6),
            priceBTC,
            expiry,
            isTop,
          ];
          if (showWalletCol) {
            row.push(bid.paymentAddress ? formatAddress(bid.paymentAddress, 4) : '-');
          }
          return row;
        });

      const widths = showWalletCol
        ? [16, 16, 12, 6, 12]
        : [16, 16, 12, 6];

      showTable(headers, rows, widths);

      if (allEntries.length > MAX_DISPLAY) {
        console.log(chalk.dim(`  Showing ${MAX_DISPLAY} of ${allEntries.length} bids (highest price first)`));
      }
    }
  } else {
    showInfo('No bid activity for this collection yet.');
  }
}

/**
 * Bidding Stats > Collection Jobs
 * Pick a collection, then show config + market data + bid table.
 * Auto-refreshes every 5s (market data cached from first fetch).
 */
export async function viewCollectionDetails(): Promise<void> {
  const stats = await withSpinner('Fetching live stats...', () => fetchBotRuntimeStatsFromApi());

  if (!stats) {
    showWarning('Bot is not running.');
    return;
  }

  const collections = stats.collections || [];
  const bidHistory = stats.bidHistory || {};

  if (collections.length === 0) {
    showInfo('No collections configured.');
    return;
  }

  // Build picker choices
  const choices = collections.map(c => {
    const history = bidHistory[c.collectionSymbol];
    const activeBids = history ? Object.keys(history.ourBids || {}).length : 0;
    const won = history?.quantity || 0;
    const suffix = activeBids > 0 || won > 0
      ? ` (${activeBids} active bid${activeBids !== 1 ? 's' : ''}, ${won} won)`
      : '';
    return {
      name: `${c.collectionSymbol}${suffix}`,
      value: c.collectionSymbol,
    };
  });
  choices.push({ name: chalk.dim('<- Back'), value: '__back__' });

  const { selected } = await inquirer.prompt([{
    type: 'list',
    name: 'selected',
    message: 'Select a collection:',
    pageSize: 15,
    choices,
  }]);

  if (selected === '__back__') return;

  const config = collections.find(c => c.collectionSymbol === selected);
  if (!config) return;

  await withLiveRefresh({
    render: async () => {
      const fresh = await fetchBotRuntimeStatsFromApi();
      if (!fresh) {
        showWarning('Bot stopped — press Enter to exit.');
        return;
      }
      // Re-find config from fresh stats (in case collections changed)
      const freshConfig = (fresh.collections || []).find(c => c.collectionSymbol === selected);
      const freshHistory = (fresh.bidHistory || {})[selected];

      // Read market data from bot's cached stats (populated each bidding cycle)
      let marketData: { floorBTC: string; supply: string; totalListed: string } | null = null;
      const cached = freshHistory?.marketData;
      if (cached) {
        marketData = {
          floorBTC: (cached.floorPrice / 100000000).toFixed(8),
          supply: cached.supply,
          totalListed: cached.totalListed,
        };
      }

      renderDetail(freshConfig || config, freshHistory, marketData);
    },
  });
}
