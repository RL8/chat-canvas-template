/**
 * Minimal CopilotKit Backend for Vercel Deployment
 */

import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({
  origin: ['https://ui-1pzs6khdm-rl8s-projects.vercel.app', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'minimal-copilotkit-backend'
  });
});

// Simple CopilotKit endpoint that returns basic response
app.post('/copilotkit', (req, res) => {
  try {
    console.log('CopilotKit request received:', req.body);
    
    // Basic response for CopilotKit
    res.json({
      type: 'function_call',
      function_call: {
        name: 'research_assistant',
        arguments: JSON.stringify({
          message: 'I am a research assistant. How can I help you with your research today?'
        })
      }
    });
  } catch (error) {
    console.error('CopilotKit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Catch all for CopilotKit routes
app.all('/copilotkit/*', (req, res) => {
  res.json({
    message: 'CopilotKit endpoint active',
    method: req.method,
    path: req.path
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Minimal CopilotKit Server running on port ${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`🔗 CopilotKit: http://localhost:${PORT}/copilotkit`);
});

export default app;