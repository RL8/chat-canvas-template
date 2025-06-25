export interface ValidationResult {
  isValid: boolean;
  issues: string[];
  sanitized: string;
  severity: 'low' | 'medium' | 'high';
  blocked: boolean;
}

export interface ContentIssue {
  type: 'prompt_injection' | 'toxicity' | 'pii' | 'length' | 'encoding';
  severity: 'low' | 'medium' | 'high';
  description: string;
  position?: number;
}

export class SafetyFilter {
  private readonly MAX_INPUT_LENGTH = 10000;
  private readonly PII_PATTERNS = [
    /\b\d{3}-\d{2}-\d{4}\b/g, // SSN
    /\b\d{16}\b/g, // Credit card
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
    /\b\d{3}-\d{3}-\d{4}\b/g, // Phone
  ];
  
  private readonly INJECTION_PATTERNS = [
    /ignore\s+(previous|all)\s+instructions/i,
    /you\s+are\s+now\s+a\s+different/i,
    /pretend\s+to\s+be/i,
    /system\s*:\s*forget/i,
    /\\x[0-9a-f]{2}/i, // Hex encoding
    /<script|javascript:|data:/i,
    /\{\{.*\}\}/g, // Template injection
  ];
  
  private readonly TOXIC_KEYWORDS = [
    'hate', 'violence', 'harm', 'illegal', 'exploit',
    'discriminat', 'threat', 'harass', 'abuse'
  ];
  
  /**
   * Validate and sanitize input
   */
  async validateInput(input: string): Promise<ValidationResult> {
    const issues: ContentIssue[] = [];
    let sanitized = input;
    let blocked = false;
    
    // Check input length
    if (input.length > this.MAX_INPUT_LENGTH) {
      issues.push({
        type: 'length',
        severity: 'medium',
        description: `Input exceeds maximum length of ${this.MAX_INPUT_LENGTH} characters`
      });
      sanitized = input.substring(0, this.MAX_INPUT_LENGTH);
    }
    
    // Check for prompt injection
    const injectionIssues = await this.checkPromptInjection(input);
    issues.push(...injectionIssues);
    
    // Check for toxicity
    const toxicityIssues = await this.checkToxicity(input);
    issues.push(...toxicityIssues);
    
    // Check for PII
    const piiIssues = this.checkPII(input);
    issues.push(...piiIssues);
    
    // Check encoding issues
    const encodingIssues = this.checkEncoding(input);
    issues.push(...encodingIssues);
    
    // Determine if input should be blocked
    blocked = issues.some(issue => 
      issue.severity === 'high' || 
      (issue.type === 'prompt_injection' && issue.severity === 'medium')
    );
    
    // Apply sanitization
    if (!blocked) {
      sanitized = this.sanitizeInput(sanitized, issues);
    }
    
    const severity = this.calculateOverallSeverity(issues);
    
    return {
      isValid: !blocked && issues.length === 0,
      issues: issues.map(issue => `${issue.type}: ${issue.description}`),
      sanitized: blocked ? '' : sanitized,
      severity,
      blocked
    };
  }
  
  /**
   * Validate output before sending to user
   */
  async validateOutput(output: string): Promise<string> {
    // Check for toxicity in output
    if (await this.containsToxicity(output)) {
      return "I apologize, but I can't provide that response. Let me try again with a different approach.";
    }
    
    // Check for PII in output
    if (this.containsPII(output)) {
      return this.redactPII(output);
    }
    
    // Check for system information leakage
    if (this.containsSystemInfo(output)) {
      return this.redactSystemInfo(output);
    }
    
    return output;
  }
  
  /**
   * Check for prompt injection attempts
   */
  private async checkPromptInjection(input: string): Promise<ContentIssue[]> {
    const issues: ContentIssue[] = [];
    
    for (const pattern of this.INJECTION_PATTERNS) {
      const match = pattern.exec(input);
      if (match) {
        issues.push({
          type: 'prompt_injection',
          severity: 'high',
          description: 'Potential prompt injection detected',
          position: match.index
        });
      }
    }
    
    // Check for role confusion attempts
    if (/assistant\s*:\s*|system\s*:\s*|user\s*:\s*/i.test(input)) {
      issues.push({
        type: 'prompt_injection',
        severity: 'medium',
        description: 'Role confusion attempt detected'
      });
    }
    
    // Check for instruction manipulation
    if (/forget|ignore|bypass|override/i.test(input) && 
        /instruction|rule|guideline|prompt/i.test(input)) {
      issues.push({
        type: 'prompt_injection',
        severity: 'high',
        description: 'Instruction manipulation attempt detected'
      });
    }
    
    return issues;
  }
  
  /**
   * Check for toxic content
   */
  private async checkToxicity(input: string): Promise<ContentIssue[]> {
    const issues: ContentIssue[] = [];
    const inputLower = input.toLowerCase();
    
    // Simple keyword-based toxicity detection
    for (const keyword of this.TOXIC_KEYWORDS) {
      if (inputLower.includes(keyword)) {
        issues.push({
          type: 'toxicity',
          severity: 'medium',
          description: `Potentially toxic content detected: ${keyword}`
        });
      }
    }
    
    // Check for excessive profanity (simplified)
    const profanityCount = (inputLower.match(/\b(damn|hell|shit|fuck|bitch)\b/g) || []).length;
    if (profanityCount > 3) {
      issues.push({
        type: 'toxicity',
        severity: 'medium',
        description: 'High profanity content detected'
      });
    }
    
    // Check for violent language
    if (/\b(kill|murder|die|death|hurt|pain|blood)\b/i.test(input) && 
        !/\b(game|movie|book|fiction|story)\b/i.test(input)) {
      issues.push({
        type: 'toxicity',
        severity: 'high',
        description: 'Violent language detected'
      });
    }
    
    return issues;
  }
  
