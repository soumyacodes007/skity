/**
 * x402 LLM Router — Public API
 */

export { route, getStrategy, registerStrategy } from "./router/index.js";
export { classifyByEntropy } from "./router/strategy.js";
export { DEFAULT_ROUTING_CONFIG } from "./router/config.js";
export type {
  Tier,
  RoutingDecision,
  RouterOptions,
  RoutingConfig,
  RouterStrategy,
} from "./router/types.js";
export type { ModelPricing } from "./router/selector.js";
