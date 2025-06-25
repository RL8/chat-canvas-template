import { LLMGateway, LLMProvider } from './llmGateway';
import { TokenValidator } from '../utils/tokenValidator';

export interface TaskAnalysis {
  complexity: 'low' | 'medium' | 'high';
  taskType: 'summarization' | 'search' | 'writing' | 'analysis' | 'general';
  estimatedTokens: number;
  estimatedCost: number;
  recommendedModel: string;
  reasoning: string;
}

export interface ModelSelection {
  provider: LLMProvider;
  reasoning: string;
  estimatedCost: number;
  fallbackOptions: LLMProvider[];
}

export class ModelRouter {
  private llmGateway: LLMGateway;
  private tokenValidator: TokenValidator;
  
  constructor(llmGateway: LLMGateway) {
    this.llmGateway = llmGateway;
    this.tokenValidator = new TokenValidator();
  }
  
  /**
   * Select optimal model for task
   */
  selectModel(task: string, input: string, context?: string[]): ModelSelection | null {
    const analysis = this.analyzeTask(task, input, context);
    const provider = this.getBestProviderForTask(analysis);
    
    if (!provider) {
      return null;
    }
    
    const fallbacks = this.getFallbackOptions(provider, analysis);
    
    return {
      provider,
      reasoning: `Selected ${provider.name}:${provider.model} for ${analysis.taskType} task with ${analysis.complexity} complexity. ${analysis.reasoning}`,
      estimatedCost: analysis.estimatedCost,
      fallbackOptions: fallbacks
    };
  }
  
  /**
   * Analyze task to determine complexity and requirements
   */
  analyzeTask(task: string, input: string, context?: string[]): TaskAnalysis {
    const taskType = this.identifyTaskType(task, input);
    const complexity = this.estimateComplexity(input, taskType, context);
    const estimatedTokens = this.tokenValidator.estimateTokens(input + (context?.join(' ') || ''));
    
    const analysis: TaskAnalysis = {
      complexity,
      taskType,
      estimatedTokens,
      estimatedCost: 0, // Will be calculated based on selected model
      recommendedModel: '',
      reasoning: ''
    };
    
    // Generate recommendation and reasoning
    const recommendation = this.generateRecommendation(analysis);
    analysis.recommendedModel = recommendation.model;
    analysis.reasoning = recommendation.reasoning;
    analysis.estimatedCost = recommendation.cost;
    
    return analysis;
  }
  
  /**
   * Identify task type from input
   */
  private identifyTaskType(task: string, input: string): TaskAnalysis['taskType'] {
    const taskLower = task.toLowerCase();
    const inputLower = input.toLowerCase();
    
    // Search-related keywords
    if (taskLower.includes('search') || taskLower.includes('find') || 
        inputLower.includes('search for') || inputLower.includes('find information')) {
      return 'search';
    }
    
    // Writing-related keywords
    if (taskLower.includes('write') || taskLower.includes('create') ||
        taskLower.includes('generate') || inputLower.includes('write a')) {
      return 'writing';
    }
    
    // Analysis-related keywords
    if (taskLower.includes('analyze') || taskLower.includes('analysis') ||
        taskLower.includes('compare') || inputLower.includes('what does this mean')) {
      return 'analysis';
    }
    
    // Summarization keywords
    if (taskLower.includes('summary') || taskLower.includes('summarize') ||
        inputLower.includes('summarize') || inputLower.includes('brief overview')) {
      return 'summarization';
    }
    
    return 'general';
  }
  
  /**
   * Estimate complexity based on various factors
   */
  private estimateComplexity(
    input: string, 
    taskType: TaskAnalysis['taskType'], 
    context?: string[]
  ): TaskAnalysis['complexity'] {
    let complexityScore = 0;
    
    // Input length factor
    const inputLength = input.length;
    if (inputLength < 200) complexityScore += 1;
    else if (inputLength < 1000) complexityScore += 2;
    else complexityScore += 3;
    
    // Context factor
    const contextLength = context?.join(' ').length || 0;
    if (contextLength > 2000) complexityScore += 2;
    else if (contextLength > 500) complexityScore += 1;
    
    // Task type factor
    switch (taskType) {
      case 'search':
        complexityScore += 1; // Search queries are usually simple
        break;
      case 'summarization':
        complexityScore += 2; // Moderate complexity
        break;
      case 'writing':
        complexityScore += 3; // Often requires creativity
        break;
      case 'analysis':
        complexityScore += 4; // Usually most complex
        break;
      default:
        complexityScore += 2;
    }
    
    // Complexity indicators in text
    const complexPatterns = [
      /\b(analyze|analysis|compare|contrast|evaluate)\b/i,
      /\b(complex|complicated|intricate|sophisticated)\b/i,
      /\b(multiple|various|several|different)\b/i,
      /\b(detailed|comprehensive|thorough|in-depth)\b/i
    ];
    
    const patternMatches = complexPatterns.reduce((count, pattern) => {
      return count + (pattern.test(input) ? 1 : 0);
    }, 0);
    
    complexityScore += patternMatches;
    
    // Return complexity level
    if (complexityScore <= 4) return 'low';
    if (complexityScore <= 7) return 'medium';
    return 'high';
  }
  
