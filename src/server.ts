/**
 * x402 LLM Router — Express Server
 *
 * Receives prompt requests, classifies them via Token Entropy,
 * gates each request behind an Algorand x402 micropayment,
 * and proxies the classified prompt to the appropriate free OpenRouter model.
 *
 * Facilitator: GoPlausible (https://facilitator.goplausible.xyz)
 * Network:     Algorand Testnet
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { paymentMiddleware, x402ResourceServer } from "@x402-avm/express";
import { registerExactAvmScheme } from "@x402-avm/avm/exact/server";
import { HTTPFacilitatorClient } from "@x402-avm/core/server";
import { ALGORAND_TESTNET_CAIP2 } from "@x402-avm/avm";

import { classifyByEntropy } from "./router/strategy.js";
import type { Tier } from "./router/types.js";

// ─── Environment ─────────────────────────────────────────────────────────────

const AVM_ADDRESS = process.env.AVM_ADDRESS;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FACILITATOR_URL =
  process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";
const PORT = parseInt(process.env.PORT || "4021", 10);

if (!AVM_ADDRESS) {
  console.error("❌  Missing AVM_ADDRESS in .env — this is your Algorand testnet address.");
  process.exit(1);
}
if (!OPENROUTER_API_KEY) {
  console.error("❌  Missing OPENROUTER_API_KEY in .env");
  process.exit(1);
}

// ─── Tier → Free OpenRouter Model Map ────────────────────────────────────────

const TIER_MODELS: Record<Tier, string> = {
  SIMPLE: "openrouter/free",
  MEDIUM: "openrouter/free",
  COMPLEX: "openrouter/free",
  REASONING: "openrouter/free",
};

// Tier → USD micropayment price
const TIER_PRICE: Record<Tier, string> = {
  SIMPLE: "$0.001",
  MEDIUM: "$0.003",
  COMPLEX: "$0.008",
  REASONING: "$0.015",
};

// ─── x402 Setup ──────────────────────────────────────────────────────────────

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const server = new x402ResourceServer(facilitatorClient);
registerExactAvmScheme(server); // unconditional — never wrap in env checks

// ─── Dynamic Route Config ─────────────────────────────────────────────────────
// The price is determined dynamically based on the `X-Prompt-Tier` header set
// by the classification pre-flight. This allows one endpoint with per-query pricing.

const routes = {
  "POST /api/v1/chat": {
    accepts: {
      scheme: "exact",
      network: ALGORAND_TESTNET_CAIP2,
      payTo: AVM_ADDRESS,
      price: (context: { adapter: { getHeader: (h: string) => string | undefined } }) => {
        const tier = (context.adapter.getHeader("x-prompt-tier") ?? "MEDIUM") as Tier;
        return TIER_PRICE[tier] ?? "$0.003";
      },
    },
    description: "Algorand x402 LLM router — pay-per-query",
  },
} as const;

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// ── Pre-classification middleware ──
// Runs BEFORE the x402 payment gate so pricing can be set dynamically.
// Reads the prompt from the body, classifies it, injects the tier as a header.
app.use("/api/v1/chat", (req, res, next) => {
  const prompt: string =
    typeof req.body?.prompt === "string"
      ? req.body.prompt
      : typeof req.body?.messages?.[req.body.messages.length - 1]?.content === "string"
        ? req.body.messages[req.body.messages.length - 1].content
        : "";

  if (!prompt) {
    res.status(400).json({ error: "Missing prompt or messages in request body" });
    return;
  }

  const { tier, confidence, reasoning } = classifyByEntropy(prompt);

  // Inject classification into headers so dynamic price fn and route handler can read them
  req.headers["x-prompt-tier"] = tier;
  req.headers["x-prompt-confidence"] = confidence.toFixed(3);
  req.headers["x-prompt-reasoning"] = reasoning;
  req.headers["x-prompt-model"] = TIER_MODELS[tier];

  next();
});

// ── x402 payment gate ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use(paymentMiddleware(routes as any, server));

// ── Protected route handler ──
app.post("/api/v1/chat", async (req, res) => {
  const prompt: string =
    typeof req.body?.prompt === "string"
      ? req.body.prompt
      : req.body?.messages?.[req.body.messages.length - 1]?.content ?? "";

  const tier = (req.headers["x-prompt-tier"] ?? "MEDIUM") as Tier;
  const model = TIER_MODELS[tier];
  const confidence = parseFloat((req.headers["x-prompt-confidence"] as string) ?? "0");
  const reasoning = (req.headers["x-prompt-reasoning"] as string) ?? "";

  // Format messages — support both {prompt} and {messages[]} bodies
  const messages =
    Array.isArray(req.body?.messages)
      ? req.body.messages
      : [{ role: "user", content: prompt }];

  console.log(`\n📨 Request  | tier=${tier} | model=${model}`);
  console.log(`   Prompt   | ${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}`);
  console.log(`   Entropy  | ${reasoning} | confidence=${confidence}`);

  try {
    const orResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:4021",
        "X-Title": "x402-llm-router",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!orResponse.ok) {
      const err = await orResponse.text();
      console.error(`   OpenRouter error ${orResponse.status}: ${err}`);
      res.status(502).json({ error: "OpenRouter API error", details: err });
      return;
    }

    const data = await orResponse.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const reply = data.choices?.[0]?.message?.content ?? "";
    console.log(`✅ Response | ${reply.slice(0, 80)}${reply.length > 80 ? "…" : ""}`);

    res.json({
      reply,
      routing: {
        tier,
        model,
        confidence,
        reasoning,
        price: TIER_PRICE[tier],
      },
      usage: data.usage,
    });
  } catch (err) {
    console.error("   Fetch error:", err);
    res.status(500).json({ error: "Internal server error", details: String(err) });
  }
});

// ── Health check (no payment required) ──
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    facilitator: FACILITATOR_URL,
    network: "algorand-testnet",
    payTo: AVM_ADDRESS,
    tiers: TIER_MODELS,
    prices: TIER_PRICE,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 x402 LLM Router running on http://localhost:${PORT}`);
  console.log(`   Network    : Algorand Testnet`);
  console.log(`   Facilitator: ${FACILITATOR_URL}`);
  console.log(`   Pay To     : ${AVM_ADDRESS}`);
  console.log(`   Health     : http://localhost:${PORT}/health`);
  console.log(`\n   Tier Pricing:`);
  for (const [tier, price] of Object.entries(TIER_PRICE)) {
    console.log(`     ${tier.padEnd(10)} ${price}  →  ${TIER_MODELS[tier as Tier]}`);
  }
  console.log(`\n   Waiting for requests...\n`);
});
