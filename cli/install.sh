#!/bin/bash
# ============================================
# ClaraVerse CLI Installer
# ============================================
# Usage: curl -fsSL https://get.claraverse.app | bash
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# URLs
GITHUB_REPO="claraverse-space/ClaraVerseAI"
CLI_URL="https://raw.githubusercontent.com/${GITHUB_REPO}/main/cli/claraverse"
INSTALL_PATH="/usr/local/bin/claraverse"

print_logo() {
    echo ""
    echo -e "${PURPLE}█▀▀ █   █▀█ █▀█ █▀█ █ █ █▀▀ █▀█ █▀▀ █▀▀${NC}"
    echo -e "${PURPLE}█   █   █▀█ █▀▄ █▀█ ▀▄▀ █▀▀ █▀▄ ▀▀█ █▀▀${NC}"
    echo -e "${PURPLE}▀▀▀ ▀▀▀ ▀ ▀ ▀ ▀ ▀ ▀  ▀  ▀▀▀ ▀ ▀ ▀▀▀ ▀▀▀${NC}"
    echo ""
    echo -e "${CYAN}Installing ClaraVerse CLI${NC}"
    echo ""
}

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "${PURPLE}→${NC} $1"
}

# Detect OS
detect_os() {
    case "$(uname -s)" in
        Linux*)     echo "linux";;
        Darwin*)    echo "macos";;
        CYGWIN*|MINGW*|MSYS*) echo "windows";;
        *)          echo "unknown";;
    esac
}

# Detect architecture
detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)   echo "amd64";;
        aarch64|arm64)  echo "arm64";;
        armv7l)         echo "armv7";;
        *)              echo "unknown";;
    esac
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Docker
check_docker() {
    if ! command_exists docker; then
        log_warning "Docker is not installed"
        echo ""
        echo "ClaraVerse requires Docker. Install it first:"
        echo ""
        case "$(detect_os)" in
            linux)
                echo "  curl -fsSL https://get.docker.com | sh"
                echo "  sudo usermod -aG docker \$USER"
                echo "  newgrp docker"
                ;;
            macos)
                echo "  brew install --cask docker"
                echo "  # Or download from: https://docs.docker.com/desktop/install/mac-install/"
                ;;
            windows)
                echo "  Download from: https://docs.docker.com/desktop/install/windows-install/"
                ;;
        esac
        echo ""
        return 1
    fi
    return 0
}

# Install CLI
install_cli() {
    local os=$(detect_os)
    local arch=$(detect_arch)

    log_info "Detected: $os ($arch)"

    # Check for sudo/root
    local use_sudo=""
    if [ "$(id -u)" -ne 0 ]; then
        if command_exists sudo; then
            use_sudo="sudo"
        else
            log_error "This script requires root privileges"
            log_info "Run with: sudo bash -c '\$(curl -fsSL https://get.claraverse.app)'"
            exit 1
        fi
    fi

    # Download CLI
    log_step "Downloading ClaraVerse CLI..."

    local tmp_file=$(mktemp)
    if command_exists curl; then
        curl -fsSL "$CLI_URL" -o "$tmp_file"
    elif command_exists wget; then
        wget -q "$CLI_URL" -O "$tmp_file"
    else
        log_error "curl or wget is required"
        exit 1
    fi

    # Install
    log_step "Installing to $INSTALL_PATH..."
    $use_sudo mv "$tmp_file" "$INSTALL_PATH"
    $use_sudo chmod +x "$INSTALL_PATH"

    log_success "ClaraVerse CLI installed!"
}

# Verify installation
verify_installation() {
    if command_exists claraverse; then
        log_success "Installation verified"
        return 0
    else
        log_error "Installation verification failed"
        log_info "You may need to add /usr/local/bin to your PATH"
        return 1
    fi
}

# Main
main() {
    print_logo

    # Check OS
    local os=$(detect_os)
    if [ "$os" = "unknown" ]; then
        log_error "Unsupported operating system"
        exit 1
    fi

    # Windows special handling
    if [ "$os" = "windows" ]; then
        log_warning "Windows detected"
        echo ""
        echo "For Windows, we recommend using WSL2 (Windows Subsystem for Linux):"
        echo "  1. Install WSL2: wsl --install"
        echo "  2. Open Ubuntu terminal"
        echo "  3. Run: curl -fsSL https://get.claraverse.app | bash"
        echo ""
        echo "Alternatively, use Docker Desktop with the all-in-one image:"
        echo "  docker run -d -p 80:80 claraverseoss/claraverse"
        echo ""
        exit 0
    fi

    # Install CLI
    install_cli

    # Verify
    if ! verify_installation; then
        exit 1
    fi

    # Check Docker
    echo ""
    if check_docker; then
        log_success "Docker is available"
    else
        log_warning "Install Docker first, then run: claraverse init"
        exit 0
    fi

    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  ClaraVerse CLI installed successfully!${NC}"
    echo -e "${GREEN}============================================${NC}"
    echo ""
    echo -e "${BOLD}Quick Start:${NC}"
    echo "  claraverse init        # Start ClaraVerse"
    echo "  claraverse status      # Check status"
    echo "  claraverse help        # Show all commands"
    echo ""
    echo -e "${BOLD}Start ClaraVerse now?${NC}"
    read -p "Run 'claraverse init'? (Y/n) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo ""
        exec claraverse init
    else
        echo ""
        echo "Run 'claraverse init' when ready to start."
    fi
}

main "$@"
