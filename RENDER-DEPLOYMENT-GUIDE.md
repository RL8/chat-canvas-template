# Render Deployment Guide - CopilotKit Backend

## 🚀 **Ready-to-Deploy Backend**

### **Files Prepared:**
✅ `agent-js/src/minimal-server.ts` - Working Express server
✅ `agent-js/package.json` - Clean dependencies  
✅ `agent-js/render.yaml` - Render configuration
✅ `agent-js/dist/minimal-server.js` - Pre-built output

## 📋 **Render Deployment Options**

### **Option 1: Web Dashboard Deployment**

1. **Go to**: https://dashboard.render.com
2. **Create New Web Service**
3. **Connect GitHub repo**: `RL8/chat-canvas-template`
4. **Set root directory**: `agent-js`
5. **Use these settings**:
   ```
   Build Command: npm install && npm run build
   Start Command: npm start
   Environment: Node
   ```

### **Option 2: CLI Deployment**

```bash
# If render CLI is available
cd /workspace/agent-js
render login
render deploy
```

### **Option 3: Manual Git Deploy**

```bash
# Commit the prepared files
git add agent-js/
git commit -m "Add minimal backend for Render deployment"
git push origin master

# Then deploy via Render dashboard
```

## ⚙️ **Environment Variables**

Set in Render dashboard:
- `NODE_ENV`: `production`
- `PORT`: `10000` (Render default)

## 🔗 **After Deployment**

1. **Get Render URL**: `https://your-app.onrender.com`
2. **Update Vercel Environment**:
   - Variable: `REMOTE_ACTION_URL`
   - Value: `https://your-app.onrender.com/copilotkit`
3. **Redeploy Vercel frontend**

## ✅ **Test Endpoints**

- Health: `https://your-app.onrender.com/health`
- CopilotKit: `https://your-app.onrender.com/copilotkit`

## 🎯 **Expected Result**

- Frontend connects to deployed backend ✅
- No more `extract() failed` errors ✅
- CopilotKit interface functional ✅

**Deployment time: ~5 minutes** ⏱️