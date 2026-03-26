/**
 * x402 LLM Router — Interactive CLI Client
 *
 * Prompts for user input, pays the x402 micropayment automatically
 * using an Algorand testnet wallet, and displays the LLM response.
 *
 * Required env vars:
 *   AVM_PRIVATE_KEY  — Base64-encoded 64-byte Algorand secret key
 *   (Get testnet ALGO at https://bank.testnet.algorand.network)
 */

import "dotenv/config";
import readline from "readline";
import algosdk from "algosdk";
import { x402Client, decodePaymentResponseHeader } from "@x402-avm/fetch";
import { wrapFetchWithPayment } from "@x402-avm/fetch";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/client";
import type { ClientAvmSigner } from "@x402-avm/avm";

// ─── Environment ─────────────────────────────────────────────────────────────

const AVM_PRIVATE_KEY = process.env.AVM_PRIVATE_KEY;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4021";

if (!AVM_PRIVATE_KEY) {
  console.error(
    "\n❌  Missing AVM_PRIVATE_KEY in .env\n" +
    "   Generate a testnet wallet at: https://lora.algokit.io/testnet\n" +
    "   Click Account → Generate → copy the base64 private key\n" +
    "   Fund it at:  https://bank.testnet.algorand.network\n"
  );
  process.exit(1);
}

// ─── Wallet / Signer Setup ───────────────────────────────────────────────────

const secretKey = Buffer.from(AVM_PRIVATE_KEY, "base64");
if (secretKey.length !== 64) {
  console.error(
    `\n❌  AVM_PRIVATE_KEY must be a base64-encoded 64-byte key (got ${secretKey.length} bytes).\n`
  );
  process.exit(1);
}
const walletAddress = algosdk.encodeAddress(secretKey.slice(32));

const signer: ClientAvmSigner = {
  address: walletAddress,
  signTransactions: async (txns: Uint8Array[], indexesToSign?: number[]) => {
    return txns.map((txn, i) => {
      if (indexesToSign && !indexesToSign.includes(i)) return null;
      const decoded = algosdk.decodeUnsignedTransaction(txn);
      return algosdk.signTransaction(decoded, secretKey).blob;
    });
  },
};

// ─── x402 Client Setup ───────────────────────────────────────────────────────

const client = new x402Client();
registerExactAvmScheme(client, { signer });

// Payment hooks — display info before paying
client.onBeforePaymentCreation(async ({ selectedRequirements }) => {
  const amountRaw = BigInt(selectedRequirements.amount ?? "0");
  // USDC has 6 decimal places
  const amountUSD = (Number(amountRaw) / 1_000_000).toFixed(6);
  console.log(`\n💰 Payment Required`);
  console.log(`   Amount  : $${amountUSD} USDC (Algorand Testnet)`);
  console.log(`   Pay To  : ${selectedRequirements.payTo}`);
  console.log(`   Signing with wallet: ${walletAddress}`);
  console.log("   ✍️  Signing transaction...");
  return undefined; // allow payment to proceed
});

client.onAfterPaymentCreation(async () => {
  console.log("   ✅ Payment signed and submitted!");
});

client.onPaymentCreationFailure(async ({ error }) => {
  console.error(`\n   ❌  Payment failed: ${error.message}`);
  console.error("   Make sure your testnet wallet has enough ALGO/USDC:");
  console.error("   👉 https://bank.testnet.algorand.network");
});

const fetchWithPay = wrapFetchWithPayment(fetch, client);

// ─── Response helpers ─────────────────────────────────────────────────────────

function printRoutingBanner(routing: {
  tier: string;
  model: string;
  confidence: number;
  reasoning: string;
  price: string;
}) {
  const tierEmoji: Record<string, string> = {
    SIMPLE: "⚡",
    MEDIUM: "🟡",
    COMPLEX: "🔴",
    REASONING: "🧠",
  };
  const emoji = tierEmoji[routing.tier] ?? "🔄";
  console.log(`\n${emoji}  Routed to ${routing.tier} → ${routing.model}`);
  console.log(`   Entropy: ${routing.reasoning} | Confidence: ${(routing.confidence * 100).toFixed(1)}%`);
  console.log(`   Price  : ${routing.price}`);
}

// ─── Main CLI Loop ────────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         x402 LLM Router — Algorand Testnet CLI          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`   Wallet  : ${walletAddress}`);
  console.log(`   Server  : ${SERVER_URL}`);
  console.log(`   Network : Algorand Testnet\n`);
  console.log("   Fund your wallet: https://bank.testnet.algorand.network");
  console.log("   View tx on Lora : https://lora.algokit.io/testnet\n");
  console.log('   Type your prompt and press Enter. Type "exit" to quit.\n');

  while (true) {
    const userInput = await prompt("\n> ");
    if (!userInput.trim()) continue;
    if (userInput.trim().toLowerCase() === "exit") {
      console.log("\n👋 Goodbye!\n");
      rl.close();
      break;
    }

    let response: Response;
    try {
      response = await fetchWithPay(`${SERVER_URL}/api/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userInput.trim() }),
      });
    } catch (err) {
      console.error(`\n❌  Request failed: ${String(err)}`);
      console.error("   Is the server running? → npm run server");
      continue;
    }

    // Check for payment response header (contains settlement tx ID)
    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    
    if (paymentResponseHeader) {
      try {
        const receipt = decodePaymentResponseHeader(paymentResponseHeader);
        
        // Extract transaction ID from receipt - try multiple possible field names
        const txId = receipt?.transaction || receipt?.txId || receipt?.transactionId;
        
        if (txId) {
          console.log(`\n   🔗 Transaction: ${txId}`);
          console.log(`   📊 View on Lora: https://lora.algokit.io/testnet/transaction/${txId}`);
        }
      } catch (e) {
        console.log(`   [Debug] Failed to decode payment response:`, e);
      }
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`\n❌  Server error ${response.status}: ${errBody}`);
      continue;
    }

    const data = await response.json() as {
      reply: string;
      routing: {
        tier: string;
        model: string;
        confidence: number;
        reasoning: string;
        price: string;
      };
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    printRoutingBanner(data.routing);

    if (data.usage) {
      console.log(
        `   Tokens : ${data.usage.prompt_tokens} in / ${data.usage.completion_tokens} out`
      );
    }

    console.log(`\n${data.reply}\n`);
  }
}

main().catch((err) => {
  console.error("\n Fatal error:", err);
  process.exit(1);
});
