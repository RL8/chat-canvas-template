/**
 * Simple CopilotKit Server
 */

import express from 'express';
import cors from 'cors';
import { CopilotKitHTTPEndpoint } from "@copilotkit/sdk-js/http";
import { MemorySaver } from "@langchain/langgraph";
import { StateGraph, StateGraphArgs } from "@langchain/langgraph";
import { CopilotKitStateAnnotation } from "@copilotkit/sdk-js/dist/langgraph";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Simple state interface
interface SimpleState {
  messages: any[];
}

// Create a simple graph
const workflow = new StateGraph(CopilotKitStateAnnotation)
  .addNode("agent", async (state: any) => {
    return {
      ...state,
      messages: [
        ...state.messages,
        {
          role: "assistant", 
          content: "I'm a research assistant. How can I help you?"
        }
      ]
    };
  })
  .addEdge("__start__", "agent")
  .addEdge("agent", "__end__");

const checkpointer = new MemorySaver();
const graph = workflow.compile({ checkpointer });

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'simple-copilotkit-server'
  });
});

// CopilotKit endpoint
app.use("/copilotkit", CopilotKitHTTPEndpoint({
  graph: graph,
}));

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Simple CopilotKit Server running on port ${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 CopilotKit: http://localhost:${PORT}/copilotkit`);
});

export default app; 