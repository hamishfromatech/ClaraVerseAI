@echo off
REM ============================================
REM ClaraVerse Diagnostic Tool for Windows
REM ============================================
REM Run this script to diagnose common issues
REM ============================================

setlocal enabledelayedexpansion

echo ============================================
echo ClaraVerse Diagnostics
echo ============================================
echo.

REM ============================================
REM System Information
REM ============================================
echo System Information:
echo OS: Windows
ver
echo.

REM ============================================
REM Docker Installation Check
REM ============================================
echo Docker Installation:

where docker >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Docker installed
    docker --version
) else (
    echo [ERROR] Docker not found
    echo    Please install: https://www.docker.com/products/docker-desktop
)

docker compose version >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Docker Compose installed
    docker compose version
) else (
    echo [ERROR] Docker Compose not found
)

echo.

REM ============================================
REM Docker Service Status
REM ============================================
echo Docker Service Status:

docker info >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo [OK] Docker daemon is running
) else (
    echo [ERROR] Docker daemon is not running
    echo    Start Docker Desktop
)

echo.

REM ============================================
REM Environment Configuration
REM ============================================
echo Environment Configuration:

if exist .env (
    echo [OK] .env file exists

    REM Check ENCRYPTION_MASTER_KEY
    findstr /C:"ENCRYPTION_MASTER_KEY=" .env | findstr /V /C:"ENCRYPTION_MASTER_KEY=$" | findstr /V /C:"auto-generated" >nul
    if %ERRORLEVEL% EQU 0 (
        echo    [OK] ENCRYPTION_MASTER_KEY is set
    ) else (
        echo    [ERROR] ENCRYPTION_MASTER_KEY is not set or invalid
    )

    REM Check JWT_SECRET
    findstr /C:"JWT_SECRET=" .env | findstr /V /C:"JWT_SECRET=$" | findstr /V /C:"auto-generated" >nul
    if %ERRORLEVEL% EQU 0 (
        echo    [OK] JWT_SECRET is set
    ) else (
        echo    [ERROR] JWT_SECRET is not set or invalid
    )

    REM Check MYSQL_PASSWORD
    findstr /C:"MYSQL_PASSWORD=" .env | findstr /V /C:"MYSQL_PASSWORD=$" >nul
    if %ERRORLEVEL% EQU 0 (
        echo    [OK] MYSQL_PASSWORD is set
    ) else (
        echo    [WARNING] MYSQL_PASSWORD is not set (will use default)
    )
) else (
    echo [ERROR] .env file not found
    echo    Run quickstart.bat to create it automatically
)

echo.

REM ============================================
REM Container Status
REM ============================================
echo Container Status:

docker compose ps >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    docker compose ps
    echo.
) else (
    echo [WARNING] No containers running
    echo    Start with: docker compose up -d
)

echo.

REM ============================================
REM Port Usage Check
REM ============================================
echo Port Usage Check:
echo Checking if services are listening...

netstat -an | findstr ":80 " >nul && echo    [OK] Port 80 (Frontend) is in use || echo    [WARNING] Port 80 (Frontend) is not in use
netstat -an | findstr ":3001 " >nul && echo    [OK] Port 3001 (Backend) is in use || echo    [WARNING] Port 3001 (Backend) is not in use
netstat -an | findstr ":3306 " >nul && echo    [OK] Port 3306 (MySQL) is in use || echo    [WARNING] Port 3306 (MySQL) is not in use
netstat -an | findstr ":27017 " >nul && echo    [OK] Port 27017 (MongoDB) is in use || echo    [WARNING] Port 27017 (MongoDB) is not in use
netstat -an | findstr ":6379 " >nul && echo    [OK] Port 6379 (Redis) is in use || echo    [WARNING] Port 6379 (Redis) is not in use

echo.

REM ============================================
REM Connectivity Tests
REM ============================================
echo Connectivity Tests:

REM Test backend
curl -s http://localhost:3001/health >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo    [OK] Backend API is responding
) else (
    echo    [ERROR] Backend API not responding
    echo       Check: docker compose logs backend
)

REM Test frontend
curl -s http://localhost:80 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo    [OK] Frontend is responding
) else (
    echo    [ERROR] Frontend not responding
    echo       Check: docker compose logs frontend
)

echo.

REM ============================================
REM Disk Space Check
REM ============================================
echo Disk Space:
for /f "tokens=3" %%a in ('dir /-c ^| findstr /C:"bytes free"') do set FREESPACE=%%a
echo Free space: %FREESPACE% bytes
echo.

REM ============================================
REM Docker Volume Check
REM ============================================
echo Docker Volumes:
docker volume ls | findstr claraverse
if %ERRORLEVEL% NEQ 0 (
    echo No ClaraVerse volumes found
)
echo.

REM ============================================
REM Recent Errors from Logs
REM ============================================
echo Recent Errors (last 20 lines):

docker compose ps >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Backend errors:
    docker compose logs --tail=20 backend 2>&1 | findstr /I "error" || echo    No recent errors
    echo.

    echo Frontend errors:
    docker compose logs --tail=20 frontend 2>&1 | findstr /I "error" || echo    No recent errors
    echo.
) else (
    echo [WARNING] No containers running
)

REM ============================================
REM Recommendations
REM ============================================
echo ======================================
echo Recommendations:
echo ======================================

if not exist .env (
    echo - Create .env file: quickstart.bat
)

docker compose ps >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo - Start services: quickstart.bat
)

echo.
echo For more help:
echo - View logs: docker compose logs -f
echo - Restart services: docker compose restart
echo - Full restart: docker compose down then quickstart.bat
echo - Report issues: https://github.com/yourusername/ClaraVerse-Scarlet-OSS/issues
echo.

pause
