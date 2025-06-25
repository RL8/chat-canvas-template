import { createClient, RedisClientType } from 'redis';

export interface RequestMetrics {
  timestamp: number;
  userId?: string;
  promptLength: number;
  responseLength: number;
  duration: number;
  tokensUsed: number;
  provider: string;
  model: string;
  success: boolean;
  errorType?: string;
  cost: number;
}

export interface SystemMetrics {
  timestamp: number;
  responseTime: {
    avg: number;
    p95: number;
    p99: number;
  };
  errorRate: number;
  throughput: number;
  tokenUsage: {
    total: number;
    perHour: number;
    perProvider: Record<string, number>;
  };
  costs: {
    total: number;
    perHour: number;
    perProvider: Record<string, number>;
  };
  providerHealth: Record<string, boolean>;
}

export interface Alert {
  id: string;
  type: 'SLOW_RESPONSE' | 'HIGH_ERROR_RATE' | 'TOKEN_LIMIT' | 'COST_THRESHOLD' | 'PROVIDER_DOWN';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: number;
  metadata: Record<string, any>;
  resolved: boolean;
}

export class MetricsCollector {
  private redis: RedisClientType;
  private readonly METRICS_RETENTION = 604800; // 7 days in seconds
  private readonly ALERT_THRESHOLDS = {
    SLOW_RESPONSE: 10000, // 10 seconds
    HIGH_ERROR_RATE: 0.05, // 5%
    TOKEN_LIMIT: 25000, // per hour
    COST_THRESHOLD: 50, // $50 per hour
  };
  
  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.redis.on('error', (err: any) => {
      console.error('Metrics Redis client error:', err);
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
   * Record request metrics
   */
  async recordRequest(
    userId: string | undefined,
    prompt: string,
    response: string,
    duration: number,
    provider: string,
    model: string,
    success: boolean,
    cost: number,
    errorType?: string
  ): Promise<void> {
    try {
      await this.initialize();
      
      const metrics: RequestMetrics = {
        timestamp: Date.now(),
        userId,
        promptLength: prompt.length,
        responseLength: response.length,
        duration,
        tokensUsed: this.estimateTokens(prompt + response),
        provider,
        model,
        success,
        errorType,
        cost
      };
      
      // Store individual request metric
      const metricKey = `metrics:request:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
      await this.redis.setEx(metricKey, this.METRICS_RETENTION, JSON.stringify(metrics));
      
      // Update aggregated metrics
      await this.updateAggregatedMetrics(metrics);
      
      // Check for alerts
      await this.checkAlerts(metrics);
      
      console.log(`Recorded metrics: ${provider}:${model} - ${duration}ms, ${metrics.tokensUsed} tokens, $${cost.toFixed(4)}`);
      
    } catch (error) {
      console.error('Error recording request metrics:', error);
    }
  }
  
  /**
   * Update aggregated metrics
   */
  private async updateAggregatedMetrics(metrics: RequestMetrics): Promise<void> {
    const hour = Math.floor(Date.now() / 3600000); // Current hour
    const hourKey = `metrics:hour:${hour}`;
    
    // Increment counters
    await this.redis.hIncrBy(hourKey, 'total_requests', 1);
    await this.redis.hIncrBy(hourKey, 'total_tokens', metrics.tokensUsed);
    await this.redis.hIncrByFloat(hourKey, 'total_cost', metrics.cost);
    await this.redis.hIncrBy(hourKey, 'total_duration', metrics.duration);
    
    if (!metrics.success) {
      await this.redis.hIncrBy(hourKey, 'error_count', 1);
    }
    
    // Provider-specific metrics
    await this.redis.hIncrBy(hourKey, `provider:${metrics.provider}:requests`, 1);
    await this.redis.hIncrBy(hourKey, `provider:${metrics.provider}:tokens`, metrics.tokensUsed);
    await this.redis.hIncrByFloat(hourKey, `provider:${metrics.provider}:cost`, metrics.cost);
    
    // Set TTL for hourly metrics
    await this.redis.expire(hourKey, this.METRICS_RETENTION);
  }
  
  /**
   * Check for alert conditions
   */
  private async checkAlerts(metrics: RequestMetrics): Promise<void> {
    const alerts: Alert[] = [];
    
    // Slow response alert
    if (metrics.duration > this.ALERT_THRESHOLDS.SLOW_RESPONSE) {
      alerts.push({
        id: `slow_response_${Date.now()}`,
        type: 'SLOW_RESPONSE',
        severity: metrics.duration > 20000 ? 'high' : 'medium',
        message: `Slow response detected: ${metrics.duration}ms (threshold: ${this.ALERT_THRESHOLDS.SLOW_RESPONSE}ms)`,
        timestamp: Date.now(),
        metadata: { duration: metrics.duration, provider: metrics.provider, userId: metrics.userId },
        resolved: false
      });
    }
    
    // Check hourly token usage
    const hour = Math.floor(Date.now() / 3600000);
    const hourKey = `metrics:hour:${hour}`;
    const hourlyTokens = await this.redis.hGet(hourKey, 'total_tokens');
    
    if (hourlyTokens && parseInt(hourlyTokens) > this.ALERT_THRESHOLDS.TOKEN_LIMIT) {
      alerts.push({
        id: `token_limit_${hour}`,
        type: 'TOKEN_LIMIT',
        severity: 'high',
        message: `Hourly token limit exceeded: ${hourlyTokens} tokens (threshold: ${this.ALERT_THRESHOLDS.TOKEN_LIMIT})`,
        timestamp: Date.now(),
        metadata: { hourlyTokens: parseInt(hourlyTokens), hour },
        resolved: false
      });
    }
    
    // Check hourly cost
    const hourlyCost = await this.redis.hGet(hourKey, 'total_cost');
    if (hourlyCost && parseFloat(hourlyCost) > this.ALERT_THRESHOLDS.COST_THRESHOLD) {
      alerts.push({
        id: `cost_threshold_${hour}`,
        type: 'COST_THRESHOLD',
        severity: 'high',
        message: `Hourly cost threshold exceeded: $${parseFloat(hourlyCost).toFixed(2)} (threshold: $${this.ALERT_THRESHOLDS.COST_THRESHOLD})`,
        timestamp: Date.now(),
        metadata: { hourlyCost: parseFloat(hourlyCost), hour },
        resolved: false
      });
    }
    
    // Store alerts
    for (const alert of alerts) {
      await this.storeAlert(alert);
    }
  }
  
  /**
   * Store alert
   */
  private async storeAlert(alert: Alert): Promise<void> {
    const alertKey = `alert:${alert.id}`;
    await this.redis.setEx(alertKey, 86400, JSON.stringify(alert)); // 24 hour TTL
    
    // Add to alert list
    await this.redis.lPush('alerts:active', alert.id);
    await this.redis.lTrim('alerts:active', 0, 99); // Keep last 100 alerts
    
    console.warn(`ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);
  }
  
  /**
   * Get system metrics
   */
  async getSystemMetrics(hours: number = 24): Promise<SystemMetrics> {
    try {
      await this.initialize();
      
      const currentHour = Math.floor(Date.now() / 3600000);
      const metrics: SystemMetrics = {
        timestamp: Date.now(),
        responseTime: { avg: 0, p95: 0, p99: 0 },
        errorRate: 0,
        throughput: 0,
        tokenUsage: { total: 0, perHour: 0, perProvider: {} },
        costs: { total: 0, perHour: 0, perProvider: {} },
        providerHealth: {}
      };
      
      // Aggregate data from recent hours
      let totalRequests = 0;
      let totalErrors = 0;
      let totalDuration = 0;
      const durations: number[] = [];
      
      for (let i = 0; i < hours; i++) {
        const hour = currentHour - i;
        const hourKey = `metrics:hour:${hour}`;
        const hourData = await this.redis.hGetAll(hourKey);
        
        if (Object.keys(hourData).length > 0) {
          const requests = parseInt(hourData.total_requests || '0');
          const errors = parseInt(hourData.error_count || '0');
          const duration = parseInt(hourData.total_duration || '0');
          const tokens = parseInt(hourData.total_tokens || '0');
          const cost = parseFloat(hourData.total_cost || '0');
          
          totalRequests += requests;
          totalErrors += errors;
          totalDuration += duration;
          metrics.tokenUsage.total += tokens;
          metrics.costs.total += cost;
          
          if (i === 0) { // Current hour
            metrics.tokenUsage.perHour = tokens;
            metrics.costs.perHour = cost;
          }
          
          // Collect provider-specific data
          Object.keys(hourData).forEach(key => {
            if (key.startsWith('provider:')) {
              const [, provider, metric] = key.split(':');
              if (metric === 'tokens') {
                metrics.tokenUsage.perProvider[provider] = 
                  (metrics.tokenUsage.perProvider[provider] || 0) + parseInt(hourData[key] || '0');
              } else if (metric === 'cost') {
                metrics.costs.perProvider[provider] = 
                  (metrics.costs.perProvider[provider] || 0) + parseFloat(hourData[key] || '0');
              }
            }
          });
        }
      }
      
      // Calculate derived metrics
      if (totalRequests > 0) {
        metrics.responseTime.avg = totalDuration / totalRequests;
        metrics.errorRate = totalErrors / totalRequests;
        metrics.throughput = totalRequests / hours;
      }
      
      // Get recent response times for percentiles
      const recentMetrics = await this.getRecentResponseTimes(100);
      if (recentMetrics.length > 0) {
        const sorted = recentMetrics.sort((a, b) => a - b);
        metrics.responseTime.p95 = sorted[Math.floor(sorted.length * 0.95)];
        metrics.responseTime.p99 = sorted[Math.floor(sorted.length * 0.99)];
      }
      
      return metrics;
      
    } catch (error) {
      console.error('Error getting system metrics:', error);
      throw error;
    }
  }
  
  /**
   * Get recent response times
   */
  private async getRecentResponseTimes(limit: number): Promise<number[]> {
    const pattern = 'metrics:request:*';
    const keys = await this.redis.keys(pattern);
    const recentKeys = keys.slice(-limit);
    
    const responseTimes: number[] = [];
    
    for (const key of recentKeys) {
      const data = await this.redis.get(key);
      if (data) {
        const metrics: RequestMetrics = JSON.parse(data);
        responseTimes.push(metrics.duration);
      }
    }
    
    return responseTimes;
  }
  
  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<Alert[]> {
    try {
      await this.initialize();
      
      const alertIds = await this.redis.lRange('alerts:active', 0, -1);
      const alerts: Alert[] = [];
      
      for (const alertId of alertIds) {
        const alertData = await this.redis.get(`alert:${alertId}`);
        if (alertData) {
          const alert: Alert = JSON.parse(alertData);
          if (!alert.resolved) {
            alerts.push(alert);
          }
        }
      }
      
      return alerts.sort((a, b) => b.timestamp - a.timestamp);
      
    } catch (error) {
      console.error('Error getting active alerts:', error);
      return [];
    }
  }
  
  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    try {
      await this.initialize();
      
      const alertData = await this.redis.get(`alert:${alertId}`);
      if (alertData) {
        const alert: Alert = JSON.parse(alertData);
        alert.resolved = true;
        await this.redis.setEx(`alert:${alertId}`, 86400, JSON.stringify(alert));
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error resolving alert:', error);
      return false;
    }
  }
  
  /**
   * Get provider performance comparison
   */
  async getProviderComparison(hours: number = 24): Promise<Record<string, any>> {
    const metrics = await this.getSystemMetrics(hours);
    const comparison: Record<string, any> = {};
    
    Object.keys(metrics.tokenUsage.perProvider).forEach(provider => {
      comparison[provider] = {
        tokens: metrics.tokenUsage.perProvider[provider],
        cost: metrics.costs.perProvider[provider],
        avgCostPerToken: metrics.costs.perProvider[provider] / metrics.tokenUsage.perProvider[provider],
        usage: (metrics.tokenUsage.perProvider[provider] / metrics.tokenUsage.total) * 100
      };
    });
    
    return comparison;
  }
  
  /**
   * Estimate tokens from text
   */
  private estimateTokens(text: string): number {
    // Rough estimation: 4 characters per token
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Export metrics for external analysis
   */
  async exportMetrics(startTime: number, endTime: number): Promise<RequestMetrics[]> {
    const pattern = 'metrics:request:*';
    const keys = await this.redis.keys(pattern);
    const metrics: RequestMetrics[] = [];
    
    for (const key of keys) {
      const data = await this.redis.get(key);
      if (data) {
        const metric: RequestMetrics = JSON.parse(data);
        if (metric.timestamp >= startTime && metric.timestamp <= endTime) {
          metrics.push(metric);
        }
      }
    }
    
    return metrics.sort((a, b) => a.timestamp - b.timestamp);
  }
  
  /**
   * Clean up old metrics
   */
  async cleanupMetrics(): Promise<number> {
    const cutoff = Date.now() - (this.METRICS_RETENTION * 1000);
    const pattern = 'metrics:request:*';
    const keys = await this.redis.keys(pattern);
    
    let cleaned = 0;
    for (const key of keys) {
      const timestamp = parseInt(key.split(':')[2]);
      if (timestamp < cutoff) {
        await this.redis.del(key);
        cleaned++;
      }
    }
    
    console.log(`Cleaned up ${cleaned} old metric entries`);
    return cleaned;
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