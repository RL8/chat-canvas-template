import { encode } from 'gpt-3-encoder';

export interface TokenValidationResult {
  isValid: boolean;
  tokenCount: number;
  chunks: string[];
  warnings: string[];
}

export class TokenValidator {
  private readonly MAX_TOKENS = 28000; // Safety buffer
  private readonly OVERLAP_TOKENS = 500; // Context overlap between chunks
  
  /**
   * Validate content and context for token limits
   */
  validateAndChunk(content: string, context: string[] = []): TokenValidationResult {
    const fullText = content + '\n' + context.join('\n');
    const totalTokens = this.estimateTokens(fullText);
    
    const result: TokenValidationResult = {
      isValid: totalTokens <= this.MAX_TOKENS,
      tokenCount: totalTokens,
      chunks: [],
      warnings: []
    };
    
    if (result.isValid) {
      result.chunks = [content];
      return result;
    }
    
    // Need to chunk the content
    result.warnings.push(`Content exceeds ${this.MAX_TOKENS} tokens (${totalTokens}). Chunking required.`);
    result.chunks = this.intelligentChunk(content, context);
    
    return result;
  }
  
  /**
   * Estimate token count using GPT-3 encoder
   */
  estimateTokens(text: string): number {
    try {
      return encode(text).length;
    } catch (error) {
      // Fallback: rough estimation (4 chars per token)
      return Math.ceil(text.length / 4);
    }
  }
  
  /**
   * Smart chunking that preserves context and logical boundaries
   */
  private intelligentChunk(content: string, context: string[]): string[] {
    const contextText = context.join('\n');
    const contextTokens = this.estimateTokens(contextText);
    const availableTokens = this.MAX_TOKENS - contextTokens - this.OVERLAP_TOKENS;
    
    if (availableTokens <= 0) {
      throw new Error('Context too large, cannot chunk effectively');
    }
    
    const chunks: string[] = [];
    const paragraphs = content.split('\n\n');
    let currentChunk = '';
    let currentTokens = 0;
    
    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph);
      
      // If single paragraph exceeds limit, force split
      if (paragraphTokens > availableTokens) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
          currentTokens = 0;
        }
        
        // Split large paragraph by sentences
        const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim());
        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokens(sentence);
          
          if (currentTokens + sentenceTokens > availableTokens) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence + '.';
            currentTokens = sentenceTokens;
          } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence + '.';
            currentTokens += sentenceTokens;
          }
        }
      } else {
        // Check if adding this paragraph would exceed limit
        if (currentTokens + paragraphTokens > availableTokens) {
          chunks.push(currentChunk.trim());
          currentChunk = paragraph;
          currentTokens = paragraphTokens;
        } else {
          currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
          currentTokens += paragraphTokens;
        }
      }
    }
    
    // Add final chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks.length > 0 ? chunks : [content]; // Fallback
  }
  
  /**
   * Create overlapping context for chunk continuity
   */
  createOverlapContext(previousChunk: string, nextChunk: string): string {
    const prevTokens = this.estimateTokens(previousChunk);
    const overlapSize = Math.min(this.OVERLAP_TOKENS, Math.floor(prevTokens * 0.1));
    
    // Take last few sentences from previous chunk
    const sentences = previousChunk.split(/[.!?]+/).filter(s => s.trim());
    const lastSentences = sentences.slice(-3).join('. ') + '.';
    
    return `Previous context: ${lastSentences}\n\nCurrent section: ${nextChunk}`;
  }
  
  /**
   * Validate if a message fits within token limits
   */
  validateMessage(message: string, systemPrompt: string = ''): boolean {
    const totalTokens = this.estimateTokens(message + systemPrompt);
    return totalTokens <= this.MAX_TOKENS;
  }
} 