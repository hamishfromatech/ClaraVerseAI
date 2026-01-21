#!/bin/bash
# ============================================
# ClaraVerse Diagnostic Tool
# ============================================
# Run this script to diagnose common issues
# ============================================

set -e

echo "🔍 ClaraVerse Diagnostics"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# System Information
# ============================================
echo -e "${BLUE}System Information:${NC}"
echo "OS: $(uname -s) $(uname -r)"
echo "Architecture: $(uname -m)"
echo ""

# ============================================
# Docker Installation Check
# ============================================
echo -e "${BLUE}Docker Installation:${NC}"

if command -v docker &> /dev/null; then
    echo -e "${GREEN}✅ Docker installed${NC}"
    docker --version
else
    echo -e "${RED}❌ Docker not found${NC}"
    echo "   Please install: https://www.docker.com/products/docker-desktop"
fi

if docker compose version &> /dev/null 2>&1; then
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
    docker compose version
else
    echo -e "${RED}❌ Docker Compose not found${NC}"
fi

echo ""

# ============================================
# Docker Service Status
# ============================================
echo -e "${BLUE}Docker Service Status:${NC}"

if docker info &> /dev/null; then
    echo -e "${GREEN}✅ Docker daemon is running${NC}"
else
    echo -e "${RED}❌ Docker daemon is not running${NC}"
    echo "   Start Docker Desktop or run: sudo systemctl start docker"
fi

echo ""

# ============================================
# Environment Configuration
# ============================================
echo -e "${BLUE}Environment Configuration:${NC}"

if [ -f .env ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"

    # Check required variables
    if grep -q "ENCRYPTION_MASTER_KEY=" .env && ! grep -q "ENCRYPTION_MASTER_KEY=$" .env && ! grep -q "ENCRYPTION_MASTER_KEY=auto-generated" .env; then
        echo -e "   ${GREEN}✅ ENCRYPTION_MASTER_KEY is set${NC}"
    else
        echo -e "   ${RED}❌ ENCRYPTION_MASTER_KEY is not set or invalid${NC}"
    fi

    if grep -q "JWT_SECRET=" .env && ! grep -q "JWT_SECRET=$" .env && ! grep -q "JWT_SECRET=auto-generated" .env; then
        echo -e "   ${GREEN}✅ JWT_SECRET is set${NC}"
    else
        echo -e "   ${RED}❌ JWT_SECRET is not set or invalid${NC}"
    fi

    if grep -q "MYSQL_PASSWORD=" .env && ! grep -q "MYSQL_PASSWORD=$" .env; then
        echo -e "   ${GREEN}✅ MYSQL_PASSWORD is set${NC}"
    else
        echo -e "   ${YELLOW}⚠️  MYSQL_PASSWORD is not set (will use default)${NC}"
    fi
else
    echo -e "${RED}❌ .env file not found${NC}"
    echo "   Run ./quickstart.sh to create it automatically"
fi

echo ""

# ============================================
# Container Status
# ============================================
echo -e "${BLUE}Container Status:${NC}"

if docker compose ps &> /dev/null; then
    docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Health}}"
    echo ""

    # Count services
    TOTAL=$(docker compose ps --format json 2>/dev/null | jq -s 'length' 2>/dev/null || echo 0)

    if command -v jq &> /dev/null; then
        RUNNING=$(docker compose ps --format json 2>/dev/null | jq -s '[.[] | select(.State == "running")] | length' 2>/dev/null || echo 0)
        HEALTHY=$(docker compose ps --format json 2>/dev/null | jq -s '[.[] | select(.Health == "healthy")] | length' 2>/dev/null || echo 0)
        echo "Summary: $RUNNING/$TOTAL running, $HEALTHY healthy"
    else
        echo "Summary: (install jq for detailed status)"
    fi
else
    echo -e "${YELLOW}⚠️  No containers running${NC}"
    echo "   Start with: docker compose up -d"
fi

echo ""

# ============================================
# Port Usage Check
# ============================================
echo -e "${BLUE}Port Usage Check:${NC}"

PORTS=(80 3001 3306 27017 6379 8080)
PORT_NAMES=("Frontend" "Backend" "MySQL" "MongoDB" "Redis" "SearXNG")