  /**
   * Generate model recommendation based on analysis
   */
  private generateRecommendation(analysis: TaskAnalysis): {
    model: string;
    reasoning: string;
    cost: number;
  } {
    let model = '';
    let reasoning = '';
    let costMultiplier = 1;
    
    switch (analysis.taskType) {
      case 'search':
        model = analysis.complexity === 'low' ? 'gpt-3.5-turbo' : 'gpt-4o';
        reasoning = 'Search queries benefit from fast, cost-effective models';
        costMultiplier = analysis.complexity === 'low' ? 0.1 : 0.5;
        break;
        
      case 'summarization':
        if (analysis.complexity === 'low') {
          model = 'gpt-3.5-turbo';
          reasoning = 'Simple summarization works well with GPT-3.5';
          costMultiplier = 0.2;
        } else {
          model = 'claude-3-5-sonnet-20240620';
          reasoning = 'Complex summarization benefits from Claude\'s comprehension';
          costMultiplier = 0.3;
        }
        break;
        
      case 'writing':
        if (analysis.complexity === 'high') {
          model = 'gpt-4o';
          reasoning = 'High-quality writing requires GPT-4\'s creativity';
          costMultiplier = 0.8;
        } else {
          model = 'claude-3-5-sonnet-20240620';
          reasoning = 'Claude excels at structured writing tasks';
          costMultiplier = 0.4;
        }
        break;
        
      case 'analysis':
        model = analysis.complexity === 'high' ? 'gpt-4o' : 'claude-3-5-sonnet-20240620';
        reasoning = 'Analysis tasks require the most capable models';
        costMultiplier = 0.9;
        break;
        
      default:
        model = analysis.complexity === 'low' ? 'gpt-3.5-turbo' : 'gpt-4o';
        reasoning = 'General tasks use balanced model selection';
        costMultiplier = 0.5;
    }
    
    const estimatedCost = analysis.estimatedTokens * 0.00002 * costMultiplier; // Rough cost estimate
    
    return { model, reasoning, cost: estimatedCost };
  }
  
  /**
   * Get best provider for analyzed task
   */
  private getBestProviderForTask(analysis: TaskAnalysis): LLMProvider | null {
    const availableProviders = this.llmGateway.getAvailableProviders();
    
    if (availableProviders.length === 0) {
      return null;
    }
    
    // Find provider with the recommended model
    const preferred = availableProviders.find(p => 
      p.model === analysis.recommendedModel
    );
    
    if (preferred) {
      return preferred;
    }
    
    // Fallback to task-specific selection
    switch (analysis.taskType) {
      case 'search':
        // Use cheapest available
        return availableProviders.sort((a, b) => a.costPerToken - b.costPerToken)[0];
        
      case 'analysis':
        // Use most capable
        return availableProviders.find(p => 
          p.model.includes('gpt-4') || p.model.includes('claude-3')
        ) || availableProviders[0];
        
      case 'writing':
        // Prefer GPT-4 or Claude for creativity
        return availableProviders.find(p => 
          p.model.includes('gpt-4') || p.model.includes('claude')
        ) || availableProviders[0];
        
      case 'summarization':
        // Use balanced option
        return availableProviders.find(p => 
          p.model.includes('claude') || p.model.includes('gpt-3.5')
        ) || availableProviders[0];
        
      default:
        return availableProviders[0];
    }
  }
  
  /**
   * Get fallback options for selected provider
   */
  private getFallbackOptions(
    selected: LLMProvider, 
    analysis: TaskAnalysis
  ): LLMProvider[] {
    const availableProviders = this.llmGateway.getAvailableProviders();
    
    return availableProviders
      .filter(p => p !== selected)
      .sort((a, b) => {
        // Sort by suitability for task
        const suitabilityA = this.calculateSuitability(a, analysis);
        const suitabilityB = this.calculateSuitability(b, analysis);
        return suitabilityB - suitabilityA;
      })
      .slice(0, 2); // Return top 2 fallback options
  }
  
  /**
   * Calculate provider suitability score
   */
  private calculateSuitability(provider: LLMProvider, analysis: TaskAnalysis): number {
    let score = 0;
    
    // Base capability score
    if (provider.model.includes('gpt-4')) score += 5;
    else if (provider.model.includes('claude-3')) score += 4;
    else if (provider.model.includes('gpt-3.5')) score += 3;
    else score += 2;
    
    // Task-specific bonuses
    switch (analysis.taskType) {
      case 'search':
        if (provider.costPerToken < 0.00001) score += 3; // Prefer cheap models
        break;
      case 'analysis':
        if (provider.model.includes('gpt-4') || provider.model.includes('claude-3')) score += 3;
        break;
      case 'writing':
        if (provider.model.includes('gpt-4')) score += 2;
        if (provider.model.includes('claude')) score += 2;
        break;
    }
    
    // Complexity adjustments
    if (analysis.complexity === 'high' && provider.maxTokens > 50000) score += 2;
    if (analysis.complexity === 'low' && provider.costPerToken < 0.00001) score += 1;
    
    return score;
  }
  
  /**
   * Get model recommendations for common scenarios
   */
  getRecommendationsForScenario(scenario: string): {
    primary: string;
    fallback: string;
    reasoning: string;
  } {
    const scenarios: Record<string, any> = {
      'research_query': {
        primary: 'gpt-3.5-turbo',
        fallback: 'gpt-4o',
        reasoning: 'Fast, cost-effective for search queries with high-quality fallback'
      },
      'report_writing': {
        primary: 'gpt-4o',
        fallback: 'claude-3-5-sonnet-20240620',
        reasoning: 'High-quality writing with structured thinking fallback'
      },
      'data_analysis': {
        primary: 'claude-3-5-sonnet-20240620',
        fallback: 'gpt-4o',
        reasoning: 'Excellent analytical capabilities with creative problem-solving fallback'
      },
      'quick_summary': {
        primary: 'gpt-3.5-turbo',
        fallback: 'claude-3-5-sonnet-20240620',
        reasoning: 'Fast summarization with quality enhancement option'
      }
    };
    
    return scenarios[scenario] || scenarios['research_query'];
  }
} 