## ORDINAL BIDDING BOT

An automated bidding bot for Bitcoin Ordinals (NFTs) on Magic Eden marketplace. It monitors collections, places strategic bids, executes counter-bidding, and manages offers.

#### Requirements

- Node.js version 18+

#### Install dependencies

This project uses **yarn** (not npm). Do not run `npm install`.

```bash
yarn install
```

---

### COMMANDS

#### Development Commands

| Command | Description |
|---------|-------------|
| `yarn bid` | Start bidding bot (ts-node) |
| `yarn dev` | Development mode with auto-reload |
| `yarn cancel` | Cancel all active offers |
| `yarn restart` | Cancel and restart bidding (cancel + 5s delay + bid) |
| `yarn scan:collections` | Scan available collections |
| `yarn manage` | Interactive management console |
| `yarn build` | Build TypeScript to JavaScript |

#### Compiled Commands (after `yarn build`)

| Command | Description |
|---------|-------------|
| `yarn start` | Run compiled bidding bot |
| `yarn start:cancel` | Run compiled offer canceller |
| `yarn start:manage` | Run compiled management CLI |
| `yarn start:scan` | Run compiled collection scanner |

#### Testing Commands

| Command | Description |
|---------|-------------|
| `yarn test` | Run vitest test suite |
| `yarn test:watch` | Run tests in watch mode |
| `yarn test:coverage` | Run tests with coverage report |

---

### COLLECTION SCANNER

`yarn scan:collections`

### MANAGEMENT CLI

The bot includes an interactive management console for configuring wallets, collections, and bot operations.

```bash
yarn manage
```

#### Menu Structure

The CLI provides four main categories:

| Category | Description |
|----------|-------------|
| **WALLETS** | Manage funding wallets and view balances |
| **COLLECTIONS** | Configure bidding targets |
| **BOT CONTROL** | Start/stop bot and monitor operations |
| **SETTINGS** | Configure advanced features |

#### Wallet Commands

| Command | Description |
|---------|-------------|
| Create new wallets | Generate new funding wallets for multi-wallet rotation |
| View wallet balances | Display BTC balance across all configured wallets |
| View ordinals/NFTs | List ordinals held in wallet addresses |
| Distribute funds | Send BTC from main wallet to pool wallets |
| Consolidate funds | Sweep BTC from pool wallets back to main wallet |
| Export/backup wallets | Export wallet configuration for backup |
| Import wallets | Import wallets from backup or external source |

#### Wallet Group Commands

Wallet groups enable isolated wallet pools for different collections, each with independent rate limits.

| Command | Description |
|---------|-------------|
| View wallet groups | List all wallet groups with balances and bid rates |
| Create wallet group | Create new wallet group with configurable bidsPerMinute |
| Add wallets to group | Add wallets from existing pool, generate new, or import WIF |
| Remove wallet from group | Remove a specific wallet from a group |
| Delete empty group | Delete a wallet group (must be empty) |
| Rebalance group | Smart rebalance based on collection requirements |
| Rebalance all groups | Rebalance all groups simultaneously |

#### Collection Commands

| Command | Description |
|---------|-------------|
| List collections | View all configured collections and their settings |
| Add collection | Add a new collection with bidding parameters |
| Edit collection | Modify settings for an existing collection |
| Remove collection | Remove a collection from bidding |
| Assign to wallet group | Assign collections to specific wallet groups |
| Scan for opportunities | Find profitable collections based on floor/volume |

#### Bot Control Commands

| Command | Description |
|---------|-------------|
| Start bot | Launch the bidding bot in the background |
| Stop bot | Gracefully stop the running bot |
| View status & stats | Display comprehensive bot statistics (see below) |
| Restart bot | Stop and restart the bot (cancel offers first) |
| View logs | Tail the bot's log output in real-time |
| Cancel all offers | Cancel all active offers across collections |

#### Settings Commands

| Command | Description |
|---------|-------------|
| Wallet rotation | Configure multi-wallet rotation settings |
| Centralize receive address | Route all won ordinals to a single address (requires wallet rotation enabled) |

#### Typical Workflows

**Initial Setup:**
1. `yarn manage` → Create new wallets
2. Fund main wallet with BTC
3. Distribute funds to pool wallets
4. Add collections to bid on
5. Start bot

**Monitoring:**
1. View status & stats to check active bids
2. View logs to monitor real-time activity
3. Check wallet balances periodically

