/**
 * Fund & Opt-In Script (algosdk v3)
 * 
 * 1. Opts your wallet into testnet USDC (ASA 10458941)
 * 2. Shows your ALGO and USDC balances
 * 
 * Run: npx tsx src/setup-wallet.ts
 */
import "dotenv/config";
import algosdk from "algosdk";

const AVM_PRIVATE_KEY = process.env.AVM_PRIVATE_KEY!;
const secretKey = Buffer.from(AVM_PRIVATE_KEY, "base64");
const address = algosdk.encodeAddress(secretKey.slice(32));

const USDC_ASA_ID = 10458941;
const algodClient = new algosdk.Algodv2("", "https://testnet-api.algonode.cloud", "");

async function main() {
  console.log("\n🔍 Wallet Setup — Algorand Testnet");
  console.log(`   Address: ${address}\n`);

  // Check current account info
  let info: any;
  try {
    info = await algodClient.accountInformation(address).do();
  } catch (err: any) {
    console.log("❌ Account not found — fund it first:");
    console.log(`   https://bank.testnet.algorand.network/`);
    console.log(`   Address: ${address}\n`);
    return;
  }

  const algoBalance = Number(info.amount) / 1_000_000;
  console.log(`   ALGO Balance: ${algoBalance.toFixed(6)} ALGO`);

  const assets: any[] = info.assets || [];
  const usdcAsset = assets.find((a: any) => a["asset-id"] === USDC_ASA_ID);

  if (usdcAsset) {
    const usdcBal = (Number(usdcAsset.amount) / 1_000_000).toFixed(6);
    console.log(`   USDC Balance: ${usdcBal} USDC`);
    console.log("\n✅ Already opted into USDC!");
    return;
  }

  console.log("   USDC: NOT OPTED IN\n");

  if (algoBalance < 0.2) {
    console.log("❌ Need at least 0.2 ALGO for opt-in MBR.");
    console.log("   Fund at: https://bank.testnet.algorand.network/\n");
    return;
  }

  console.log("📝 Opting into USDC (ASA 10458941)...\n");

  const suggestedParams = await algodClient.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    assetIndex: USDC_ASA_ID,
    amount: 0,
    suggestedParams,
  });

  const signedTxn = algosdk.signTransaction(optInTxn, secretKey);

  // algosdk v3: sendRawTransaction returns the response directly
  const sendResult = await algodClient.sendRawTransaction(signedTxn.blob).do();
  const txId = optInTxn.txID();

  console.log(`   Tx ID: ${txId}`);
  console.log(`   🔗 https://lora.algokit.io/testnet/transaction/${txId}`);
  console.log("   Waiting for confirmation...");

  // Wait for confirmation with more rounds
  const confirmed = await algosdk.waitForConfirmation(algodClient, txId, 10);
  console.log(`   ✅ Confirmed in round ${confirmed["confirmed-round"]}\n`);

  // Re-check balance
  const info2: any = await algodClient.accountInformation(address).do();
  const assets2: any[] = info2.assets || [];
  const usdc2 = assets2.find((a: any) => a["asset-id"] === USDC_ASA_ID);
  const usdcBal = usdc2 ? (Number(usdc2.amount) / 1_000_000).toFixed(6) : "0.000000";

  console.log("─".repeat(60));
  console.log(`   ALGO: ${(Number(info2.amount) / 1_000_000).toFixed(6)}`);
  console.log(`   USDC: ${usdcBal}`);
  console.log("─".repeat(60));
  console.log("\n📌 NEXT: You need testnet USDC to make x402 payments.");
  console.log("   The x402 protocol uses USDC for micro-payments.");
  console.log("   Ask in the Algorand Discord for testnet USDC,");
  console.log("   or I can switch the router to use ALGO instead.\n");
}

main().catch((err) => {
  console.error("Error:", err.message || err);
});
