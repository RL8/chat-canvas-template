# Claude Code MCP - Quick Activation & Test Guide

## 🚀 Quick Activation Check

### 1. Test MCP Connectivity (30 seconds)
```powershell
# In any Cursor chat, run these commands to verify MCP is active:
```

**Test Commands:**
1. **Basic connectivity test:**
   - Use: `mcp_claude-code-global_Bash` with command `echo "MCP Test"`
   - Expected: Returns output showing MCP is responding

2. **File system access test:**
   - Use: `mcp_claude-code-global_LS` with path `/workspace`
   - Expected: Shows current project files

3. **Quick write test:**
   - Use: `mcp_claude-code-global_Write` to create a test file
   - Expected: File created successfully

## ✅ Success Indicators

- **MCP Active**: Tools respond with data (not errors)
- **Workspace Mounted**: `/workspace` shows project files
- **Full Access**: Can read, write, and execute commands

## ❌ Common Issues & Quick Fixes

### Issue: MCP tools not available
**Fix:** Check Cursor MCP configuration at `%APPDATA%\Cursor\User\mcp.json`

### Issue: Docker errors (legacy setup)
**Fix:** Ignore Docker compose errors - MCP runs independently

### Issue: Workspace not mounted
**Fix:** Restart Cursor and test again

## 🎯 One-Command Verification

**Single test that confirms everything works:**
```
mcp_claude-code-global_Bash: pwd && ls -la
```
**Expected output:** Shows `/workspace` directory with project files

## 📝 Notes

- Claude Code MCP runs automatically when Cursor starts
- No Docker setup required for MCP functionality  
- Docker setup in `.claude-tools` is for separate research agent project
- MCP workspace auto-maps to current Cursor project directory

**Total test time: < 1 minute** ⏱️ 