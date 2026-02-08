/**
 * Enhanced logging utility for bid bot
 * Provides color-coded, timestamped logs with better visibility
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// Log level system
export enum LogLevel { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 }

function parseLogLevel(value: string | undefined): LogLevel {
  switch (value?.toLowerCase()) {
    case 'debug': return LogLevel.DEBUG;
    case 'warn': case 'warning': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

let currentLogLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

export function setLogLevel(level: LogLevel): void { currentLogLevel = level; }
export function getLogLevel(): LogLevel { return currentLogLevel; }

function shouldLog(level: LogLevel): boolean { return level >= currentLogLevel; }

// Bid statistics tracking
export class BidStats {
  private stats = {
    bidsPlaced: 0,
    bidsSkipped: 0,
    bidsCancelled: 0,
    bidsAdjusted: 0,
    errors: 0,
    lastReset: Date.now()
  };

  increment(type: 'bidsPlaced' | 'bidsSkipped' | 'bidsCancelled' | 'bidsAdjusted' | 'errors') {
    this.stats[type]++;
  }

  getStats() {
    const runtime = (Date.now() - this.stats.lastReset) / 1000 / 60; // minutes
    return {
      ...this.stats,
      runtime: runtime.toFixed(1)
    };
  }

  reset() {
    this.stats = {
      bidsPlaced: 0,
      bidsSkipped: 0,
      bidsCancelled: 0,
      bidsAdjusted: 0,
      errors: 0,
      lastReset: Date.now()
    };
  }

  printSummary() {
    const stats = this.getStats();
    console.log(`${colors.bright}${colors.cyan}╔════════════════════ BID STATISTICS ════════════════════╗${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Runtime:        ${colors.bright}${stats.runtime} minutes${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Bids Placed:    ${colors.green}${colors.bright}${stats.bidsPlaced}${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Bids Adjusted:  ${colors.blue}${colors.bright}${stats.bidsAdjusted}${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Bids Cancelled: ${colors.yellow}${colors.bright}${stats.bidsCancelled}${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Bids Skipped:   ${colors.magenta}${colors.bright}${stats.bidsSkipped}${colors.reset}`);
    console.log(`${colors.cyan}║${colors.reset} Errors:         ${colors.red}${colors.bright}${stats.errors}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════════╝${colors.reset}\n`);
  }
}

export const bidStats = new BidStats();

// Export getter for external access to stats
export function getBidStatsData() {
  return bidStats.getStats();
}

// Get timestamp
function getTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Format BTC amount
export function formatBTC(sats: number): string {
  return `${(sats / 1e8).toFixed(8)} BTC`;
}

// Format sats with BTC equivalent
export function formatSats(sats: number): string {
  return `${sats.toLocaleString()} sats (${formatBTC(sats)})`;
}

// Format token ID (show last 8 chars)
export function formatTokenId(tokenId: string): string {
  return tokenId.length > 12 ? `...${tokenId.slice(-8)}` : tokenId;
}

export const Logger = {
  // Debug - Verbose diagnostic output (only visible at LOG_LEVEL=debug)
  debug(message: string, details?: unknown) {
    if (!shouldLog(LogLevel.DEBUG)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.dim}[${timestamp}] ${message}${colors.reset}`);
    if (details) {
      console.log(`  ${colors.dim}${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  },

  // Success - Bids placed, adjusted
  success(message: string, details?: unknown) {
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.green}[OK] [${timestamp}]${colors.reset} ${colors.green}${message}${colors.reset}`);
    if (details) {
      console.log(`  ${colors.dim}${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  },

  // Info - General information
  info(message: string, details?: unknown) {
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.cyan}[INFO] [${timestamp}]${colors.reset} ${message}`);
    if (details) {
      console.log(`  ${colors.dim}${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  },

  // Warning - Skipped bids, thresholds exceeded
  warning(message: string, details?: unknown) {
    if (!shouldLog(LogLevel.WARN)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.yellow}[WARN] [${timestamp}]${colors.reset} ${colors.yellow}${message}${colors.reset}`);
    if (details) {
      console.log(`  ${colors.dim}${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  },

  // Error - Failed operations
  error(message: string, error?: unknown) {
    if (!shouldLog(LogLevel.ERROR)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.red}[ERR] [${timestamp}]${colors.reset} ${colors.red}${message}${colors.reset}`);
    if (error) {
      if (error instanceof Error && error.stack) {
        console.log(`  ${colors.dim}${error.stack}${colors.reset}`);
      } else {
        console.log(`  ${colors.dim}${JSON.stringify(error, null, 2)}${colors.reset}`);
      }
    }
  },

  // Critical - System issues, memory warnings
  critical(message: string, details?: unknown) {
    if (!shouldLog(LogLevel.ERROR)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bgRed}${colors.bright}${colors.white} CRITICAL [${timestamp}] ${colors.reset} ${colors.red}${colors.bright}${message}${colors.reset}`);
    if (details) {
      console.log(`  ${colors.red}${JSON.stringify(details, null, 2)}${colors.reset}`);
    }
  },

  // Bid placed
  bidPlaced(
    collectionSymbol: string,
    tokenId: string,
    price: number,
    type: 'NEW' | 'OUTBID' | 'COUNTERBID' = 'NEW',
    details?: {
      floorPrice?: number;
      minOffer?: number;
      maxOffer?: number;
    }
  ) {
    bidStats.increment('bidsPlaced');
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.green}[${timestamp}] BID PLACED${colors.reset}`);
    console.log(`  Collection: ${colors.bright}${collectionSymbol}${colors.reset}`);
    console.log(`  Token:      ${colors.dim}${formatTokenId(tokenId)}${colors.reset}`);
    const floorPct = details?.floorPrice ? ` (${((price / details.floorPrice) * 100).toFixed(1)}% of floor)` : '';
    console.log(`  Price:      ${colors.bright}${colors.green}${formatBTC(price)}${colors.reset}${colors.dim}${floorPct}${colors.reset}`);
    if (details?.minOffer !== undefined && details?.maxOffer !== undefined) {
      console.log(`  Range:      ${colors.dim}${formatBTC(details.minOffer)} - ${formatBTC(details.maxOffer)}${colors.reset}`);
      const reason = price === details.minOffer ? 'minOffer' : price === details.maxOffer ? 'maxOffer' : 'calculated';
      console.log(`  Reason:     ${colors.dim}${reason}${colors.reset}`);
    }
    console.log(`  Type:       ${colors.cyan}${type}${colors.reset}\n`);
  },

  // Bid adjusted
  bidAdjusted(collectionSymbol: string, tokenId: string, oldPrice: number, newPrice: number) {
    bidStats.increment('bidsAdjusted');
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    const diff = newPrice - oldPrice;
    const arrow = diff > 0 ? '↑' : '↓';
    const color = diff > 0 ? colors.red : colors.green;
    console.log(`${colors.bright}${colors.blue}[${timestamp}] BID ADJUSTED${colors.reset}`);
    console.log(`  Collection: ${colors.bright}${collectionSymbol}${colors.reset}`);
    console.log(`  Token:      ${colors.dim}${formatTokenId(tokenId)}${colors.reset}`);
    console.log(`  Old Price:  ${colors.dim}${formatBTC(oldPrice)}${colors.reset}`);
    console.log(`  New Price:  ${colors.bright}${color}${formatBTC(newPrice)}${colors.reset} ${arrow} ${color}${formatBTC(Math.abs(diff))}${colors.reset}\n`);
  },

  // Bid cancelled
  bidCancelled(collectionSymbol: string, tokenId: string, reason: string) {
    bidStats.increment('bidsCancelled');
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.yellow}[${timestamp}] BID CANCELLED${colors.reset}`);
    console.log(`  Collection: ${colors.bright}${collectionSymbol}${colors.reset}`);
    console.log(`  Token:      ${colors.dim}${formatTokenId(tokenId)}${colors.reset}`);
    console.log(`  Reason:     ${colors.yellow}${reason}${colors.reset}\n`);
  },

  // Bid skipped
  bidSkipped(
    collectionSymbol: string,
    tokenId: string,
    reason: string,
    topOffer?: number,      // Actual offer from API
    ourBid?: number,        // Our calculated bid (may equal topOffer if we can't outbid)
    maxBid?: number         // Our maximum allowed bid
  ) {
    bidStats.increment('bidsSkipped');
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.magenta}[${timestamp}] BID SKIPPED${colors.reset}`);
    console.log(`  Collection: ${colors.bright}${collectionSymbol}${colors.reset}`);
    console.log(`  Token:      ${colors.dim}${formatTokenId(tokenId)}${colors.reset}`);
    console.log(`  Reason:     ${colors.magenta}${reason}${colors.reset}`);
    if (topOffer !== undefined && maxBid !== undefined) {
      // If ourBid is provided and differs from topOffer, show both
      if (ourBid !== undefined && ourBid !== topOffer) {
        console.log(`  Top Offer:  ${colors.dim}${formatBTC(topOffer)}${colors.reset}`);
        console.log(`  Our Bid:    ${colors.dim}${formatBTC(ourBid)}${colors.reset}`);
      } else {
        // When ourBid equals topOffer (or not provided), just show the offer
        console.log(`  Top Offer:  ${colors.dim}${formatBTC(topOffer)}${colors.reset}`);
      }
      console.log(`  Max Bid:    ${colors.dim}${formatBTC(maxBid)}${colors.reset}`);
    }
    console.log('');
  },

  // Collection offer placed
  collectionOfferPlaced(collectionSymbol: string, price: number) {
    bidStats.increment('bidsPlaced');
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.green}[${timestamp}] COLLECTION OFFER PLACED${colors.reset}`);
    console.log(`  Collection: ${colors.bright}${collectionSymbol}${colors.reset}`);
    console.log(`  Price:      ${colors.bright}${colors.green}${formatBTC(price)}${colors.reset}\n`);
  },

  // Schedule start
  scheduleStart(collectionSymbol: string) {
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}[${timestamp}] SCHEDULE: ${collectionSymbol}${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
  },

  // Schedule complete
  scheduleComplete(collectionSymbol: string, duration: number) {
    if (!shouldLog(LogLevel.INFO)) return;
    const timestamp = getTimestamp();
    console.log(`${colors.bright}${colors.cyan}[OK] [${timestamp}] SCHEDULE COMPLETE: ${collectionSymbol}${colors.reset} ${colors.dim}(${duration.toFixed(2)}s)${colors.reset}\n`);
  },

  // WebSocket events
  websocket: {
    connected() {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bright}${colors.green}[${timestamp}] WebSocket Connected${colors.reset}\n`);
    },

    disconnected() {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bright}${colors.red}[${timestamp}] WebSocket Disconnected${colors.reset}\n`);
    },

    subscribed(collectionSymbol: string) {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bright}${colors.cyan}[${timestamp}] Subscribed to: ${collectionSymbol}${colors.reset}`);
    },

    event(type: string, collectionSymbol: string, tokenId?: string) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      const token = tokenId ? ` | Token: ${formatTokenId(tokenId)}` : '';
      console.log(`${colors.dim}[${timestamp}] Event: ${type} | ${collectionSymbol}${token}${colors.reset}`);
    },

    error(err: unknown) {
      if (!shouldLog(LogLevel.ERROR)) return;
      const timestamp = getTimestamp();
      const errorMsg = err instanceof Error ? err.message : (typeof err === 'string' ? err : 'Unknown error');
      console.log(`${colors.bright}${colors.red}[${timestamp}] WebSocket Error: ${errorMsg}${colors.reset}`);
      if (err instanceof Error && err.stack) {
        console.log(`  ${colors.dim}${err.stack}${colors.reset}`);
      }
    },

    maxRetriesExceeded() {
      if (!shouldLog(LogLevel.ERROR)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bgRed}${colors.white}${colors.bright} [${timestamp}] WEBSOCKET MAX RETRIES EXCEEDED ${colors.reset}`);
      console.log(`${colors.red}${colors.bright}  WebSocket connection failed after maximum retry attempts.${colors.reset}`);
    }
  },

  // Memory monitoring
  memory: {
    status(heapUsedMB: number, heapTotalMB: number, queueSize: number, totalBids: number, pQueuePending?: number, pQueueActive?: number) {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      const percentage = ((heapUsedMB / heapTotalMB) * 100).toFixed(1);
      console.log(`\n${colors.bright}${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log(`${colors.bright}${colors.blue}[${timestamp}] MEMORY STATUS${colors.reset}`);
      console.log(`${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log(`  Heap:       ${colors.bright}${heapUsedMB.toFixed(2)} MB${colors.reset} / ${heapTotalMB.toFixed(2)} MB (${percentage}%)`);
      console.log(`  Queue:      ${colors.bright}${queueSize}${colors.reset} events`);
      console.log(`  Bids:       ${colors.bright}${totalBids}${colors.reset} tracked`);
      if (pQueuePending !== undefined && pQueueActive !== undefined) {
        console.log(`  Bid queue:  ${colors.bright}${pQueuePending}${colors.reset} pending, ${colors.bright}${pQueueActive}${colors.reset} active`);
      }
      console.log(`${colors.bright}${colors.blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
    },

    warning(message: string) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bgYellow}${colors.black}${colors.bright} MEMORY WARNING [${timestamp}] ${colors.reset} ${colors.yellow}${message}${colors.reset}\n`);
    },

    critical(message: string) {
      if (!shouldLog(LogLevel.ERROR)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bgRed}${colors.white}${colors.bright} MEMORY CRITICAL [${timestamp}] ${colors.reset} ${colors.red}${colors.bright}${message}${colors.reset}\n`);
    },

    cleanup(itemsCleaned: number) {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.bright}${colors.green}[${timestamp}] Cleanup: ${itemsCleaned} items removed${colors.reset}\n`);
    }
  },

  // Print statistics summary
  printStats() {
    bidStats.printSummary();
  },

  // Separator
  separator() {
    if (!shouldLog(LogLevel.INFO)) return;
    console.log(`${colors.dim}${'─'.repeat(60)}${colors.reset}`);
  },

  // Header
  header(text: string) {
    if (!shouldLog(LogLevel.INFO)) return;
    console.log(`\n${colors.bright}${colors.cyan}╔${'═'.repeat(text.length + 2)}╗${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}║ ${text} ║${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}╚${'═'.repeat(text.length + 2)}╝${colors.reset}\n`);
  },

  // Pacer logging
  pacer: {
    init(bidsPerMin: number, windowSec: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Initialized: ${bidsPerMin} bids per ${windowSec}s window${colors.reset}`);
    },

    bid(current: number, max: number, remaining: number, resetIn: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Bid ${current}/${max} in window (${remaining} remaining, reset in ${resetIn}s)${colors.reset}`);
    },

    waiting(current: number, max: number, waitSec: number) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Rate limit reached (${current}/${max}). Waiting ${waitSec}s for window reset...${colors.reset}`);
    },

    windowReset() {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Window reset. Resuming bid placement.${colors.reset}`);
    },

    error(tokenId?: string) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      const tokenSuffix = tokenId ? ` for token ${tokenId.slice(-8)}` : '';
      console.log(`${colors.yellow}[${timestamp}] [PACER] Rate limit error${tokenSuffix}${colors.reset}`);
    },

    status(used: number, max: number, remaining: number, resetIn: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Status: ${used}/${max} bids used, ${remaining} remaining, reset in ${resetIn}s${colors.reset}`);
    },

    manualReset() {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Manual reset performed${colors.reset}`);
    },

    cycleStart(remaining: number, max: number, resetIn: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [PACER] Cycle start: ${remaining}/${max} bids available, window resets in ${resetIn}s${colors.reset}`);
    },
  },

  // Rate limit logging
  rateLimit: {
    pause(durationSec: number) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.yellow}[${timestamp}] [RATE LIMIT] Global pause for ${durationSec}s${colors.reset}`);
    },

    lifted() {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.yellow}[${timestamp}] [RATE LIMIT] Global pause lifted${colors.reset}`);
    },
  },

  // Queue logging
  queue: {
    skip(tokenId: string, reason: string) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [QUEUE] Skipping ${tokenId.slice(-8)} - ${reason}${colors.reset}`);
    },

    waiting(tokenId: string, waitSec: number) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.yellow}[${timestamp}] [QUEUE] Waiting ${waitSec}s for rate limit (token: ...${tokenId.slice(-8)})${colors.reset}`);
    },

    progress(pending: number, active: number, pacerUsed: number, pacerMax: number, resetIn: number, totalBids: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [QUEUE] Pending: ${pending}, Active: ${active} | Pacer: ${pacerUsed}/${pacerMax} used, reset in ${resetIn}s | Total bids: ${totalBids}${colors.reset}`);
    },
  },

  // Tokens logging
  tokens: {
    retrieved(count: number, target: number) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [TOKENS] Retrieved ${count} tokens from API (target: ${target})${colors.reset}`);
    },

    firstListings(listings: string) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.dim}[${timestamp}] [TOKENS] First 5 listings: ${listings}${colors.reset}`);
    },
  },

  // Wallet logging
  wallet: {
    using(label: string, tokenId: string) {
      if (!shouldLog(LogLevel.DEBUG)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.blue}[${timestamp}] [WALLET] Using wallet "${label}" for bid on ${tokenId.slice(-8)}${colors.reset}`);
    },

    allRateLimited(tokenId?: string) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      const tokenSuffix = tokenId ? ` for ${tokenId.slice(-8)}` : '';
      console.log(`${colors.blue}[${timestamp}] [WALLET] All wallets rate-limited, timed out waiting${tokenSuffix}${colors.reset}`);
    },
  },

  // Schedule logging
  schedule: {
    rateLimited(collectionSymbol: string, waitSec: number) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.cyan}[${timestamp}] [SCHEDULE] ${collectionSymbol} - Rate limited, waiting ${waitSec}s before queueing${colors.reset}`);
    },

    skipping(collectionSymbol: string, remainingSec: number) {
      if (!shouldLog(LogLevel.WARN)) return;
      const timestamp = getTimestamp();
      console.log(`${colors.cyan}[${timestamp}] [SCHEDULE] ${collectionSymbol} - Globally rate limited, skipping cycle (${remainingSec}s remaining)${colors.reset}`);
    },
  },

  // Offer error logging
  offer: {
    error(operation: string, tokenId: string, message: string, httpStatus?: number, response?: unknown) {
      if (!shouldLog(LogLevel.ERROR)) return;
      const timestamp = getTimestamp();
      const statusStr = httpStatus ? ` (HTTP ${httpStatus})` : '';
      console.log(`${colors.red}[ERR] [${timestamp}] [OFFER] ${operation} error for ${tokenId.slice(-8)}${statusStr}: ${message}${colors.reset}`);
      if (response) {
        console.log(`  ${colors.dim}${JSON.stringify(response, null, 2)}${colors.reset}`);
      }
    },

    insufficientFunds(tokenId: string, bidAmount: number, required: number, available: number) {
      if (!shouldLog(LogLevel.ERROR)) return;
      const timestamp = getTimestamp();
      const estFees = required - bidAmount;
      console.log(`${colors.bright}${colors.yellow}[${timestamp}] INSUFFICIENT FUNDS${colors.reset} for ${colors.dim}${formatTokenId(tokenId)}${colors.reset}`);
      console.log(`  Bid Amount:   ${colors.bright}${bidAmount.toLocaleString()} sats${colors.reset} (${formatBTC(bidAmount)})`);
      console.log(`  Est. Fees:    ${colors.dim}~${estFees.toLocaleString()} sats${colors.reset}`);
      console.log(`  Total Req:    ${colors.bright}${required.toLocaleString()} sats${colors.reset}`);
      console.log(`  Available:    ${colors.red}${available.toLocaleString()} sats${colors.reset}`);
      console.log('');
    },
  },

  // Summary logging
  summary: {
    bidPlacement(data: {
      tokensProcessed: number;
      newBidsPlaced: number;
      bidsAdjusted: number;
      alreadyHaveBids: number;
      noActionNeeded: number;
      skippedOfferTooHigh: number;
      skippedBidTooHigh: number;
      skippedAlreadyOurs: number;
      bidsFailed: number;
      currentActiveBids: number;
      bidCount: number;
      successfulBidsPlaced?: number;
    }) {
      if (!shouldLog(LogLevel.INFO)) return;
      const timestamp = getTimestamp();
      console.log('');
      console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log(`${colors.bright}[${timestamp}] BID PLACEMENT SUMMARY${colors.reset}`);
      console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log(`  Tokens processed:          ${data.tokensProcessed}`);
      if (data.successfulBidsPlaced !== undefined) {
        console.log(`  Successful bids placed:    ${colors.bright}${data.successfulBidsPlaced}${colors.reset} / ${data.bidCount} target`);
      }
      console.log(`  NEW bids placed:           ${colors.green}${data.newBidsPlaced}${colors.reset}`);
      console.log(`  Bids adjusted:             ${colors.blue}${data.bidsAdjusted}${colors.reset}`);
      console.log(`  Already have bids:         ${data.alreadyHaveBids}`);
      console.log(`  No action needed:          ${data.noActionNeeded}`);
      console.log(`  Skipped (offer > max):     ${colors.yellow}${data.skippedOfferTooHigh}${colors.reset}`);
      console.log(`  Skipped (bid > max):       ${colors.yellow}${data.skippedBidTooHigh}${colors.reset}`);
      console.log(`  Skipped (already ours):    ${data.skippedAlreadyOurs}`);
      console.log(`  Bids failed:               ${data.bidsFailed > 0 ? colors.red + data.bidsFailed + colors.reset : data.bidsFailed}`);
      console.log(`  Total active bids:         ${colors.bright}${data.currentActiveBids}${colors.reset} / ${data.bidCount} target`);
      console.log(`${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      console.log('');
    },
  },
};

export default Logger;
