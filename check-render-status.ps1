# Render Status Checker
# Usage: .\check-render-status.ps1

param(
    [string]$ApiKey = $env:RENDER_API_KEY,
    [string]$ServiceId = "srv-d1ds372dbo4c73e8ddog"
)

# Check if API key is provided
if (-not $ApiKey) {
    Write-Error "RENDER_API_KEY environment variable not set"
    exit 1
}

Write-Host "📊 Checking Render service status..." -ForegroundColor Green
Write-Host "Service ID: $ServiceId" -ForegroundColor Cyan

# Prepare headers
$headers = @{
    "Accept" = "application/json"
    "Authorization" = "Bearer $ApiKey"
}

try {
    # Get latest deployment
    $response = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$ServiceId/deploys?limit=1" -Headers $headers -Method GET
    $deployData = ($response.Content | ConvertFrom-Json).value[0].deploy
    
    Write-Host "`n🔍 Latest Deployment:" -ForegroundColor Yellow
    Write-Host "ID: $($deployData.id)" -ForegroundColor White
    Write-Host "Status: $($deployData.status)" -ForegroundColor $(if ($deployData.status -eq "live") { "Green" } elseif ($deployData.status -like "*progress*") { "Yellow" } else { "Red" })
    Write-Host "Trigger: $($deployData.trigger)" -ForegroundColor White
    Write-Host "Commit: $($deployData.commit.id.Substring(0,7)) - $($deployData.commit.message)" -ForegroundColor Cyan
    Write-Host "Started: $($deployData.startedAt)" -ForegroundColor White
    
    # Get service info
    $serviceResponse = Invoke-WebRequest -Uri "https://api.render.com/v1/services/$ServiceId" -Headers $headers -Method GET
    $serviceData = ($serviceResponse.Content | ConvertFrom-Json)
    
    Write-Host "`n🌐 Service Info:" -ForegroundColor Yellow
    Write-Host "Name: $($serviceData.name)" -ForegroundColor White
    Write-Host "URL: $($serviceData.serviceDetails.url)" -ForegroundColor Blue
    Write-Host "Suspended: $($serviceData.suspended)" -ForegroundColor $(if ($serviceData.suspended -eq "not_suspended") { "Green" } else { "Red" })
    Write-Host "Auto-deploy: $($serviceData.autoDeploy)" -ForegroundColor White
    Write-Host "Plan: $($serviceData.serviceDetails.plan)" -ForegroundColor White
    Write-Host "Region: $($serviceData.serviceDetails.region)" -ForegroundColor White
    
    Write-Host "`n📱 Quick Links:" -ForegroundColor Yellow
    Write-Host "Dashboard: $($serviceData.dashboardUrl)" -ForegroundColor Blue
    Write-Host "Live Site: $($serviceData.serviceDetails.url)" -ForegroundColor Blue
    
} catch {
    Write-Error "Failed to get status: $($_.Exception.Message)"
    exit 1
} 