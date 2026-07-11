import "dotenv/config";
import { createDecipheriv, createHash } from "node:crypto";
import readline from "node:readline";
import { ethers } from "ethers";
import { Pool } from "pg";

const USDT_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
const USDT_DECIMALS = 18;

const requestedAddress = String(process.argv[2] || "").trim();
if (!ethers.isAddress(requestedAddress)) {
  console.error("Usage: npm run wallet:recover -- 0xDepositAddress");
  process.exit(1);
}

const required = ["DATABASE_URL", "ALCHEMY_BNB_RPC_URL", "BSC_HOT_WALLET_ADDRESS"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required.`);
}

function decrypt(encryptedValue, encryptionKey) {
  const [ivRaw, tagRaw, encryptedRaw] = String(encryptedValue).split(":");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Encrypted wallet key has an invalid format.");
  const key = createHash("sha256").update(encryptionKey).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
}

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY) throw new Error("Run this utility in an interactive terminal.");
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    for await (const chunk of process.stdin) {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          return value.replace(/\u001b\[200~/g, "").replace(/\u001b\[201~/g, "");
        }
        if (character === "\u0003") throw new Error("Recovery cancelled.");
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  return value;
}

function visiblePrompt(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(label, (answer) => { rl.close(); resolve(answer); }));
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    `SELECT id, user_id, deposit_address, encrypted_private_key, status
     FROM wallet_accounts
     WHERE lower(deposit_address) = lower($1)
     LIMIT 1`,
    [requestedAddress],
  );
  const record = result.rows[0];
  if (!record) throw new Error("No wallet record exists for that deposit address.");

  const oldEncryptionKey = await hiddenPrompt("Old encryption key (hidden): ");
  if (!oldEncryptionKey) throw new Error("No encryption key was entered.");
  console.log(`Received an old encryption key with ${oldEncryptionKey.length} characters.`);
  let privateKey;
  try {
    privateKey = decrypt(record.encrypted_private_key, oldEncryptionKey);
  } catch {
    throw new Error("The old encryption key could not decrypt this wallet.");
  }

  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_BNB_RPC_URL);
  const network = await provider.getNetwork();
  if (network.chainId !== 56n) throw new Error(`Refusing recovery on unexpected chain ID ${network.chainId}.`);

  const signer = new ethers.Wallet(privateKey, provider);
  privateKey = "";
  if (signer.address.toLowerCase() !== record.deposit_address.toLowerCase()) {
    throw new Error("Decrypted private key does not match the stored deposit address.");
  }

  const destination = ethers.getAddress(process.env.BSC_HOT_WALLET_ADDRESS);
  if (destination.toLowerCase() === signer.address.toLowerCase()) throw new Error("Recovery destination cannot equal the deposit address.");
  const tokenAddress = ethers.getAddress(process.env.BSC_USDT_CONTRACT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955");
  const token = new ethers.Contract(tokenAddress, USDT_ABI, signer);
  const balance = await token.balanceOf(signer.address);
  if (balance <= 0n) throw new Error("This deposit address has no USDT to recover.");
  const amount = ethers.formatUnits(balance, USDT_DECIMALS);

  console.log(`Verified source:      ${signer.address}`);
  console.log(`BRX hot wallet:       ${destination}`);
  console.log(`Recoverable balance:  ${amount} USDT`);
  const confirmation = await visiblePrompt(`Type SWEEP to transfer ${amount} USDT to the BRX hot wallet: `);
  if (String(confirmation).trim() !== "SWEEP") throw new Error("Recovery cancelled; nothing was sent.");

  const tx = await token.transfer(destination, balance);
  console.log(`Broadcast transaction: ${tx.hash}`);
  await pool.query(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'wallet.recovery_sweep', 'wallet_account', $2, $3::jsonb)`,
    [record.user_id, record.id, JSON.stringify({ from: signer.address, to: destination, amount, txHash: tx.hash })],
  );
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Recovery transaction failed: ${tx.hash}`);
  await pool.query("UPDATE wallet_accounts SET status = 'disabled' WHERE id = $1", [record.id]);
  console.log(`Recovery confirmed in block ${receipt.blockNumber}. The old deposit wallet is now disabled.`);
} finally {
  await pool.end();
}
