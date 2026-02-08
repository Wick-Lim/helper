// Application-wide constants
// Centralized configuration for limits, timeouts, and default values

/** Maximum iterations for agent loop */
export const MAX_ITERATIONS = {
  DEFAULT: 100,
  MIN: 1,
  MAX: 1000,
} as const;

/** Thinking budget for LLM (in tokens) */
export const THINKING_BUDGET = {
  DEFAULT: 10000,
  MIN: 0,
  MAX: 100000,
} as const;

/** Tool execution timeouts */
export const TIMEOUTS = {
  TOOL: {
    DEFAULT: 30000,
    MIN: 1000,
    MAX: 300000, // 5 minutes
  },
  CODE: {
    DEFAULT: 60000,
    MIN: 1000,
    MAX: 300000,
  },
  WEB: {
    DEFAULT: 30000,
    MAX: 120000, // 2 minutes
  },
  BROWSER: {
    NAVIGATION: 30000,
    IDLE_PAGE_CLOSE: 300000, // 5 minutes
    BROWSER_RESTART: 1800000, // 30 minutes
  },
} as const;

/** Output limits */
export const LIMITS = {
  OUTPUT_CHARS: {
    DEFAULT: 10000,
    MIN: 1000,
    MAX: 100000,
  },
  FILE_SIZE: {
    MAX: 50 * 1024 * 1024, // 50MB
  },
  RESPONSE_SIZE: {
    MAX: 10 * 1024 * 1024, // 10MB
  },
  SCREENSHOTS: {
    MAX_COUNT: 100,
    MAX_AGE_MS: 24 * 60 * 60 * 1000, // 24 hours
  },
  LIST_RESULTS: {
    MAX: 500,
  },
  TOKENS: {
    INPUT_MAX: 100000,
    OUTPUT_MAX: 8192,
  },
} as const;

/** Message and content length limits */
export const LENGTHS = {
  TELEGRAM_MESSAGE: 4096,
  LOG_PREVIEW: 200,
  SUMMARY_MAX: 500,
  TOOL_OUTPUT_LOG: 2000,
  SCREENSHOT_QUALITY: 80,
  VIEWPORT: {
    WIDTH: 1280,
    HEIGHT: 720,
  },
  FULLPAGE_MAX_HEIGHT: 1440,
} as const;

/** Rate limiting configuration */
export const RATE_LIMITS = {
  LOCAL_LLM: {
    REQUESTS_PER_MINUTE: 60, // Local LLM can handle more requests
    MAX_TOKENS: 60,
  },
  WEB: {
    REQUESTS_PER_MINUTE: 100,
    DELAY_MS: 1000,
  },
} as const;

/** Retry configuration */
export const RETRY = {
  MAX_ATTEMPTS: 3,
  DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
  MAX_DELAY_MS: 60000,
} as const;

/** Database configuration */
export const DB = {
  CACHE_SIZE: -20000, // 20MB
  BUSY_TIMEOUT: 5000,
  PATHS: {
    DEFAULT: "/data/agent.db",
    FALLBACK: "./agent.db",
  },
} as const;

/** Allowed directories for file operations */
export const ALLOWED_DIRECTORIES = {
  SHELL: ["/workspace", "/tmp", "/tmp/agent"],
  FILE: ["/workspace", "/tmp", "/data/screenshots"],
} as const;

/** Temperature and generation config */
export const GENERATION = {
  TEMPERATURE: {
    DEFAULT: 0.7,
    MIN: 0,
    MAX: 2,
  },
  MAX_TOKENS: {
    DEFAULT: 8192,
  },
} as const;

/** Survival and Growth configuration */
export const GROWTH = {
  DAILY_DEBT: 250.0 / 30.0, // $250 per month
  HOURLY_DEBT: 250.0 / (30 * 24),
  KNOWLEDGE_MAX_ENTRIES: 10000,
  THOUGHTS_RETENTION_DAYS: 7,
  EMBEDDING_DIM: 384,
} as const;

/** Telegram configuration */
export const TELEGRAM = {
  POLL_TIMEOUT: 30,
  MAX_CONSECUTIVE_ERRORS: 10,
  MAX_RETRIES: 3,
} as const;

/** Stuck detection thresholds */
export const STUCK_DETECTION = {
  SAME_CALL_THRESHOLD: 3,
  SINGLE_TOOL_THRESHOLD: 10,
} as const;

/** Environment variable names (for reference) */
export const ENV_VARS = {
  LOCAL_LLM_URL: "LOCAL_LLM_URL",
  TELEGRAM_TOKEN: "TELEGRAM_TOKEN",
  PORT: "PORT",
  DB_PATH: "DB_PATH",
  PUPPETEER_EXECUTABLE_PATH: "PUPPETEER_EXECUTABLE_PATH",
} as const;

/** Default model names */
export const MODELS = {
  DEFAULT: "Qwen2.5-7B-Instruct",
  LOCAL: "Qwen2.5-7B-Instruct",
} as const;

/** File extensions and MIME types */
export const MIME_TYPES: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  // Videos
  mp4: "video/mp4",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  // Audio
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  // Documents
  pdf: "application/pdf",
  zip: "application/zip",
  tar: "application/x-tar",
  gz: "application/gzip",
  json: "application/json",
  csv: "text/csv",
  txt: "text/plain",
} as const;

/** Screenshot configuration */
export const SCREENSHOT = {
  DIR: "/data/screenshots",
  FORMAT: "jpeg" as const,
  QUALITY: 80,
  ENCODING: "base64" as const,
} as const;

/** HTTP Status codes */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  SERVER_ERROR: 500,
} as const;
