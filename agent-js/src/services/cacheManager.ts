import { createClient, RedisClientType } from 'redis';
import { createHash } from 'crypto';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Cache key prefix
}

export interface CacheResult<T> {
  hit: boolean;
  data: T | null;
  source: 'cache' | 'fresh';
  timestamp?: number;
}

export class CacheManager {
  private redis: RedisClientType;
  private readonly DEFAULT_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = 'research_cache';
  
  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.redis.on('error', (err: any) => {
      console.error('Cache Redis client error:', err);
    });
  }
  
  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }
  
  /**
   * Get cached response for search query
   */
  async getCachedResponse(searchQuery: string): Promise<string | null> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('search', searchQuery);
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const { response, timestamp } = JSON.parse(cached);
        
        // Check if cache is still valid (1 hour for search results)
        if (Date.now() - timestamp < 3600000) {
          console.log(`Cache hit for search: ${searchQuery.substring(0, 50)}...`);
          return response;
        } else {
          // Cache expired, remove it
          await this.redis.del(cacheKey);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting cached response:', error);
      return null;
    }
  }
  
  /**
   * Cache search response
   */
  async cacheResponse(query: string, response: string, options: CacheOptions = {}): Promise<void> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey(options.prefix || 'search', query);
      const ttl = options.ttl || this.DEFAULT_TTL;
      
      const cacheData = {
        response,
        timestamp: Date.now(),
        query: query.substring(0, 100), // Store truncated query for debugging
      };
      
      await this.redis.setEx(cacheKey, ttl, JSON.stringify(cacheData));
      console.log(`Cached response for: ${query.substring(0, 50)}...`);
      
    } catch (error) {
      console.error('Error caching response:', error);
    }
  }
  
  /**
   * Cache LLM response with content-based key
   */
  async cacheLLMResponse(prompt: string, response: string, model: string): Promise<void> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('llm', `${model}:${prompt}`);
      const cacheData = {
        prompt: prompt.substring(0, 200),
        response,
        model,
        timestamp: Date.now(),
      };
      
      // Cache LLM responses for 24 hours
      await this.redis.setEx(cacheKey, 86400, JSON.stringify(cacheData));
      
    } catch (error) {
      console.error('Error caching LLM response:', error);
    }
  }
  
  /**
   * Get cached LLM response
   */
  async getCachedLLMResponse(prompt: string, model: string): Promise<string | null> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('llm', `${model}:${prompt}`);
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const { response, timestamp } = JSON.parse(cached);
        
        // LLM cache valid for 24 hours
        if (Date.now() - timestamp < 86400000) {
          console.log(`LLM cache hit for model ${model}`);
          return response;
        } else {
          await this.redis.del(cacheKey);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting cached LLM response:', error);
      return null;
    }
  }
  
  /**
   * Cache resource content
   */
  async cacheResourceContent(url: string, content: string): Promise<void> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('resource', url);
      const cacheData = {
        url,
        content,
        timestamp: Date.now(),
      };
      
      // Cache resource content for 6 hours
      await this.redis.setEx(cacheKey, 21600, JSON.stringify(cacheData));
      
    } catch (error) {
      console.error('Error caching resource content:', error);
    }
  }
  
  /**
   * Get cached resource content
   */
  async getCachedResourceContent(url: string): Promise<string | null> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('resource', url);
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        const { content, timestamp } = JSON.parse(cached);
        
        // Resource cache valid for 6 hours
        if (Date.now() - timestamp < 21600000) {
          console.log(`Resource cache hit for: ${url}`);
          return content;
        } else {
          await this.redis.del(cacheKey);
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting cached resource content:', error);
      return null;
    }
  }
  
  /**
   * Cache research report sections
   */
  async cacheReportSection(topic: string, section: string, content: string): Promise<void> {
    try {
      await this.initialize();
      
      const cacheKey = this.generateCacheKey('report', `${topic}:${section}`);
      const cacheData = {
        topic,
        section,
        content,
        timestamp: Date.now(),
      };
      
      // Cache report sections for 2 hours
      await this.redis.setEx(cacheKey, 7200, JSON.stringify(cacheData));
      
    } catch (error) {
      console.error('Error caching report section:', error);
    }
  }
  
  /**
   * Generate cache key with hash for long keys
   */
  private generateCacheKey(type: string, content: string): string {
    const hash = this.hashContent(content);
    return `${this.CACHE_PREFIX}:${type}:${hash}`;
  }
  
  /**
   * Hash content for consistent cache keys
   */
  private hashContent(content: string): string {
    return createHash('sha256')
      .update(content.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16); // Use first 16 chars for shorter keys
  }
  
  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalKeys: number;
    hitRate: number;
    memoryUsage: string;
    keysByType: Record<string, number>;
  }> {
    try {
      await this.initialize();
      
      const keys = await this.redis.keys(`${this.CACHE_PREFIX}:*`);
      const info = await this.redis.info('memory');
      
      // Count keys by type
      const keysByType: Record<string, number> = {};
      keys.forEach((key: string) => {
        const type = key.split(':')[1];
        keysByType[type] = (keysByType[type] || 0) + 1;
      });
      
      // Extract memory usage from Redis info
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : 'Unknown';
      
      return {
        totalKeys: keys.length,
        hitRate: 0, // Would need hit/miss tracking for accurate rate
        memoryUsage,
        keysByType
      };
      
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        totalKeys: 0,
        hitRate: 0,
        memoryUsage: 'Error',
        keysByType: {}
      };
    }
  }
  
  /**
   * Clear cache by type or pattern
   */
  async clearCache(type?: string): Promise<number> {
    try {
      await this.initialize();
      
      const pattern = type 
        ? `${this.CACHE_PREFIX}:${type}:*` 
        : `${this.CACHE_PREFIX}:*`;
      
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        const deleted = await this.redis.del(keys);
        console.log(`Cleared ${deleted} cache entries for pattern: ${pattern}`);
        return deleted;
      }
      
      return 0;
    } catch (error) {
      console.error('Error clearing cache:', error);
      return 0;
    }
  }
  
  /**
   * Preload cache with common queries
   */
  async preloadCache(commonQueries: string[]): Promise<void> {
    console.log('Preloading cache with common queries...');
    
    for (const query of commonQueries) {
      // Check if already cached
      const cached = await this.getCachedResponse(query);
      if (!cached) {
        // Would trigger actual search to populate cache
        console.log(`Cache miss for common query: ${query}`);
      }
    }
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