  /**
   * Check for personally identifiable information
   */
  private checkPII(input: string): ContentIssue[] {
    const issues: ContentIssue[] = [];
    
    for (const pattern of this.PII_PATTERNS) {
      const matches = input.match(pattern);
      if (matches) {
        issues.push({
          type: 'pii',
          severity: 'medium',
          description: `PII detected: ${matches.length} instance(s)`
        });
      }
    }
    
    return issues;
  }
  
  /**
   * Check for encoding/injection attempts
   */
  private checkEncoding(input: string): ContentIssue[] {
    const issues: ContentIssue[] = [];
    
    // Check for unusual encodings
    if (/(%[0-9a-f]{2})+/i.test(input)) {
      issues.push({
        type: 'encoding',
        severity: 'medium',
        description: 'URL encoding detected'
      });
    }
    
    // Check for base64 patterns
    if (/[A-Za-z0-9+\/]{20,}={0,2}/.test(input)) {
      issues.push({
        type: 'encoding',
        severity: 'low',
        description: 'Base64 encoding detected'
      });
    }
    
    return issues;
  }
  
  /**
   * Sanitize input based on identified issues
   */
  private sanitizeInput(input: string, issues: ContentIssue[]): string {
    let sanitized = input;
    
    // Remove PII
    for (const pattern of this.PII_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    
    // Clean up excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    
    // Remove dangerous characters for injection
    sanitized = sanitized.replace(/[<>{}]/g, '');
    
    return sanitized;
  }
  
  /**
   * Check if output contains toxicity
   */
  private async containsToxicity(output: string): Promise<boolean> {
    const outputLower = output.toLowerCase();
    
    // Check for toxic keywords in output
    return this.TOXIC_KEYWORDS.some(keyword => outputLower.includes(keyword));
  }
  
  /**
   * Check if output contains PII
   */
  private containsPII(output: string): boolean {
    return this.PII_PATTERNS.some(pattern => pattern.test(output));
  }
  
  /**
   * Redact PII from output
   */
  private redactPII(output: string): string {
    let redacted = output;
    
    for (const pattern of this.PII_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    
    return redacted;
  }
  
  /**
   * Check for system information leakage
   */
  private containsSystemInfo(output: string): boolean {
    const systemPatterns = [
      /openai|anthropic|claude|gpt-/i,
      /api[_\s]?key|token|secret/i,
      /error|exception|stack[_\s]?trace/i,
      /localhost|127\.0\.0\.1|internal/i
    ];
    
    return systemPatterns.some(pattern => pattern.test(output));
  }
  
  /**
   * Redact system information from output
   */
  private redactSystemInfo(output: string): string {
    let redacted = output;
    
    // Replace system references with generic terms
    redacted = redacted.replace(/openai|gpt-\d/gi, 'the AI system');
    redacted = redacted.replace(/anthropic|claude/gi, 'the AI assistant');
    redacted = redacted.replace(/api[_\s]?key|token|secret/gi, '[SYSTEM INFO]');
    redacted = redacted.replace(/localhost|127\.0\.0\.1/gi, '[INTERNAL ADDRESS]');
    
    return redacted;
  }
  
  /**
   * Calculate overall severity from issues
   */
  private calculateOverallSeverity(issues: ContentIssue[]): 'low' | 'medium' | 'high' {
    if (issues.some(issue => issue.severity === 'high')) return 'high';
    if (issues.some(issue => issue.severity === 'medium')) return 'medium';
    return 'low';
  }
  
  /**
   * Create content filter for streaming responses
   */
  createStreamFilter(): (chunk: string) => string {
    let buffer = '';
    
    return (chunk: string) => {
      buffer += chunk;
      
      // Check buffer for issues
      if (this.containsPII(buffer) || this.containsSystemInfo(buffer)) {
        buffer = this.redactPII(this.redactSystemInfo(buffer));
      }
      
      // Return processed chunk
      const result = buffer;
      buffer = '';
      return result;
    };
  }
  
  /**
   * Validate content for research context
   */
  validateResearchContent(content: string, context: 'search' | 'report' | 'summary'): ValidationResult {
    const baseValidation = this.validateInput(content);
    
    // Research-specific validation
    const researchIssues: ContentIssue[] = [];
    
    if (context === 'search' && content.length < 10) {
      researchIssues.push({
        type: 'length',
        severity: 'low',
        description: 'Search query might be too short for effective results'
      });
    }
    
    if (context === 'report' && content.length < 100) {
      researchIssues.push({
        type: 'length',
        severity: 'low',
        description: 'Report content might be too brief'
      });
    }
    
    return {
      ...baseValidation,
      issues: [...baseValidation.issues, ...researchIssues.map(i => `${i.type}: ${i.description}`)]
    };
  }
} 