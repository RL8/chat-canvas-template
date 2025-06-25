# Render Deployment Script
# Usage: .\deploy-render.ps1

param(
    [string]$ApiKey = $env:RENDER_API_KEY,
    [string]$ServiceId = "srv-d1ds372dbo4c73e8ddog",
    [switch]$ClearCache = $false
)

# Check if API key is provided
if (-not $ApiKey) {
    Write-Error "RENDER_API_KEY environment variable not set or -ApiKey parameter not provided"
    exit 1
}

Write-Host "🚀 Starting Render deployment..." -ForegroundColor Green
Write-Host "Service ID: $ServiceId" -ForegroundColor Cyan

# Prepare headers
$headers = @{
    "Accept" = "application/json"
    "Authorization" = "Bearer $ApiKey" 
    "Content-Type" = "application/json"
}

# Prepare deployment body
$deployBody = @{
    clearCache = $ClearCache
} | ConvertTo-Json

try {
    # Trigger deployment
    $response = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$ServiceId/deploys" -Headers $headers -Method POST -Body $deployBody
    $deployData = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ Deployment triggered successfully!" -ForegroundColor Green
    Write-Host "Deployment ID: $($deployData.id)" -ForegroundColor Yellow
    Write-Host "Status: $($deployData.status)" -ForegroundColor Yellow
    Write-Host "Commit: $($deployData.commit.id.Substring(0,7)) - $($deployData.commit.message)" -ForegroundColor Cyan
    Write-Host "Dashboard: https://dashboard.render.com/web/$ServiceId" -ForegroundColor Blue
    Write-Host "Live URL: https://chat-canvas-template.onrender.com" -ForegroundColor Blue
    
    Write-Host "`n⏳ Deployment is in progress. Check the dashboard for live updates." -ForegroundColor Yellow
    
} catch {
    Write-Error "❌ Deployment failed: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $errorResponse = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($errorResponse)
        $errorContent = $reader.ReadToEnd()
        Write-Host "Error details: $errorContent" -ForegroundColor Red
    }
    exit 1
} 