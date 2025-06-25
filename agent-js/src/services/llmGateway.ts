import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseMessage } from "@langchain/core/messages";

export interface LLMProvider {
  name: string;
  model: string;
  priority: number;
  instance: BaseChatModel;
  maxTokens: number;
  costPerToken: number;
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed: number;
  cost: number;
  duration: number;
}

export class LLMGateway {
  private providers: LLMProvider[] = [];
  private healthStatus: Map<string, boolean> = new Map();
  private lastHealthCheck: Map<string, number> = new Map();
  private readonly HEALTH_CHECK_INTERVAL = 300000; // 5 minutes
  
  constructor() {
    this.initializeProviders();
  }
  
  private initializeProviders() {
    // Primary: OpenAI GPT-4
    if (process.env.OPENAI_API_KEY) {
      this.providers.push({
        name: 'openai',
        model: 'gpt-4o',
        priority: 1,
        instance: new ChatOpenAI({ 
          temperature: 0, 
          modelName: "gpt-4o",
          maxTokens: 4000 
        }),
        maxTokens: 30000,
        costPerToken: 0.00003 // $30/1M tokens
      });
      
      // Fallback: OpenAI GPT-3.5
      this.providers.push({
        name: 'openai',
        model: 'gpt-3.5-turbo',
        priority: 3,
        instance: new ChatOpenAI({ 
          temperature: 0, 
          modelName: "gpt-3.5-turbo",
          maxTokens: 4000 
        }),
        maxTokens: 16000,
        costPerToken: 0.000002 // $2/1M tokens
      });
    }
    
    // Secondary: Anthropic Claude
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.push({
        name: 'anthropic',
        model: 'claude-3-5-sonnet-20240620',
        priority: 2,
        instance: new ChatAnthropic({
          temperature: 0,
          modelName: "claude-3-5-sonnet-20240620",
          maxTokens: 4000
        }),
        maxTokens: 200000,
        costPerToken: 0.000015 // $15/1M tokens
      });
    }
    
    // Tertiary: Google Gemini
    if (process.env.GOOGLE_API_KEY) {
      this.providers.push({
        name: 'google',
        model: 'gemini-1.5-pro',
        priority: 4,
        instance: new ChatGoogleGenerativeAI({
          temperature: 0,
          model: "gemini-1.5-pro",
          apiKey: process.env.GOOGLE_API_KEY
        }),
        maxTokens: 1000000,
        costPerToken: 0.0000075 // $7.5/1M tokens
      });
    }
    
    // Sort by priority
    this.providers.sort((a, b) => a.priority - b.priority);
    
    // Initialize health status
    this.providers.forEach(provider => {
      this.healthStatus.set(`${provider.name}-${provider.model}`, true);
      this.lastHealthCheck.set(`${provider.name}-${provider.model}`, 0);
    });
  }
  
  /**
   * Generate response with automatic fallback
   */
  async generateResponse(
    messages: BaseMessage[], 
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<LLMResponse> {
    const sortedProviders = this.getAvailableProviders();
    
    for (const provider of sortedProviders) {
      try {
        console.log(`Attempting to use ${provider.name}:${provider.model}`);
        
        const startTime = Date.now();
        const response = await this.callProvider(provider, messages, options);
        const duration = Date.now() - startTime;
        
        // Mark provider as healthy
        this.healthStatus.set(`${provider.name}-${provider.model}`, true);
        
        return {
          content: response.content as string,
          provider: provider.name,
          model: provider.model,
          tokensUsed: this.estimateTokensUsed(messages, response.content as string),
          cost: this.calculateCost(provider, messages, response.content as string),
          duration
        };
        
      } catch (error) {
        console.warn(`Provider ${provider.name}:${provider.model} failed:`, error);
        
        // Mark provider as unhealthy
        this.healthStatus.set(`${provider.name}-${provider.model}`, false);
        this.lastHealthCheck.set(`${provider.name}-${provider.model}`, Date.now());
        
        // Continue to next provider
        continue;
      }
    }
    
    throw new Error('All LLM providers failed');
  }
  
  /**
   * Call specific provider
   */
  private async callProvider(
    provider: LLMProvider, 
    messages: BaseMessage[], 
    options: { maxTokens?: number; temperature?: number }
  ) {
    // Update provider instance with options
    if (options.maxTokens) {
      if (provider.instance instanceof ChatOpenAI) {
        provider.instance.maxTokens = Math.min(options.maxTokens, provider.maxTokens);
      }
    }
    
    if (options.temperature !== undefined) {
      provider.instance.temperature = options.temperature;
    }
    
    return await provider.instance.invoke(messages);
  }
  
  /**
   * Get available providers sorted by priority and health
   */
  private getAvailableProviders(): LLMProvider[] {
    const now = Date.now();
    
    return this.providers.filter(provider => {
      const key = `${provider.name}-${provider.model}`;
      const isHealthy = this.healthStatus.get(key);
      const lastCheck = this.lastHealthCheck.get(key) || 0;
      
      // Re-enable provider after health check interval
      if (!isHealthy && (now - lastCheck) > this.HEALTH_CHECK_INTERVAL) {
        this.healthStatus.set(key, true);
        return true;
      }
      
      return isHealthy;
    });
  }
  
  /**
   * Estimate tokens used in conversation
   */
  private estimateTokensUsed(messages: BaseMessage[], response: string): number {
    const messageText = messages.map(m => m.content).join(' ');
    const totalText = messageText + response;
    
    // Rough estimation: 4 characters per token
    return Math.ceil(totalText.length / 4);
  }
  
  /**
   * Calculate cost for the conversation
   */
  private calculateCost(provider: LLMProvider, messages: BaseMessage[], response: string): number {
    const tokensUsed = this.estimateTokensUsed(messages, response);
    return tokensUsed * provider.costPerToken;
  }
  
  /**
   * Get provider health status
   */
  getProviderHealth(): Record<string, boolean> {
    const health: Record<string, boolean> = {};
    this.providers.forEach(provider => {
      const key = `${provider.name}-${provider.model}`;
      health[key] = this.healthStatus.get(key) || false;
    });
    return health;
  }
  
  /**
   * Get best provider for specific task
   */
  getBestProvider(task: 'summarization' | 'search' | 'writing' | 'analysis'): LLMProvider | null {
    const available = this.getAvailableProviders();
    
    if (available.length === 0) return null;
    
    // Task-specific provider selection
    switch (task) {
      case 'search':
        // Use cheapest available for search queries
        return available.sort((a, b) => a.costPerToken - b.costPerToken)[0];
      
      case 'analysis':
        // Use most capable for analysis
        return available.find(p => p.model.includes('gpt-4') || p.model.includes('claude-3')) || available[0];
      
      case 'summarization':
        // Use balanced option
        return available.find(p => p.model.includes('gpt-3.5') || p.model.includes('claude')) || available[0];
      
      case 'writing':
        // Use high-quality model
        return available.find(p => p.model.includes('gpt-4') || p.model.includes('claude-3')) || available[0];
      
      default:
        return available[0];
    }
  }
} 