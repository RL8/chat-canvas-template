import { createClient, RedisClientType } from 'redis';
import { AgentState } from '../state';
import { BaseMessage, SystemMessage } from '@langchain/core/messages';

export interface ConversationCheckpoint {
  state: AgentState;
  timestamp: number;
  tools: string[];
  context: BaseMessage[];
  metadata: {
    version: string;
    modelUsed: string;
    totalTokens: number;
  };
}

export class ConversationManager {
  private redis: RedisClientType;
  private readonly CHECKPOINT_TTL = 3600; // 1 hour
  private readonly MAX_CHECKPOINTS = 10;
  
  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    this.redis.on('error', (err: any) => {
      console.error('Redis client error:', err);
    });
    
    this.redis.on('connect', () => {
      console.log('Connected to Redis');
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
   * Save conversation checkpoint
   */
  async saveCheckpoint(threadId: string, state: AgentState): Promise<void> {
    try {
      await this.initialize();
      
      const checkpoint: ConversationCheckpoint = {
        state,
        timestamp: Date.now(),
        tools: this.extractAvailableTools(state),
        context: state.messages?.slice(-10) || [], // Keep recent context
        metadata: {
          version: '1.0',
          modelUsed: state.model || 'unknown',
          totalTokens: this.estimateStateTokens(state)
        }
      };
      
      const checkpointKey = `checkpoint:${threadId}:${Date.now()}`;
      
      // Save checkpoint
      await this.redis.setEx(
        checkpointKey, 
        this.CHECKPOINT_TTL, 
        JSON.stringify(checkpoint)
      );
      
      // Update latest checkpoint reference
      await this.redis.setEx(
        `latest:${threadId}`, 
        this.CHECKPOINT_TTL, 
        checkpointKey
      );
      
      // Cleanup old checkpoints
      await this.cleanupOldCheckpoints(threadId);
      
      console.log(`Checkpoint saved for thread ${threadId}`);
      
    } catch (error) {
      console.error('Failed to save checkpoint:', error);
      // Don't throw - this shouldn't break the main flow
    }
  }
  
  /**
   * Recover from error using last checkpoint
   */
  async recoverFromError(threadId: string, error: Error): Promise<AgentState | null> {
    try {
      await this.initialize();
      
      const checkpoint = await this.getLastCheckpoint(threadId);
      if (!checkpoint) {
        console.log('No checkpoint found for recovery');
        return null;
      }
      
      console.log(`Recovering from error using checkpoint from ${new Date(checkpoint.timestamp)}`);
      
      // Create recovered state with error context
      const recoveredState: AgentState = {
        ...checkpoint.state,
        messages: [
          ...checkpoint.context,
          new SystemMessage(`Recovered from error: ${error.message}. Continuing conversation...`)
        ]
      };
      
      // Log recovery
      await this.logRecovery(threadId, error, checkpoint.timestamp);
      
      return recoveredState;
      
    } catch (recoveryError) {
      console.error('Failed to recover from error:', recoveryError);
      return null;
    }
  }
  
  /**
   * Get the last checkpoint for a thread
   */
  async getLastCheckpoint(threadId: string): Promise<ConversationCheckpoint | null> {
    try {
      await this.initialize();
      
      const latestKey = await this.redis.get(`latest:${threadId}`);
      if (!latestKey) return null;
      
      const checkpointData = await this.redis.get(latestKey);
      if (!checkpointData) return null;
      
      return JSON.parse(checkpointData) as ConversationCheckpoint;
      
    } catch (error) {
      console.error('Failed to get checkpoint:', error);
      return null;
    }
  }
  
  /**
   * Create fresh state for new conversations
   */
  createFreshState(): AgentState {
    return {
      model: process.env.DEFAULT_MODEL || 'openai',
      research_question: '',
      report: '',
      resources: [],
      logs: [],
      messages: []
    };
  }
  
  /**
   * Get conversation history
   */
  async getConversationHistory(threadId: string): Promise<ConversationCheckpoint[]> {
    try {
      await this.initialize();
      
      const pattern = `checkpoint:${threadId}:*`;
      const keys = await this.redis.keys(pattern);
      
      const checkpoints: ConversationCheckpoint[] = [];
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          checkpoints.push(JSON.parse(data));
        }
      }
      
      return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
      
    } catch (error) {
      console.error('Failed to get conversation history:', error);
      return [];
    }
  }
  
  /**
   * Clean up old checkpoints
   */
  private async cleanupOldCheckpoints(threadId: string): Promise<void> {
    try {
      const pattern = `checkpoint:${threadId}:*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > this.MAX_CHECKPOINTS) {
        // Sort by timestamp (extracted from key)
        const sortedKeys = keys.sort((a: string, b: string) => {
          const timestampA = parseInt(a.split(':')[2]);
          const timestampB = parseInt(b.split(':')[2]);
          return timestampB - timestampA;
        });
        
        // Delete oldest checkpoints
        const keysToDelete = sortedKeys.slice(this.MAX_CHECKPOINTS);
        if (keysToDelete.length > 0) {
          await this.redis.del(keysToDelete);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup old checkpoints:', error);
    }
  }
  
  /**
   * Extract available tools from state
   */
  private extractAvailableTools(state: AgentState): string[] {
    // This would be enhanced based on actual tool availability
    return ['Search', 'WriteReport', 'WriteResearchQuestion', 'DeleteResources'];
  }
  
  /**
   * Estimate token count for state
   */
  private estimateStateTokens(state: AgentState): number {
    const content = [
      state.research_question || '',
      state.report || '',
      ...(state.resources?.map((r: any) => r.content || '') || []),
      ...(state.messages?.map((m: any) => m.content || '') || [])
    ].join(' ');
    
    return Math.ceil(content.length / 4); // Rough estimation
  }
  
  /**
   * Log recovery events
   */
  private async logRecovery(threadId: string, error: Error, checkpointTimestamp: number): Promise<void> {
    try {
      const recoveryLog = {
        threadId,
        error: error.message,
        checkpointTimestamp,
        recoveryTimestamp: Date.now(),
        stack: error.stack
      };
      
      await this.redis.lPush(
        'recovery_logs', 
        JSON.stringify(recoveryLog)
      );
      
      // Keep only last 100 recovery logs
      await this.redis.lTrim('recovery_logs', 0, 99);
      
    } catch (logError) {
      console.error('Failed to log recovery:', logError);
    }
  }
  
  /**
   * Get recovery statistics
   */
  async getRecoveryStats(): Promise<{ totalRecoveries: number; recentRecoveries: any[] }> {
    try {
      await this.initialize();
      
      const logs = await this.redis.lRange('recovery_logs', 0, -1);
      const recentRecoveries = logs.slice(0, 10).map((log: string) => JSON.parse(log));
      
      return {
        totalRecoveries: logs.length,
        recentRecoveries
      };
      
    } catch (error) {
      console.error('Failed to get recovery stats:', error);
      return { totalRecoveries: 0, recentRecoveries: [] };
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