# ============================================
# ClaraVerse CLI Installer for Windows
# ============================================
# Usage: iwr -useb https://get.claraverse.ai/windows | iex
# ============================================

$ErrorActionPreference = "Stop"

# Colors
function Write-Color($Color, $Message) {
    Write-Host $Message -ForegroundColor $Color
}

function Write-Info($Message) { Write-Color "Cyan" "[i] $Message" }
function Write-Success($Message) { Write-Color "Green" "[✓] $Message" }
function Write-Warning($Message) { Write-Color "Yellow" "[!] $Message" }
function Write-Error($Message) { Write-Color "Red" "[✗] $Message" }
function Write-Step($Message) { Write-Color "Magenta" "[→] $Message" }

# Print logo
function Show-Logo {
    Write-Host ""
    Write-Color "Magenta" "[=] [=] [=] [=] [=] [=] [=] [=] [=] [=]"
    Write-Color "Magenta" " C   L   A   R   A   V   E   R   S   E "
    Write-Color "Magenta" "[=] [=] [=] [=] [=] [=] [=] [=] [=] [=]"
    Write-Host ""
    Write-Color "Cyan" "    Your Private AI Workspace - Windows Installer"
    Write-Host ""
}

# Check if Docker is installed
function Test-Docker {
    try {
        $null = docker version 2>&1
        return $true
    } catch {
        return $false
    }
}

