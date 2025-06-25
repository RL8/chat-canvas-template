# Simple Render Status Checker
param(
    [string]$ApiKey = $env:RENDER_API_KEY,
    [string]$ServiceId = "srv-d1ds372dbo4c73e8ddog"
)

if (-not $ApiKey) {
    Write-Error "RENDER_API_KEY environment variable not set"
    exit 1
}

Write-Host "Checking Render service status..." -ForegroundColor Green

$headers = @{
    "Accept" = "application/json"
    "Authorization" = "Bearer $ApiKey"
}

try {
    # Get latest deployment
    $response = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$ServiceId/deploys?limit=1" -Headers $headers -Method GET
    $deployData = ($response.Content | ConvertFrom-Json).value[0].deploy
    
    Write-Host ""
    Write-Host "Latest Deployment:" -ForegroundColor Yellow
    Write-Host "ID: $($deployData.id)" 
    Write-Host "Status: $($deployData.status)" -ForegroundColor $(if ($deployData.status -eq "live") { "Green" } elseif ($deployData.status -like "*progress*") { "Yellow" } else { "Red" })
    Write-Host "Commit: $($deployData.commit.id.Substring(0,7)) - $($deployData.commit.message)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Live URL: https://chat-canvas-template.onrender.com" -ForegroundColor Blue
    Write-Host "Dashboard: https://dashboard.render.com/web/$ServiceId" -ForegroundColor Blue
    
} catch {
    Write-Error "Failed to get status: $($_.Exception.Message)"
    exit 1
} 