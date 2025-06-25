/**
 * Enhanced Chat Node with integrated services
 */

import { RunnableConfig } from "@langchain/core/runnables";
import { AgentState, Resource } from "./state";
import { getModel, callModelWithGateway } from "./model";
import { getResource } from "./download";
import {
  SystemMessage,
  AIMessage,
  ToolMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { copilotkitCustomizeConfig } from "@copilotkit/sdk-js/langgraph";

// Import enhanced services
import { TokenValidator } from "./utils/tokenValidator";
import { SafetyFilter } from "./validation/safetyFilter";
import { CacheManager } from "./services/cacheManager";
import { MetricsCollector } from "./monitoring/metrics";
import { ConversationManager } from "./services/conversationManager";

// Initialize services
const tokenValidator = new TokenValidator();
const safetyFilter = new SafetyFilter();
const cacheManager = new CacheManager();
const metricsCollector = new MetricsCollector();
const conversationManager = new ConversationManager();

const Search = tool(() => {}, {
  name: "Search",
  description:
    "A list of one or more search queries to find good resources to support the research.",
  schema: z.object({ queries: z.array(z.string()) }),
});

const WriteReport = tool(() => {}, {
  name: "WriteReport",
  description: "Write the research report.",
  schema: z.object({ report: z.string() }),
});

const WriteResearchQuestion = tool(() => {}, {
  name: "WriteResearchQuestion",
  description: "Write the research question.",
  schema: z.object({ research_question: z.string() }),
});

const DeleteResources = tool(() => {}, {
  name: "DeleteResources",
  description: "Delete the URLs from the resources.",
  schema: z.object({ urls: z.array(z.string()) }),
});

export async function chat_node(state: AgentState, config: RunnableConfig) {
  const startTime = Date.now();
  const requestId = `${state.threadId || 'unknown'}-${Date.now()}`;
  
  try {
    // Create checkpoint for error recovery
    if (state.threadId) {
      await conversationManager.createCheckpoint(state.threadId, state);
    }

    const customConfig = copilotkitCustomizeConfig(config, {
      emitIntermediateState: [
        {
          stateKey: "report",
          tool: "WriteReport",
          toolArgument: "report",
        },
        {
          stateKey: "research_question",
          tool: "WriteResearchQuestion",
          toolArgument: "research_question",
        },
      ],
      emitToolCalls: "DeleteResources",
    });

    state["resources"] = state.resources || [];
    const researchQuestion = state.research_question || "";
    const report = state.report || "";

    // Process resources with caching
    const resources: Resource[] = [];
    for (const resource of state["resources"]) {
      const content = getResource(resource.url);
      if (content === "ERROR") {
        continue;
      }
      resource.content = content;
      resources.push(resource);
    }

    // Build system prompt
    const systemPrompt = `You are a research assistant. You help the user with writing a research report.
        Do not recite the resources, instead use them to answer the user's question.
        You should use the search tool to get resources before answering the user's question.
        If you finished writing the report, ask the user proactively for next steps, changes etc, make it engaging.
        To write the report, you should use the WriteReport tool. Never EVER respond with the report, only use the tool.
        If a research question is provided, YOU MUST NOT ASK FOR IT AGAIN.

        This is the research question:
        ${researchQuestion}

        This is the research report:
        ${report}

        Here are the resources that you have available:
        ${JSON.stringify(resources)}`;

    // Validate input for safety
    const userMessage = state.messages[state.messages.length - 1];
    if (userMessage && userMessage.content) {
      const safetyResult = await safetyFilter.validateInput(userMessage.content as string);
      if (!safetyResult.isValid) {
        console.warn('Input blocked by safety filter:', safetyResult.reason);
        return {
          messages: [
            new AIMessage({
              content: "I'm sorry, but I can't process that request due to safety concerns. Please rephrase your question."
            })
          ]
        };
      }
    }

    // Create messages array
    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      ...state.messages,
    ];

    // Validate token count and chunk if necessary
    const tokenValidation = await tokenValidator.validateAndChunk(
      messages.map(m => m.content as string).join('\n')
    );

    if (!tokenValidation.isValid && tokenValidation.chunks) {
      console.log(`Token validation failed, using chunked content: ${tokenValidation.chunks.length} chunks`);
      // Use the first chunk for now, could implement more sophisticated chunking strategy
      const firstChunkMessages = [
        new SystemMessage(systemPrompt),
        new SystemMessage(`Note: Content was chunked due to size. Processing chunk 1 of ${tokenValidation.chunks.length}.`),
        ...state.messages.slice(-3) // Keep last few messages for context
      ];
      messages.splice(0, messages.length, ...firstChunkMessages);
    }

    // Check cache first
    const cacheKey = cacheManager.generateCacheKey('chat_response', {
      messages: messages.map(m => ({ role: m._getType(), content: m.content })),
      model: state.model
    });

    let cachedResponse = await cacheManager.get(cacheKey, 'llm_response');
    if (cachedResponse) {
      console.log('Using cached response');
      
      // Record cache hit
      await metricsCollector.recordRequest(requestId, {
        type: 'chat',
        duration: Date.now() - startTime,
        cached: true,
        tokensUsed: 0,
        cost: 0
      });

      return cachedResponse;
    }

    // Get model and make request
    const model = await getModel(state, 'chat', messages.map(m => m.content).join(' '));
    const invokeArgs: Record<string, unknown> = {};
    if (model.constructor.name === "ChatOpenAI") {
      invokeArgs["parallel_tool_calls"] = false;
    }

    const response = await model.bindTools!(
      [Search, WriteReport, WriteResearchQuestion, DeleteResources],
      invokeArgs
    ).invoke(messages, customConfig);

    const aiMessage = response as AIMessage;

    // Validate output for safety
    if (aiMessage.content) {
      const outputSafety = await safetyFilter.validateOutput(aiMessage.content as string);
      if (!outputSafety.isValid) {
        console.warn('Output blocked by safety filter:', outputSafety.reason);
        return {
          messages: [
            new AIMessage({
              content: "I apologize, but I need to provide a different response. Let me try again with a safer approach."
            })
          ]
        };
      }
    }

    // Process tool calls
    let result: any = { messages: response };

    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      if (aiMessage.tool_calls[0].name === "WriteReport") {
        const report = aiMessage.tool_calls[0].args.report;
        
        // Validate report content
        const reportSafety = await safetyFilter.validateOutput(report);
        if (!reportSafety.isValid) {
          console.warn('Report blocked by safety filter:', reportSafety.reason);
          return {
            messages: [
              new AIMessage({
                content: "I need to revise the report to ensure it meets our content guidelines. Let me create a new version."
              })
            ]
          };
        }

        result = {
          report,
          messages: [
            aiMessage,
            new ToolMessage({
              tool_call_id: aiMessage.tool_calls![0]["id"]!,
              content: "Report written.",
              name: "WriteReport",
            }),
          ],
        };
      } else if (aiMessage.tool_calls[0].name === "WriteResearchQuestion") {
        const researchQuestion = aiMessage.tool_calls[0].args.research_question;
        result = {
          research_question: researchQuestion,
          messages: [
            aiMessage,
            new ToolMessage({
              tool_call_id: aiMessage.tool_calls![0]["id"]!,
              content: "Research question written.",
              name: "WriteResearchQuestion",
            }),
          ],
        };
      }
    }

    // Cache the successful response
    await cacheManager.set(cacheKey, result, 'llm_response');

    // Record metrics
    const duration = Date.now() - startTime;
    await metricsCollector.recordRequest(requestId, {
      type: 'chat',
      duration,
      cached: false,
      tokensUsed: tokenValidation.tokenCount || 0,
      cost: 0.001 // Estimate, should be updated with actual cost from model
    });

    return result;

  } catch (error) {
    console.error('Chat node error:', error);

    // Attempt recovery from checkpoint
    if (state.threadId) {
      try {
        const recovered = await conversationManager.recoverFromCheckpoint(state.threadId);
        if (recovered) {
          console.log('Successfully recovered from checkpoint');
          // Record recovery
          await metricsCollector.recordError('chat_recovered', error as Error);
          return recovered;
        }
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError);
      }
    }

    // Record error metrics
    await metricsCollector.recordError('chat_failed', error as Error);

    // Return error message
    return {
      messages: [
        new AIMessage({
          content: "I encountered an error processing your request. Please try again or rephrase your question."
        })
      ]
    };
  }
}
