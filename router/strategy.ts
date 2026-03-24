/**
 * Router Strategy Registry
 *
 * Strategies:
 *   "entropy"  — Token Entropy + Failure Cost gates (DEFAULT, 0.01ms, no deps)
 *   "llm"      — LLM-based classifier via llm-classifier.ts (fallback, ~200-400ms)
 */

import type { Tier, RoutingDecision, RouterStrategy, RouterOptions } from "./types.js";
import { classifyByLLM } from "./llm-classifier.js";
import { selectModel } from "./selector.js";

// ─── Token Entropy Classifier ─────────────────────────────────────────────────

const HIGH_STAKES_KW = [
  "audit", "security", "vulnerability", "reentrancy", "overflow",
  "authentication", "authorization", "encrypt", "decrypt", "private key",
  "wallet", "payment", "mfa", "brute-force", "distributed lock", "race condition",
];

const IMPLICIT_SCOPE_KW = [
  "all bugs", "entire codebase", "fix everything", "systematically",
  "production-ready", "complete system", "comprehensive", "full-stack",
  "complete ci", "complete oauth", "complete production", "complete auth",
];

const REASONING_KW = [
  "prove", "derive", "theorem", "induction", "differential equation",
  "formally verify", "chain of thought", "step by step proof", "loop invariant",
  "abelian", "continuous function", "proof by", "by contradiction",
];

