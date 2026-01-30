## ORDINAL BIDDING BOT

#### Requirements

- node version 18+

#### Install dependencies

- yarn is recommended

`yarn install`

OR

`npm install`

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

#### Collection Commands

| Command | Description |
|---------|-------------|
| List collections | View all configured collections and their settings |
| Add collection | Add a new collection with bidding parameters |
| Edit collection | Modify settings for an existing collection |
| Remove collection | Remove a collection from bidding |
| Scan for opportunities | Find profitable collections based on floor/volume |

#### Bot Control Commands

| Command | Description |
|---------|-------------|
| Start bot | Launch the bidding bot in the background |
| Stop bot | Gracefully stop the running bot |
| View status & stats | Display bot status, active bids, and statistics |
| Restart bot | Stop and restart the bot (cancel offers first) |
| View logs | Tail the bot's log output in real-time |
| Cancel all offers | Cancel all active offers across collections |

#### Settings Commands

| Command | Description |
|---------|-------------|
| Wallet rotation | Configure multi-wallet rotation settings |

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

---

### Create Offers

- Set env variables

`cp .env.example .env`

- Edit the collections.json and set bidding configurations

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
		"feeSatsPerVbyte": 28
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

#### Address Rotation (Bypass API Rate Limits)

The bot supports rotating dummy receive addresses when requesting PSBTs from the Magic Eden API, which helps bypass rate limits that are tied to the receive address. When enabled:

1. **API Requests**: Uses rotating dummy addresses from a pool
2. **PSBT Creation**: Extracts tap keys from API responses
3. **Local PSBT**: Creates new PSBT with your **real** receive address
4. **Blockchain**: Only your real receive address appears on-chain

**Configuration (in .env file):**

```bash
# Enable address rotation
ENABLE_ADDRESS_ROTATION=true

# Number of dummy addresses to generate (default: 10)
ADDRESS_POOL_SIZE=10

# BIP39 mnemonic or hex seed for generating dummy addresses
# These addresses don't need funding - they're only used for API requests
# Example: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
ADDRESS_POOL_SEED="your 12 or 24 word mnemonic"
```

**Important Notes:**
- The dummy addresses **do not need funding** - they're only used for API requests
- Your ordinals will be delivered to your real `TOKEN_RECEIVE_ADDRESS`
- This works in conjunction with the existing PSBT caching system
- Completely transparent to the blockchain - only dummy addresses are visible to the API

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

#### Bulk cancel offers

`yarn cancel`
