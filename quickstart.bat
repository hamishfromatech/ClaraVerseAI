@echo off
REM ============================================
REM A-Tech AI Quickstart for Windows
REM ============================================
REM Get up and running in 60 seconds!
REM ============================================

setlocal enabledelayedexpansion

echo ============================================
echo A-Tech AI Quickstart
echo ============================================
echo.

REM ============================================
REM Step 1: Check Docker Installation
REM ============================================
echo Step 1: Checking Docker installation...

where docker >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker not found
    echo.
    echo Please install Docker Desktop for Windows:
    echo   Download: https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

docker compose version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Compose not found
    echo.
    echo Please update Docker Desktop to the latest version.
    echo.
    pause
    exit /b 1
)

echo [OK] Docker is installed
docker --version
docker compose version
echo.

REM ============================================
REM Step 2: Setup .env File
REM ============================================
echo Step 2: Setting up environment configuration...

if exist .env (
    echo [OK] .env file already exists
    echo [INFO] Using existing configuration
    echo.
) else (
    echo [SETUP] Creating .env file with auto-generated secure keys...

    REM Generate secure random keys using PowerShell
    echo    Generating ENCRYPTION_MASTER_KEY...
    for /f "delims=" %%a in ('powershell -Command "$bytes = New-Object byte[] 32; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes); [System.BitConverter]::ToString($bytes).Replace('-','').ToLower()"') do set ENCRYPTION_KEY=%%a

    echo    Generating JWT_SECRET...
    for /f "delims=" %%a in ('powershell -Command "$bytes = New-Object byte[] 64; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes); [System.BitConverter]::ToString($bytes).Replace('-','').ToLower()"') do set JWT_SECRET=%%a

    REM Check if .env.default exists
    if not exist .env.default (
        echo [ERROR] .env.default not found
        echo Please ensure you're in the our-version directory
        pause
        exit /b 1
    )

    REM Copy .env.default to .env
    copy .env.default .env >nul

    REM Replace placeholder values using PowerShell
    powershell -Command "(Get-Content .env) -replace 'ENCRYPTION_MASTER_KEY=auto-generated-on-first-run', 'ENCRYPTION_MASTER_KEY=!ENCRYPTION_KEY!' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace 'JWT_SECRET=auto-generated-on-first-run', 'JWT_SECRET=!JWT_SECRET!' | Set-Content .env"

    echo [OK] .env file created with secure keys
    echo [INFO] Keys have been saved to .env (keep this file secure!)
    echo.
)

REM ============================================
REM Step 3: Clean Up Old Containers
REM ============================================
echo Step 3: Cleaning up old containers...
docker compose down 2>nul
echo [OK] Cleanup complete
echo.

REM ============================================
REM Step 4: Pull Docker Images
REM ============================================
echo Step 4: Pulling Docker images...
echo [INFO] This may take a few minutes on first run...
docker compose pull --quiet
if %ERRORLEVEL% NEQ 0 (
    docker compose pull
)
echo [OK] Images pulled
echo.

REM ============================================
REM Step 5: Start All Services
REM ============================================
echo Step 5: Starting A-Tech AI...
echo [INFO] Docker will automatically start services in the correct order
echo [INFO] This may take 60-90 seconds...
echo.

docker compose up -d --build

echo.
echo [OK] All services started
echo.

REM ============================================
REM Step 6: Wait for Services
REM ============================================
echo Step 6: Waiting for services to become healthy...
echo [INFO] Waiting 45 seconds for services to initialize...
timeout /t 45 /nobreak >nul
echo.

REM ============================================
REM Success Message
REM ============================================
echo ======================================
echo A-Tech AI is Running!
echo ======================================
echo.
echo Access your instance:
echo   Frontend:     http://localhost:82
echo   Backend API:  http://localhost:3003
echo   Health Check: http://localhost:3003/health
echo.
echo First Steps:
echo   1. Open http://localhost:82 in your browser
echo   2. Register your account (first user becomes admin!)
echo   3. Add your AI provider API keys in Settings
echo.
echo Useful Commands:
echo   - View logs:       docker compose logs -f
echo   - View logs (one): docker compose logs -f backend
echo   - Stop all:        docker compose down
echo   - Restart all:     docker compose restart
echo   - Check status:    docker compose ps
echo.
echo Documentation:
echo   - README.md - Full documentation
echo   - .env - Your configuration (keep secure!)
echo.
echo Troubleshooting:
echo   - Run diagnose.bat for diagnostic information
echo   - Report issues: https://github.com/hamishfromatech/our-version/issues
echo.
pause
