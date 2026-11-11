/**
 * repo-docs/llm, client-safe entry: provider and model lists, constants,
 * types, the engine's LLM error type and the token and cost estimators. No
 * provider SDK and no environment reads; the client that calls providers is in
 * `repo-docs/llm/server`.
 */

export type {
  LLMRequest,
  LLMResponse,
  CallLLMOptions,
  CallLLMResult,
  ProviderConfig,
  LLMModel,
  LLMProvider,
  SelfHealingOptions,
  SelfHealingResult,
  ProblemDetail,
} from './types';

export {
  PROVIDER_IDS,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GOOGLE_MODELS,
  GROQ_MODELS,
  DEEPSEEK_MODELS,
  XAI_MODELS,
  OPENROUTER_MODELS,
  OLLAMA_MODELS,
  AZURE_MODELS,
  MODEL_PRICING,
  MODEL_CONTEXT_WINDOWS,
  ENV_KEYS,
  API_ENDPOINTS,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT,
  getModelDisplayName,
  calculateCost,
  getModelContextWindow,
  isLocalProvider,
  requiresApiKey,
  validateApiKey,
} from './constants';

export {
  LLM_PROVIDERS,
  getProvider,
  getModel,
  getAllProviders,
  getRecommendedProviders,
  pricingPer1K,
  createModel,
} from './providers';

export * from './errors';

export {
  // Cost estimation
  estimateTokens,
  calculateCost as calculateModelCost,
  formatCost,
  getFullCostEstimate,
  compareCosts,
  calculateCacheSavings,
  estimatePartialRegenerationSavings,
  quickCostEstimate,
  getCheapestModelInBudget,
  getModelsByPriceTier,
  
  // Token estimation
  estimateTokenCount,
  estimateTokenCountBatch,
  getModelContextWindow as getContextWindow,
  estimateTokensWithWarning,
  estimateTokensForFiles,
  parseTokenLimitError,
  calculateContentReduction,
  suggestLargerModels,
  promptFitsModel,
  getMaxContentSize,
  truncateToTokenLimit,
  
  // Types
  type TokenEstimate,
  type CostEstimate,
  type CacheSavings,
  type PartialRegenerationSavings,
  type TokenEstimation,
  type TokenLimitConfig,
  type TokenLimitError,
  type ContentReduction,
  type ModelSuggestion,
} from './estimators';
