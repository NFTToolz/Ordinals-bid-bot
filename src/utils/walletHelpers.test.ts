import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory, ECPairAPI, TinySecp256k1Interface } from 'ecpair';

const tinysecp: TinySecp256k1Interface = require('tiny-secp256k1');
const ECPair: ECPairAPI = ECPairFactory(tinysecp);

// Generate deterministic test WIF keys
function generateTestWIF(index: number): string {
  const privateKeyBytes = Buffer.alloc(32, 0);
  privateKeyBytes[31] = index + 1;
  const keyPair = ECPair.fromPrivateKey(privateKeyBytes, { network: bitcoin.networks.bitcoin });
  return keyPair.toWIF();
}

function derivePaymentAddress(wif: string): string {
  const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
  return bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network: bitcoin.networks.bitcoin,
  }).address as string;
}

function derivePublicKey(wif: string): string {
  const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
  return keyPair.publicKey.toString('hex');
}

const PRIMARY_WIF = generateTestWIF(0);
const PRIMARY_PAYMENT = derivePaymentAddress(PRIMARY_WIF);
const PRIMARY_PUBKEY = derivePublicKey(PRIMARY_WIF);
const PRIMARY_RECEIVE = 'bc1p_primary_receive';

const ROTATION_WIF_1 = generateTestWIF(1);
const ROTATION_PAYMENT_1 = derivePaymentAddress(ROTATION_WIF_1);
const ROTATION_PUBKEY_1 = derivePublicKey(ROTATION_WIF_1);

const ROTATION_WIF_2 = generateTestWIF(2);
const ROTATION_PAYMENT_2 = derivePaymentAddress(ROTATION_WIF_2);
const ROTATION_PUBKEY_2 = derivePublicKey(ROTATION_WIF_2);

// --- Mocks ---

const mockGetWalletGroupManager = vi.fn();
const mockIsWalletGroupManagerInitialized = vi.fn();
const mockGetWalletPool = vi.fn();
const mockIsWalletPoolInitialized = vi.fn();
const mockHasFundingWIF = vi.fn();
const mockGetFundingWIF = vi.fn();
const mockHasReceiveAddress = vi.fn();
const mockGetReceiveAddress = vi.fn();

vi.mock('./walletGroups', () => ({
  isWalletGroupManagerInitialized: (...args: unknown[]) => mockIsWalletGroupManagerInitialized(...args),
  getWalletGroupManager: (...args: unknown[]) => mockGetWalletGroupManager(...args),
}));

vi.mock('./walletPool', () => ({
  isWalletPoolInitialized: (...args: unknown[]) => mockIsWalletPoolInitialized(...args),
  getWalletPool: (...args: unknown[]) => mockGetWalletPool(...args),
}));

vi.mock('./fundingWallet', () => ({
  hasFundingWIF: (...args: unknown[]) => mockHasFundingWIF(...args),
  getFundingWIF: (...args: unknown[]) => mockGetFundingWIF(...args),
  hasReceiveAddress: (...args: unknown[]) => mockHasReceiveAddress(...args),
  getReceiveAddress: (...args: unknown[]) => mockGetReceiveAddress(...args),
}));

// Suppress console output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

function makeWalletState(wif: string, receiveAddress: string, label: string) {
  const keyPair = ECPair.fromWIF(wif, bitcoin.networks.bitcoin);
  const paymentAddress = bitcoin.payments.p2wpkh({
    pubkey: keyPair.publicKey,
    network: bitcoin.networks.bitcoin,
  }).address as string;
  return {
    config: { wif, receiveAddress, label },
    paymentAddress,
    publicKey: keyPair.publicKey.toString('hex'),
    keyPair,
    lastBidTime: 0,
    bidTimestamps: [],
    isAvailable: true,
  };
}

