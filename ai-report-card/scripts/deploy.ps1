# Deploy presentation to GitHub Pages
# Usage: powershell -File deploy.ps1

param(
    [string]$RepoPath = "C:\Users\david.hayes\ai-enablement-status",
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"

# Get week number
$weekNum = (Get-Date).DayOfYear / 7
$weekNum = [math]::Ceiling($weekNum)
$dateStr = (Get-Date).ToString("yyyy-MM-dd")

if (-not $Message) {
    $Message = "chore: weekly update - week $weekNum ($dateStr)"
}

Write-Host "Deploying to GitHub Pages..." -ForegroundColor Cyan

# Check repo exists
if (-not (Test-Path $RepoPath)) {
    Write-Host "ERROR: Repository not found at $RepoPath" -ForegroundColor Red
    exit 1
}

Set-Location $RepoPath

# Check for changes
$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes to deploy." -ForegroundColor Yellow
    exit 0
}

# Stage, commit, push (archive model: the new week's report dir + the updated hub)
git add reports index.html
git commit -m $Message
git push origin master

Write-Host "Deployed successfully!" -ForegroundColor Green
Write-Host "URL: https://rev4nchist.github.io/ai-enablement-status/" -ForegroundColor Cyan
