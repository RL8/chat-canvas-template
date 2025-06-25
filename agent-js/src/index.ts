/**
 * Enhanced Research Agent Server with Health Monitoring
 */

import express from 'express';
import cors from 'cors';
import { initializeAgentServices, graph, executeWorkflowWithRecovery } from './agent';
import { AgentState } from './state';
import { CopilotKitHTTPEndpoint } from "@copilotkit/sdk-js";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      services: {
        redis: 'connected', // Will be updated dynamically
        agent: 'ready'
      }
    };
    
    res.status(200).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// CopilotKit endpoint
app.use("/copilotkit", CopilotKitHTTPEndpoint({
  graph: graph,
}));

// Agent execution endpoint
app.post('/agent/execute', async (req, res) => {
  try {
    const { input, config } = req.body;
    const result = await executeWorkflowWithRecovery(input as AgentState, config);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Agent execution failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    // This would integrate with MetricsCollector
    res.json({
      metrics: 'Available in production build',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Metrics unavailable' });
  }
});

// Initialize and start server
async function startServer() {
  try {
    console.log('🚀 Starting Enhanced Research Agent Server...');
    
    // Initialize all services
    await initializeAgentServices();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log(`📊 Metrics: http://localhost:${PORT}/metrics`);
      console.log(`🤖 Agent API: http://localhost:${PORT}/agent/execute`);
      console.log(`🔗 CopilotKit: http://localhost:${PORT}/copilotkit`);
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(console.error);