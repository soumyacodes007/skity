import algosdk from 'algosdk';

const ADDRESS = "XROKYTN2ZDUDE7FCQQVVZ54GB4R2TNSR3R7OJIGVGTWYHYE73LYPO3HIVE";
const MNEMONIC = "snap east fan dismiss income enrich obtain puppy caught picnic flower chicken abandon tribe wild offer avoid addict awful until vacuum bunker friend tuition";

async function check() {
  console.log("--- Algorand Key Validation ---");

  // 1. Check Address
  try {
    const isValidAddr = algosdk.isValidAddress(ADDRESS);
    console.log(`Address Valid: ${isValidAddr}`);
  } catch (e) {
    console.log(`Address Error: ${e.message}`);
  }

  // 2. Check Mnemonic and convert to Private Key
  try {
    const secretKey = algosdk.mnemonicToSecretKey(MNEMONIC);
    console.log(`Mnemonic Valid: Yes`);
    console.log(`Derived Address: ${secretKey.addr}`);
    
    // The private key is a Uint8Array (64 bytes). The SDK needs it as a base64 string.
    const b64Key = Buffer.from(secretKey.sk).toString('base64');
    console.log(`\nCorrect AVM_PRIVATE_KEY (Base64):`);
    console.log(b64Key);
    
  } catch (e) {
    console.log(`Mnemonic Error: ${e.message}`);
  }
}

check();
