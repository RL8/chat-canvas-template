/**
 * Enhanced model management with LLM Gateway integration
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AgentState } from "./state";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { LLMGateway } from "./services/llmGateway";
import { ModelRouter } from "./services/modelRouter";
import { FeatureFlags } from "./features/featureFlags";
import { config } from "./config/appConfig";

// Global instances
let llmGateway: LLMGateway | null = null;
let modelRouter: ModelRouter | null = null;
let featureFlags: FeatureFlags | null = null;

/**
 * Initialize enhanced model services
 */
export async function initializeModelServices(): Promise<void> {
  if (!llmGateway) {
    llmGateway = new LLMGateway();
    console.log('LLM Gateway initialized');
  }
  
  if (!modelRouter) {
    modelRouter = new ModelRouter(llmGateway);
    console.log('Model Router initialized');
  }
  
  if (!featureFlags) {
    featureFlags = new FeatureFlags();
    await featureFlags.initialize();
    console.log('Feature Flags initialized');
  }
}

/**
 * Get model with enhanced routing and fallback
 */
async function getModel(state: AgentState, task?: string, input?: string): Promise<BaseChatModel> {
  await initializeModelServices();
  
  const appConfig = config();
  const useModelRouting = await featureFlags!.isEnabled('enable_model_routing', state.userId);
  
  if (useModelRouting && task && input && modelRouter) {
    try {
      const selection = modelRouter.selectModel(task, input, []);
      if (selection) {
        console.log(`Smart model selection: ${selection.provider.name}:${selection.provider.model} - ${selection.reasoning}`);
        return selection.provider.instance;
      }
    } catch (error) {
      console.warn('Model routing failed, falling back to legacy selection:', error);
    }
  }
  
  // Legacy model selection with fallback support
  const stateModel = state.model;
  const model = process.env.MODEL || stateModel;

  console.log(`Using model: ${model}`);

  if (model === "openai") {
    return new ChatOpenAI({ 
      temperature: appConfig.llm.temperature, 
      modelName: "gpt-4o",
      maxTokens: Math.min(4000, appConfig.llm.maxTokens)
    });
  }
  if (model === "anthropic") {
    return new ChatAnthropic({
      temperature: appConfig.llm.temperature,
      modelName: "claude-3-5-sonnet-20240620",
      maxTokens: Math.min(4000, appConfig.llm.maxTokens)
    });
  }
  if (model === "google_genai") {
    return new ChatGoogleGenerativeAI({
      temperature: appConfig.llm.temperature,
      model: "gemini-1.5-pro",
      apiKey: process.env.GOOGLE_API_KEY || undefined,
    });
  }

  throw new Error("Invalid model specified");
}

/**
 * Get LLM Gateway instance
 */
export function getLLMGateway(): LLMGateway | null {
  return llmGateway;
}

/**
 * Get Model Router instance
 */
export function getModelRouter(): ModelRouter | null {
  return modelRouter;
}

/**
 * Enhanced model call with gateway integration
 */
export async function callModelWithGateway(
  messages: any[], 
  task: string = 'general',
  userId?: string
): Promise<any> {
  await initializeModelServices();
  
  const useProviderFallback = await featureFlags!.isEnabled('enable_provider_fallback', userId);
  
  if (useProviderFallback && llmGateway) {
    try {
      const response = await llmGateway.generateResponse(messages);
      console.log(`LLM Gateway response: ${response.provider}:${response.model} - ${response.duration}ms, $${response.cost.toFixed(4)}`);
      return {
        content: response.content,
        metadata: {
          provider: response.provider,
          model: response.model,
          tokensUsed: response.tokensUsed,
          cost: response.cost,
          duration: response.duration
        }
      };
    } catch (error) {
      console.error('LLM Gateway failed, falling back to legacy model:', error);
      // Continue to legacy fallback
    }
  }
  
  // Legacy model fallback
  const legacyModel = await getModel({ model: 'openai' } as AgentState, task);
  const response = await legacyModel.invoke(messages);
  
  return {
    content: response.content,
    metadata: {
      provider: 'legacy',
      model: 'unknown',
      tokensUsed: 0,
      cost: 0,
      duration: 0
    }
  };
}

export { getModel };
