export interface LLMConfig {
  providers: string[];
  maxTokens: number;
  temperature: number;
  fallbackModel: string;
  timeoutMs: number;
  retryAttempts: number;
}

export interface MonitoringConfig {
  enabled: boolean;
  alertThresholds: {
    responseTime: number;
    errorRate: number;
    tokenUsage: number;
  };
  metricsRetention: number;
  enableDetailedLogging: boolean;
}

export interface CacheConfig {
  ttl: number;
  enabled: boolean;
  maxMemory: string;
  cleanupInterval: number;
  preloadCommonQueries: boolean;
}

export interface SecurityConfig {
  enableInputValidation: boolean;
  enableOutputFiltering: boolean;
  maxInputLength: number;
  enableRateLimiting: boolean;
  requestsPerMinute: number;
  enableContentFiltering: boolean;
}

export interface PerformanceConfig {
  enableCaching: boolean;
  enableModelRouting: boolean;
  enableCheckpointing: boolean;
  maxConcurrentRequests: number;
  requestTimeoutMs: number;
}

export interface AppConfig {
  llm: LLMConfig;
  monitoring: MonitoringConfig;
  cache: CacheConfig;
  security: SecurityConfig;
  performance: PerformanceConfig;
  environment: 'development' | 'staging' | 'production';
  version: string;
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): AppConfig {
  return {
    llm: {
      providers: process.env.LLM_PROVIDERS?.split(',') || ['openai'],
      maxTokens: parseInt(process.env.MAX_TOKENS || '28000'),
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
      fallbackModel: process.env.FALLBACK_MODEL || 'gpt-3.5-turbo',
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000'),
      retryAttempts: parseInt(process.env.LLM_RETRY_ATTEMPTS || '3')
    },
    
    monitoring: {
      enabled: process.env.MONITORING_ENABLED === 'true',
      alertThresholds: {
        responseTime: parseInt(process.env.ALERT_RESPONSE_TIME || '10000'),
        errorRate: parseFloat(process.env.ALERT_ERROR_RATE || '0.05'),
        tokenUsage: parseInt(process.env.ALERT_TOKEN_USAGE || '25000')
      },
      metricsRetention: parseInt(process.env.METRICS_RETENTION_HOURS || '168'), // 7 days
      enableDetailedLogging: process.env.DETAILED_LOGGING === 'true'
    },
    
    cache: {
      ttl: parseInt(process.env.CACHE_TTL || '3600'),
      enabled: process.env.CACHE_ENABLED !== 'false',
      maxMemory: process.env.CACHE_MAX_MEMORY || '100mb',
      cleanupInterval: parseInt(process.env.CACHE_CLEANUP_INTERVAL || '1800'), // 30 minutes
      preloadCommonQueries: process.env.CACHE_PRELOAD === 'true'
    },
    
    security: {
      enableInputValidation: process.env.INPUT_VALIDATION !== 'false',
      enableOutputFiltering: process.env.OUTPUT_FILTERING !== 'false',
      maxInputLength: parseInt(process.env.MAX_INPUT_LENGTH || '10000'),
      enableRateLimiting: process.env.RATE_LIMITING === 'true',
      requestsPerMinute: parseInt(process.env.REQUESTS_PER_MINUTE || '60'),
      enableContentFiltering: process.env.CONTENT_FILTERING === 'true'
    },
    
    performance: {
      enableCaching: process.env.PERFORMANCE_CACHING !== 'false',
      enableModelRouting: process.env.MODEL_ROUTING !== 'false',
      enableCheckpointing: process.env.CHECKPOINTING !== 'false',
      maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10'),
      requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '60000')
    },
    
    environment: (process.env.NODE_ENV as 'development' | 'staging' | 'production') || 'development',
    version: process.env.APP_VERSION || '1.0.0'
  };
}

/**
 * Validate configuration for required settings
 */
