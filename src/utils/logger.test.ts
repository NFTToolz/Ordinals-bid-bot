import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { formatBTC, formatSats, formatTokenId, formatWalletForLog, BidStats, getBidStatsData, bidStats, Logger, LogLevel, setLogLevel, getLogLevel } from './logger';

describe('Logger Utilities', () => {
  describe('formatBTC', () => {
    it('should convert satoshis to BTC string with 8 decimal places', () => {
      expect(formatBTC(100000000)).toBe('1.00000000 BTC');
      expect(formatBTC(50000000)).toBe('0.50000000 BTC');
      expect(formatBTC(1)).toBe('0.00000001 BTC');
      expect(formatBTC(0)).toBe('0.00000000 BTC');
    });

    it('should handle large values', () => {
      expect(formatBTC(2100000000000000)).toBe('21000000.00000000 BTC');
    });

    it('should handle fractional satoshis (edge case)', () => {
      expect(formatBTC(12345678)).toBe('0.12345678 BTC');
    });

    it('should handle negative values', () => {
      expect(formatBTC(-100000000)).toBe('-1.00000000 BTC');
    });
  });

  describe('formatSats', () => {
    it('should format satoshis with locale string and BTC equivalent', () => {
      const result = formatSats(100000000);
      expect(result).toContain('100,000,000 sats');
      expect(result).toContain('1.00000000 BTC');
    });

    it('should format small values', () => {
      const result = formatSats(1000);
      expect(result).toContain('1,000 sats');
      expect(result).toContain('0.00001000 BTC');
    });

    it('should handle zero', () => {
      const result = formatSats(0);
      expect(result).toContain('0 sats');
      expect(result).toContain('0.00000000 BTC');
    });

    it('should format large values with locale separator', () => {
      const result = formatSats(2100000000000000);
      expect(result).toContain('21000000.00000000 BTC');
    });
  });

  describe('formatTokenId', () => {
    it('should truncate long token IDs showing last 8 chars', () => {
      const longId = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678i0';
      expect(formatTokenId(longId)).toBe('...345678i0');
    });

    it('should return short IDs unchanged', () => {
      const shortId = 'abc123';
      expect(formatTokenId(shortId)).toBe('abc123');
    });

    it('should handle exactly 12 character IDs', () => {
      const exactId = '123456789012';
      expect(formatTokenId(exactId)).toBe('123456789012');
    });

    it('should truncate IDs longer than 12 characters', () => {
      const id = '1234567890123';
      expect(formatTokenId(id)).toBe('...67890123');
    });

    it('should handle empty string', () => {
      expect(formatTokenId('')).toBe('');
    });

    it('should handle standard inscription ID format', () => {
      const inscriptionId = 'abc123def456789012345678901234567890123456789012345678901234i0';
      const result = formatTokenId(inscriptionId);
      expect(result).toBe('...901234i0');
    });
  });

  describe('formatWalletForLog', () => {
    it('should return undefined when no address provided', () => {
      expect(formatWalletForLog('Label')).toBeUndefined();
      expect(formatWalletForLog()).toBeUndefined();
    });

    it('should format address only (no label)', () => {
      expect(formatWalletForLog(undefined, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('bc1q...f3t4');
    });

    it('should format label with address', () => {
      expect(formatWalletForLog('Wallet A', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('Wallet A (bc1q...f3t4)');
    });

    it('should return short addresses unchanged', () => {
      expect(formatWalletForLog(undefined, 'bc1q1234')).toBe('bc1q1234');
    });

    it('should handle label with short address', () => {
      expect(formatWalletForLog('Main', 'bc1q1234')).toBe('Main (bc1q1234)');
    });
  });

  describe('BidStats', () => {
    let stats: BidStats;

    beforeEach(() => {
      stats = new BidStats();
    });

    describe('increment', () => {
      it('should increment bidsPlaced', () => {
        stats.increment('bidsPlaced');
        stats.increment('bidsPlaced');
        expect(stats.getStats().bidsPlaced).toBe(2);
      });

      it('should increment bidsSkipped', () => {
        stats.increment('bidsSkipped');
        expect(stats.getStats().bidsSkipped).toBe(1);
      });

      it('should increment bidsCancelled', () => {
        stats.increment('bidsCancelled');
        expect(stats.getStats().bidsCancelled).toBe(1);
      });

      it('should increment bidsAdjusted', () => {
        stats.increment('bidsAdjusted');
        expect(stats.getStats().bidsAdjusted).toBe(1);
      });

      it('should increment errors', () => {
        stats.increment('errors');
        stats.increment('errors');
        stats.increment('errors');
        expect(stats.getStats().errors).toBe(3);
      });

      it('should handle multiple increments of different types', () => {
        stats.increment('bidsPlaced');
        stats.increment('bidsSkipped');
        stats.increment('errors');
        stats.increment('bidsPlaced');

        const result = stats.getStats();
        expect(result.bidsPlaced).toBe(2);
        expect(result.bidsSkipped).toBe(1);
        expect(result.errors).toBe(1);
      });
    });

    describe('getStats', () => {
      it('should return all stats with runtime', () => {
        const result = stats.getStats();
        expect(result).toHaveProperty('bidsPlaced', 0);
        expect(result).toHaveProperty('bidsSkipped', 0);
        expect(result).toHaveProperty('bidsCancelled', 0);
        expect(result).toHaveProperty('bidsAdjusted', 0);
        expect(result).toHaveProperty('errors', 0);
        expect(result).toHaveProperty('runtime');
        expect(result).toHaveProperty('lastReset');
      });

      it('should calculate runtime in minutes as string', () => {
        const result = stats.getStats();
        expect(typeof result.runtime).toBe('string');
        expect(parseFloat(result.runtime)).toBeGreaterThanOrEqual(0);
      });

      it('should return current stats values', () => {
        stats.increment('bidsPlaced');
        stats.increment('bidsPlaced');
        stats.increment('errors');

        const result = stats.getStats();
        expect(result.bidsPlaced).toBe(2);
        expect(result.errors).toBe(1);
      });
    });

    describe('reset', () => {
      it('should reset all stats to zero', () => {
        stats.increment('bidsPlaced');
        stats.increment('bidsSkipped');
        stats.increment('errors');

        stats.reset();

        const result = stats.getStats();
        expect(result.bidsPlaced).toBe(0);
        expect(result.bidsSkipped).toBe(0);
        expect(result.bidsCancelled).toBe(0);
        expect(result.bidsAdjusted).toBe(0);
        expect(result.errors).toBe(0);
      });

      it('should reset the lastReset timestamp', () => {
        const beforeReset = stats.getStats().lastReset;

        vi.useFakeTimers();
        vi.advanceTimersByTime(100);

        stats.reset();

        const afterReset = stats.getStats().lastReset;
        expect(afterReset).toBeGreaterThanOrEqual(beforeReset);

        vi.useRealTimers();
      });
    });

    describe('printSummary', () => {
      let consoleSpy: any;

      beforeEach(() => {
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      });

      afterEach(() => {
        consoleSpy.mockRestore();
      });

      it('should not throw when printing summary', () => {
        stats.increment('bidsPlaced');
        expect(() => stats.printSummary()).not.toThrow();
      });

      it('should print stats to console', () => {
        stats.increment('bidsPlaced');
        stats.increment('bidsPlaced');
        stats.increment('errors');

        stats.printSummary();

        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((call: any) => call[0]).join('\n');
        expect(output).toContain('BID STATISTICS');
      });
    });
  });

  describe('getBidStatsData', () => {
    it('should return stats from bidStats singleton', () => {
      const result = getBidStatsData();
      expect(result).toHaveProperty('bidsPlaced');
      expect(result).toHaveProperty('runtime');
    });
  });

  describe('Logger methods', () => {
    let consoleSpy: any;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bidStats.reset();
      setLogLevel(LogLevel.DEBUG);
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      setLogLevel(LogLevel.INFO);
    });

    describe('success', () => {
      it('should log success message', () => {
        Logger.success('Operation completed');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[OK]');
        expect(output).toContain('Operation completed');
      });

      it('should log success with details', () => {
        Logger.success('Done', { key: 'value' });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('info', () => {
      it('should log info message', () => {
        Logger.info('Information message');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[INFO]');
      });

      it('should log info with details', () => {
        Logger.info('Info', { data: 123 });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('warning', () => {
      it('should log warning message', () => {
        Logger.warning('Warning message');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[WARN]');
        expect(output).toContain('Warning message');
      });

      it('should log warning with details', () => {
        Logger.warning('Warn', { issue: 'test' });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('error', () => {
      it('should log error message', () => {
        Logger.error('Error occurred');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[ERR]');
        expect(output).toContain('Error occurred');
      });

      it('should log error with stack trace', () => {
        const error = new Error('Test error');
        Logger.error('Failed', error);
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });

      it('should log error with object', () => {
        Logger.error('Failed', { code: 500 });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('critical', () => {
      it('should log critical message', () => {
        Logger.critical('Critical issue');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('CRITICAL');
      });

      it('should log critical with details', () => {
        Logger.critical('System failure', { memory: '95%' });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });
    });

    describe('bidPlaced', () => {
      it('should log bid placed and increment stats', () => {
        const initialStats = getBidStatsData();
        const initialBids = initialStats.bidsPlaced;

        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'NEW');

        expect(consoleSpy).toHaveBeenCalled();
        const newStats = getBidStatsData();
        expect(newStats.bidsPlaced).toBe(initialBids + 1);
      });

      it('should log BID PLACED for COUNTERBID', () => {
        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'COUNTERBID');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('BID PLACED');
      });

      it('should log BID PLACED for OUTBID', () => {
        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'OUTBID');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('BID PLACED');
      });

      it('should log BID PLACED for NEW', () => {
        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'NEW');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('BID PLACED');
      });

      it('should log Wallet line when wallet is provided', () => {
        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'NEW', { wallet: 'Wallet A (bc1q...abcd)' });
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Wallet:');
        expect(output).toContain('Wallet A (bc1q...abcd)');
      });

      it('should not log Wallet line when wallet is not provided', () => {
        Logger.bidPlaced('test-collection', 'token123i0', 50000, 'NEW', { floorPrice: 100000 });
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).not.toContain('Wallet:');
      });
    });

    describe('bidAdjusted', () => {
      it('should log bid adjusted and increment stats', () => {
        const initialStats = getBidStatsData();
        const initialAdjusted = initialStats.bidsAdjusted;

        Logger.bidAdjusted('test-collection', 'token123i0', 40000, 50000);

        expect(consoleSpy).toHaveBeenCalled();
        const newStats = getBidStatsData();
        expect(newStats.bidsAdjusted).toBe(initialAdjusted + 1);
      });

      it('should show price increase with up arrow', () => {
        Logger.bidAdjusted('test-collection', 'token123i0', 40000, 50000);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('↑');
      });

      it('should show price decrease with down arrow', () => {
        Logger.bidAdjusted('test-collection', 'token123i0', 50000, 40000);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('↓');
      });
    });

    describe('bidCancelled', () => {
      it('should log bid cancelled and increment stats', () => {
        const initialStats = getBidStatsData();
        const initialCancelled = initialStats.bidsCancelled;

        Logger.bidCancelled('test-collection', 'token123i0', 'Price too high');

        expect(consoleSpy).toHaveBeenCalled();
        const newStats = getBidStatsData();
        expect(newStats.bidsCancelled).toBe(initialCancelled + 1);
      });
    });

    describe('bidSkipped', () => {
      it('should log bid skipped and increment stats', () => {
        const initialStats = getBidStatsData();
        const initialSkipped = initialStats.bidsSkipped;

        Logger.bidSkipped('test-collection', 'token123i0', 'Already top bid');

        expect(consoleSpy).toHaveBeenCalled();
        const newStats = getBidStatsData();
        expect(newStats.bidsSkipped).toBe(initialSkipped + 1);
      });

      it('should log with price info when provided', () => {
        Logger.bidSkipped('test-collection', 'token123i0', 'Offer too high', 60000, 55000, 50000);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Top Offer');
        expect(output).toContain('Our Bid');
        expect(output).toContain('Max Bid');
      });

      it('should not show Our Bid when equal to topOffer', () => {
        Logger.bidSkipped('test-collection', 'token123i0', 'Offer too high', 60000, 60000, 50000);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Top Offer');
        expect(output).not.toContain('Our Bid');
      });
    });

    describe('collectionOfferPlaced', () => {
      it('should log collection offer placed and increment stats', () => {
        const initialStats = getBidStatsData();
        const initialBids = initialStats.bidsPlaced;

        Logger.collectionOfferPlaced('test-collection', 50000);

        expect(consoleSpy).toHaveBeenCalled();
        const newStats = getBidStatsData();
        expect(newStats.bidsPlaced).toBe(initialBids + 1);
      });

      it('should log Wallet line when wallet is provided', () => {
        Logger.collectionOfferPlaced('test-collection', 50000, 'bc1q...abcd');
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Wallet:');
        expect(output).toContain('bc1q...abcd');
      });

      it('should not log Wallet line when wallet is not provided', () => {
        Logger.collectionOfferPlaced('test-collection', 50000);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).not.toContain('Wallet:');
      });
    });

    describe('scheduleStart', () => {
      it('should log schedule start', () => {
        Logger.scheduleStart('test-collection');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('SCHEDULE');
        expect(output).toContain('test-collection');
      });
    });

    describe('scheduleComplete', () => {
      it('should log schedule complete with duration', () => {
        Logger.scheduleComplete('test-collection', 2.5);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('SCHEDULE COMPLETE');
        expect(output).toContain('2.50s');
      });
    });

    describe('websocket', () => {
      it('should log connected', () => {
        Logger.websocket.connected();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('WebSocket');
        expect(output).toContain('Connected');
      });

      it('should log disconnected', () => {
        Logger.websocket.disconnected();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Disconnected');
      });

      it('should log subscribed', () => {
        Logger.websocket.subscribed('test-collection');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Subscribed');
        expect(output).toContain('test-collection');
      });

      it('should log event with token', () => {
        Logger.websocket.event('offer', 'test-collection', 'token123i0');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('offer');
        expect(output).toContain('Token');
      });

      it('should log event without token', () => {
        Logger.websocket.event('listing', 'test-collection');
        expect(consoleSpy).toHaveBeenCalled();
      });

      it('should log error', () => {
        Logger.websocket.error(new Error('Connection failed'));
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Error');
      });

      it('should log error with stack', () => {
        const error = new Error('Test');
        error.stack = 'Error: Test\n    at test.ts:1:1';
        Logger.websocket.error(error);
        expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      });

      it('should log maxRetriesExceeded', () => {
        Logger.websocket.maxRetriesExceeded();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('MAX RETRIES');
      });
    });

    describe('memory', () => {
      it('should log memory status', () => {
        Logger.memory.status(100, 200, 50, 100);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('MEMORY STATUS');
        expect(output).toContain('Heap');
        expect(output).toContain('Queue');
      });

      it('should log memory warning', () => {
        Logger.memory.warning('High memory usage');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('MEMORY WARNING');
      });

      it('should log memory critical', () => {
        Logger.memory.critical('Out of memory');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('MEMORY CRITICAL');
      });

      it('should log cleanup', () => {
        Logger.memory.cleanup(50);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Cleanup');
        expect(output).toContain('50');
      });
    });

    describe('printStats', () => {
      it('should print stats summary', () => {
        Logger.printStats();
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('separator', () => {
      it('should print separator line', () => {
        Logger.separator();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('─');
      });
    });

    describe('header', () => {
      it('should print header with text', () => {
        Logger.header('Test Header');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Test Header');
        expect(output).toContain('╔');
        expect(output).toContain('╚');
      });
    });

    describe('pacer', () => {
      it('should log init', () => {
        Logger.pacer.init(10, 60);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('PACER');
        expect(output).toContain('Initialized');
      });

      it('should log bid', () => {
        Logger.pacer.bid(5, 10, 5, 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('PACER');
        expect(output).toContain('5/10');
      });

      it('should log waiting', () => {
        Logger.pacer.waiting(10, 10, 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Rate limit');
      });

      it('should log windowReset', () => {
        Logger.pacer.windowReset();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Window reset');
      });

      it('should log error', () => {
        Logger.pacer.error('token123');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('PACER');
        expect(output).toContain('error');
      });

      it('should log status', () => {
        Logger.pacer.status(5, 10, 5, 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('PACER');
        expect(output).toContain('Status');
      });

      it('should log manualReset', () => {
        Logger.pacer.manualReset();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Manual reset');
      });

      it('should log cycleStart', () => {
        Logger.pacer.cycleStart(10, 10, 60);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('Cycle start');
      });
    });

    describe('rateLimit', () => {
      it('should log pause', () => {
        Logger.rateLimit.pause(60);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('RATE LIMIT');
        expect(output).toContain('pause');
      });

      it('should log lifted', () => {
        Logger.rateLimit.lifted();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('RATE LIMIT');
        expect(output).toContain('lifted');
      });
    });

    describe('queue', () => {
      it('should log skip', () => {
        Logger.queue.skip('token123i0', 'Already processed');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('QUEUE');
        expect(output).toContain('Skipping');
      });

      it('should log waiting', () => {
        Logger.queue.waiting('token123i0', 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('QUEUE');
        expect(output).toContain('Waiting');
      });

      it('should log progress', () => {
        Logger.queue.progress(5, 2, 3, 10, 30, 15);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('QUEUE');
        expect(output).toContain('Pending');
      });
    });

    describe('tokens', () => {
      it('should log retrieved', () => {
        Logger.tokens.retrieved(50, 100);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('TOKENS');
        expect(output).toContain('Retrieved');
      });

      it('should log firstListings', () => {
        Logger.tokens.firstListings('0.001, 0.002, 0.003');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('TOKENS');
        expect(output).toContain('First 5 listings');
      });
    });

    describe('wallet', () => {
      it('should log using', () => {
        Logger.wallet.using('Wallet 1', 'token123i0');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('WALLET');
        expect(output).toContain('Wallet 1');
      });

      it('should log allRateLimited', () => {
        Logger.wallet.allRateLimited('token123i0');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('WALLET');
        expect(output).toContain('rate-limited');
      });

      it('should log allRateLimited without token', () => {
        Logger.wallet.allRateLimited();
        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('schedule', () => {
      it('should log rateLimited', () => {
        Logger.schedule.rateLimited('test-collection', 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('SCHEDULE');
        expect(output).toContain('Rate limited');
      });

      it('should log skipping', () => {
        Logger.schedule.skipping('test-collection', 30);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('SCHEDULE');
        expect(output).toContain('skipping');
      });
    });

    describe('offer', () => {
      it('should log error', () => {
        Logger.offer.error('create', 'token123i0', 'Failed to create');
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('OFFER');
        expect(output).toContain('error');
      });

      it('should log error with HTTP status', () => {
        Logger.offer.error('submit', 'token123i0', 'Server error', 500);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('HTTP 500');
      });

      it('should log error with response', () => {
        Logger.offer.error('cancel', 'token123i0', 'Not found', 404, { message: 'Offer not found' });
        expect(consoleSpy).toHaveBeenCalledTimes(2);
      });

      it('should log insufficientFunds', () => {
        Logger.offer.insufficientFunds('token123i0', 50000, 60000, 30000);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('INSUFFICIENT FUNDS');
      });
    });

    describe('summary.bidPlacement', () => {
      it('should log bid placement summary', () => {
        Logger.summary.bidPlacement({
          tokensProcessed: 100,
          newBidsPlaced: 20,
          bidsAdjusted: 5,
          alreadyHaveBids: 10,
          noActionNeeded: 50,
          skippedOfferTooHigh: 5,
          skippedBidTooHigh: 5,
          skippedAlreadyOurs: 5,
          bidsFailed: 0,
          currentActiveBids: 35,
          bidCount: 50,
        });
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('BID PLACEMENT SUMMARY');
        expect(output).toContain('Tokens processed');
      });

      it('should log with successfulBidsPlaced when provided', () => {
        Logger.summary.bidPlacement({
          tokensProcessed: 100,
          newBidsPlaced: 20,
          bidsAdjusted: 5,
          alreadyHaveBids: 10,
          noActionNeeded: 50,
          skippedOfferTooHigh: 5,
          skippedBidTooHigh: 5,
          skippedAlreadyOurs: 5,
          bidsFailed: 0,
          currentActiveBids: 35,
          bidCount: 50,
          successfulBidsPlaced: 25,
        });
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Successful bids placed');
      });
    });
  });

  describe('Log Levels', () => {
    let consoleSpy: any;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      bidStats.reset();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
      setLogLevel(LogLevel.INFO);
    });

    it('Logger.debug() outputs at DEBUG level', () => {
      setLogLevel(LogLevel.DEBUG);
      Logger.debug('test debug');
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0][0];
      expect(output).toContain('test debug');
    });

    it('Logger.debug() is silent at INFO level', () => {
      setLogLevel(LogLevel.INFO);
      Logger.debug('test debug');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('Logger.info() outputs at INFO level', () => {
      setLogLevel(LogLevel.INFO);
      Logger.info('test info');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('Logger.info() is silent at WARN level', () => {
      setLogLevel(LogLevel.WARN);
      Logger.info('test info');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('Logger.warning() outputs at WARN level', () => {
      setLogLevel(LogLevel.WARN);
      Logger.warning('test warn');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('Logger.warning() is silent at ERROR level', () => {
      setLogLevel(LogLevel.ERROR);
      Logger.warning('test warn');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('Logger.error() always outputs at ERROR level', () => {
      setLogLevel(LogLevel.ERROR);
      Logger.error('test error');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('bidPlaced() increments stats even when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const before = getBidStatsData().bidsPlaced;
      Logger.bidPlaced('col', 'token123i0', 50000, 'NEW');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(getBidStatsData().bidsPlaced).toBe(before + 1);
    });

    it('bidSkipped() increments stats even when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const before = getBidStatsData().bidsSkipped;
      Logger.bidSkipped('col', 'token123i0', 'reason');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(getBidStatsData().bidsSkipped).toBe(before + 1);
    });

    it('bidAdjusted() increments stats even when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const before = getBidStatsData().bidsAdjusted;
      Logger.bidAdjusted('col', 'token123i0', 40000, 50000);
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(getBidStatsData().bidsAdjusted).toBe(before + 1);
    });

    it('bidCancelled() increments stats even when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const before = getBidStatsData().bidsCancelled;
      Logger.bidCancelled('col', 'token123i0', 'reason');
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(getBidStatsData().bidsCancelled).toBe(before + 1);
    });

    it('collectionOfferPlaced() increments stats even when level is ERROR', () => {
      setLogLevel(LogLevel.ERROR);
      const before = getBidStatsData().bidsPlaced;
      Logger.collectionOfferPlaced('col', 50000);
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(getBidStatsData().bidsPlaced).toBe(before + 1);
    });

    it('setLogLevel/getLogLevel round-trip', () => {
      setLogLevel(LogLevel.DEBUG);
      expect(getLogLevel()).toBe(LogLevel.DEBUG);
      setLogLevel(LogLevel.WARN);
      expect(getLogLevel()).toBe(LogLevel.WARN);
      setLogLevel(LogLevel.ERROR);
      expect(getLogLevel()).toBe(LogLevel.ERROR);
      setLogLevel(LogLevel.INFO);
      expect(getLogLevel()).toBe(LogLevel.INFO);
    });

    it('LogLevel enum has correct ordering', () => {
      expect(LogLevel.DEBUG).toBeLessThan(LogLevel.INFO);
      expect(LogLevel.INFO).toBeLessThan(LogLevel.WARN);
      expect(LogLevel.WARN).toBeLessThan(LogLevel.ERROR);
    });

    it('debug details are output at DEBUG level', () => {
      setLogLevel(LogLevel.DEBUG);
      Logger.debug('msg', { key: 'val' });
      expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it('websocket.event is silent at INFO level', () => {
      setLogLevel(LogLevel.INFO);
      Logger.websocket.event('offer', 'col', 'tok');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('websocket.event outputs at DEBUG level', () => {
      setLogLevel(LogLevel.DEBUG);
      Logger.websocket.event('offer', 'col', 'tok');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('pacer.init is silent at INFO level', () => {
      setLogLevel(LogLevel.INFO);
      Logger.pacer.init(10, 60);
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('separator is silent at WARN level', () => {
      setLogLevel(LogLevel.WARN);
      Logger.separator();
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('summary.bidPlacement is silent at WARN level', () => {
      setLogLevel(LogLevel.WARN);
      Logger.summary.bidPlacement({
        tokensProcessed: 10, newBidsPlaced: 5, bidsAdjusted: 1,
        alreadyHaveBids: 2, noActionNeeded: 1, skippedOfferTooHigh: 0,
        skippedBidTooHigh: 0, skippedAlreadyOurs: 1, bidsFailed: 0,
        currentActiveBids: 8, bidCount: 10,
      });
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });
});