**Troubleshooting:**
1. View logs to identify issues
2. Cancel all offers if needed
3. Restart bot to apply changes

#### Bot Status Display

The `View status & stats` command displays comprehensive information:

| Section | Details |
|---------|---------|
| Bot Status | Running/stopped, PID, uptime, start time |
| Session Statistics | Bids placed/skipped/adjusted/cancelled, errors, success rate |
| Rate Limiter | Current bids in window, window reset time, total waits |
| Wallet Pool | Available/total wallets, per-wallet bid counts and reset timers |
| System | Memory usage (heap), event queue size, WebSocket connection status |
| Configuration | Collection count, wallet count |
| Active Collections | Per-collection settings summary |
| Bid Activity | Active bids, top bids, items won per collection |

---

### Create Offers

- Set env variables

`cp .env.example .env`

- Copy the example collections config and edit it:

`cp config/collections.example.json config/collections.json`

- Edit `config/collections.json` and set bidding configurations

### ITEM OFFER

| Field                           | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| collectionSymbol                | The symbol of the collection to bid on.                               |
| minBid                          | The minimum bid amount.                                               |
| minFloorBid                     | The minimum percentage of the floor price to bid.                     |
| maxFloorBid                     | The maximum percentage of the floor price to bid.                     |
| maxBid                          | The maximum bid amount.                                               |
| bidCount                        | The number of bids to place.                                          |
| duration                        | The duration of the bidding process.                                  |
| scheduledLoop                   | The interval (in seconds) at which to run the scheduled bidding loop. |
| offerType (ITEM OR COLLECTION)  | Type of offer either item or collection or trait (coming soon)        |
| enableCounterBidding (OPTIONAL) | Enable / disable counter bidding                                      |
| fundingWalletWIF (OPTIONAL)     | WIF (Wallet Import Format). This overrides the value set in the env   |
| quantity (OPTIONAL)             | the maximum number of token to buy, default to 1                      |
| tokenReceiveAddress (OPTIONAL)  | Token receive address. This overrides the value set in the env        |
| walletGroup (OPTIONAL)          | Name of wallet group to use for this collection                       |

```
[
  	{
		"collectionSymbol": "bitdogs_btc",
		"minBid": 0.0015,
		"maxBid": 0.0019,
		"minFloorBid": 65,
		"maxFloorBid": 80,
		"bidCount": 7,
		"duration": 60,
		"enableCounterBidding": true,
		"scheduledLoop": 60,
		"outBidMargin": 1e-6,
		"offerType": "ITEM",
		"quantity": 1,
		"walletGroup": "high-value"
	}
]
```

### COLLECTION OFFER

| Field                           | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| collectionSymbol                | The symbol of the collection to bid on.                               |
| minBid                          | The minimum bid amount.                                               |
| minFloorBid                     | The minimum percentage of the floor price to bid.                     |
| maxFloorBid                     | The maximum percentage of the floor price to bid.                     |
| maxBid                          | The maximum bid amount.                                               |
| bidCount                        | The number of bids to place.                                          |
| duration                        | The duration of the bidding process.                                  |
| scheduledLoop                   | The interval (in seconds) at which to run the scheduled bidding loop. |
| offerType (ITEM OR COLLECTION)  | Type of offer either item or collection or trait (coming soon)        |
| enableCounterBidding (OPTIONAL) | Enable / disable counter bidding                                      |
| fundingWalletWIF (OPTIONAL)     | WIF (Wallet Import Format). This overrides the value set in the env   |
| feeSatsPerVbyte (OPTIONAL)      | Network fees, default to 28                                           |
| tokenReceiveAddress (OPTIONAL)  | Token receive address. This overrides the value set in the env        |
| walletGroup (OPTIONAL)          | Name of wallet group to use for this collection                       |

```
[
  	{
		"collectionSymbol": "bitdogs_btc",
		"minBid": 0.0015,
		"maxBid": 0.0019,
		"minFloorBid": 65,
		"maxFloorBid": 80,
		"bidCount": 7,
		"duration": 60,
		"enableCounterBidding": true,
		"scheduledLoop": 60,
		"outBidMargin": 1e-6,
		"offerType": "COLLECTION",
		"quantity": 1,
		"feeSatsPerVbyte": 28,
		"walletGroup": "floor-sweeper"
	}
]
```

### TRAIT OFFER