function computeEntropy(text: string): number {
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

export function classifyByEntropy(
  prompt: string,
): { tier: Tier; confidence: number; reasoning: string } {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;

  // Gate 1: Implicit scope (broad agentic tasks always need best model)
  if (IMPLICIT_SCOPE_KW.some((s) => lower.includes(s)) && wordCount >= 5) {
    return { tier: "COMPLEX", confidence: 0.95, reasoning: "implicit-scope-gate" };
  }

  // Gate 2: High-stakes failure cost (security/crypto/payments)
  if (HIGH_STAKES_KW.some((kw) => lower.includes(kw))) {
    return { tier: "COMPLEX", confidence: 0.93, reasoning: "failure-cost-gate" };
  }

  // Gate 3: Explicit reasoning vocabulary
  if (REASONING_KW.some((kw) => lower.includes(kw))) {
    return { tier: "REASONING", confidence: 0.9, reasoning: "reasoning-kw-gate" };
  }

  // Gate 4: Token entropy — primary structural signal
  const entropy = computeEntropy(prompt);

  if (wordCount <= 5) {
    return { tier: "SIMPLE", confidence: 0.9, reasoning: `entropy=${entropy.toFixed(2)} short-query` };
  }
  if (wordCount <= 10 && entropy < 2.5) {
    return { tier: "SIMPLE", confidence: 0.85, reasoning: `entropy=${entropy.toFixed(2)} short-low-entropy` };
  }
  if (entropy < 1.5) {
    return { tier: "SIMPLE", confidence: 0.8, reasoning: `entropy=${entropy.toFixed(2)}` };
  }
  if (entropy < 3.0) {
    const tier: Tier = wordCount > 40 ? "COMPLEX" : "MEDIUM";
    return { tier, confidence: 0.75, reasoning: `entropy=${entropy.toFixed(2)} words=${wordCount}` };
  }
  if (entropy < 4.0) {
    const tier: Tier = wordCount > 60 ? "COMPLEX" : "MEDIUM";
    return { tier, confidence: 0.78, reasoning: `entropy=${entropy.toFixed(2)} words=${wordCount}` };
  }
  return { tier: "COMPLEX", confidence: 0.82, reasoning: `entropy=${entropy.toFixed(2)} high-entropy` };
}

// ─── Shared profile/tier-config resolution ────────────────────────────────────

function resolveProfile(options: RouterOptions): {
  tierConfigs: Record<Tier, { primary: string; fallback: string[] }>;
  profileSuffix: string;
  profile: RoutingDecision["profile"];
} {
  const { routingProfile, config, hasTools } = options;

  if (routingProfile === "eco" && config.ecoTiers) {
    return { tierConfigs: config.ecoTiers, profileSuffix: " | eco", profile: "eco" };
  }
  if (routingProfile === "premium" && config.premiumTiers) {
    return { tierConfigs: config.premiumTiers, profileSuffix: " | premium", profile: "premium" };
  }

  const isExplicitAgentic = config.overrides.agenticMode ?? false;
  const isEntropyAgentic = false; // computed per-strategy before calling this
  const useAgenticTiers =
    (hasTools || isExplicitAgentic || isEntropyAgentic) && config.agenticTiers != null;

  return {
    tierConfigs: useAgenticTiers ? config.agenticTiers! : config.tiers,
    profileSuffix: useAgenticTiers ? ` | agentic${hasTools ? " (tools)" : ""}` : "",
    profile: useAgenticTiers ? "agentic" : "auto",
  };
}

function applyStructuredOutputUpgrade(
  tier: Tier,
  reasoning: string,
  systemPrompt: string | undefined,
  config: RouterOptions["config"],
): { tier: Tier; reasoning: string } {
  if (!systemPrompt || !/json|structured|schema/i.test(systemPrompt)) {
    return { tier, reasoning };
  }
  const tierRank: Record<Tier, number> = { SIMPLE: 0, MEDIUM: 1, COMPLEX: 2, REASONING: 3 };
  const minTier = config.overrides.structuredOutputMinTier;
  if (tierRank[tier] < tierRank[minTier]) {
    return { tier: minTier, reasoning: reasoning + ` | upgraded to ${minTier} (structured output)` };
  }
  return { tier, reasoning };
}

// ─── EntropyStrategy (DEFAULT) ────────────────────────────────────────────────

/**
 * Entropy-based routing strategy (DEFAULT).
 *
 * Uses Token Entropy as the primary complexity signal, gated by:
 *   1. Implicit scope detection (agentic / broad tasks → COMPLEX)
 *   2. Failure-cost safety (security / crypto / payments → COMPLEX)
 *   3. Reasoning vocabulary (proof / derivation / induction → REASONING)
 *
 * 0 external dependencies. Runs in ~0.01ms.
 */
export class EntropyStrategy implements RouterStrategy {
  readonly name = "entropy";

  route(
    prompt: string,
    systemPrompt: string | undefined,
    maxOutputTokens: number,
    options: RouterOptions,
  ): RoutingDecision {
    const { config, modelPricing } = options;
    const fullText = `${systemPrompt ?? ""} ${prompt}`;
    const estimatedTokens = Math.ceil(fullText.length / 4);

    // Profile + tier config resolution
    const lowerPrompt = prompt.toLowerCase();
    const isEntropyAgentic = IMPLICIT_SCOPE_KW.some((s) => lowerPrompt.includes(s));
    const hasToolsInRequest = options.hasTools ?? false;
    const isExplicitAgentic = config.overrides.agenticMode ?? false;
    const { routingProfile } = options;

    let tierConfigs: Record<Tier, { primary: string; fallback: string[] }>;
    let profileSuffix: string;
    let profile: RoutingDecision["profile"];

    if (routingProfile === "eco" && config.ecoTiers) {
      tierConfigs = config.ecoTiers; profileSuffix = " | eco"; profile = "eco";
    } else if (routingProfile === "premium" && config.premiumTiers) {
      tierConfigs = config.premiumTiers; profileSuffix = " | premium"; profile = "premium";
    } else {
      const useAgenticTiers =
        (hasToolsInRequest || isExplicitAgentic || isEntropyAgentic) && config.agenticTiers != null;
      tierConfigs = useAgenticTiers ? config.agenticTiers! : config.tiers;
      profileSuffix = useAgenticTiers ? ` | agentic${hasToolsInRequest ? " (tools)" : ""}` : "";
      profile = useAgenticTiers ? "agentic" : "auto";
    }

    // Large context override
    if (estimatedTokens > config.overrides.maxTokensForceComplex) {
      const decision = selectModel(
        "COMPLEX", 0.95, "rules",
        `Input exceeds ${config.overrides.maxTokensForceComplex} tokens${profileSuffix}`,
        tierConfigs, modelPricing, estimatedTokens, maxOutputTokens, routingProfile, undefined,
      );
      return { ...decision, tierConfigs, profile };
    }

    // Entropy classification
    const { tier: rawTier, confidence, reasoning: rawReasoning } = classifyByEntropy(prompt);
    const { tier, reasoning } = applyStructuredOutputUpgrade(rawTier, rawReasoning + profileSuffix, systemPrompt, config);

    const decision = selectModel(
      tier, confidence, "rules", reasoning,
      tierConfigs, modelPricing, estimatedTokens, maxOutputTokens, routingProfile, undefined,
    );
    return { ...decision, tierConfigs, profile };
  }
}

// ─── LLMStrategy (FALLBACK) ───────────────────────────────────────────────────

/**
 * LLM-based routing classifier (FALLBACK / ASYNC UTILITY).
 *
 * NOT a RouterStrategy — this is an async utility. Use it manually when you need
 * LLM-quality classification (e.g., for ambiguous prompts post-entropy).
 *
 * Routes to a cheap LLM (e.g. DeepSeek) to classify the query.
 * Costs ~$0.00003 per request, latency ~200-400ms.
 * Uses in-memory caching to avoid redundant classifications.
 */
export class LLMStrategy {
  readonly name = "llm";

  constructor(
    private readonly payFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    private readonly apiBase: string,
    private readonly classifierConfig = {
      model: "deepseek/deepseek-chat",
      maxTokens: 5,
      temperature: 0,
      truncationChars: 500,
      cacheTtlMs: 5 * 60 * 1000, // 5 minutes
    },
  ) {}

  async route(
    prompt: string,
    systemPrompt: string | undefined,
    maxOutputTokens: number,
    options: RouterOptions,
  ): Promise<RoutingDecision> {
    const { config, modelPricing } = options;
    const fullText = `${systemPrompt ?? ""} ${prompt}`;
    const estimatedTokens = Math.ceil(fullText.length / 4);
    const { routingProfile } = options;

    let tierConfigs: Record<Tier, { primary: string; fallback: string[] }>;
    let profileSuffix: string;
    let profile: RoutingDecision["profile"];

    if (routingProfile === "eco" && config.ecoTiers) {
      tierConfigs = config.ecoTiers; profileSuffix = " | eco"; profile = "eco";
    } else if (routingProfile === "premium" && config.premiumTiers) {
      tierConfigs = config.premiumTiers; profileSuffix = " | premium"; profile = "premium";
    } else {
      const hasToolsInRequest = options.hasTools ?? false;
      const isExplicitAgentic = config.overrides.agenticMode ?? false;
      const useAgenticTiers = (hasToolsInRequest || isExplicitAgentic) && config.agenticTiers != null;
      tierConfigs = useAgenticTiers ? config.agenticTiers! : config.tiers;
      profileSuffix = useAgenticTiers ? ` | agentic${hasToolsInRequest ? " (tools)" : ""}` : "";
      profile = useAgenticTiers ? "agentic" : "auto";
    }

    // Large context override
    if (estimatedTokens > config.overrides.maxTokensForceComplex) {
      const decision = selectModel(
        "COMPLEX", 0.95, "rules",
        `Input exceeds ${config.overrides.maxTokensForceComplex} tokens${profileSuffix}`,
        tierConfigs, modelPricing, estimatedTokens, maxOutputTokens, routingProfile, undefined,
      );
      return { ...decision, tierConfigs, profile };
    }

    // LLM classification
    const { tier: rawTier, confidence } = await classifyByLLM(
      prompt, this.classifierConfig, this.payFetch, this.apiBase,
    );

    const reasoning = `llm-classifier:${this.classifierConfig.model}`;
    const { tier, reasoning: finalReasoning } = applyStructuredOutputUpgrade(
      rawTier, reasoning + profileSuffix, systemPrompt, config,
    );

    const decision = selectModel(
      tier, confidence, "rules", finalReasoning,
      tierConfigs, modelPricing, estimatedTokens, maxOutputTokens, routingProfile, undefined,
    );
    return { ...decision, tierConfigs, profile };
  }
}

// ─── Strategy Registry ────────────────────────────────────────────────────────

const registry = new Map<string, RouterStrategy>();
registry.set("entropy", new EntropyStrategy());
// Note: "llm" strategy must be registered at runtime with payFetch + apiBase
// via registerStrategy(new LLMStrategy(payFetch, apiBase))

export function getStrategy(name: string): RouterStrategy {
  const strategy = registry.get(name);
  if (!strategy) {
    throw new Error(`Unknown routing strategy: ${name}`);
  }
  return strategy;
}

export function registerStrategy(strategy: RouterStrategy): void {
  registry.set(strategy.name, strategy);
}
