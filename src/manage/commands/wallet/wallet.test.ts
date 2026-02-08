/**
 * Tests for wallet commands
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

function generateTestWIF(): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

const TEST_WIF = generateTestWIF();
const TEST_RECEIVE_ADDRESS = 'bc1p' + 'a'.repeat(58);

// Mock dependencies
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

vi.mock('../../utils/display', () => ({
  showSectionHeader: vi.fn(),
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showTable: vi.fn(),
  showImportantBox: vi.fn(),
  getSeparatorWidth: vi.fn(() => 60),
  formatBTC: vi.fn((sats: number) => `${(sats / 100000000).toFixed(8)} BTC`),
  withSpinner: vi.fn().mockImplementation(async (message, fn) => fn()),
  clearScreen: vi.fn(),
}));

vi.mock('../../utils/interactiveTable', () => ({
  showInteractiveTable: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../utils/prompts', () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptSelect: vi.fn().mockResolvedValue('generate'),
  promptInteger: vi.fn().mockResolvedValue(5),
  promptText: vi.fn().mockResolvedValue('bidder'),
  promptPassword: vi.fn().mockResolvedValue('password123'),
  promptContinue: vi.fn().mockResolvedValue(undefined),
}));

// Mock WalletGenerator
const mockWallets = [
  {
    label: 'bidder-0',
    wif: TEST_WIF,
    paymentAddress: 'bc1qpayment0',
    receiveAddress: 'bc1preceive0',
    publicKey: '02abc',
  },
  {
    label: 'bidder-1',
    wif: TEST_WIF,
    paymentAddress: 'bc1qpayment1',
    receiveAddress: 'bc1preceive1',
    publicKey: '02def',
  },
];

vi.mock('../../services/WalletGenerator', () => ({
  generateMnemonic: vi.fn().mockReturnValue('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
  validateMnemonic: vi.fn().mockReturnValue(true),
  deriveWallets: vi.fn().mockReturnValue(mockWallets),
  addWalletsToConfig: vi.fn(),
  getNextWalletIndex: vi.fn().mockReturnValue(0),
  loadWallets: vi.fn().mockReturnValue({ wallets: mockWallets }),
  isGroupsFormat: vi.fn().mockReturnValue(false),
  getAllWalletsFromGroups: vi.fn().mockReturnValue([]),
  getWalletFromWIF: vi.fn().mockImplementation((wif, network) => ({
    paymentAddress: 'bc1qpayment',
    receiveAddress: 'bc1preceive',
    publicKey: '02abc',
  })),
  // Encryption-related exports
  readWalletsFileRaw: vi.fn().mockReturnValue(null),
  isEncryptedFormat: vi.fn().mockReturnValue(false),
  loadWalletsDecrypted: vi.fn().mockReturnValue(null),
  loadFundingWalletFromConfig: vi.fn().mockReturnValue(null),
  setSessionPassword: vi.fn(),
  clearSessionPassword: vi.fn(),
  getSessionPassword: vi.fn().mockReturnValue(null),
}));

// Mock BalanceService
vi.mock('../../services/BalanceService', () => ({
  getAllBalances: vi.fn().mockResolvedValue([
    { address: 'bc1qpayment', total: 1000000, confirmed: 1000000, unconfirmed: 0, utxoCount: 2 },
  ]),
  calculateTotalBalance: vi.fn().mockReturnValue({
    confirmed: 1000000,
    unconfirmed: 0,
    total: 1000000,
  }),
}));

// Set up env
beforeAll(() => {
  process.env.FUNDING_WIF = TEST_WIF;
  process.env.TOKEN_RECEIVE_ADDRESS = TEST_RECEIVE_ADDRESS;
});

describe('Wallet Commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createWallets', () => {
    it('should return early when count is 0', async () => {
      const { createWallets } = await import('./create');
      const prompts = await import('../../utils/prompts');
      const { deriveWallets } = await import('../../services/WalletGenerator');

      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(0);

      await createWallets();

      expect(deriveWallets).not.toHaveBeenCalled();
    });

    it('should show error when count is out of range', async () => {
      const { createWallets } = await import('./create');
      const prompts = await import('../../utils/prompts');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(101);

      await createWallets();

      expect(display.showError).toHaveBeenCalledWith('Please enter a number between 1 and 100');
    });

    it('should return early when mnemonic source is cancelled', async () => {
      const { createWallets } = await import('./create');
      const prompts = await import('../../utils/prompts');
      const { deriveWallets } = await import('../../services/WalletGenerator');

      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(5);
      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('__cancel__' as any);

      await createWallets();

      expect(deriveWallets).not.toHaveBeenCalled();
    });

    it('should generate new mnemonic when selected', async () => {
      const { createWallets } = await import('./create');
      const prompts = await import('../../utils/prompts');
      const { generateMnemonic, deriveWallets, addWalletsToConfig } = await import('../../services/WalletGenerator');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(3);
      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('generate');
      vi.mocked(prompts.promptText).mockResolvedValueOnce('test');
      vi.mocked(prompts.promptConfirm)
        .mockResolvedValueOnce(true)  // Save
        .mockResolvedValueOnce(false); // Don't encrypt

      await createWallets();

      expect(generateMnemonic).toHaveBeenCalled();
      expect(deriveWallets).toHaveBeenCalled();
    });

    it('should show error for invalid mnemonic', async () => {
      const { createWallets } = await import('./create');
      const prompts = await import('../../utils/prompts');
      const { validateMnemonic, deriveWallets } = await import('../../services/WalletGenerator');
      const display = await import('../../utils/display');

      vi.mocked(prompts.promptInteger).mockResolvedValueOnce(3);
      vi.mocked(prompts.promptSelect).mockResolvedValueOnce('existing');
      vi.mocked(prompts.promptText).mockResolvedValueOnce('invalid mnemonic');
      vi.mocked(validateMnemonic).mockReturnValueOnce(false);

      await createWallets();

      expect(display.showError).toHaveBeenCalledWith('Invalid mnemonic. Please check and try again.');
      expect(deriveWallets).not.toHaveBeenCalled();
    });
  });

  describe('listWallets', () => {
    it('should display wallet balances', async () => {
      const { listWallets } = await import('./list');
      const display = await import('../../utils/display');
      const { showInteractiveTable } = await import('../../utils/interactiveTable');

      await listWallets();

      expect(display.showSectionHeader).toHaveBeenCalledWith('WALLET BALANCES');
      expect(showInteractiveTable).toHaveBeenCalled();
    });

    it('should show error when no wallets found', async () => {
      const { listWallets } = await import('./list');
      const { loadWallets, getWalletFromWIF } = await import('../../services/WalletGenerator');
      const display = await import('../../utils/display');

      // Clear FUNDING_WIF temporarily
      const originalWIF = process.env.FUNDING_WIF;
      delete process.env.FUNDING_WIF;
      vi.mocked(loadWallets).mockReturnValueOnce(null);

      await listWallets();

      expect(display.showWarning).toHaveBeenCalled();

      // Restore
      process.env.FUNDING_WIF = originalWIF;
    });

    it('should deduplicate wallets that match main wallet payment address', async () => {
      const { listWallets } = await import('./list');
      const { loadWallets, isGroupsFormat, getWalletFromWIF } = await import('../../services/WalletGenerator');
      const { showInteractiveTable } = await import('../../utils/interactiveTable');

      // getWalletFromWIF returns same paymentAddress for both the main wallet and the config wallet
      vi.mocked(getWalletFromWIF)
        .mockReturnValueOnce({ paymentAddress: 'bc1qsame', publicKey: '02abc' })  // main wallet
        .mockReturnValueOnce({ paymentAddress: 'bc1qsame', publicKey: '02abc' }); // dup config wallet
      vi.mocked(loadWallets).mockReturnValueOnce({
        wallets: [{ label: 'dup-wallet', wif: TEST_WIF, receiveAddress: 'bc1preceive0' }],
      });
      vi.mocked(isGroupsFormat).mockReturnValueOnce(false);

      await listWallets();

      // The interactive table should be called with only the main wallet (dup filtered out)
      expect(showInteractiveTable).toHaveBeenCalled();
      const tableData = vi.mocked(showInteractiveTable).mock.calls[0][0];
      const labels = tableData.rows.map((r: any) => r.label);
      expect(labels).toContain('Main Wallet (FUNDING_WIF)');
      expect(labels).not.toContain('dup-wallet');
    });
  });

  describe('getWalletsWithBalances', () => {
    it('should return wallets with balances', async () => {
      const { getWalletsWithBalances } = await import('./list');

      const result = await getWalletsWithBalances();

      expect(Array.isArray(result)).toBe(true);
    });
  });
});

describe('Wallet Creation Logic', () => {
  it('should show existing wallet count', () => {
    const existing = { wallets: [{ label: 'w1' }, { label: 'w2' }] };
    let existingCount = 0;

    if (existing.wallets?.length) {
      existingCount = existing.wallets.length;
    }

    expect(existingCount).toBe(2);
  });

  it('should calculate next wallet index', () => {
    const wallets = [
      { label: 'bidder-0' },
      { label: 'bidder-1' },
      { label: 'bidder-2' },
    ];

    const nextIndex = wallets.length;

    expect(nextIndex).toBe(3);
  });

  it('should truncate long labels in display', () => {
    const label = 'this-is-a-very-long-wallet-label-that-should-be-truncated';
    const maxLength = 25;

    const displayLabel = label.length > maxLength
      ? label.slice(0, maxLength - 3) + '...'
      : label;

    expect(displayLabel.length).toBeLessThanOrEqual(maxLength);
  });

  it('should format address for display', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    const formatted = address.slice(0, 8) + '...' + address.slice(-6);

    expect(formatted).toBe('bc1qw508...v8f3t4');
    expect(formatted.length).toBe(17);
  });
});

describe('Wallet Balance Aggregation', () => {
  it('should calculate total balance from multiple wallets', () => {
    const balances = [
      { total: 1000000, confirmed: 1000000, unconfirmed: 0 },
      { total: 500000, confirmed: 500000, unconfirmed: 0 },
      { total: 250000, confirmed: 200000, unconfirmed: 50000 },
    ];

    const totals = balances.reduce(
      (acc, b) => ({
        confirmed: acc.confirmed + b.confirmed,
        unconfirmed: acc.unconfirmed + b.unconfirmed,
        total: acc.total + b.total,
      }),
      { confirmed: 0, unconfirmed: 0, total: 0 }
    );

    expect(totals.total).toBe(1750000);
    expect(totals.confirmed).toBe(1700000);
    expect(totals.unconfirmed).toBe(50000);
  });
});

describe('Wallet Groups vs Legacy Format', () => {
  it('should detect groups format', () => {
    const groupsFormat = {
      groups: {
        'group-1': { wallets: [] },
        'group-2': { wallets: [] },
      },
    };

    const isGroups = !!groupsFormat.groups && typeof groupsFormat.groups === 'object';

    expect(isGroups).toBe(true);
  });

  it('should detect legacy format', () => {
    const legacyFormat = {
      wallets: [{ label: 'w1', wif: 'wif1' }],
    };

    const isLegacy = !!legacyFormat.wallets && Array.isArray(legacyFormat.wallets);
    const isGroups = !!(legacyFormat as any).groups && typeof (legacyFormat as any).groups === 'object';

    expect(isLegacy).toBe(true);
    expect(isGroups).toBe(false);
  });
});

describe('Mnemonic Validation', () => {
  it('should validate correct mnemonic word count', () => {
    const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const words = validMnemonic.split(' ');

    expect(words.length).toBe(12);
  });

  it('should detect invalid word count', () => {
    const invalidMnemonic = 'abandon abandon abandon';
    const words = invalidMnemonic.split(' ');

    const isValidCount = [12, 15, 18, 21, 24].includes(words.length);

    expect(isValidCount).toBe(false);
  });
});

describe('Password Confirmation', () => {
  it('should detect password mismatch', () => {
    const password: string = 'password123';
    const confirmPassword: string = 'password456';

    const matches = password === confirmPassword;

    expect(matches).toBe(false);
  });

  it('should confirm matching passwords', () => {
    const password: string = 'password123';
    const confirmPassword: string = 'password123';

    const matches = password === confirmPassword;

    expect(matches).toBe(true);
  });
});

describe('BTC Formatting', () => {
  it('should format satoshis to BTC', () => {
    const sats = 100000000; // 1 BTC
    const btc = sats / 100000000;

    expect(btc).toBe(1);
    expect(btc.toFixed(8)).toBe('1.00000000');
  });

  it('should handle small amounts', () => {
    const sats = 1000; // 0.00001 BTC
    const btc = sats / 100000000;

    expect(btc.toFixed(8)).toBe('0.00001000');
  });

  it('should handle zero', () => {
    const sats = 0;
    const btc = sats / 100000000;

    expect(btc.toFixed(8)).toBe('0.00000000');
  });
});

describe('Wallet Export/Import Logic', () => {
  it('should collect wallet data for export', () => {
    const wallets = [
      { label: 'w1', wif: 'wif1', paymentAddress: 'pay1', receiveAddress: 'rec1' },
      { label: 'w2', wif: 'wif2', paymentAddress: 'pay2', receiveAddress: 'rec2' },
    ];

    const exportData = wallets.map(w => ({
      label: w.label,
      wif: w.wif,
      paymentAddress: w.paymentAddress,
      receiveAddress: w.receiveAddress,
    }));

    expect(exportData).toHaveLength(2);
    expect(exportData[0].wif).toBe('wif1');
  });
});

describe('Wallet Distribution Logic', () => {
  it('should calculate distribution amounts', () => {
    const totalAmount = 1000000; // sats
    const walletCount = 5;
    const perWallet = Math.floor(totalAmount / walletCount);

    expect(perWallet).toBe(200000);
    expect(perWallet * walletCount).toBe(1000000);
  });

  it('should handle uneven distribution', () => {
    const totalAmount = 1000001;
    const walletCount = 3;
    const perWallet = Math.floor(totalAmount / walletCount);
    const remainder = totalAmount % walletCount;

    expect(perWallet).toBe(333333);
    expect(remainder).toBe(2);
  });

  it('should validate minimum distribution amount', () => {
    const totalAmount = 1000;
    const walletCount = 5;
    const minPerWallet = 546; // Dust limit
    const perWallet = Math.floor(totalAmount / walletCount);

    const isValid = perWallet >= minPerWallet;

    expect(isValid).toBe(false);
  });
});

describe('Wallet Consolidation Logic', () => {
  it('should calculate consolidation amounts', () => {
    const utxos = [
      { value: 100000 },
      { value: 50000 },
      { value: 25000 },
    ];

    const totalValue = utxos.reduce((sum, u) => sum + u.value, 0);
    const estimatedFee = 1000;
    const netAmount = totalValue - estimatedFee;

    expect(totalValue).toBe(175000);
    expect(netAmount).toBe(174000);
  });

  it('should skip consolidation when insufficient funds', () => {
    const totalValue = 500;
    const estimatedFee = 1000;

    const canConsolidate = totalValue > estimatedFee;

    expect(canConsolidate).toBe(false);
  });
});

describe('Group Wallet Operations', () => {
  it('should create new group', () => {
    const groups: Record<string, { bidsPerMinute: number; wallets: any[] }> = {};
    const groupName = 'new-group';
    const bidsPerMinute = 5;

    groups[groupName] = {
      bidsPerMinute,
      wallets: [],
    };

    expect(groups[groupName]).toBeDefined();
    expect(groups[groupName].bidsPerMinute).toBe(5);
  });

  it('should add wallet to group', () => {
    const groups: Record<string, { wallets: any[] }> = {
      'my-group': { wallets: [] },
    };

    const newWallet = { label: 'w1', wif: 'wif1' };
    groups['my-group'].wallets.push(newWallet);

    expect(groups['my-group'].wallets).toHaveLength(1);
    expect(groups['my-group'].wallets[0].label).toBe('w1');
  });

  it('should remove wallet from group', () => {
    const groups: Record<string, { wallets: any[] }> = {
      'my-group': {
        wallets: [
          { label: 'w1' },
          { label: 'w2' },
          { label: 'w3' },
        ],
      },
    };

    const indexToRemove = 1;
    groups['my-group'].wallets.splice(indexToRemove, 1);

    expect(groups['my-group'].wallets).toHaveLength(2);
    expect(groups['my-group'].wallets.map(w => w.label)).toEqual(['w1', 'w3']);
  });
});

// ============================================================================
// Ordinals Logic Tests
// ============================================================================
describe('Ordinals View Logic', () => {
  it('should build wallet list from config', () => {
    const mainWallet = {
      label: 'Main Wallet',
      paymentAddress: 'bc1qmain',
      receiveAddress: 'bc1pmain',
    };

    const configWallets = [
      { label: 'Wallet 1', paymentAddress: 'bc1q1', receiveAddress: 'bc1p1' },
      { label: 'Wallet 2', paymentAddress: 'bc1q2', receiveAddress: 'bc1p2' },
    ];

    const allWallets = [mainWallet, ...configWallets];

    expect(allWallets).toHaveLength(3);
    expect(allWallets[0].label).toBe('Main Wallet');
  });

  it('should filter selected wallets', () => {
    const allWallets = [
      { label: 'W1', receiveAddress: 'addr1' },
      { label: 'W2', receiveAddress: 'addr2' },
      { label: 'W3', receiveAddress: 'addr3' },
    ];

    const selectedAddresses = ['addr1', 'addr3'];

    const selectedWallets = allWallets.filter(w =>
      selectedAddresses.includes(w.receiveAddress)
    );

    expect(selectedWallets).toHaveLength(2);
    expect(selectedWallets.map(w => w.label)).toEqual(['W1', 'W3']);
  });

  it('should format token counts', () => {
    const total = 1;
    const plural = total === 1 ? '' : 's';

    expect(`${total} NFT${plural}`).toBe('1 NFT');
  });

  it('should format multiple token counts', () => {
    const total: number = 5;
    const plural = total === 1 ? '' : 's';

    expect(`${total} NFT${plural}`).toBe('5 NFTs');
  });

  it('should limit displayed tokens', () => {
    const tokens = Array.from({ length: 30 }, (_, i) => ({ id: `token${i}` }));
    const maxDisplay = 20;

    const displayedTokens = tokens.slice(0, maxDisplay);
    const remaining = tokens.length - maxDisplay;

    expect(displayedTokens).toHaveLength(20);
    expect(remaining).toBe(10);
  });

  it('should collect all tokens for detail view', () => {
    const walletResults = [
      { label: 'W1', tokens: [{ id: 't1' }, { id: 't2' }] },
      { label: 'W2', tokens: [{ id: 't3' }] },
    ];

    const allTokens: Array<{ wallet: string; token: any }> = [];
    walletResults.forEach(result => {
      result.tokens.forEach(token => {
        allTokens.push({ wallet: result.label, token });
      });
    });

    expect(allTokens).toHaveLength(3);
    expect(allTokens[0].wallet).toBe('W1');
    expect(allTokens[2].wallet).toBe('W2');
  });

  it('should calculate total NFTs across wallets', () => {
    const walletResults = [
      { total: 5 },
      { total: 3 },
      { total: 0 },
      { total: 2 },
    ];

    const totalNFTs = walletResults.reduce((sum, r) => sum + r.total, 0);

    expect(totalNFTs).toBe(10);
  });

  it('should skip wallets with zero tokens', () => {
    const walletResults = [
      { label: 'W1', total: 5 },
      { label: 'W2', total: 0 },
      { label: 'W3', total: 3 },
    ];

    const walletsWithTokens = walletResults.filter(r => r.total > 0);

    expect(walletsWithTokens).toHaveLength(2);
    expect(walletsWithTokens.map(w => w.label)).toEqual(['W1', 'W3']);
  });
});

// ============================================================================
// Distribution Command Logic Tests
// ============================================================================
describe('Distribution Command Logic', () => {
  it('should check for sufficient balance', () => {
    const sourceBalance = 1000000;
    const requestedAmount = 500000;

    const hasSufficientFunds = requestedAmount <= sourceBalance;

    expect(hasSufficientFunds).toBe(true);
  });

  it('should reject insufficient balance', () => {
    const sourceBalance = 100000;
    const requestedAmount = 500000;

    const hasSufficientFunds = requestedAmount <= sourceBalance;

    expect(hasSufficientFunds).toBe(false);
  });

  it('should calculate amount after fee', () => {
    const totalAmount = 100000;
    const estimatedFee = 5000;
    const amountAfterFee = totalAmount - estimatedFee;

    expect(amountAfterFee).toBe(95000);
  });

  it('should calculate amount per wallet for equal split', () => {
    const amountAfterFee = 100000;
    const walletCount = 4;
    const amountPerWallet = Math.floor(amountAfterFee / walletCount);

    expect(amountPerWallet).toBe(25000);
  });

  it('should validate amount is above dust threshold', () => {
    const DUST_THRESHOLD = 546;
    const amountPerWallet = 600;

    const isAboveDust = amountPerWallet > DUST_THRESHOLD;

    expect(isAboveDust).toBe(true);
  });

  it('should reject amount below dust threshold', () => {
    const DUST_THRESHOLD = 546;
    const amountPerWallet = 500;

    const isAboveDust = amountPerWallet > DUST_THRESHOLD;

    expect(isAboveDust).toBe(false);
  });

  it('should build recipients list', () => {
    const wallets = [
      { paymentAddress: 'addr1', label: 'W1' },
      { paymentAddress: 'addr2', label: 'W2' },
    ];
    const amountPerWallet = 50000;

    const recipients = wallets.map(w => ({
      address: w.paymentAddress,
      amount: amountPerWallet,
    }));

    expect(recipients).toHaveLength(2);
    expect(recipients[0].amount).toBe(50000);
  });

  it('should filter out zero amounts in custom distribution', () => {
    const amounts = [
      { address: 'addr1', amount: 10000 },
      { address: 'addr2', amount: 0 },
      { address: 'addr3', amount: 5000 },
    ];

    const validRecipients = amounts.filter(r => r.amount > 0);

    expect(validRecipients).toHaveLength(2);
  });

  it('should estimate fee for distribution', () => {
    const recipientCount = 5;
    const feeRate = 20; // sats/vB

    // Rough estimate: 10 bytes overhead + 68 bytes per input + 31 bytes per output
    const estimatedVBytes = 10 + 68 + (recipientCount + 1) * 31;
    const estimatedFee = estimatedVBytes * feeRate;

    expect(estimatedVBytes).toBe(264); // 10 + 68 + 6*31
    expect(estimatedFee).toBe(5280);
  });

  it('should map recipients to labels', () => {
    const recipients = [
      { address: 'addr1', amount: 10000 },
      { address: 'addr2', amount: 20000 },
    ];

    const wallets = [
      { paymentAddress: 'addr1', label: 'Wallet 1' },
      { paymentAddress: 'addr2', label: 'Wallet 2' },
    ];

    const recipientDetails = recipients.map((r, i) => ({
      label: wallets.find(w => w.paymentAddress === r.address)?.label || `Wallet ${i + 1}`,
      address: r.address,
      amount: r.amount,
    }));

    expect(recipientDetails[0].label).toBe('Wallet 1');
    expect(recipientDetails[1].label).toBe('Wallet 2');
  });
});

// ============================================================================
// Consolidation Command Logic Tests
// ============================================================================
describe('Consolidation Command Logic', () => {
  it('should filter wallets with funds', () => {
    const wallets = [
      { label: 'Main Wallet', balance: { total: 100000 } },
      { label: 'W1', balance: { total: 50000 } },
      { label: 'W2', balance: { total: 0 } },
      { label: 'W3', balance: { total: 25000 } },
    ];

    const walletsWithFunds = wallets.filter(
      w => w.balance.total > 0 && w.label !== 'Main Wallet'
    );

    expect(walletsWithFunds).toHaveLength(2);
    expect(walletsWithFunds.map(w => w.label)).toEqual(['W1', 'W3']);
  });

  it('should detect no funds to consolidate', () => {
    const wallets = [
      { label: 'Main Wallet', balance: { total: 100000 } },
      { label: 'W1', balance: { total: 0 } },
    ];

    const walletsWithFunds = wallets.filter(
      w => w.balance.total > 0 && w.label !== 'Main Wallet'
    );

    const canConsolidate = walletsWithFunds.length > 0;

    expect(canConsolidate).toBe(false);
  });

  it('should calculate total to consolidate', () => {
    const sourceWallets = [
      { balance: { total: 50000 } },
      { balance: { total: 30000 } },
      { balance: { total: 20000 } },
    ];

    const totalToConsolidate = sourceWallets.reduce(
      (sum, w) => sum + w.balance.total,
      0
    );

    expect(totalToConsolidate).toBe(100000);
  });

  it('should track wallets with inscriptions', () => {
    const sourceWallets = [
      { label: 'W1', receiveAddress: 'addr1' },
      { label: 'W2', receiveAddress: 'addr2' },
      { label: 'W3', receiveAddress: 'addr3' },
    ];

    const inscriptionCheck = new Map([
      ['addr1', true],
      ['addr2', false],
      ['addr3', true],
    ]);

    const walletsWithInscriptions: string[] = [];
    sourceWallets.forEach(w => {
      if (inscriptionCheck.get(w.receiveAddress)) {
        walletsWithInscriptions.push(w.label);
      }
    });

    expect(walletsWithInscriptions).toEqual(['W1', 'W3']);
  });

  it('should build signing wallets list', () => {
    const sourceWallets = [
      { label: 'W1', paymentAddress: 'pay1' },
      { label: 'W2', paymentAddress: 'pay2' },
    ];

    const configWallets = [
      { wif: 'wif1', paymentAddress: 'pay1' },
      { wif: 'wif2', paymentAddress: 'pay2' },
    ];

    const signingWallets = sourceWallets.map(sw => {
      const config = configWallets.find(cw => cw.paymentAddress === sw.paymentAddress);
      return config ? { wif: config.wif, address: sw.paymentAddress } : null;
    }).filter(Boolean);

    expect(signingWallets).toHaveLength(2);
    expect(signingWallets[0]).toEqual({ wif: 'wif1', address: 'pay1' });
  });

  it('should use fallback address for receive address', () => {
    const wallet = { receiveAddress: undefined, paymentAddress: 'payAddr' };

    const addressToCheck = wallet.receiveAddress || wallet.paymentAddress;

    expect(addressToCheck).toBe('payAddr');
  });

  it('should validate destination address format', () => {
    const validAddresses = [
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', // P2WPKH
      'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297', // P2TR
    ];

    validAddresses.forEach(addr => {
      const isValid = addr.startsWith('bc1q') || addr.startsWith('bc1p');
      expect(isValid).toBe(true);
    });
  });

  it('should calculate UTXO count for preview', () => {
    const utxos = [
      { address: 'addr1', value: 10000 },
      { address: 'addr1', value: 5000 },
      { address: 'addr2', value: 8000 },
    ];

    const utxoCount = utxos.length;
    const uniqueAddresses = new Set(utxos.map(u => u.address));

    expect(utxoCount).toBe(3);
    expect(uniqueAddresses.size).toBe(2);
  });
});

// ============================================================================
// Token/Inscription Display Logic Tests
// ============================================================================
describe('Token Display Logic', () => {
  it('should format token for display', () => {
    const token = {
      collection: { name: 'Test Collection' },
      displayName: 'Token #123',
      contentType: 'image/png',
      satRarity: 'uncommon',
      outputValue: 10000,
      listed: true,
      listedPrice: 50000000, // 0.5 BTC
    };

    const formatted = {
      collection: token.collection?.name || 'Unknown',
      name: token.displayName || 'Unknown',
      type: token.contentType || 'unknown',
      rarity: token.satRarity || 'common',
      value: `${(token.outputValue / 100000000).toFixed(8)} BTC`,
      listedPrice: token.listed ? `${(token.listedPrice! / 100000000).toFixed(5)} BTC` : '-',
    };

    expect(formatted.collection).toBe('Test Collection');
    expect(formatted.rarity).toBe('uncommon');
    expect(formatted.listedPrice).toBe('0.50000 BTC');
  });

  it('should handle unlisted tokens', () => {
    const token = {
      listed: false,
      listedPrice: null,
    };

    const listedDisplay = token.listed ? `${token.listedPrice} sats` : '-';

    expect(listedDisplay).toBe('-');
  });

  it('should truncate long names', () => {
    const name = 'This is a very long token name that should be truncated for display';
    const maxLength = 20;

    const truncated = name.length > maxLength
      ? name.slice(0, maxLength - 3) + '...'
      : name;

    expect(truncated.length).toBeLessThanOrEqual(maxLength);
    expect(truncated).toBe('This is a very lo...');
  });

  it('should build detail view choice list', () => {
    const allTokens = [
      { wallet: 'W1', token: { collection: 'C1', name: 'T1' } },
      { wallet: 'W2', token: { collection: 'C2', name: 'T2' } },
    ];

    const choices = allTokens.map((item, index) => ({
      name: `${item.token.collection} - ${item.token.name} (${item.wallet})`,
      value: index.toString(),
    }));

    expect(choices).toHaveLength(2);
    expect(choices[0].name).toBe('C1 - T1 (W1)');
    expect(choices[0].value).toBe('0');
  });
});

// ============================================================================
// Error Handling Logic Tests
// ============================================================================
describe('Transaction Error Handling', () => {
  it('should detect dust error', () => {
    const errorMsg = 'Transaction failed: dust output';

    const isDustError = errorMsg.toLowerCase().includes('dust');

    expect(isDustError).toBe(true);
  });

  it('should detect insufficient funds error', () => {
    const errorMsg = 'Insufficient funds for transaction';

    const isInsufficientFunds =
      errorMsg.toLowerCase().includes('insufficient') ||
      errorMsg.toLowerCase().includes('funds');

    expect(isInsufficientFunds).toBe(true);
  });

  it('should detect mempool error', () => {
    const errorMsg = 'mempool rejection: txn-mempool-conflict';

    const isMempoolError = errorMsg.toLowerCase().includes('mempool');

    expect(isMempoolError).toBe(true);
  });

  it('should handle generic errors', () => {
    const errorMsg = 'Unknown network error';

    const isDustError = errorMsg.toLowerCase().includes('dust');
    const isInsufficientFunds = errorMsg.toLowerCase().includes('insufficient');
    const isMempoolError = errorMsg.toLowerCase().includes('mempool');

    const isKnownError = isDustError || isInsufficientFunds || isMempoolError;

    expect(isKnownError).toBe(false);
  });
});