| Field                           | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| collectionSymbol                | The symbol of the collection to bid on.                               |
| minBid                          | The minimum bid amount.                                               |
| maxBid                          | The maximum bid amount.                                               |
| minFloorBid                     | The minimum percentage of the floor price to bid.                     |
| maxFloorBid                     | The maximum percentage of the floor price to bid.                     |
| bidCount                        | The number of bids to place.                                          |
| duration                        | The duration of the bidding process.                                  |
| scheduledLoop                   | The interval (in seconds) at which to run the scheduled bidding loop. |
| offerType                       | Must be "ITEM" for trait bidding.                                     |
| enableCounterBidding (OPTIONAL) | Enable / disable counter bidding                                      |
| outBidMargin                    | The margin to outbid existing offers.                                 |
| quantity                        | The maximum number of tokens to buy.                                  |
| feeSatsPerVbyte (OPTIONAL)      | Network fees, default to 28                                           |
| traits                          | An array of trait objects specifying traitType and value.             |
| walletGroup (OPTIONAL)          | Name of wallet group to use for this collection                       |

```
[
  {
    "collectionSymbol": "octoglyphs",
    "minBid": 0.001615,
    "maxBid": 0.0018915,
    "minFloorBid": 95,
    "maxFloorBid": 97,
    "bidCount": 40,
    "duration": 60,
    "scheduledLoop": 300,
    "enableCounterBidding": true,
    "outBidMargin": 5e-5,
    "offerType": "ITEM",
    "quantity": 1,
    "feeSatsPerVbyte": 25,
    "traits": [
      {
        "traitType": "Accessories",
        "value: "Juice Box",
			}
		]
	}
]
```

`yarn bid`

### ADVANCED FEATURES

#### Multi-Wallet Rotation (Maximize Bid Throughput)

Magic Eden enforces a rate limit of ~5 bids per minute **per wallet**. With multi-wallet rotation, you can scale your bidding throughput by using multiple funding wallets.

| Wallets | Throughput |
|---------|------------|
| 1       | 5 bids/min |
| 2       | 10 bids/min |
| 3       | 15 bids/min |
| 5       | 25 bids/min |

**Step 1: Create wallet configuration file**

Create `config/wallets.json` (copy from `wallets.example.json`):

```json
{
  "wallets": [
    {
      "wif": "L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ",
      "receiveAddress": "bc1q...",
      "label": "wallet-1"
    },
    {
      "wif": "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn",
      "receiveAddress": "bc1q...",
      "label": "wallet-2"
    },
    {
      "wif": "L3p8oAcQTtuokSCRHQ7i4MhjWc9zornvpJLfmg62sYpLRJF9woSu",
      "receiveAddress": "bc1q...",
      "label": "wallet-3"
    }
  ],
  "bidsPerMinute": 5,
  "selectionStrategy": "least-recently-used"
}
```

| Field | Description |
|-------|-------------|
| `wif` | Private key in Wallet Import Format (funding wallet) |
| `receiveAddress` | Address to receive purchased ordinals |
| `label` | Friendly name for logging |
| `bidsPerMinute` | Rate limit per wallet (default: 5) |
| `selectionStrategy` | Wallet selection method (only `least-recently-used` supported) |

**Step 2: Configure environment variables**

Add to your `.env` file:

```bash
# Enable multi-wallet rotation
ENABLE_WALLET_ROTATION=true

# Path to wallet configuration file
WALLET_CONFIG_PATH=./config/wallets.json

# Bids per minute PER WALLET (Magic Eden's limit)
# With 3 wallets at 5 bids/min each = 15 bids/min total
BIDS_PER_MINUTE=5
```

**Step 3: Fund your wallets**

Each wallet needs sufficient BTC to cover:
- Bid amounts for your configured collections
- Network fees (typically 1000-5000 sats per transaction)

**How it works:**
1. Bot selects the least-recently-used wallet that hasn't hit its rate limit
2. Places bid using that wallet's funding address
3. Records bid to per-wallet rate tracker
4. If all wallets are rate-limited, waits for the next available window
5. Ordinals are delivered to each wallet's configured `receiveAddress`

**Console output with wallet rotation:**
```
[WALLET ROTATION] Using wallet "wallet-1" for bid on ...abc123
[WALLET POOL] Recorded bid for "wallet-1" (3/5 in window)
[WALLET ROTATION] Using wallet "wallet-2" for bid on ...def456
[WALLET POOL] Recorded bid for "wallet-2" (1/5 in window)
```

