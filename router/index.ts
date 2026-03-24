/**
 * Smart Router Entry Point
 *
 * Classifies requests and routes to the cheapest capable model.
 * Delegates to pluggable RouterStrategy (default: EntropyStrategy, ~0.01ms).
 * Use strategy "rules" to fall back to the legacy 14-dimension classifier.
 */

import type { RoutingDecision, RouterOptions } from "./types.js";
import { getStrategy } from "./strategy.js";

/**
 * Route a request to the cheapest capable model.
 * Delegates to the "entropy" strategy (Token Entropy + Failure Cost gates) by default.
 * Override by calling getStrategy("rules") for the legacy scorer.
 */
export function route(
  prompt: string,
  systemPrompt: string | undefined,
  maxOutputTokens: number,
  options: RouterOptions,
): RoutingDecision {
  const strategy = getStrategy(options.strategy ?? "entropy");
  return strategy.route(prompt, systemPrompt, maxOutputTokens, options);
}

export { getStrategy, registerStrategy } from "./strategy.js";
export {
  getFallbackChain,
  getFallbackChainFiltered,
  filterByToolCalling,
  filterByVision,
  filterByExcludeList,
  calculateModelCost,
} from "./selector.js";
export { DEFAULT_ROUTING_CONFIG } from "./config.js";
export type {
  RoutingDecision,
  Tier,
  RoutingConfig,
  RouterOptions,
  RouterStrategy,
} from "./types.js";
export type { ModelPricing } from "./selector.js";
