/**
 * Enhanced Agent with Conversation Management and Error Recovery
 * This is the main entry point for the AI.
 * It defines the workflow graph and the entry point for the agent.
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { AgentState, AgentStateAnnotation } from "./state";
import { download_node } from "./download";
import { chat_node } from "./chat";
import { search_node } from "./search";
import { delete_node, perform_delete_node } from "./delete";

// Import enhanced services
import { ConversationManager } from "./services/conversationManager";
import { MetricsCollector } from "./monitoring/metrics";
import { config } from "./config/appConfig";

// Initialize services
const conversationManager = new ConversationManager();
const metricsCollector = new MetricsCollector();

// Enhanced node wrappers with checkpointing and error recovery
async function enhanced_download_node(state: AgentState, config: any) {
  const startTime = Date.now();
  const nodeId = "download";
  
  try {
    // Create checkpoint before processing
    if (state.threadId) {
      await conversationManager.createCheckpoint(state.threadId, state);
    }
    
    const result = await download_node(state, config);
    
    // Record successful execution
    await metricsCollector.recordRequest(`${nodeId}-${Date.now()}`, {
      type: nodeId,
      duration: Date.now() - startTime,
      cached: false,
      tokensUsed: 0,
      cost: 0
    });
    
    return result;
  } catch (error) {
    console.error(`Error in ${nodeId}:`, error);
    await metricsCollector.recordError(`${nodeId}_failed`, error as Error);
    
    // Attempt recovery from checkpoint
    if (state.threadId) {
      const recovered = await conversationManager.recoverFromCheckpoint(state.threadId);
      if (recovered) {
        console.log(`Successfully recovered ${nodeId} from checkpoint`);
        return recovered;
      }
    }
    
    throw error;
  }
}

async function enhanced_chat_node(state: AgentState, config: any) {
  const startTime = Date.now();
  const nodeId = "chat_node";
  
  try {
    // Checkpoint is handled inside chat_node already
    const result = await chat_node(state, config);
    
    // Record successful execution
    await metricsCollector.recordRequest(`${nodeId}-${Date.now()}`, {
      type: nodeId,
      duration: Date.now() - startTime,
      cached: false,
      tokensUsed: 0,
      cost: 0
    });
    
    return result;
  } catch (error) {
    console.error(`Error in ${nodeId}:`, error);
    await metricsCollector.recordError(`${nodeId}_failed`, error as Error);
    throw error; // chat_node handles its own recovery
  }
}

async function enhanced_search_node(state: AgentState, config: any) {
  const startTime = Date.now();
  const nodeId = "search_node";
  
  try {
    // Create checkpoint before processing
    if (state.threadId) {
      await conversationManager.createCheckpoint(state.threadId, state);
    }
    
    const result = await search_node(state, config);
    
    // Record successful execution
    await metricsCollector.recordRequest(`${nodeId}-${Date.now()}`, {
      type: nodeId,
      duration: Date.now() - startTime,
      cached: false,
      tokensUsed: 0,
      cost: 0
    });
    
    return result;
  } catch (error) {
    console.error(`Error in ${nodeId}:`, error);
    await metricsCollector.recordError(`${nodeId}_failed`, error as Error);
    
    // Attempt recovery from checkpoint
    if (state.threadId) {
      const recovered = await conversationManager.recoverFromCheckpoint(state.threadId);
      if (recovered) {
        console.log(`Successfully recovered ${nodeId} from checkpoint`);
        return recovered;
      }
    }
    
    throw error;
  }
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode("download", enhanced_download_node)
  .addNode("chat_node", enhanced_chat_node)
  .addNode("search_node", enhanced_search_node)
  .addNode("delete_node", delete_node)
  .addNode("perform_delete_node", perform_delete_node)
  .setEntryPoint("download")
  .addEdge("download", "chat_node")
  .addConditionalEdges("chat_node", route, [
    "search_node",
    "chat_node",
    "delete_node",
    END,
  ])
  .addEdge("delete_node", "perform_delete_node")
  .addEdge("perform_delete_node", "chat_node")
  .addEdge("search_node", "download");

// Initialize services and create enhanced checkpointer
const memorySaver = new MemorySaver();

export const graph = workflow.compile({
  interruptAfter: ["delete_node"],
  checkpointer: memorySaver,
});

function route(state: AgentState) {
  const messages = state.messages || [];

  if (
    messages.length > 0 &&
    messages[messages.length - 1].constructor.name === "AIMessageChunk"
  ) {
    const aiMessage = messages[messages.length - 1] as AIMessage;

    if (
      aiMessage.tool_calls &&
      aiMessage.tool_calls.length > 0 &&
      aiMessage.tool_calls[0].name === "Search"
    ) {
      return "search_node";
    } else if (
      aiMessage.tool_calls &&
      aiMessage.tool_calls.length > 0 &&
      aiMessage.tool_calls[0].name === "DeleteResources"
    ) {
      return "delete_node";
    }
  }
  if (
    messages.length > 0 &&
    messages[messages.length - 1].constructor.name === "ToolMessage"
  ) {
    return "chat_node";
  }
  return END;
}

/**
 * Initialize enhanced agent services
 */
export async function initializeAgentServices(): Promise<void> {
  try {
    console.log('Initializing enhanced agent services...');
    
    // Initialize ConversationManager
    await conversationManager.initialize();
    console.log('✅ ConversationManager initialized');
    
    // Initialize MetricsCollector 
    await metricsCollector.initialize();
    console.log('✅ MetricsCollector initialized');
    
    console.log('🚀 All agent services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize agent services:', error);
    throw error;
  }
}

/**
 * Get conversation manager instance
 */
export function getConversationManager(): ConversationManager {
  return conversationManager;
}

/**
 * Get metrics collector instance
 */
export function getMetricsCollector(): MetricsCollector {
  return metricsCollector;
}

/**
 * Enhanced workflow execution with error recovery
 */
export async function executeWorkflowWithRecovery(
  inputs: AgentState,
  config?: any
): Promise<any> {
  const executionId = `execution-${Date.now()}`;
  const startTime = Date.now();
  
  try {
    console.log(`🔄 Starting workflow execution: ${executionId}`);
    
    // Ensure threadId exists for checkpointing
    if (!inputs.threadId) {
      inputs.threadId = `thread-${Date.now()}`;
    }
    
    // Create initial checkpoint
    await conversationManager.createCheckpoint(inputs.threadId, inputs);
    
    // Execute the workflow
    const result = await graph.invoke(inputs, config);
    
    // Record successful execution
    await metricsCollector.recordRequest(executionId, {
      type: 'workflow',
      duration: Date.now() - startTime,
      cached: false,
      tokensUsed: 0,
      cost: 0
    });
    
    console.log(`✅ Workflow execution completed: ${executionId}`);
    return result;
    
  } catch (error) {
    console.error(`❌ Workflow execution failed: ${executionId}`, error);
    
    // Record the error
    await metricsCollector.recordError('workflow_failed', error as Error);
    
    // Attempt recovery from the last checkpoint
    if (inputs.threadId) {
      try {
        const recovered = await conversationManager.recoverFromCheckpoint(inputs.threadId);
        if (recovered) {
          console.log(`🔄 Successfully recovered workflow: ${executionId}`);
          await metricsCollector.recordError('workflow_recovered', error as Error);
          return recovered;
        }
      } catch (recoveryError) {
        console.error(`❌ Recovery failed for workflow: ${executionId}`, recoveryError);
      }
    }
    
    throw error;
  }
}