describe('walletHelpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();

    // Defaults: primary wallet configured, rotation off
    mockHasFundingWIF.mockReturnValue(true);
    mockGetFundingWIF.mockReturnValue(PRIMARY_WIF);
    mockHasReceiveAddress.mockReturnValue(true);
    mockGetReceiveAddress.mockReturnValue(PRIMARY_RECEIVE);
    mockIsWalletGroupManagerInitialized.mockReturnValue(false);
    mockIsWalletPoolInitialized.mockReturnValue(false);
  });

  describe('getAllWalletCredentialsForCancellation', () => {
    it('returns primary wallet when rotation is disabled', async () => {
      // ENABLE_WALLET_ROTATION is read at module init time from process.env
      // For these tests, we re-import with the env var set
      delete process.env.ENABLE_WALLET_ROTATION;
      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        paymentAddress: PRIMARY_PAYMENT,
        receiveAddress: PRIMARY_RECEIVE,
        privateKey: PRIMARY_WIF,
        publicKey: PRIMARY_PUBKEY,
        label: 'primary',
      });
    });

    it('returns primary + group manager wallets when rotation enabled with groups', async () => {
      process.env.ENABLE_WALLET_ROTATION = 'true';
      const state1 = makeWalletState(ROTATION_WIF_1, 'bc1p_recv_1', 'rot-1');
      const state2 = makeWalletState(ROTATION_WIF_2, 'bc1p_recv_2', 'rot-2');

      mockIsWalletGroupManagerInitialized.mockReturnValue(true);
      const mockManager = {
        getAllPaymentAddresses: vi.fn(() => [ROTATION_PAYMENT_1, ROTATION_PAYMENT_2]),
        getWalletByPaymentAddress: vi.fn((addr: string) => {
          if (addr === ROTATION_PAYMENT_1) return { wallet: state1, groupName: 'group1' };
          if (addr === ROTATION_PAYMENT_2) return { wallet: state2, groupName: 'group1' };
          return null;
        }),
      };
      mockGetWalletGroupManager.mockReturnValue(mockManager);

      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(3); // primary + 2 rotation
      expect(result[0].label).toBe('primary');
      expect(result[1]).toEqual({
        paymentAddress: ROTATION_PAYMENT_1,
        receiveAddress: 'bc1p_recv_1',
        privateKey: ROTATION_WIF_1,
        publicKey: ROTATION_PUBKEY_1,
        label: 'rot-1',
      });
      expect(result[2]).toEqual({
        paymentAddress: ROTATION_PAYMENT_2,
        receiveAddress: 'bc1p_recv_2',
        privateKey: ROTATION_WIF_2,
        publicKey: ROTATION_PUBKEY_2,
        label: 'rot-2',
      });
    });

    it('returns primary + pool wallets when rotation enabled with legacy pool', async () => {
      process.env.ENABLE_WALLET_ROTATION = 'true';
      const state1 = makeWalletState(ROTATION_WIF_1, 'bc1p_recv_1', 'pool-1');

      mockIsWalletGroupManagerInitialized.mockReturnValue(false);
      mockIsWalletPoolInitialized.mockReturnValue(true);
      const mockPool = {
        getAllPaymentAddresses: vi.fn(() => [ROTATION_PAYMENT_1]),
        getWalletByPaymentAddress: vi.fn((addr: string) => {
          if (addr === ROTATION_PAYMENT_1) return state1;
          return null;
        }),
      };
      mockGetWalletPool.mockReturnValue(mockPool);

      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(2); // primary + 1 pool wallet
      expect(result[0].label).toBe('primary');
      expect(result[1]).toEqual({
        paymentAddress: ROTATION_PAYMENT_1,
        receiveAddress: 'bc1p_recv_1',
        privateKey: ROTATION_WIF_1,
        publicKey: ROTATION_PUBKEY_1,
        label: 'pool-1',
      });
    });

    it('deduplicates when primary appears in pool/manager', async () => {
      process.env.ENABLE_WALLET_ROTATION = 'true';
      const primaryState = makeWalletState(PRIMARY_WIF, PRIMARY_RECEIVE, 'dup-primary');

      mockIsWalletGroupManagerInitialized.mockReturnValue(false);
      mockIsWalletPoolInitialized.mockReturnValue(true);
      const mockPool = {
        getAllPaymentAddresses: vi.fn(() => [PRIMARY_PAYMENT]),
        getWalletByPaymentAddress: vi.fn(() => primaryState),
      };
      mockGetWalletPool.mockReturnValue(mockPool);

      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(1); // deduplicated
      expect(result[0].label).toBe('primary');
    });

    it('returns empty when no primary WIF and rotation disabled', async () => {
      delete process.env.ENABLE_WALLET_ROTATION;
      mockHasFundingWIF.mockReturnValue(false);

      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(0);
    });

    it('prefers group manager over pool when both initialized', async () => {
      process.env.ENABLE_WALLET_ROTATION = 'true';
      const state1 = makeWalletState(ROTATION_WIF_1, 'bc1p_recv_1', 'mgr-wallet');

      mockIsWalletGroupManagerInitialized.mockReturnValue(true);
      mockIsWalletPoolInitialized.mockReturnValue(true);
      const mockManager = {
        getAllPaymentAddresses: vi.fn(() => [ROTATION_PAYMENT_1]),
        getWalletByPaymentAddress: vi.fn(() => ({ wallet: state1, groupName: 'g1' })),
      };
      mockGetWalletGroupManager.mockReturnValue(mockManager);

      const { getAllWalletCredentialsForCancellation, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const result = getAllWalletCredentialsForCancellation();
      expect(result).toHaveLength(2); // primary + 1 from manager
      expect(result[1].label).toBe('mgr-wallet');
      // Pool should NOT be consulted
      expect(mockGetWalletPool).not.toHaveBeenCalled();
    });
  });

  describe('getWalletCredentialsByPaymentAddress', () => {
    it('returns credentials for primary wallet', async () => {
      delete process.env.ENABLE_WALLET_ROTATION;
      const { getWalletCredentialsByPaymentAddress, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const creds = getWalletCredentialsByPaymentAddress(PRIMARY_PAYMENT);
      expect(creds).toBeDefined();
      expect(creds!.privateKey).toBe(PRIMARY_WIF);
      expect(creds!.publicKey).toBe(PRIMARY_PUBKEY);
      expect(creds!.receiveAddress).toBe(PRIMARY_RECEIVE);
    });

    it('returns credentials for rotation wallet via manager', async () => {
      process.env.ENABLE_WALLET_ROTATION = 'true';
      const state1 = makeWalletState(ROTATION_WIF_1, 'bc1p_recv_1', 'rot-1');

      mockIsWalletGroupManagerInitialized.mockReturnValue(true);
      mockGetWalletGroupManager.mockReturnValue({
        getAllPaymentAddresses: vi.fn(() => [ROTATION_PAYMENT_1]),
        getWalletByPaymentAddress: vi.fn(() => ({ wallet: state1, groupName: 'g1' })),
      });

      const { getWalletCredentialsByPaymentAddress, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const creds = getWalletCredentialsByPaymentAddress(ROTATION_PAYMENT_1);
      expect(creds).toBeDefined();
      expect(creds!.privateKey).toBe(ROTATION_WIF_1);
    });

    it('returns undefined for unknown address', async () => {
      delete process.env.ENABLE_WALLET_ROTATION;
      const { getWalletCredentialsByPaymentAddress, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const creds = getWalletCredentialsByPaymentAddress('bc1q_unknown');
      expect(creds).toBeUndefined();
    });

    it('returns undefined for empty address', async () => {
      const { getWalletCredentialsByPaymentAddress, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      expect(getWalletCredentialsByPaymentAddress('')).toBeUndefined();
    });

    it('is case-insensitive', async () => {
      delete process.env.ENABLE_WALLET_ROTATION;
      const { getWalletCredentialsByPaymentAddress, clearWalletCredentialsCache } = await import('./walletHelpers');
      clearWalletCredentialsCache();

      const creds = getWalletCredentialsByPaymentAddress(PRIMARY_PAYMENT.toUpperCase());
      expect(creds).toBeDefined();
      expect(creds!.privateKey).toBe(PRIMARY_WIF);
    });
  });
});
