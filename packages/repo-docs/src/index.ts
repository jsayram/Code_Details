/**
 * repo-docs, client-safe entry.
 *
 * GitHub URL checks, the include/exclude pattern lists, the engine's error type
 * and its types. Nothing here touches the network on its own, the disk, DNS or
 * a provider SDK, so browser pages may import it. The crawler, the flow, the
 * LLM client, the safe fetch and the file store live in the server entries:
 * `repo-docs/server`, `repo-docs/llm/server`, `repo-docs/safe-fetch` and
 * `repo-docs/store/file`.
 */

export type {
  FileStats,
  CrawlerResult,
  CrawlerOptions,
  PatternCategory,
  CachedFile,
  CachedAbstraction,
  CachedChapter,
  RepoCache,
  RepoIndex,
  FileChangeAnalysis,
  RegenerationMode,
  RegenerationPlan,
  StorageAdapter,
  Abstraction,
  AbstractionRelationship,
  Chapter,
  GeneratedDocumentation,
  NodeSharedState,
  NodeConfig,
  NodeResult,
  DocumentationMode,
  GenerationOptions,
  ProblemDetail,
} from './repoScrapper/types';

export {
  RepoError,
  createRepoError,
  githubAuthError,
  githubRateLimitError,
  githubNotFoundError,
  githubApiError,
  crawlerError,
  cacheError,
  generationError,
  validationError,
  networkError,
  timeoutError,
  parseGitHubError,
  isRepoErrorType,
  isRetryableError,
  REPO_ERROR_TYPES,
  type RepoErrorType,
} from './repoScrapper/errors';

// The browser-side crawler only calls the app's own API route; the URL helpers
// are pure.
export {
  githubFileCrawler,
  parseGitHubUrl,
  normalizeRepoUrl,
  repoUrlToFilename,
  calculateTotalSize,
  formatFileSize,
  getCrawlSummary,
  isValidGitHubUrl,
  createCrawlerOptions,
  simulateError,
  DEFAULT_MAX_FILE_SIZE,
  DEFAULT_API_PATH,
} from './repoScrapper/crawler';

export {
  includedPatternCategories,
  excludedPatternCategories,
  getAllIncludedPatterns,
  getIncludePatternsByCategory,
  getAllExcludedPatterns,
  getRequiredExcludedPatterns,
  getExcludePatternsByCategory,
  buildPatternSet,
  getDefaultPatterns,
  matchesPattern,
  filterFiles,
} from './repoScrapper/patterns';