export function validateConfig(config: AppConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required API keys
  if (config.llm.providers.includes('openai') && !process.env.OPENAI_API_KEY) {
    errors.push('OPENAI_API_KEY is required when using OpenAI provider');
  }
  
  if (config.llm.providers.includes('anthropic') && !process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is required when using Anthropic provider');
  }
  
  if (config.llm.providers.includes('google') && !process.env.GOOGLE_API_KEY) {
    errors.push('GOOGLE_API_KEY is required when using Google provider');
  }
  
  // Redis configuration for caching/checkpointing
  if ((config.cache.enabled || config.performance.enableCheckpointing) && 
      !process.env.REDIS_URL) {
    errors.push('REDIS_URL is required when caching or checkpointing is enabled');
  }
  
  // Performance constraints
  if (config.llm.maxTokens > 200000) {
    errors.push('MAX_TOKENS should not exceed 200,000 for stability');
  }
  
  if (config.performance.maxConcurrentRequests > 50) {
    errors.push('MAX_CONCURRENT_REQUESTS should not exceed 50 for stability');
  }
  
  // Monitoring configuration
  if (config.monitoring.enabled && config.monitoring.alertThresholds.errorRate > 1) {
    errors.push('Alert error rate threshold should be between 0 and 1');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get environment-specific configurations
 */
export function getEnvironmentDefaults(env: string): Partial<AppConfig> {
  switch (env) {
    case 'development':
      return {
        monitoring: {
          enabled: true,
          enableDetailedLogging: true,
          alertThresholds: { responseTime: 15000, errorRate: 0.1, tokenUsage: 30000 },
          metricsRetention: 24
        },
        security: {
          enableInputValidation: true,
          enableOutputFiltering: false, // More permissive for development
          enableRateLimiting: false,
          requestsPerMinute: 120,
          maxInputLength: 20000,
          enableContentFiltering: false
        },
        cache: {
          ttl: 1800, // Shorter cache for development
          preloadCommonQueries: false,
          enabled: true,
          maxMemory: '50mb',
          cleanupInterval: 600
        }
      };
      
    case 'staging':
      return {
        monitoring: {
          enabled: true,
          enableDetailedLogging: true,
          alertThresholds: { responseTime: 8000, errorRate: 0.05, tokenUsage: 25000 },
          metricsRetention: 72
        },
        security: {
          enableInputValidation: true,
          enableOutputFiltering: true,
          enableRateLimiting: true,
          requestsPerMinute: 80,
          maxInputLength: 15000,
          enableContentFiltering: true
        },
        cache: {
          ttl: 3600,
          preloadCommonQueries: true,
          enabled: true,
          maxMemory: '200mb',
          cleanupInterval: 1800
        }
      };
      
    case 'production':
      return {
        monitoring: {
          enabled: true,
          enableDetailedLogging: false, // Less verbose in production
          alertThresholds: { responseTime: 5000, errorRate: 0.02, tokenUsage: 20000 },
          metricsRetention: 168 // 7 days
        },
        security: {
          enableInputValidation: true,
          enableOutputFiltering: true,
          enableRateLimiting: true,
          requestsPerMinute: 60,
          maxInputLength: 10000,
          enableContentFiltering: true
        },
        cache: {
          ttl: 7200, // Longer cache for production
          preloadCommonQueries: true,
          enabled: true,
          maxMemory: '500mb',
          cleanupInterval: 3600
        }
      };
      
    default:
      return {};
  }
}

/**
 * Merge environment defaults with loaded config
 */
export function getConfig(): AppConfig {
  const baseConfig = loadConfig();
  const envDefaults = getEnvironmentDefaults(baseConfig.environment);
  
  // Deep merge configuration
  const config = {
    ...baseConfig,
    llm: { ...baseConfig.llm, ...envDefaults.llm },
    monitoring: { ...baseConfig.monitoring, ...envDefaults.monitoring },
    cache: { ...baseConfig.cache, ...envDefaults.cache },
    security: { ...baseConfig.security, ...envDefaults.security },
    performance: { ...baseConfig.performance, ...envDefaults.performance }
  };
  
  // Validate final configuration
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('Configuration validation failed:');
    validation.errors.forEach(error => console.error(`  - ${error}`));
    throw new Error('Invalid configuration');
  }
  
  return config;
}

/**
 * Configuration singleton
 */
let configInstance: AppConfig | null = null;

export function config(): AppConfig {
  if (!configInstance) {
    configInstance = getConfig();
    console.log(`Loaded configuration for ${configInstance.environment} environment`);
  }
  return configInstance;
}

/**
 * Reload configuration (useful for testing)
 */
export function reloadConfig(): AppConfig {
  configInstance = null;
  return config();
} 