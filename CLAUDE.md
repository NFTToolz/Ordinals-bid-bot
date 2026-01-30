# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An automated bidding bot for Bitcoin Ordinals (NFTs) on Magic Eden marketplace. It monitors collections, places strategic bids, executes counter-bidding, and manages offers.

## Commands

```bash
# Install dependencies
yarn install

# Start bidding bot
yarn bid

# Development mode with auto-reload
yarn dev

# Cancel all active offers
yarn cancel

# Cancel and restart bidding (cancel + 5s delay + bid)
yarn restart

# Scan available collections
yarn scan:collections

# Build TypeScript
yarn build
```

## Architecture

### Core Flow
```
Entry (bid.ts) → EventManager → Bid Placement → Blockchain
                    ↓
        ┌──────────┴──────────┐
        │                     │
   WebSocket              Scheduled Loop
   (counter-bid)          (periodic bid)
        │                     │
        └──────────┬──────────┘
                   ↓
             Queue Processor
                   ↓
         Create Offer (Magic Eden API)
                   ↓
         Sign → Submit to Magic Eden
```

### Key Files

| File | Purpose |
|------|---------|
| `src/bid.ts` | Main entry point with EventManager, WebSocket, bidding loop |
| `src/functions/Offer.ts` | Offer management (place/cancel/sign) |
| `src/functions/Tokens.ts` | Token retrieval and collection data |
| `src/functions/Collection.ts` | Collection metadata and best offer queries |
| `src/utils/logger.ts` | Structured logging with statistics |
| `src/axios/axiosInstance.ts` | HTTP client with retry/backoff logic |
| `src/bottleneck/index.ts` | Rate limiter (configurable via RATE_LIMIT) |
| `collections.json` | Bidding configuration per collection |

### Bid State Tracking

The `bidHistory` object tracks per-collection state:
- `ourBids`: Active bids with price and expiration
- `topBids`: Boolean map of tokens where we have top bid
- `bottomListings`: Lowest priced listings for targeting
- `quantity`: Count of tokens purchased

### Bid Calculation

```
minOffer = max(minBid, minFloorBid% of floor)
maxOffer = min(maxBid, maxFloorBid% of floor)
```

Bidding above 100% of floor price is blocked for ITEM and COLLECTION offers (allowed for trait bidding).

## Configuration

### Environment Variables (.env)
```
TOKEN_RECEIVE_ADDRESS    # Ordinals delivery address
FUNDING_WIF              # Private key (Wallet Import Format)
API_KEY                  # Magic Eden API key
RATE_LIMIT               # Requests per second (default: 32)
DEFAULT_OUTBID_MARGIN    # Outbid margin in BTC
DEFAULT_LOOP             # Seconds between bidding cycles
```

### Collection Config (collections.json)
```json
{
  "collectionSymbol": "collection-name",
  "minBid": 0.001,           // Min bid in BTC
  "maxBid": 0.002,           // Max bid in BTC
  "minFloorBid": 50,         // Min % of floor
  "maxFloorBid": 97,         // Max % of floor
  "bidCount": 20,            // Items to bid on
  "duration": 60,            // Offer duration (minutes)
  "scheduledLoop": 60,       // Cycle interval (seconds)
  "enableCounterBidding": true,
  "outBidMargin": 1e-6,      // Outbid margin in BTC
  "offerType": "ITEM",       // ITEM, COLLECTION
  "quantity": 1,             // Max items to win
  "feeSatsPerVbyte": 28,     // Network fee
  "traits": []               // Optional trait filters
}
```

## Key Patterns

### Rate Limiting Strategy
- Bottleneck enforces request rate per RATE_LIMIT env var
- Axios retry with exponential backoff for 429/400 errors

### Memory Management
- Bid history cleanup runs hourly (24-hour TTL)
- Event queue capped at 1000 events
- Max 100 bids tracked per collection
- Memory monitoring every 5 minutes with alerts

### Processing Guards
- `processingTokens` map prevents race conditions on same token
- `EventManager.isScheduledRunning` and `isProcessingQueue` coordinate WebSocket vs scheduled tasks
- WebSocket reconnection with exponential backoff (max 5 retries)

## TypeScript

- Strict mode enabled
- Key interfaces: `IToken`, `IOffer`, `ICollectionOffer`, `CollectionData`
- Uses bitcoinjs-lib, ecpair, tiny-secp256k1 for Bitcoin operations
