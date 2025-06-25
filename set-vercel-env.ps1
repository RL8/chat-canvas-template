# Set Vercel Environment Variable
$env:VERCEL_ORG_ID = "rl8s-projects"
$env:VERCEL_PROJECT_ID = "ui"

Write-Host "Setting REMOTE_ACTION_URL environment variable..." -ForegroundColor Green

# Use echo to pipe the value to vercel env add
$backendUrl = "https://chat-canvas-template.onrender.com/copilotkit"
echo $backendUrl | vercel env add REMOTE_ACTION_URL production

Write-Host "Environment variable set successfully!" -ForegroundColor Green
Write-Host "Backend URL: $backendUrl" -ForegroundColor Cyan 