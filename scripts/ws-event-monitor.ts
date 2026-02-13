/**
 * WebSocket Event Monitor
 *
 * Connects to Magic Eden's WebSocket and subscribes to your configured collections.
 * Shows real-time event frequency, all event kinds observed, and highlights
 * any unhandled kinds the bot doesn't currently watch.
 *
 * Usage:  npx ts-node scripts/ws-event-monitor.ts [--duration 60]
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// --- Config ---
const WS_ENDPOINT =
  'wss://wss-mainnet.magiceden.io/CJMw7IPrGPUb13adEQYW2ASbR%2FIWToagGUCr02hWp1oWyLAtf5CS0XF69WNXj0MbO6LEQLrFQMQoEqlX7%2Fny2BP08wjFc9MxzEmM5v2c5huTa3R1DPqGSbuO2TXKEEneIc4FMEm5ZJruhU8y4cyfIDzGqhWDhxK3iRnXtYzI0FGG1%2BMKyx9WWOpp3lLA3Gm2BgNpHHp3wFEas5TqVdJn0GtBrptg8ZEveG8c44CGqfWtEsS0iI8LZDR7tbrZ9fZpbrngDaimEYEH6MgvhWPTlKrsGw%3D%3D';

const WATCHED_EVENTS = [
  'offer_placed',
  'coll_offer_created',
  'coll_offer_edited',
  'offer_cancelled',
  'coll_offer_cancelled',
  'buying_broadcasted',
  'offer_accepted_broadcasted',
  'coll_offer_fulfill_broadcasted',
];

// Parse args
const args = process.argv.slice(2);
let durationSec = 60;
const durationIdx = args.indexOf('--duration');
if (durationIdx !== -1 && args[durationIdx + 1]) {
  durationSec = parseInt(args[durationIdx + 1], 10) || 60;
}

// --collections flag: comma-separated list overrides config file
let collectionSymbols: string[] = [];
const colIdx = args.indexOf('--collections');
if (colIdx !== -1 && args[colIdx + 1]) {
  collectionSymbols = args[colIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
}

// Fall back to config file if no --collections flag
if (collectionSymbols.length === 0) {
  const collectionsPath = path.join(process.cwd(), 'config/collections.json');
  if (!fs.existsSync(collectionsPath)) {
    console.error('Usage: ts-node scripts/ws-event-monitor.ts --collections omb,nodemonkes,bitcoin-puppets [--duration 60]');
    process.exit(1);
  }
  const parsed = JSON.parse(fs.readFileSync(collectionsPath, 'utf-8'));
  collectionSymbols = parsed.map((c: { collectionSymbol: string }) => c.collectionSymbol);
}

// --- Stats tracking ---
interface EventRecord {
  kind: string;
  collection: string;
  timestamp: number;
}

const allEvents: EventRecord[] = [];
// kind → count
const kindCounts = new Map<string, number>();
// collection → kind → count
const collectionKindCounts = new Map<string, Map<string, number>>();
// Track non-JSON and malformed messages
let nonJsonMessages = 0;
let malformedMessages = 0;
let totalMessages = 0;

const startTime = Date.now();

// --- Display ---
const CLEAR = '\x1b[2J\x1b[H';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';

function render() {
  const elapsed = (Date.now() - startTime) / 1000;
  const totalEvents = allEvents.length;
  const eventsPerSec = totalEvents / Math.max(elapsed, 1);

  // Count events in last 10s for recent rate
  const tenSecsAgo = Date.now() - 10_000;
  const recentCount = allEvents.filter((e) => e.timestamp >= tenSecsAgo).length;
  const recentRate = recentCount / Math.min(elapsed, 10);

  let out = CLEAR;
  out += `${BOLD}${CYAN}━━━ Magic Eden WebSocket Event Monitor ━━━${RESET}\n`;
  out += `${DIM}Collections: ${collectionSymbols.join(', ')}${RESET}\n`;
  out += `${DIM}Elapsed: ${elapsed.toFixed(0)}s / ${durationSec}s${RESET}\n\n`;

  // Overall stats
  out += `${BOLD}Overall${RESET}\n`;
  out += `  Total messages:  ${totalMessages}  (non-JSON: ${nonJsonMessages}, malformed: ${malformedMessages})\n`;
  out += `  Valid events:    ${totalEvents}\n`;
  out += `  Avg rate:        ${BOLD}${eventsPerSec.toFixed(1)}/s${RESET}\n`;
  out += `  Recent rate:     ${BOLD}${recentRate.toFixed(1)}/s${RESET} ${DIM}(last 10s)${RESET}\n`;

  // Ready gate simulation: how many events arrive in first N seconds
  const burstWindows = [2, 5, 10];
  const burstCounts = burstWindows.map((w) => {
    const cutoff = startTime + w * 1000;
    return allEvents.filter((e) => e.timestamp <= cutoff).length;
  });
  out += `  Burst:           ${burstWindows.map((w, i) => `${burstCounts[i]} in ${w}s`).join('  |  ')}\n\n`;

  // Event kinds breakdown
  const sortedKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);
  out += `${BOLD}Event Kinds${RESET}\n`;
  out += `  ${'Kind'.padEnd(42)} ${'Count'.padStart(7)}  ${'Rate'.padStart(8)}  Status\n`;
  out += `  ${'─'.repeat(42)} ${'─'.repeat(7)}  ${'─'.repeat(8)}  ${'─'.repeat(12)}\n`;

  for (const [kind, count] of sortedKinds) {
    const rate = (count / Math.max(elapsed, 1)).toFixed(2);
    const isWatched = WATCHED_EVENTS.includes(kind);
    const status = isWatched
      ? `${GREEN}HANDLED${RESET}`
      : `${RED}UNHANDLED${RESET}`;
    out += `  ${kind.padEnd(42)} ${String(count).padStart(7)}  ${(rate + '/s').padStart(8)}  ${status}\n`;
  }

  // Per-collection breakdown
  out += `\n${BOLD}Per-Collection Breakdown${RESET}\n`;
  for (const symbol of collectionSymbols) {
    const kindMap = collectionKindCounts.get(symbol);
    if (!kindMap || kindMap.size === 0) {
      out += `  ${YELLOW}${symbol}${RESET}: ${DIM}(no events)${RESET}\n`;
      continue;
    }
    const total = [...kindMap.values()].reduce((s, v) => s + v, 0);
    const rate = (total / Math.max(elapsed, 1)).toFixed(1);
    out += `  ${CYAN}${symbol}${RESET}  ${DIM}(${total} events, ${rate}/s)${RESET}\n`;

    const sorted = [...kindMap.entries()].sort((a, b) => b[1] - a[1]);
    for (const [kind, count] of sorted) {
      const isWatched = WATCHED_EVENTS.includes(kind);
      const marker = isWatched ? GREEN + '●' + RESET : RED + '○' + RESET;
      out += `    ${marker} ${kind.padEnd(40)} ${String(count).padStart(6)}\n`;
    }
  }

  // Show events from collections NOT in our config
  const unknownCollections = new Map<string, number>();
  for (const e of allEvents) {
    if (!collectionSymbols.includes(e.collection)) {
      unknownCollections.set(e.collection, (unknownCollections.get(e.collection) || 0) + 1);
    }
  }
  if (unknownCollections.size > 0) {
    out += `\n${BOLD}${YELLOW}Unexpected Collections${RESET} ${DIM}(events for collections we didn't subscribe to)${RESET}\n`;
    const sorted = [...unknownCollections.entries()].sort((a, b) => b[1] - a[1]);
    for (const [col, count] of sorted.slice(0, 10)) {
      out += `  ${col.padEnd(42)} ${String(count).padStart(6)}\n`;
    }
    if (sorted.length > 10) {
      out += `  ${DIM}...and ${sorted.length - 10} more${RESET}\n`;
    }
  }

  // Queue pressure simulation
  out += `\n${BOLD}Queue Pressure Estimate${RESET}\n`;
  const queueCap = 1000;
  if (totalEvents > 0) {
    const fillTimeSec = queueCap / eventsPerSec;
    const fillTimeRecent = queueCap / Math.max(recentRate, 0.1);
    out += `  At avg rate (${eventsPerSec.toFixed(1)}/s):    queue fills in ${MAGENTA}${fillTimeSec.toFixed(0)}s${RESET}\n`;
    out += `  At recent rate (${recentRate.toFixed(1)}/s):  queue fills in ${MAGENTA}${fillTimeRecent.toFixed(0)}s${RESET}\n`;
    out += `  ${DIM}(1000 event cap, assumes no draining — worst case startup scenario)${RESET}\n`;
  } else {
    out += `  ${DIM}Waiting for events...${RESET}\n`;
  }

  out += `\n${DIM}${GREEN}● = handled by bot${RESET}  ${DIM}${RED}○ = not handled (review needed)${RESET}\n`;
  out += `${DIM}Press Ctrl+C to stop early${RESET}\n`;

  process.stdout.write(out);
}

// --- WebSocket ---
console.log(`Connecting to Magic Eden WebSocket...`);
console.log(`Subscribing to ${collectionSymbols.length} collections: ${collectionSymbols.join(', ')}`);
console.log(`Running for ${durationSec}s\n`);

const ws = new WebSocket(WS_ENDPOINT);

ws.on('open', () => {
  console.log('Connected! Subscribing...\n');

  for (const symbol of collectionSymbols) {
    ws.send(JSON.stringify({
      type: 'subscribeCollection',
      constraint: { chain: 'bitcoin', collectionSymbol: symbol },
    }));
  }

  // Start rendering
  const renderInterval = setInterval(render, 1000);

  // End timer
  const endTimer = setTimeout(() => {
    clearInterval(renderInterval);
    ws.close();
    render(); // final render
    printSummary();
    process.exit(0);
  }, durationSec * 1000);

  ws.on('close', () => {
    clearInterval(renderInterval);
    clearTimeout(endTimer);
  });
});

ws.on('message', (data: WebSocket.Data) => {
  totalMessages++;

  let parsed: any;
  try {
    parsed = JSON.parse(data.toString());
  } catch {
    nonJsonMessages++;
    return;
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') {
    malformedMessages++;
    return;
  }

  const kind: string = parsed.kind;
  const collection: string = parsed.collectionSymbol || '(unknown)';
  const now = Date.now();

  allEvents.push({ kind, collection, timestamp: now });
  kindCounts.set(kind, (kindCounts.get(kind) || 0) + 1);

  if (!collectionKindCounts.has(collection)) {
    collectionKindCounts.set(collection, new Map());
  }
  collectionKindCounts.get(collection)!.set(kind, (collectionKindCounts.get(collection)!.get(kind) || 0) + 1);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

function printSummary() {
  const elapsed = (Date.now() - startTime) / 1000;
  const total = allEvents.length;

  console.log('\n\n━━━ FINAL SUMMARY ━━━\n');
  console.log(`Duration:        ${elapsed.toFixed(0)}s`);
  console.log(`Total messages:  ${totalMessages}`);
  console.log(`Valid events:    ${total}`);
  console.log(`Avg rate:        ${(total / Math.max(elapsed, 1)).toFixed(1)}/s`);
  console.log(`Non-JSON msgs:   ${nonJsonMessages}`);
  console.log(`Malformed msgs:  ${malformedMessages}`);

  console.log('\nAll event kinds observed:');
  const sortedKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [kind, count] of sortedKinds) {
    const isWatched = WATCHED_EVENTS.includes(kind);
    const tag = isWatched ? '[HANDLED]  ' : '[UNHANDLED]';
    console.log(`  ${tag} ${kind.padEnd(42)} ${count}`);
  }

  const unhandled = sortedKinds.filter(([k]) => !WATCHED_EVENTS.includes(k));
  if (unhandled.length === 0) {
    console.log('\n✅ All observed event kinds are handled by the bot.');
  } else {
    console.log(`\n⚠️  ${unhandled.length} unhandled event kind(s):`);
    for (const [kind, count] of unhandled) {
      console.log(`   - ${kind} (${count} events)`);
    }
    console.log('\nReview these in WATCHED_EVENTS (src/utils/bidLogic.ts) to decide if any need handling.');
  }
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
  ws.close();
  render();
  printSummary();
  process.exit(0);
});
