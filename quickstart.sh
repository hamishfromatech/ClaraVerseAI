#!/bin/bash
# ============================================
# ClaraVerse Quickstart
# ============================================
# Get up and running in 60 seconds!
# Works on Linux and macOS
# ============================================

set -e

echo "🚀 ClaraVerse Quickstart"
echo "========================"
echo ""

# Colors for better UX
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Detect OS
OS=$(uname -s)
echo "Detected OS: $OS"
echo ""

# ============================================
# Step 1: Check Docker Installation
# ============================================
echo -e "${BLUE}Step 1: Checking Docker installation...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found${NC}"
    echo ""
    echo "Please install Docker Desktop:"
    echo "  • macOS/Windows: https://www.docker.com/products/docker-desktop"
    echo "  • Linux: https://docs.docker.com/engine/install/"
    echo ""
    exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo -e "${RED}❌ Docker Compose not found${NC}"
    echo ""
    echo "Please install Docker Compose:"
    echo "  • https://docs.docker.com/compose/install/"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Docker is installed${NC}"
docker --version
docker compose version
echo ""

# ============================================
# Step 2: Setup .env File
# ============================================
echo -e "${BLUE}Step 2: Setting up environment configuration...${NC}"

if [ -f .env ]; then
    echo -e "${GREEN}✅ .env file already exists${NC}"
    echo -e "${YELLOW}   Using existing configuration${NC}"
    echo ""
else
    echo "📝 Creating .env file with auto-generated secure keys..."

    # Generate secure random keys
    echo "   Generating ENCRYPTION_MASTER_KEY..."
    if command -v openssl &> /dev/null; then
        ENCRYPTION_KEY=$(openssl rand -hex 32)
    else
        # Fallback to /dev/urandom
        ENCRYPTION_KEY=$(head -c 32 /dev/urandom | xxd -p -c 32)
    fi

    echo "   Generating JWT_SECRET..."
    if command -v openssl &> /dev/null; then
        JWT_SECRET=$(openssl rand -hex 64)
    else
        # Fallback to /dev/urandom
        JWT_SECRET=$(head -c 64 /dev/urandom | xxd -p -c 64)
    fi

    # Copy .env.default or .env.example to .env
    if [ -f .env.default ]; then
        cp .env.default .env
    elif [ -f .env.example ]; then
        echo -e "${YELLOW}   Using .env.example as template${NC}"
        cp .env.example .env
    else
        echo -e "${RED}❌ Neither .env.default nor .env.example found${NC}"
        echo "Please ensure you're in the ClaraVerse-Scarlet-OSS directory"
        exit 1
    fi

    # Replace placeholder values with generated keys
    # Handle macOS vs Linux sed syntax differences
    if [[ "$OS" == "Darwin" ]]; then
        # macOS sed syntax - handle both empty values and "auto-generated" placeholder
        sed -i '' "s/^ENCRYPTION_MASTER_KEY=.*/ENCRYPTION_MASTER_KEY=$ENCRYPTION_KEY/" .env
        sed -i '' "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    else
        # Linux sed syntax - handle both empty values and "auto-generated" placeholder
        sed -i "s/^ENCRYPTION_MASTER_KEY=.*/ENCRYPTION_MASTER_KEY=$ENCRYPTION_KEY/" .env
        sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    fi

    echo -e "${GREEN}✅ .env file created with secure keys${NC}"
    echo -e "${YELLOW}   Keys have been saved to .env (keep this file secure!)${NC}"
    echo ""
fi

# ============================================
# Step 3: Clean Up Old Containers
# ============================================
echo -e "${BLUE}Step 3: Cleaning up old containers...${NC}"
docker compose down 2>/dev/null || true
echo -e "${GREEN}✅ Cleanup complete${NC}"
echo ""

# ============================================
# Step 4: Pull Docker Images
# ============================================
echo -e "${BLUE}Step 4: Pulling Docker images...${NC}"
echo -e "${YELLOW}   This may take a few minutes on first run...${NC}"
docker compose pull --quiet || docker compose pull
echo -e "${GREEN}✅ Images pulled${NC}"
echo ""

# ============================================
# Step 5: Start All Services
# ============================================
echo -e "${BLUE}Step 5: Starting ClaraVerse...${NC}"
echo -e "${YELLOW}   Docker will automatically start services in the correct order${NC}"
echo -e "${YELLOW}   This may take 60-90 seconds...${NC}"
echo ""

# Start all services and let Docker Compose handle dependencies
docker compose up -d --build

echo ""
echo -e "${GREEN}✅ All services started${NC}"
echo ""

# ============================================
# Step 6: Wait for Services to Be Healthy
# ============================================
echo -e "${BLUE}Step 6: Waiting for services to become healthy...${NC}"
echo ""

MAX_WAIT=120
ELAPSED=0
SERVICES_TOTAL=7

while [ $ELAPSED -lt $MAX_WAIT ]; do
    # Count healthy services using jq if available
    if command -v jq &> /dev/null; then
        # Use jq -s to slurp all JSON objects and count how many have Health == "healthy"
        HEALTHY=$(docker compose ps --format json 2>/dev/null | jq -s '[.[] | select(.Health == "healthy")] | length' 2>/dev/null || echo 0)
    else
        # Fallback: just wait and skip progress tracking
        echo -e "${YELLOW}   Waiting for services to initialize (install jq for progress tracking)...${NC}"
        sleep 30
        break
    fi

    echo -ne "\r   Services healthy: $HEALTHY/$SERVICES_TOTAL"

    if [ "$HEALTHY" -eq "$SERVICES_TOTAL" ]; then
        echo ""
        echo ""
        echo -e "${GREEN}✅ All services are healthy!${NC}"
        break
    fi

    sleep 3
    ELAPSED=$((ELAPSED + 3))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    echo ""
    echo -e "${YELLOW}⚠️  Startup is taking longer than expected${NC}"
    echo "   Services may still be initializing. Check with:"
    echo "   docker compose ps"
    echo ""
fi

# ============================================
# Success Message
# ============================================
echo ""
echo "======================================"
echo -e "${GREEN}🎉 ClaraVerse is Running!${NC}"
echo "======================================"
echo ""
echo "Access your instance:"
echo -e "  ${BLUE}Frontend:${NC}     http://localhost:80"
echo -e "  ${BLUE}Backend API:${NC}  http://localhost:3001"
echo -e "  ${BLUE}Health Check:${NC} http://localhost:3001/health"
echo ""
echo "First Steps:"
echo "  1. Open http://localhost:80 in your browser"
echo "  2. Register your account (first user becomes admin!)"
echo "  3. Add your AI provider API keys in Settings"
echo ""
echo "Useful Commands:"
echo "  • View logs:       docker compose logs -f"
echo "  • View logs (one): docker compose logs -f backend"
echo "  • Stop all:        docker compose down"
echo "  • Restart all:     docker compose restart"
echo "  • Check status:    docker compose ps"
echo ""
echo "Documentation:"
echo "  • README.md - Full documentation"
echo "  • .env - Your configuration (keep secure!)"
echo ""
echo "Troubleshooting:"
echo "  • Run ./diagnose.sh for diagnostic information"
echo "  • Report issues: https://github.com/yourusername/ClaraVerse-Scarlet-OSS/issues"
echo ""
