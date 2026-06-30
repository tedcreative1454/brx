import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ethers } from "ethers";
import { env } from "../config/env";

const TRANSFER_EVENT = "event Transfer(address indexed from, address indexed to, uint256 value)";
const USDT_ABI = [TRANSFER_EVENT, "function transfer(address to, uint256 amount) returns (bool)"];
const USDT_DECIMALS = 18;

export interface UsdtTransferLog {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  fromAddress: string;
  toAddress: string;
  amount: string;
}

export interface BroadcastResult {
  txHash: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
}

export interface TransactionStatus {
  exists: boolean;
  confirmed: boolean;
  failed: boolean;
  confirmations: number;
  blockNumber?: number;
}

@Injectable()
export class BscService {
  private readonly provider = new ethers.JsonRpcProvider(env.alchemyBnbRpcUrl);
  private readonly iface = new ethers.Interface(USDT_ABI);
  private readonly transferTopic = ethers.id("Transfer(address,address,uint256)");

  latestBlock() {
    return this.provider.getBlockNumber();
  }

  withdrawalSignerConfigured() {
    return Boolean(env.bscHotWalletPrivateKey);
  }

  async sendUsdt(toAddress: string, amount: string): Promise<BroadcastResult> {
    if (!env.bscHotWalletPrivateKey) {
      throw new ServiceUnavailableException("BSC hot wallet private key is not configured.");
    }

    const to = ethers.getAddress(toAddress);
    const signer = new ethers.Wallet(env.bscHotWalletPrivateKey, this.provider);
    const contract = new ethers.Contract(env.bscUsdtContractAddress, USDT_ABI, signer);
    const parsedAmount = ethers.parseUnits(amount, USDT_DECIMALS);
    const tx = await contract.transfer(to, parsedAmount);

    return {
      txHash: tx.hash,
      fromAddress: await signer.getAddress(),
      toAddress: to,
      amount,
    };
  }

  async transactionStatus(txHash: string, requiredConfirmations = env.bscWithdrawalConfirmationsRequired): Promise<TransactionStatus> {
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (!receipt) return { exists: false, confirmed: false, failed: false, confirmations: 0 };

    const latest = await this.latestBlock();
    const confirmations = Math.max(0, latest - receipt.blockNumber + 1);
    return {
      exists: true,
      confirmed: receipt.status === 1 && confirmations >= requiredConfirmations,
      failed: receipt.status === 0,
      confirmations,
      blockNumber: receipt.blockNumber,
    };
  }

  async getUsdtTransfersTo(address: string, fromBlock: number, toBlock: number): Promise<UsdtTransferLog[]> {
    const toTopic = ethers.zeroPadValue(ethers.getAddress(address), 32);
    const logs: ethers.Log[] = [];
    const chunkSize = Math.max(1, env.bscLogBlockRange);

    for (let chunkFrom = fromBlock; chunkFrom <= toBlock; chunkFrom += chunkSize) {
      const chunkTo = Math.min(toBlock, chunkFrom + chunkSize - 1);
      const chunkLogs = await this.provider.getLogs({
        address: env.bscUsdtContractAddress,
        fromBlock: chunkFrom,
        toBlock: chunkTo,
        topics: [this.transferTopic, null, toTopic],
      });
      logs.push(...chunkLogs);
    }

    return logs.map((log) => {
      const parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) throw new Error(`Unable to parse USDT transfer log ${log.transactionHash}`);
      const [fromAddress, toAddress, value] = parsed.args as unknown as [string, string, bigint];
      return {
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        fromAddress,
        toAddress,
        amount: ethers.formatUnits(value, USDT_DECIMALS),
      };
    });
  }
}
