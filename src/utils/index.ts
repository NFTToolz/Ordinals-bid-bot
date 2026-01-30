import { config } from "dotenv"
import axiosInstance from "../axios/axiosInstance";
import limiter from "../bottleneck";

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
    console.log('--------------------------------------------------------------------------------');
    console.log("BALANCE: ", balance);
    console.log('--------------------------------------------------------------------------------');

    return balance;
  } catch (error: any) {
    console.error('getBitcoinBalance:', error?.response?.data || error?.message);
    return undefined;  // Return undefined to distinguish API error from zero balance
  }
}
