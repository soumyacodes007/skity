import algosdk from 'algosdk';

const account = algosdk.generateAccount();
const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
const base64Key = Buffer.from(account.sk).toString('base64');

console.log("\n✨ New Algorand Wallet Generated ✨\n");
console.log("------------------------------------------------------------------");
console.log(`AVM_ADDRESS=${account.addr}`);
console.log(`AVM_PRIVATE_KEY=${base64Key}`);
console.log("------------------------------------------------------------------");
console.log("\n📜 Mnemonic (Recovery Phrase):");
console.log(mnemonic);
console.log("\n⚠️ IMPORTANT: Save the Mnemonic somewhere safe. Do not share it.");
console.log("The AVM_PRIVATE_KEY above is what you need for your .env file.");
console.log("------------------------------------------------------------------\n");
