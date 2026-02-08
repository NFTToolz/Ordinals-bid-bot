import { clearScreen } from './display';
import chalk = require('chalk');

export interface LiveRefreshOptions {
  render: () => Promise<void>;
  intervalMs?: number;
}

/**
 * Reusable auto-refresh loop with raw stdin keypress handling.
 * R/r = immediate refresh, P/p = pause/resume, Enter/Ctrl+C = exit.
 */
export async function withLiveRefresh(opts: LiveRefreshOptions): Promise<void> {
  const intervalMs = opts.intervalMs ?? 5000;
  let paused = false;
  let refreshing = false;
  let stopped = false;

  const doRefresh = async () => {
    if (refreshing || stopped) return;
    refreshing = true;
    try {
      clearScreen();
      const pauseTag = paused ? chalk.yellow(' [PAUSED]') : '';
      console.log(chalk.dim(`  R: refresh  P: pause/resume  Enter: exit${pauseTag}`));
      console.log('');
      await opts.render();
    } finally {
      refreshing = false;
    }
  };

  // Initial render
  await doRefresh();

  // Auto-refresh interval
  let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
    if (!paused && !stopped) {
      doRefresh();
    }
  }, intervalMs);

  // Wait for keypress to exit
  await new Promise<void>((resolve) => {
    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      stopped = true;
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const onData = (key: Buffer) => {
      // R/r — immediate refresh
      if (key[0] === 114 || key[0] === 82) {
        doRefresh();
        return;
      }
      // P/p — toggle pause
      if (key[0] === 112 || key[0] === 80) {
        paused = !paused;
        doRefresh();
        return;
      }
      // Enter (13/10) or Ctrl+C (3) — exit
      if (key[0] === 13 || key[0] === 10 || key[0] === 3) {
        cleanup();
        resolve();
      }
    };

    process.stdin.on('data', onData);
  });
}
