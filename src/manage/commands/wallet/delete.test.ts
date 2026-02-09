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
  formatBTC: vi.fn((sats: number) => `${(sats / 100000000).toFixed(8)} BTC`),
  withSpinner: vi.fn().mockImplementation(async (_message: string, fn: () => Promise<unknown>) => fn()),
  getSeparatorWidth: vi.fn(() => 60),
}));

vi.mock('../../utils/prompts', () => ({
  promptMultiSelect: vi.fn().mockResolvedValue([]),
  promptConfirm: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../utils/walletPassword', () => ({
  ensureWalletPasswordIfNeeded: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../utils/interactiveTable', () => ({
  showInteractiveTable: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/WalletGenerator', () => ({
  loadWallets: vi.fn().mockReturnValue({ wallets: [] }),
  isGroupsFormat: vi.fn().mockReturnValue(false),
  removeWalletFromConfig: vi.fn().mockReturnValue(true),
  removeWalletFromGroup: vi.fn().mockReturnValue({ success: true }),
  findWalletGroup: vi.fn().mockReturnValue(null),
  getAllWalletsFromGroups: vi.fn().mockReturnValue([]),
  getWalletFromWIF: vi.fn().mockReturnValue({
    paymentAddress: 'bc1qpayment',
    receiveAddress: 'bc1preceive',
    publicKey: '02abc',
  }),
  // Encryption-related exports
  readWalletsFileRaw: vi.fn().mockReturnValue(null),
  isEncryptedFormat: vi.fn().mockReturnValue(false),
  loadWalletsDecrypted: vi.fn().mockReturnValue(null),
  loadFundingWalletFromConfig: vi.fn().mockReturnValue(null),
  setSessionPassword: vi.fn(),
  clearSessionPassword: vi.fn(),
  getSessionPassword: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/BalanceService', () => ({
  getAllBalances: vi.fn().mockResolvedValue([]),
  calculateTotalBalance: vi.fn().mockReturnValue({
    confirmed: 0,
    unconfirmed: 0,
    total: 0,
  }),
}));

vi.mock('../../../utils/fundingWallet', () => ({
  hasReceiveAddress: vi.fn().mockReturnValue(true),
  getReceiveAddress: vi.fn().mockReturnValue(TEST_RECEIVE_ADDRESS),
}));

beforeAll(() => {
  process.env.FUNDING_WIF = TEST_WIF;
  process.env.TOKEN_RECEIVE_ADDRESS = TEST_RECEIVE_ADDRESS;
});