for i in "${!PORTS[@]}"; do
    PORT=${PORTS[$i]}
    NAME=${PORT_NAMES[$i]}

    if command -v lsof &> /dev/null; then
        if lsof -i :$PORT &> /dev/null; then
            echo -e "   ${GREEN}✅ Port $PORT ($NAME) is in use${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Port $PORT ($NAME) is not in use${NC}"
        fi
    elif command -v netstat &> /dev/null; then
        if netstat -tulpn 2>/dev/null | grep -q ":$PORT "; then
            echo -e "   ${GREEN}✅ Port $PORT ($NAME) is in use${NC}"
        else
            echo -e "   ${YELLOW}⚠️  Port $PORT ($NAME) is not in use${NC}"
        fi
    else
        echo -e "   ${YELLOW}⚠️  Cannot check port $PORT (install lsof or netstat)${NC}"
    fi
done

echo ""

# ============================================
# Connectivity Tests
# ============================================
echo -e "${BLUE}Connectivity Tests:${NC}"

# Test backend health endpoint
if curl -s http://localhost:3001/health > /dev/null 2>&1; then
    HEALTH_RESPONSE=$(curl -s http://localhost:3001/health)
    if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
        echo -e "   ${GREEN}✅ Backend API is responding (healthy)${NC}"
    else
        echo -e "   ${YELLOW}⚠️  Backend API responding but not healthy${NC}"
        echo "      Response: $HEALTH_RESPONSE"
    fi
else
    echo -e "   ${RED}❌ Backend API not responding${NC}"
    echo "      Check: docker compose logs backend"
fi

# Test frontend
if curl -s http://localhost:80 > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ Frontend is responding${NC}"
else
    echo -e "   ${RED}❌ Frontend not responding${NC}"
    echo "      Check: docker compose logs frontend"
fi

echo ""

# ============================================
# Disk Space Check
# ============================================
echo -e "${BLUE}Disk Space:${NC}"
df -h . | tail -1
echo ""

# ============================================
# Docker Volume Check
# ============================================
echo -e "${BLUE}Docker Volumes:${NC}"
docker volume ls | grep claraverse || echo "No ClaraVerse volumes found"
echo ""

# ============================================
# Recent Errors from Logs
# ============================================
echo -e "${BLUE}Recent Errors (last 50 lines):${NC}"

if docker compose ps &> /dev/null; then
    echo -e "${YELLOW}Backend errors:${NC}"
    docker compose logs --tail=50 backend 2>&1 | grep -i "error" | tail -5 || echo "   No recent errors"
    echo ""

    echo -e "${YELLOW}Frontend errors:${NC}"
    docker compose logs --tail=50 frontend 2>&1 | grep -i "error" | tail -5 || echo "   No recent errors"
    echo ""
else
    echo -e "${YELLOW}⚠️  No containers running${NC}"
fi

# ============================================
# Recommendations
# ============================================
echo "======================================"
echo -e "${BLUE}Recommendations:${NC}"
echo "======================================"

# Check if services are not running
if ! docker compose ps &> /dev/null || [ "$(docker compose ps --format json | wc -l)" -eq 0 ]; then
    echo "• Start services: ./quickstart.sh"
fi

# Check if .env is missing
if [ ! -f .env ]; then
    echo "• Create .env file: ./quickstart.sh"
fi

# Check if not all services are healthy
if command -v jq &> /dev/null && docker compose ps &> /dev/null; then
    TOTAL=$(docker compose ps --format json 2>/dev/null | wc -l | tr -d ' ')
    HEALTHY=$(docker compose ps --format json 2>/dev/null | jq -r 'select(.Health == "healthy")' 2>/dev/null | wc -l | tr -d ' ')

    if [ "$HEALTHY" -lt 7 ] && [ "$TOTAL" -gt 0 ]; then
        echo "• Wait for services to become healthy: docker compose ps"
        echo "• Or view logs for unhealthy services: docker compose logs <service-name>"
    fi
fi

echo ""
echo "For more help:"
echo "• View logs: docker compose logs -f"
echo "• Restart services: docker compose restart"
echo "• Full restart: docker compose down && ./quickstart.sh"
echo "• Report issues: https://github.com/yourusername/ClaraVerse-Scarlet-OSS/issues"
echo ""
