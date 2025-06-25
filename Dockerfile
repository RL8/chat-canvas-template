FROM node:18-alpine

# Set working directory
WORKDIR /app

# Create a simple package.json
RUN echo '{ \
  "name": "simple-backend", \
  "version": "1.0.0", \
  "main": "server.js", \
  "scripts": { \
    "start": "node server.js" \
  }, \
  "dependencies": { \
    "express": "^4.18.2", \
    "cors": "^2.8.5" \
  } \
}' > package.json

# Install dependencies
RUN npm install

# Create simple server file
RUN echo 'const express = require("express"); \
const cors = require("cors"); \
const app = express(); \
const PORT = process.env.PORT || 8000; \
\
app.use(cors()); \
app.use(express.json()); \
\
app.get("/health", (req, res) => { \
  res.json({ \
    status: "healthy", \
    timestamp: new Date().toISOString(), \
    service: "chat-canvas-backend" \
  }); \
}); \
\
app.post("/copilotkit", (req, res) => { \
  res.json({ \
    message: "CopilotKit backend is working", \
    timestamp: new Date().toISOString() \
  }); \
}); \
\
app.get("/", (req, res) => { \
  res.json({ \
    message: "Chat Canvas Backend API", \
    endpoints: ["/health", "/copilotkit"], \
    timestamp: new Date().toISOString() \
  }); \
}); \
\
app.listen(PORT, () => { \
  console.log(`Server running on port ${PORT}`); \
});' > server.js

# Expose port
EXPOSE 8000

# Start the application
CMD ["npm", "start"] 