describe('deleteWalletsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show error when no config wallets exist', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    // Main wallet only — no config wallets
    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({ wallets: [] });
    vi.mocked(WalletGenerator.getWalletFromWIF).mockReturnValue({
      paymentAddress: 'bc1qmainpay',
      receiveAddress: TEST_RECEIVE_ADDRESS,
      publicKey: '02main',
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
    ]);

    await deleteWalletsCommand();

    expect(display.showError).toHaveBeenCalledWith('No config wallets found to delete.');
  });

  it('should return early if user selects no wallets', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
    });
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 0, confirmed: 0, unconfirmed: 0, utxoCount: 0 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue([]);

    await deleteWalletsCommand();

    expect(display.showWarning).toHaveBeenCalledWith('Cancelled');
    expect(prompts.promptConfirm).not.toHaveBeenCalled();
  });

  it('should return early if user declines confirmation', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
    });
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 0, confirmed: 0, unconfirmed: 0, utxoCount: 0 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue(['bidder-0']);
    vi.mocked(prompts.promptConfirm).mockResolvedValue(false);

    await deleteWalletsCommand();

    expect(display.showWarning).toHaveBeenCalledWith('Cancelled');
    expect(WalletGenerator.removeWalletFromConfig).not.toHaveBeenCalled();
  });

  it('should delete wallet in legacy format', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
    });
    vi.mocked(WalletGenerator.isGroupsFormat).mockReturnValue(false);
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 0, confirmed: 0, unconfirmed: 0, utxoCount: 0 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue(['bidder-0']);
    vi.mocked(prompts.promptConfirm).mockResolvedValue(true);
    vi.mocked(WalletGenerator.removeWalletFromConfig).mockReturnValue(true);

    await deleteWalletsCommand();

    expect(WalletGenerator.removeWalletFromConfig).toHaveBeenCalledWith('bidder-0');
    expect(display.showSuccess).toHaveBeenCalledWith('Deleted "bidder-0"');
  });

  it('should delete wallet in groups format', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      groups: {
        'group-a': {
          wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
        },
      },
      defaultGroup: 'group-a',
    });
    vi.mocked(WalletGenerator.isGroupsFormat).mockReturnValue(true);
    vi.mocked(WalletGenerator.getAllWalletsFromGroups).mockReturnValue([
      { label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS, groupName: 'group-a' },
    ]);
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 0, confirmed: 0, unconfirmed: 0, utxoCount: 0 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue(['bidder-0']);
    vi.mocked(prompts.promptConfirm).mockResolvedValue(true);
    vi.mocked(WalletGenerator.findWalletGroup).mockReturnValue('group-a');
    vi.mocked(WalletGenerator.removeWalletFromGroup).mockReturnValue({ success: true });

    await deleteWalletsCommand();

    expect(WalletGenerator.removeWalletFromGroup).toHaveBeenCalledWith('group-a', 'bidder-0');
    expect(display.showSuccess).toHaveBeenCalledWith('Deleted "bidder-0" from group "group-a"');
  });

  it('should warn when selected wallet has non-zero balance', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const display = await import('../../utils/display');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
    });
    vi.mocked(WalletGenerator.isGroupsFormat).mockReturnValue(false);
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 50000, confirmed: 50000, unconfirmed: 0, utxoCount: 1 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue(['bidder-0']);
    vi.mocked(prompts.promptConfirm).mockResolvedValue(false);

    await deleteWalletsCommand();

    expect(display.showWarning).toHaveBeenCalledWith(
      '1 wallet(s) have non-zero balance! Funds will be lost if not consolidated first.'
    );
  });

  it('should skip Main Wallet from selection list', async () => {
    const { deleteWalletsCommand } = await import('./delete');
    const prompts = await import('../../utils/prompts');
    const WalletGenerator = await import('../../services/WalletGenerator');
    const BalanceService = await import('../../services/BalanceService');

    vi.mocked(WalletGenerator.loadWallets).mockReturnValue({
      wallets: [{ label: 'bidder-0', wif: TEST_WIF, receiveAddress: TEST_RECEIVE_ADDRESS }],
    });
    vi.mocked(WalletGenerator.isGroupsFormat).mockReturnValue(false);
    let callCount = 0;
    vi.mocked(WalletGenerator.getWalletFromWIF).mockImplementation((_wif, _network) => {
      callCount++;
      if (callCount === 1) {
        return { paymentAddress: 'bc1qmainpay', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02main' };
      }
      return { paymentAddress: 'bc1qpayment0', receiveAddress: TEST_RECEIVE_ADDRESS, publicKey: '02abc' };
    });
    vi.mocked(BalanceService.getAllBalances).mockResolvedValue([
      { address: 'bc1qmainpay', total: 500000, confirmed: 500000, unconfirmed: 0, utxoCount: 1 },
      { address: 'bc1qpayment0', total: 0, confirmed: 0, unconfirmed: 0, utxoCount: 0 },
    ]);
    vi.mocked(prompts.promptMultiSelect).mockResolvedValue([]);

    await deleteWalletsCommand();

    // promptMultiSelect should only have config wallet choices, not Main Wallet
    const multiSelectCall = vi.mocked(prompts.promptMultiSelect).mock.calls[0];
    const choiceLabels = (multiSelectCall[1] as Array<{ name: string; value: string }>).map(c => c.name);
    expect(choiceLabels.every(label => !label.includes('Main Wallet'))).toBe(true);
    expect(choiceLabels.length).toBe(1);
    expect(choiceLabels[0]).toContain('bidder-0');
  });
});
