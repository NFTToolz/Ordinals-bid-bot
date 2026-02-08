import * as readline from 'readline';

/**
 * Prompt for a password on stdin with hidden input (for non-interactive contexts like bid.ts).
 * Uses readline directly — no inquirer dependency.
 */
export function promptPasswordStdin(message: string = 'Password: '): Promise<string> {
  // Handle piped stdin from parent process (e.g. manage CLI spawning the bot)
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      process.stdin.on('data', (chunk: string) => { data += chunk; });
      process.stdin.on('end', () => {
        const password = data.trim();
        if (!password) {
          reject(new Error('No password received from stdin'));
          return;
        }
        resolve(password);
      });
      process.stdin.on('error', (err: Error) => {
        reject(err);
      });
      process.stdin.resume();
    });
  }

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
      if (answer.length < 8) {
        process.stderr.write('Password must be at least 8 characters.\n');
        // Re-prompt by recursing
        resolve(promptPasswordStdin(message));
      } else {
        resolve(answer);
      }
    });

    // Mute after the prompt is written
    muted = true;
    const stdErrWrite = (process.stderr as any).write;
    (process.stderr as any).write = function (chunk: unknown, ...args: unknown[]) {
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