**Important Notes:**
- Each wallet operates independently with its own rate limit window
- The global pacer is bypassed when wallet rotation is enabled
- Wallets are selected using least-recently-used strategy to distribute bids evenly
- If all wallets are exhausted, the bot logs when the next wallet becomes available

#### Centralized Receive Address

When using multiple wallets, you can route all won ordinals to a single address:

1. Enable via CLI: `yarn manage` → Settings → Centralize receive address
2. Or set in `.env`: `CENTRALIZE_RECEIVE_ADDRESS=true`

When enabled, all wallets send won NFTs to `TOKEN_RECEIVE_ADDRESS` instead of their individual addresses.

#### Wallet Groups

Wallet groups let you create isolated wallet pools for different collections. Each group has its own set of wallets and independent rate limits, preventing high-volume collections from exhausting wallets needed by others.

**Config structure (`config/wallets.json`):**

```json
{
  "groups": {
    "default": {
      "wallets": [],
      "bidsPerMinute": 5
    },
    "high-value": {
      "wallets": [
        {
          "label": "hv-wallet-1",
          "wif": "your-private-key-wif",
          "receiveAddress": "bc1p..."
        }
      ],
      "bidsPerMinute": 5
    }
  },
  "defaultGroup": "default"
}
```

**Setup steps:**

1. **Create a group:** `yarn manage` → Wallet Groups → Create wallet group
2. **Add wallets:** Select the group → Add wallets (generate new, import WIF, or move from existing pool)
3. **Assign to collection:** Collections → Assign to wallet group → Select collection → Choose group

**Funding:** Use "Rebalance group" from the Wallet Groups menu to automatically distribute BTC across wallets based on the assigned collection's `maxBid` setting. This ensures each wallet has sufficient funds for bidding.

#### Bulk cancel offers

`yarn cancel`

---

### CONFIGURATION FILES

| File | Purpose |
|------|---------|
| `.env` | Environment variables and API keys |
| `config/collections.json` | Bidding configurations per collection |
| `config/wallets.json` | Wallet pool configuration |

---

### ENVIRONMENT VARIABLES

| Variable | Description | Default |
|----------|-------------|---------|
| `TOKEN_RECEIVE_ADDRESS` | Address to receive purchased ordinals | (required) |
| `FUNDING_WIF` | Private key in Wallet Import Format | (required) |
| `API_KEY` | Magic Eden API key | (required) |
| `RATE_LIMIT` | HTTP requests per second | 32 |
| `DEFAULT_OUTBID_MARGIN` | Default outbid margin in BTC | 0.00000001 |
| `DEFAULT_COUNTER_BID_LOOP_TIME` | Counter-bid loop interval (seconds) | 30 |
| `DEFAULT_LOOP` | Default scheduled loop interval (seconds) | 30 |
| `ENABLE_WALLET_ROTATION` | Enable multi-wallet rotation | false |
| `WALLET_CONFIG_PATH` | Path to wallet config file | ./config/wallets.json |
| `BIDS_PER_MINUTE` | Per-wallet bid rate limit | 5 |
| `SKIP_OVERLAPPING_CYCLES` | Skip cycles when previous still running | true |
| `CENTRALIZE_RECEIVE_ADDRESS` | Route all ordinals to TOKEN_RECEIVE_ADDRESS | false |

---

### ARCHITECTURE

#### Bid Calculation

Offers are calculated within a bounded range:

```
minOffer = max(minBid, minFloorBid% × floor)
maxOffer = min(maxBid, maxFloorBid% × floor)
```

Bidding above 100% of floor price is blocked for ITEM and COLLECTION offers (allowed for trait bidding).

#### Core Flow

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

#### Memory Management

- Bid history cleanup runs hourly (24-hour TTL)
- Event queue capped at 1000 events (FIFO drop when full)
- Max 100 bids tracked per collection
- Memory monitoring every 5 minutes with alerts

#### Rate Limiting

- HTTP requests: Bottleneck enforces `RATE_LIMIT` requests/second
- Bid pacing: `BIDS_PER_MINUTE` per wallet with 60-second sliding window
- Retry: Exponential backoff for 429/400 errors

#### WebSocket

- Counter-bidding via real-time events
- Automatic reconnection with exponential backoff (max 5 retries)
- Graceful degradation to scheduled-only mode on failure

#### Processing Guards

- `processingTokens` map prevents race conditions on same token
- Bid deduplication with 30-second cooldown per token
- `isScheduledRunning` and `isProcessingQueue` coordinate WebSocket vs scheduled tasks
