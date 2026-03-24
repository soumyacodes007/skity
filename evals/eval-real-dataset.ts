import { Tier } from "../src/router/types.js";

// ─── FINAL ROUTER (Algorithm 10 from v2) ─────────────────────────────────────
// Token Entropy (primary structural signal) + Failure Cost + Implicit Scope

const HIGH_STAKES = ["audit", "security", "vulnerability", "production", "reentrancy", "overflow",
  "authentication", "authorization", "encrypt", "decrypt", "private key", "wallet", "payment",
  "mfa", "brute-force", "distributed lock", "race condition"];

const IMPLICIT_SCOPE = ["all bugs", "entire codebase", "fix everything",
  "systematically", "production-ready", "complete system",
  "comprehensive", "full-stack", "complete ci", "complete oauth",
  "complete production", "complete auth"];

const REASONING_KW = ["prove", "derive", "theorem", "induction", "differential",
  "formally verify", "chain of thought", "step by step", "loop invariant",
  "abelian", "continuous function", "proof by"];

function tokenEntropy(text: string): number {
  const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (words.length < 3) return 0;
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  const total = words.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function route_token_entropy(prompt: string): Tier {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;

  // Gate 1: Implicit scope detection
  if (IMPLICIT_SCOPE.some((s) => lower.includes(s)) && wordCount >= 5) return "COMPLEX";

  // Gate 2: Failure-cost safety net
  if (HIGH_STAKES.some((kw) => lower.includes(kw))) return "COMPLEX";

  // Gate 3: Reasoning keyword override
  if (REASONING_KW.some((kw) => lower.includes(kw))) return "REASONING";

  // Layer 4: Token entropy — primary structural signal
  const entropy = tokenEntropy(prompt);

  if (wordCount <= 5) return "SIMPLE";
  if (wordCount <= 10 && entropy < 2.5) return "SIMPLE";

  if (entropy < 1.5) return "SIMPLE";
  if (entropy < 3.0) return wordCount > 40 ? "COMPLEX" : "MEDIUM";
  // The threshold between MEDIUM and COMPLEX is structural length and vocabulary diversity.
  if (entropy < 4.0) return wordCount > 60 ? "COMPLEX" : "MEDIUM";
  
  return "COMPLEX";
}

// ─── MASSIVE EVAL RUNNER ─────────────────────────────────────────────────────

type AlpacaDataset = {
  instruction: string;
  input: string;
  output: string;
}[];

const DATASET_URL = "https://raw.githubusercontent.com/tatsu-lab/stanford_alpaca/main/alpaca_data.json";
const SAMPLE_SIZE = 500;

async function runMassiveEval() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  MASSIVE EVALUATION: Stanford Alpaca Dataset`);
  console.log(`  Testing Architecture: Token Entropy + Implicit Scope Routing`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  console.log(`⬇️  Downloading dataset from ${DATASET_URL}...`);
  const t0 = performance.now();
  const response = await fetch(DATASET_URL);
  const data: AlpacaDataset = await response.json();
  console.log(`✅ Downloaded ${data.length} prompts in ${(performance.now() - t0).toFixed(0)}ms.\n`);

  // Use a fixed random seed (or just Math.random but we take a slice to ensure consistency)
  const shuffled = data.sort(() => 0.5 - Math.random());
  const sample = shuffled.slice(0, SAMPLE_SIZE);

  console.log(`🚀 Running Token Entropy router on ${SAMPLE_SIZE} prompts...\n`);

  const results = {
    SIMPLE: [] as string[],
    MEDIUM: [] as string[],
    COMPLEX: [] as string[],
    REASONING: [] as string[],
  };

  let totalMs = 0;
  let maxMs = 0;

  // Warmup
  route_token_entropy("warmup");

  for (const item of sample) {
    const prompt = item.input ? `${item.instruction}\n\n${item.input}` : item.instruction;
    
    const tStart = performance.now();
    const tier = route_token_entropy(prompt);
    const elapsed = performance.now() - tStart;
    
    totalMs += elapsed;
    maxMs = Math.max(maxMs, elapsed);
    
    results[tier].push(prompt);
  }

  const avgMs = totalMs / SAMPLE_SIZE;

  console.log("─── Speed & Performance ───");
  console.log(`Avg Latency:  ${avgMs.toFixed(3)} ms`);
  console.log(`Max Latency:  ${maxMs.toFixed(3)} ms`);
  console.log(`Total Time:   ${totalMs.toFixed(1)} ms`);

  console.log("\n─── Tier Distribution ───");
  const total = SAMPLE_SIZE;
  console.log(`SIMPLE:      ${results.SIMPLE.length.toString().padStart(4)} (${((results.SIMPLE.length / total) * 100).toFixed(1)}%)`);
  console.log(`MEDIUM:      ${results.MEDIUM.length.toString().padStart(4)} (${((results.MEDIUM.length / total) * 100).toFixed(1)}%)`);
  console.log(`COMPLEX:     ${results.COMPLEX.length.toString().padStart(4)} (${((results.COMPLEX.length / total) * 100).toFixed(1)}%)`);
  console.log(`REASONING:   ${results.REASONING.length.toString().padStart(4)} (${((results.REASONING.length / total) * 100).toFixed(1)}%)`);

  console.log("\n─── Random Samples by Tier ───");
  
  for (const tier of ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"] as const) {
    console.log(`\n[ ${tier} ]`);
    if (results[tier].length === 0) {
      console.log("  (No examples)");
      continue;
    }
    
    // Pick 3 random examples
    const shuffledTier = results[tier].sort(() => 0.5 - Math.random());
    for (let i = 0; i < Math.min(3, shuffledTier.length); i++) {
       const p = shuffledTier[i];
       const trunc = p.length > 100 ? p.substring(0, 97).replace(/\n/g, " ") + "..." : p.replace(/\n/g, " ");
       console.log(`  • "${trunc}"`);
    }
  }
}

runMassiveEval().catch(console.error);
