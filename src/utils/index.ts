import { config } from "dotenv"
import axiosInstance from "../axios/axiosInstance";
import limiter from "../bottleneck";
import { getErrorMessage } from "./errorUtils";
import Logger from "./logger";

config()

const API_KEY = process.env.API_KEY as string;

export async function getBitcoinBalance(address: string): Promise<number | undefined> {
  try {
    const response = await limiter.schedule(() =>
      axiosInstance.get('https://nfttools.pro', {
        headers: {
          'url': `https://blockchain.info/q/addressbalance/${address}`,
          'x-nft-api-key': API_KEY
        }
      }));

    const balance = response.data;
    Logger.debug(`[BALANCE] ${balance?.toLocaleString()} sats`);

    return balance;
  } catch (error: unknown) {
    Logger.error(`[BALANCE] ${getErrorMessage(error)}`);
    return undefined;  // Return undefined to distinguish API error from zero balance
  }
}
