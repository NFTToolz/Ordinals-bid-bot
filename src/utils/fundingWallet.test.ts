import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getFundingWIF,
  setFundingWIF,
  hasFundingWIF,
  clearFundingWIF,
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
