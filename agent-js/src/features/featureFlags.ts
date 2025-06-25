import { createClient, RedisClientType } from 'redis';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description: string;
  rolloutPercentage: number;
  conditions?: {
    userIds?: string[];
    environments?: string[];
    dateRange?: {
      start: number;
      end: number;
    };
  };
  created: number;
  lastModified: number;
}

export interface FeatureFlagEvaluation {
  flagName: string;
  enabled: boolean;
  reason: string;
  rolloutBucket?: number;
}

export class FeatureFlags {
  private redis: RedisClientType;
  private localCache: Map<string, FeatureFlag> = new Map();
  private readonly CACHE_TTL = 300; // 5 minutes
  private lastCacheUpdate = 0;
  
  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.redis.on('error', (err: any) => {
      console.error('Feature flags Redis client error:', err);
    });
    
    // Initialize default flags
    this.initializeDefaultFlags();
  }
  
  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
    await this.refreshCache();
  }
  
  /**
   * Check if feature is enabled for user/context
   */
  async isEnabled(flagName: string, userId?: string, context?: Record<string, any>): Promise<boolean> {
    const evaluation = await this.evaluateFlag(flagName, userId, context);
    return evaluation.enabled;
  }
  
  /**
   * Evaluate feature flag with detailed reasoning
   */
  async evaluateFlag(
    flagName: string, 
    userId?: string, 
    context?: Record<string, any>
  ): Promise<FeatureFlagEvaluation> {
    try {
      await this.ensureCacheUpdated();
      
      const flag = this.localCache.get(flagName);
      
      if (!flag) {
        return {
          flagName,
          enabled: false,
          reason: 'Flag not found'
        };
      }
      
      // Check if flag is globally disabled
      if (!flag.enabled) {
        return {
          flagName,
          enabled: false,
          reason: 'Flag globally disabled'
        };
      }
      
      // Check environment conditions
      if (flag.conditions?.environments) {
        const currentEnv = process.env.NODE_ENV || 'development';
        if (!flag.conditions.environments.includes(currentEnv)) {
          return {
            flagName,
            enabled: false,
            reason: `Environment ${currentEnv} not in allowed list`
          };
        }
      }
      
      // Check date range conditions
      if (flag.conditions?.dateRange) {
        const now = Date.now();
        if (now < flag.conditions.dateRange.start || now > flag.conditions.dateRange.end) {
          return {
            flagName,
            enabled: false,
            reason: 'Outside of date range'
          };
        }
      }
      
      // Check user-specific conditions
      if (flag.conditions?.userIds && userId) {
        if (flag.conditions.userIds.includes(userId)) {
          return {
            flagName,
            enabled: true,
            reason: 'User in whitelist'
          };
        }
      }
      
      // Check rollout percentage
      if (flag.rolloutPercentage < 100) {
        const rolloutBucket = this.getUserBucket(flagName, userId);
        const enabled = rolloutBucket < flag.rolloutPercentage;
        
        return {
          flagName,
          enabled,
          reason: enabled ? 
            `User in rollout (bucket ${rolloutBucket}/${flag.rolloutPercentage})` :
            `User not in rollout (bucket ${rolloutBucket}/${flag.rolloutPercentage})`,
          rolloutBucket
        };
      }
      
      return {
        flagName,
        enabled: true,
        reason: 'Flag fully enabled'
      };
      
    } catch (error) {
      console.error(`Error evaluating flag ${flagName}:`, error);
      return {
        flagName,
        enabled: false,
        reason: `Evaluation error: ${error}`
      };
    }
  }
  
  /**
   * Create or update feature flag
   */
  async setFlag(flag: Omit<FeatureFlag, 'created' | 'lastModified'>): Promise<void> {
    try {
      await this.initialize();
      
      const existingFlag = await this.redis.hGet('feature_flags', flag.name);
      const now = Date.now();
      
      const fullFlag: FeatureFlag = {
        ...flag,
        created: existingFlag ? JSON.parse(existingFlag).created : now,
        lastModified: now
      };
      
      await this.redis.hSet('feature_flags', flag.name, JSON.stringify(fullFlag));
      
      // Invalidate cache
      this.localCache.set(flag.name, fullFlag);
      
      console.log(`Feature flag updated: ${flag.name} = ${flag.enabled} (${flag.rolloutPercentage}%)`);
      
    } catch (error) {
      console.error(`Error setting flag ${flag.name}:`, error);
      throw error;
    }
  }
  
  /**
   * Delete feature flag
   */
  async deleteFlag(flagName: string): Promise<boolean> {
    try {
      await this.initialize();
      
      const result = await this.redis.hDel('feature_flags', flagName);
      this.localCache.delete(flagName);
      
      console.log(`Feature flag deleted: ${flagName}`);
      return result > 0;
      
    } catch (error) {
      console.error(`Error deleting flag ${flagName}:`, error);
      return false;
    }
  }
  
  /**
   * Get all feature flags
   */
  async getAllFlags(): Promise<FeatureFlag[]> {
    try {
      await this.ensureCacheUpdated();
      return Array.from(this.localCache.values()).sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      console.error('Error getting all flags:', error);
      return [];
    }
  }
  
  /**
   * Get feature flag usage statistics
   */
  async getFlagStats(flagName: string, hours: number = 24): Promise<{
    evaluations: number;
    enabledCount: number;
    disabledCount: number;
    reasons: Record<string, number>;
  }> {
    try {
      await this.initialize();
      
      const now = Date.now();
      const startTime = now - (hours * 60 * 60 * 1000);
      
      const stats = {
        evaluations: 0,
        enabledCount: 0,
        disabledCount: 0,
        reasons: {} as Record<string, number>
      };
      
      // Get evaluation logs (would need to implement logging)
      const logPattern = `flag_eval:${flagName}:*`;
      const keys = await this.redis.keys(logPattern);
      
      for (const key of keys) {
        const timestamp = parseInt(key.split(':')[2]);
        if (timestamp >= startTime) {
          const logData = await this.redis.get(key);
          if (logData) {
            const evaluation: FeatureFlagEvaluation = JSON.parse(logData);
            stats.evaluations++;
            
            if (evaluation.enabled) {
              stats.enabledCount++;
            } else {
              stats.disabledCount++;
            }
            
            stats.reasons[evaluation.reason] = (stats.reasons[evaluation.reason] || 0) + 1;
          }
        }
      }
      
      return stats;
      
    } catch (error) {
      console.error(`Error getting flag stats for ${flagName}:`, error);
      return { evaluations: 0, enabledCount: 0, disabledCount: 0, reasons: {} };
    }
  }
  
  /**
   * Log feature flag evaluation (for analytics)
   */
  async logEvaluation(evaluation: FeatureFlagEvaluation, userId?: string): Promise<void> {
    try {
      const logKey = `flag_eval:${evaluation.flagName}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      const logData = {
        ...evaluation,
        userId,
        timestamp: Date.now()
      };
      
      // Store with 7 day TTL
      await this.redis.setEx(logKey, 604800, JSON.stringify(logData));
      
    } catch (error) {
      console.error('Error logging flag evaluation:', error);
      // Don't throw - logging should be non-blocking
    }
  }
  
  /**
   * Get user's rollout bucket (0-99)
   */
  private getUserBucket(flagName: string, userId?: string): number {
    const identifier = userId || 'anonymous';
    const hash = this.simpleHash(`${flagName}:${identifier}`);
    return hash % 100;
  }
  
  /**
   * Simple hash function for consistent bucketing
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
  
  /**
   * Ensure cache is updated
   */
  private async ensureCacheUpdated(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_TTL * 1000) {
      await this.refreshCache();
    }
  }
  
  /**
   * Refresh local cache from Redis
   */
  private async refreshCache(): Promise<void> {
    try {
      await this.initialize();
      
      const flags = await this.redis.hGetAll('feature_flags');
      this.localCache.clear();
      
      Object.entries(flags).forEach(([name, data]) => {
        try {
          const flag: FeatureFlag = JSON.parse(data);
          this.localCache.set(name, flag);
        } catch (error) {
          console.error(`Error parsing flag ${name}:`, error);
        }
      });
      
      this.lastCacheUpdate = Date.now();
      console.log(`Refreshed feature flags cache: ${this.localCache.size} flags`);
      
    } catch (error) {
      console.error('Error refreshing flags cache:', error);
    }
  }
  
  /**
   * Initialize default feature flags
   */
  private async initializeDefaultFlags(): Promise<void> {
    const defaultFlags: Omit<FeatureFlag, 'created' | 'lastModified'>[] = [
      {
        name: 'use_advanced_search',
        enabled: false,
        description: 'Enable advanced search implementation',
        rolloutPercentage: 0,
        conditions: {
          environments: ['development', 'staging']
        }
      },
      {
        name: 'enable_caching',
        enabled: true,
        description: 'Enable response caching',
        rolloutPercentage: 100
      },
      {
        name: 'enable_model_routing',
        enabled: true,
        description: 'Enable smart model routing',
        rolloutPercentage: 50
      },
      {
        name: 'enable_safety_filters',
        enabled: true,
        description: 'Enable input/output safety filtering',
        rolloutPercentage: 100
      },
      {
        name: 'enable_provider_fallback',
        enabled: true,
        description: 'Enable LLM provider fallback',
        rolloutPercentage: 100
      },
      {
        name: 'enable_checkpointing',
        enabled: true,
        description: 'Enable conversation checkpointing',
        rolloutPercentage: 75
      },
      {
        name: 'detailed_monitoring',
        enabled: false,
        description: 'Enable detailed performance monitoring',
        rolloutPercentage: 25,
        conditions: {
          environments: ['staging', 'production']
        }
      }
    ];
    
    // Set default flags if they don't exist
    setTimeout(async () => {
      for (const flag of defaultFlags) {
        const existing = await this.redis.hGet('feature_flags', flag.name);
        if (!existing) {
          await this.setFlag(flag);
        }
      }
    }, 1000); // Delay to ensure Redis is connected
  }
  
  /**
   * Batch evaluate multiple flags
   */
  async evaluateFlags(
    flagNames: string[], 
    userId?: string, 
    context?: Record<string, any>
  ): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const flagName of flagNames) {
      results[flagName] = await this.isEnabled(flagName, userId, context);
    }
    
    return results;
  }
  
  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    if (this.redis.isOpen) {
      await this.redis.quit();
    }
  }
} 