# Main installation
function Install-ClaraVerse {
    Show-Logo

    # Create install directory
    $InstallDir = "$env:USERPROFILE\.claraverse"
    $BinDir = "$InstallDir\bin"

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    if (-not (Test-Path $BinDir)) {
        New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
    }

    # Download CLI wrapper script
    Write-Step "Creating ClaraVerse CLI..."

    $CliScript = @'
@echo off
setlocal enabledelayedexpansion

set "DOCKER_IMAGE=claraverseoss/claraverse:latest"
set "SEARXNG_IMAGE=searxng/searxng:latest"
set "CONTAINER_NAME=claraverse"
set "SEARXNG_CONTAINER=claraverse-search"
set "NETWORK_NAME=claraverse-net"
set "PORT=80"

if "%1"=="" goto :help
if "%1"=="help" goto :help
if "%1"=="-h" goto :help
if "%1"=="--help" goto :help
if "%1"=="init" goto :init
if "%1"=="start" goto :start
if "%1"=="stop" goto :stop
if "%1"=="restart" goto :restart
if "%1"=="status" goto :status
if "%1"=="logs" goto :logs
if "%1"=="update" goto :update
if "%1"=="uninstall" goto :uninstall
if "%1"=="version" goto :version

echo Unknown command: %1
echo Run 'claraverse help' for usage
exit /b 1

:help
echo.
echo ClaraVerse CLI - Your Private AI Workspace
echo.
echo Usage: claraverse ^<command^> [options]
echo.
echo Commands:
echo   init [port]    Initialize and start ClaraVerse (default port: 80)
echo   start          Start ClaraVerse
echo   stop           Stop ClaraVerse
echo   restart        Restart ClaraVerse
echo   status         Show status
echo   logs           View logs
echo   update         Update to latest version
echo   uninstall      Remove ClaraVerse
echo   version        Show version
echo   help           Show this help
echo.
echo What's Included:
echo   - AI Chat and Assistants
echo   - Web Search (SearXNG)
echo   - Code Execution (E2B)
echo   - Image Generation
echo   - MongoDB, MySQL, Redis
echo.
echo Examples:
echo   claraverse init
echo   claraverse init 8080
echo   claraverse logs
echo.
goto :eof

:init
if not "%2"=="" set "PORT=%2"
echo [i] Initializing ClaraVerse on port %PORT%...
echo [->] Creating network...
docker network create %NETWORK_NAME% 2>nul
echo [->] Setting up web search (SearXNG)...
docker pull %SEARXNG_IMAGE%
docker rm -f %SEARXNG_CONTAINER% 2>nul
docker run -d --name %SEARXNG_CONTAINER% --network %NETWORK_NAME% -v claraverse-searxng:/etc/searxng --restart unless-stopped %SEARXNG_IMAGE%
echo [->] Pulling latest ClaraVerse image...
docker pull %DOCKER_IMAGE%
echo [->] Starting ClaraVerse...
docker rm -f %CONTAINER_NAME% 2>nul
docker run -d --name %CONTAINER_NAME% --network %NETWORK_NAME% -p %PORT%:80 -v claraverse-data:/data -e "SEARXNG_URL=http://%SEARXNG_CONTAINER%:8080" -e "SEARXNG_URLS=http://%SEARXNG_CONTAINER%:8080" --restart unless-stopped %DOCKER_IMAGE%
echo.
echo [OK] ClaraVerse is starting!
echo.
echo     Access: http://localhost:%PORT%
echo.
echo     Features:
echo       - AI Chat and Assistants
echo       - Web Search (SearXNG)
echo       - Code Execution (E2B)
echo       - Image Generation
echo.
echo     First Steps:
echo       1. Open http://localhost:%PORT% in browser
echo       2. Register account (first user = admin)
echo       3. Add AI provider keys in Settings
echo.
goto :eof

:start
echo [->] Starting ClaraVerse...
docker start %SEARXNG_CONTAINER% 2>nul
docker start %CONTAINER_NAME%
echo [OK] Started
goto :eof

:stop
echo [->] Stopping ClaraVerse...
docker stop %CONTAINER_NAME%
docker stop %SEARXNG_CONTAINER% 2>nul
echo [OK] Stopped
goto :eof

:restart
echo [->] Restarting ClaraVerse...
docker restart %SEARXNG_CONTAINER% 2>nul
docker restart %CONTAINER_NAME%
echo [OK] Restarted
goto :eof

:status
echo.
echo ClaraVerse Status
echo ================================
for /f "tokens=*" %%i in ('docker ps -a --filter "name=%CONTAINER_NAME%" --format "{{.Status}}"') do (
    echo Main:   %%i
)
for /f "tokens=*" %%i in ('docker inspect --format "{{.State.Health.Status}}" %CONTAINER_NAME% 2^>nul') do (
    echo Health: %%i
)
for /f "tokens=*" %%i in ('docker ps -a --filter "name=%SEARXNG_CONTAINER%" --format "{{.Status}}"') do (
    echo Search: %%i
)
echo ================================
echo.
goto :eof

:logs
docker logs --tail 100 %CONTAINER_NAME%
goto :eof

:update
echo [->] Updating ClaraVerse...
docker network create %NETWORK_NAME% 2>nul
docker pull %DOCKER_IMAGE%
docker pull %SEARXNG_IMAGE%
docker stop %CONTAINER_NAME% 2>nul
docker rm %CONTAINER_NAME% 2>nul
docker run -d --name %CONTAINER_NAME% --network %NETWORK_NAME% -p %PORT%:80 -v claraverse-data:/data -e "SEARXNG_URL=http://%SEARXNG_CONTAINER%:8080" -e "SEARXNG_URLS=http://%SEARXNG_CONTAINER%:8080" --restart unless-stopped %DOCKER_IMAGE%
echo [OK] Updated!
goto :eof

:uninstall
echo [!] This will stop and remove ClaraVerse.
set /p "CONFIRM=Are you sure? (y/N): "
if /i not "%CONFIRM%"=="y" goto :eof
docker stop %CONTAINER_NAME% 2>nul
docker stop %SEARXNG_CONTAINER% 2>nul
docker rm %CONTAINER_NAME% 2>nul
docker rm %SEARXNG_CONTAINER% 2>nul
docker network rm %NETWORK_NAME% 2>nul
echo [OK] ClaraVerse removed
echo.
echo To also remove data: docker volume rm claraverse-data claraverse-searxng
goto :eof

:version
echo ClaraVerse CLI v1.0.0 (Windows)
echo.
echo Components:
echo   - ClaraVerse (All-in-One)
echo     Backend, Frontend, MongoDB, MySQL, Redis, E2B
echo   - SearXNG (Web Search)
goto :eof
'@

    $CliBatPath = "$BinDir\claraverse.bat"
    $CliScript | Out-File -FilePath $CliBatPath -Encoding ASCII

    Write-Success "CLI script created"

    # Add to PATH
    Write-Step "Adding to PATH..."

    $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($CurrentPath -notlike "*$BinDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$CurrentPath;$BinDir", "User")
        $env:Path = "$env:Path;$BinDir"
        Write-Success "Added to PATH"
        Write-Warning "You may need to restart your terminal for PATH changes to take effect"
    } else {
        Write-Info "Already in PATH"
    }

    # Check Docker
    Write-Host ""
    if (Test-Docker) {
        Write-Success "Docker is available"
    } else {
        Write-Warning "Docker Desktop is not running or not installed"
        Write-Host ""
        Write-Host "Install Docker Desktop from:"
        Write-Host "  https://docs.docker.com/desktop/install/windows-install/"
        Write-Host ""
        Write-Host "After installing Docker, run: claraverse init"
        return
    }

    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  ClaraVerse CLI installed successfully!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Quick Start:" -ForegroundColor White
    Write-Host "  claraverse init        # Start ClaraVerse"
    Write-Host "  claraverse status      # Check status"
    Write-Host "  claraverse help        # Show all commands"
    Write-Host ""

    $StartNow = Read-Host "Start ClaraVerse now? (Y/n)"
    if ($StartNow -ne "n" -and $StartNow -ne "N") {
        Write-Host ""
        & "$CliBatPath" init
    } else {
        Write-Host ""
        Write-Host "Run 'claraverse init' when ready to start."
    }
}

# Run installation
Install-ClaraVerse
