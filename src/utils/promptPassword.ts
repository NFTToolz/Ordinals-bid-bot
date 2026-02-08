import * as readline from 'readline';

/**
 * Prompt for a password on stdin with hidden input (for non-interactive contexts like bid.ts).
 * Uses readline directly — no inquirer dependency.
 */
export function promptPasswordStdin(message: string = 'Password: '): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr, // Write prompt to stderr so it shows in terminal
      terminal: true,
    });

    // Mute output for password entry
    const originalWrite = (process.stderr as any).write;
    let muted = false;

    rl.question(message, (answer) => {
      muted = false;
      (process.stderr as any).write = originalWrite;
      process.stderr.write('\n');
      rl.close();
      resolve(answer);
    });

    // Mute after the prompt is written
    muted = true;
    const stdErrWrite = (process.stderr as any).write;
    (process.stderr as any).write = function (chunk: any, ...args: any[]) {
      if (muted) {
        // Only suppress character echoing, allow newlines through
        if (typeof chunk === 'string' && chunk === '\n') {
          return stdErrWrite.call(process.stderr, chunk, ...args);
        }
        return true;
      }
      return stdErrWrite.call(process.stderr, chunk, ...args);
    };
  });
}
