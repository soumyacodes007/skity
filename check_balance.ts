import algosdk from 'algosdk';
import { USDC_TESTNET_ASA_ID } from '@x402-avm/avm';
import 'dotenv/config';

const sk = Buffer.from(process.env.AVM_PRIVATE_KEY!, 'base64');
const addr = algosdk.encodeAddress(sk.slice(32));
const client = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', '');

console.log(`\n🔍 Wallet Balance — Algorand Testnet`);
console.log(`   Address: ${addr}\n`);

const raw = await client.accountInformation(addr).do() as any;

const algoBalance = Number(raw.amount) / 1e6;
console.log(`   ALGO    : ${algoBalance.toFixed(6)} ALGO`);

const assets: any[] = raw.assets || [];
console.log(`   Assets  : ${assets.length} found\n`);

for (const a of assets) {
  // algosdk v3 uses BigInt for amounts — convert for display
  const assetId = typeof a.assetId !== 'undefined' ? Number(a.assetId) : Number(a['asset-id']);
  const amount = typeof a.amount !== 'undefined' ? Number(a.amount) : 0;
  
  let label = `ASA ${assetId}`;
  if (String(assetId) === String(USDC_TESTNET_ASA_ID)) {
    const usdcBal = (amount / 1_000_000).toFixed(6);
    label = `USDC (ASA ${assetId}) ✅`;
    console.log(`   ${label}: ${usdcBal} USDC`);
  } else {
    console.log(`   ${label}: ${amount} units`);
  }
}

// Also check if opted into USDC
const hasUsdc = assets.some((a: any) => {
  const id = typeof a.assetId !== 'undefined' ? Number(a.assetId) : Number(a['asset-id']);
  return String(id) === String(USDC_TESTNET_ASA_ID);
});

if (!hasUsdc) {
  console.log(`   USDC: NOT OPTED IN`);
  console.log(`\n   Run: npx tsx src/setup-wallet.ts to opt in`);
} else {
  console.log(`\n✅ You are opted into USDC — you're ready to make x402 payments!`);
  console.log(`   If balance is 0, get testnet USDC from:`);
  console.log(`   👉 https://faucet.circle.com (select Algorand Testnet)`);
}
