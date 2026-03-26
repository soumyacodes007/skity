import algosdk from 'algosdk';

const words24 = [
  "snap", "east", "fan", "dismiss", "income", "enrich", 
  "obtain", "puppy", "caught", "picnic", "flower", "chicken", 
  "abandon", "tribe", "wild", "offer", "avoid", "addict", 
  "awful", "until", "vacuum", "bunker", "friend", "tuition"
];

// We'll iterate through a known set of words or just try to find the one.
// I'll use a small set of common BIP-39 words including "fury", "future", "fun", etc.
const possibleWords = ["fury", "future", "fuel", "fun", "funny", "full", "fossil", "foster"];

async function verify() {
  for (const word of possibleWords) {
    const mnemonic = words24.join(" ") + " " + word;
    try {
      const key = algosdk.mnemonicToSecretKey(mnemonic);
      console.log(`\n✅  MATCH FOUND with 25th word: "${word}"`);
      console.log(`Derived Address: ${key.addr}`);
      console.log(`Base64 Secret Key: ${Buffer.from(key.sk).toString('base64')}`);
      return;
    } catch (e) {
      // checksum fail
    }
  }
  console.log("None of the guessed words worked. The 25th word might be different.");
}

verify();
