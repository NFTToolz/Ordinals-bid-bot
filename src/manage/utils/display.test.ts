import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatBTC,
  formatAddress,
  stripAnsi,
  showHeader,
  showStatusBar,
  showSectionHeader,
  showTable,
  showSuccess,
  showError,
  showWarning,
  showInfo,
  withSpinner,
  withProgressSpinner,
  showImportantBox,
  showTransactionPreview,
  showCollectionSummary,
  clearScreen,
} from './display';

describe('Display Utilities', () => {
  describe('formatBTC', () => {
    it('should format satoshis to BTC with 8 decimal places', () => {
      expect(formatBTC(100000000)).toBe('1.00000000 BTC');
      expect(formatBTC(50000000)).toBe('0.50000000 BTC');
      expect(formatBTC(12345678)).toBe('0.12345678 BTC');
    });

    it('should handle zero', () => {
      expect(formatBTC(0)).toBe('0.00000000 BTC');
    });

    it('should handle small values', () => {
      expect(formatBTC(1)).toBe('0.00000001 BTC');
      expect(formatBTC(100)).toBe('0.00000100 BTC');
    });

    it('should handle large values', () => {
      expect(formatBTC(2100000000000000)).toBe('21000000.00000000 BTC');
    });

    it('should handle negative values', () => {
      expect(formatBTC(-50000000)).toBe('-0.50000000 BTC');
    });
  });

  describe('formatAddress', () => {
    it('should truncate long addresses with ellipsis', () => {
      const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      const result = formatAddress(address, 8);
      expect(result).toBe('bc1qw508...7kv8f3t4');
      expect(result.length).toBe(19); // 8 + 3 + 8
    });

    it('should return short addresses unchanged', () => {
      const address = 'bc1qshort';
      expect(formatAddress(address, 8)).toBe('bc1qshort');
    });

    it('should handle custom length parameter', () => {
      const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      const result = formatAddress(address, 4);
      expect(result).toBe('bc1q...f3t4');
    });

    it('should use default length of 8', () => {
      const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
      const result = formatAddress(address);
      expect(result).toBe('bc1qw508...7kv8f3t4');
    });

    it('should return address unchanged if length <= length * 2', () => {
      const address = '1234567890123456';
      expect(formatAddress(address, 8)).toBe(address);
    });

    it('should handle empty string', () => {
      expect(formatAddress('', 8)).toBe('');
    });

    it('should handle taproot addresses', () => {
      const address = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
      const result = formatAddress(address, 8);
      // First 8 + '...' + last 8 = 'bc1p5d7r...usxg3297'
      expect(result).toBe('bc1p5d7r...usxg3297');
    });
  });

  describe('stripAnsi', () => {
    it('should remove ANSI color codes', () => {
      const colored = '\x1b[31mRed Text\x1b[0m';
      expect(stripAnsi(colored)).toBe('Red Text');
    });

    it('should remove multiple ANSI codes', () => {
      const colored = '\x1b[1m\x1b[32mBold Green\x1b[0m Normal';
      expect(stripAnsi(colored)).toBe('Bold Green Normal');
    });

    it('should handle string without ANSI codes', () => {
      const plain = 'Plain text without colors';
      expect(stripAnsi(plain)).toBe(plain);
    });

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('should remove complex ANSI sequences', () => {
      const complex = '\x1b[38;5;196mExtended color\x1b[0m';
      expect(stripAnsi(complex)).toBe('Extended color');
    });

    it('should preserve non-ANSI escape sequences', () => {
      const text = 'Tab:\tNewline:\n';
      expect(stripAnsi(text)).toBe('Tab:\tNewline:\n');
    });

    it('should handle consecutive ANSI codes', () => {
      const text = '\x1b[0m\x1b[1m\x1b[31mText\x1b[0m';
      expect(stripAnsi(text)).toBe('Text');
    });

    it('should handle bold and dim codes', () => {
      const text = '\x1b[1mBold\x1b[0m \x1b[2mDim\x1b[0m';
      expect(stripAnsi(text)).toBe('Bold Dim');
    });
  });

  describe('Console output functions', () => {
    let consoleSpy: any;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    describe('showHeader', () => {
      it('should print header with title', () => {
        showHeader();
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        // ASCII art header contains "Management Console" as subtitle
        expect(output).toContain('Management Console');
      });

      it('should use box drawing characters', () => {
        showHeader();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('╔');
        expect(output).toContain('╗');
        expect(output).toContain('═');
      });
    });

    describe('showStatusBar', () => {
      it('should show RUNNING status with green indicator', () => {
        showStatusBar('RUNNING', 5, 3);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Bot Status');
        expect(output).toContain('RUNNING');
        expect(output).toContain('Wallets: 5');
        expect(output).toContain('Collections: 3');
      });

      it('should show STOPPED status with red indicator', () => {
        showStatusBar('STOPPED', 0, 0);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('STOPPED');
      });

      it('should use box drawing characters', () => {
        showStatusBar('RUNNING', 5, 3);
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('╚');
        expect(output).toContain('╝');
      });
    });

    describe('showSectionHeader', () => {
      it('should print section header with title', () => {
        showSectionHeader('Test Section');
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Test Section');
        expect(output).toContain('━');
      });
    });

    describe('showTable', () => {
      it('should print table with headers and rows', () => {
        const headers = ['Name', 'Value'];
        const rows = [['Item 1', '100'], ['Item 2', '200']];
        showTable(headers, rows);

        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Name');
        expect(output).toContain('Value');
        expect(output).toContain('Item 1');
        expect(output).toContain('100');
      });

      it('should use table border characters', () => {
        const headers = ['Col1'];
        const rows = [['Data']];
        showTable(headers, rows);

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('┌');
        expect(output).toContain('┐');
        expect(output).toContain('└');
        expect(output).toContain('┘');
      });

      it('should handle custom column widths', () => {
        const headers = ['Name', 'Value'];
        const rows = [['A', 'B']];
        showTable(headers, rows, [20, 10]);

        expect(consoleSpy).toHaveBeenCalled();
      });

      it('should handle empty rows', () => {
        const headers = ['Name', 'Value'];
        const rows: string[][] = [];
        showTable(headers, rows);

        expect(consoleSpy).toHaveBeenCalled();
      });

      it('should handle cells with undefined values', () => {
        const headers = ['Col1', 'Col2'];
        const rows = [['A', undefined as any]];
        showTable(headers, rows);

        expect(consoleSpy).toHaveBeenCalled();
      });
    });

    describe('showSuccess', () => {
      it('should print success message with checkmark', () => {
        showSuccess('Operation completed');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[OK]');
        expect(output).toContain('Operation completed');
      });
    });

    describe('showError', () => {
      it('should print error message with x mark', () => {
        showError('Operation failed');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[ERR]');
        expect(output).toContain('Operation failed');
      });
    });

    describe('showWarning', () => {
      it('should print warning message with warning symbol', () => {
        showWarning('Proceed with caution');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[!]');
        expect(output).toContain('Proceed with caution');
      });
    });

    describe('showInfo', () => {
      it('should print info message with info symbol', () => {
        showInfo('FYI: This is info');
        const output = consoleSpy.mock.calls[0][0];
        expect(output).toContain('[i]');
        expect(output).toContain('FYI: This is info');
      });
    });

    describe('showImportantBox', () => {
      it('should print box with important information', () => {
        showImportantBox(['Line 1', 'Line 2']);

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Line 1');
        expect(output).toContain('Line 2');
        expect(output).toContain('━');
      });

      it('should handle single line', () => {
        showImportantBox(['Single line']);

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Single line');
      });

      it('should handle single item array', () => {
        showImportantBox(['Important!']);
        expect(consoleSpy).toHaveBeenCalled();
        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Important!');
      });
    });

    describe('showTransactionPreview', () => {
      it('should print transaction preview with all details', () => {
        showTransactionPreview(
          'bc1qsender1234567890',
          [
            { label: 'Wallet 1', address: 'bc1qreceiver1', amount: 50000 },
            { label: 'Wallet 2', address: 'bc1qreceiver2', amount: 30000 },
          ],
          1000,
          100000
        );

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('TRANSACTION PREVIEW');
        expect(output).toContain('From');
        expect(output).toContain('To');
        expect(output).toContain('Wallet 1');
        expect(output).toContain('Wallet 2');
        expect(output).toContain('Subtotal');
        expect(output).toContain('Network Fee');
        expect(output).toContain('Total');
        expect(output).toContain('Remaining');
      });

      it('should not show remaining if not provided', () => {
        showTransactionPreview(
          'bc1qsender',
          [{ label: 'Dest', address: 'bc1qdest', amount: 50000 }],
          1000
        );

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).not.toContain('Remaining');
      });
    });

    describe('showCollectionSummary', () => {
      it('should print collection summary with all fields', () => {
        showCollectionSummary({
          symbol: 'test-collection',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 95,
          bidCount: 20,
          duration: 60,
          enableCounterBidding: true,
          offerType: 'ITEM',
          quantity: 5,
        });

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('COLLECTION SUMMARY');
        expect(output).toContain('test-collection');
        expect(output).toContain('Min Bid');
        expect(output).toContain('Max Bid');
        expect(output).toContain('Floor Range');
        expect(output).toContain('50% - 95%');
        expect(output).toContain('Bid Count');
        expect(output).toContain('Duration');
        expect(output).toContain('Offer Type');
        expect(output).toContain('Counter-bid');
        expect(output).toContain('Enabled');
        expect(output).toContain('Max to Win');
      });

      it('should show disabled counter-bidding', () => {
        showCollectionSummary({
          symbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 95,
          bidCount: 20,
          duration: 60,
          enableCounterBidding: false,
          offerType: 'ITEM',
        });

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).toContain('Disabled');
      });

      it('should not show quantity if not provided', () => {
        showCollectionSummary({
          symbol: 'test',
          minBid: 0.001,
          maxBid: 0.01,
          minFloorBid: 50,
          maxFloorBid: 95,
          bidCount: 20,
          duration: 60,
          enableCounterBidding: true,
          offerType: 'COLLECTION',
        });

        const output = consoleSpy.mock.calls.map((c: any) => c[0]).join('\n');
        expect(output).not.toContain('Max to Win');
      });
    });
  });

  describe('withSpinner', () => {
    let stdoutSpy: any;
    let clearIntervalSpy: any;

    beforeEach(() => {
      vi.useFakeTimers();
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    });

    afterEach(() => {
      vi.useRealTimers();
      stdoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should return result of async function', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const resultPromise = withSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);
      const result = await resultPromise;

      expect(result).toBe('result');
    });

    it('should call provided function', async () => {
      const fn = vi.fn().mockResolvedValue('done');

      const resultPromise = withSpinner('Processing...', fn);
      vi.advanceTimersByTime(100);
      await resultPromise;

      expect(fn).toHaveBeenCalled();
    });

    it('should propagate errors from function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Test error'));

      const resultPromise = withSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);

      await expect(resultPromise).rejects.toThrow('Test error');
    });

    it('should clear interval on success', async () => {
      const fn = vi.fn().mockResolvedValue('done');

      const resultPromise = withSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);
      await resultPromise;

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear interval on error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Error'));

      const resultPromise = withSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);

      try {
        await resultPromise;
      } catch {
        // Expected
      }

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('withProgressSpinner', () => {
    let stdoutSpy: any;
    let clearIntervalSpy: any;

    beforeEach(() => {
      vi.useFakeTimers();
      stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    });

    afterEach(() => {
      vi.useRealTimers();
      stdoutSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('should return result of async function', async () => {
      const fn = vi.fn().mockImplementation(async () => 'result');

      const resultPromise = withProgressSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);
      const result = await resultPromise;

      expect(result).toBe('result');
    });

    it('should call provided function with update callback', async () => {
      const fn = vi.fn().mockImplementation(async (update: (msg: string) => void) => {
        expect(typeof update).toBe('function');
        return 'done';
      });

      const resultPromise = withProgressSpinner('Starting...', fn);
      vi.advanceTimersByTime(100);
      await resultPromise;

      expect(fn).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should update displayed message when update callback is called', async () => {
      const fn = vi.fn().mockImplementation(async (update: (msg: string) => void) => {
        update('Progress [1/5]...');
        return 'done';
      });

      const resultPromise = withProgressSpinner('Progress [0/5]...', fn);
      vi.advanceTimersByTime(100);
      await resultPromise;

      const outputs = stdoutSpy.mock.calls.map((c: any) => c[0]).join('');
      expect(outputs).toContain('Progress [1/5]...');
    });

    it('should propagate errors from function', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        throw new Error('Progress error');
      });

      const resultPromise = withProgressSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);

      await expect(resultPromise).rejects.toThrow('Progress error');
    });

    it('should clear interval on success', async () => {
      const fn = vi.fn().mockImplementation(async () => 'done');

      const resultPromise = withProgressSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);
      await resultPromise;

      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should clear interval on error', async () => {
      const fn = vi.fn().mockImplementation(async () => {
        throw new Error('Error');
      });

      const resultPromise = withProgressSpinner('Loading...', fn);
      vi.advanceTimersByTime(100);

      try {
        await resultPromise;
      } catch {
        // Expected
      }

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });

  describe('clearScreen', () => {
    it('should call console.clear', () => {
      const clearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});

      clearScreen();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
