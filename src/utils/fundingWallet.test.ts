import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFundingWIF,
  setFundingWIF,
  hasFundingWIF,
  clearFundingWIF,
  getReceiveAddress,
  setReceiveAddress,
  hasReceiveAddress,
  clearReceiveAddress,
} from './fundingWallet';

describe('fundingWallet', () => {
  const originalEnv = process.env.FUNDING_WIF;

  beforeEach(() => {
    clearFundingWIF();
    delete process.env.FUNDING_WIF;
  });

  afterEach(() => {
    clearFundingWIF();
    if (originalEnv !== undefined) {
      process.env.FUNDING_WIF = originalEnv;
    } else {
      delete process.env.FUNDING_WIF;
    }
  });

  describe('setFundingWIF', () => {
    it('should set the in-memory WIF', () => {
      setFundingWIF('test-wif');
      expect(getFundingWIF()).toBe('test-wif');
    });

    it('should sync to process.env.FUNDING_WIF', () => {
      setFundingWIF('test-wif-sync');
      expect(process.env.FUNDING_WIF).toBe('test-wif-sync');
    });
  });

  describe('getFundingWIF', () => {
    it('should return in-memory WIF when set', () => {
      setFundingWIF('memory-wif');
      process.env.FUNDING_WIF = 'env-wif';
      expect(getFundingWIF()).toBe('memory-wif');
    });

    it('should fallback to process.env when no in-memory WIF', () => {
      process.env.FUNDING_WIF = 'env-wif';
      expect(getFundingWIF()).toBe('env-wif');
    });

    it('should throw when no WIF is configured', () => {
      expect(() => getFundingWIF()).toThrow('Funding WIF not configured');
    });
  });

  describe('hasFundingWIF', () => {
    it('should return false when nothing is set', () => {
      expect(hasFundingWIF()).toBe(false);
    });

    it('should return true when in-memory WIF is set', () => {
      setFundingWIF('some-wif');
      expect(hasFundingWIF()).toBe(true);
    });

    it('should return true when process.env.FUNDING_WIF is set', () => {
      process.env.FUNDING_WIF = 'env-wif';
      expect(hasFundingWIF()).toBe(true);
    });
  });

  describe('clearFundingWIF', () => {
    it('should clear the in-memory WIF but not process.env', () => {
      setFundingWIF('some-wif');
      clearFundingWIF();
      // setFundingWIF synced to env, so env still has the value
      expect(process.env.FUNDING_WIF).toBe('some-wif');
      // hasFundingWIF() is still true because process.env has it
      expect(hasFundingWIF()).toBe(true);
    });

    it('should allow getFundingWIF to fallback to env after clear', () => {
      setFundingWIF('memory-wif');
      process.env.FUNDING_WIF = 'env-wif';
      clearFundingWIF();
      // After clearing in-memory, should fall back to env
      expect(getFundingWIF()).toBe('env-wif');
    });

    it('should result in no WIF when env is also cleared', () => {
      setFundingWIF('some-wif');
      clearFundingWIF();
      delete process.env.FUNDING_WIF;
      expect(hasFundingWIF()).toBe(false);
      expect(() => getFundingWIF()).toThrow('Funding WIF not configured');
    });
  });
});

describe('receiveAddress', () => {
  const originalEnv = process.env.TOKEN_RECEIVE_ADDRESS;

  beforeEach(() => {
    clearReceiveAddress();
    delete process.env.TOKEN_RECEIVE_ADDRESS;
  });

  afterEach(() => {
    clearReceiveAddress();
    if (originalEnv !== undefined) {
      process.env.TOKEN_RECEIVE_ADDRESS = originalEnv;
    } else {
      delete process.env.TOKEN_RECEIVE_ADDRESS;
    }
  });

  describe('setReceiveAddress', () => {
    it('should set the in-memory address', () => {
      setReceiveAddress('bc1ptest123');
      expect(getReceiveAddress()).toBe('bc1ptest123');
    });

    it('should sync to process.env.TOKEN_RECEIVE_ADDRESS', () => {
      setReceiveAddress('bc1psync');
      expect(process.env.TOKEN_RECEIVE_ADDRESS).toBe('bc1psync');
    });
  });

  describe('getReceiveAddress', () => {
    it('should return in-memory address when set', () => {
      setReceiveAddress('bc1pmemory');
      process.env.TOKEN_RECEIVE_ADDRESS = 'bc1penv';
      expect(getReceiveAddress()).toBe('bc1pmemory');
    });

    it('should fallback to process.env when no in-memory address', () => {
      process.env.TOKEN_RECEIVE_ADDRESS = 'bc1penv';
      expect(getReceiveAddress()).toBe('bc1penv');
    });

    it('should throw when no address is configured', () => {
      expect(() => getReceiveAddress()).toThrow('TOKEN_RECEIVE_ADDRESS not configured');
    });
  });

  describe('hasReceiveAddress', () => {
    it('should return false when nothing is set', () => {
      expect(hasReceiveAddress()).toBe(false);
    });

    it('should return true when in-memory address is set', () => {
      setReceiveAddress('bc1ptest');
      expect(hasReceiveAddress()).toBe(true);
    });

    it('should return true when process.env.TOKEN_RECEIVE_ADDRESS is set', () => {
      process.env.TOKEN_RECEIVE_ADDRESS = 'bc1penv';
      expect(hasReceiveAddress()).toBe(true);
    });
  });

  describe('clearReceiveAddress', () => {
    it('should clear in-memory address but not process.env', () => {
      setReceiveAddress('bc1ptest');
      clearReceiveAddress();
      // setReceiveAddress synced to env, so env still has the value
      expect(process.env.TOKEN_RECEIVE_ADDRESS).toBe('bc1ptest');
      expect(hasReceiveAddress()).toBe(true);
    });

    it('should result in no address when env is also cleared', () => {
      setReceiveAddress('bc1ptest');
      clearReceiveAddress();
      delete process.env.TOKEN_RECEIVE_ADDRESS;
      expect(hasReceiveAddress()).toBe(false);
      expect(() => getReceiveAddress()).toThrow('TOKEN_RECEIVE_ADDRESS not configured');
    });
  });
});
