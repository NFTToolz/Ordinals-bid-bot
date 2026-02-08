/** @deprecated Use WalletGenerator from src/manage/services/WalletGenerator.ts instead. This file is legacy and will be removed in a future version. */
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function removeWalletFile() {
  console.log('\x1b[31m%s\x1b[0m', "WARNING: Deleting your private key could lead to loss of funds!");

  rl.question("Are you sure you want to delete the wallet file? (yes/no): ", (answer) => {
    if (answer.toLowerCase() === 'yes') {
      try {
        fs.unlinkSync(path.join(__dirname, 'wallet.json'));
        console.log('Wallet file removed successfully.');
      } catch (err) {
        console.error(`Error removing wallet file: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (answer.toLowerCase() === 'no') {
      console.log("Operation cancelled.");
    } else {
      console.log("Invalid input. Please enter 'yes' or 'no'.");
    }
    rl.close();
  });
}

removeWalletFile();
