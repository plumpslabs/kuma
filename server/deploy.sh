#!/bin/bash
# ============================================================
# KOLEKTIF — Deploy to VPS
# ============================================================
# Usage:
#   ssh root@vps-ip 'bash -s' < deploy.sh
#
# Or copy to VPS and run:
#   chmod +x deploy.sh && ./deploy.sh
# ============================================================

set -e

REPO_URL="${KUMA_REPO_URL:-https://github.com/plumpslabs/kuma.git}"
BRANCH="${KUMA_BRANCH:-main}"
SERVER_DIR="${KUMA_SERVER_DIR:-/opt/kolektif}"
PORT="${KUMA_PORT:-3000}"

echo "🐻 Kolektif Server — Deploy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. Check prerequisites
echo "📦 Checking prerequisites..."
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt install -y nodejs
fi

if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

# 2. Clone/update repo
if [ -d "$SERVER_DIR" ]; then
    echo "🔄 Updating existing installation..."
    cd "$SERVER_DIR"
    git pull origin "$BRANCH"
else
    echo "📥 Cloning repository..."
    git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$SERVER_DIR"
    cd "$SERVER_DIR"
fi

# 3. Install server dependencies
echo "📦 Installing dependencies..."
cd server
npm install

# 4. Build
echo "🔨 Building..."
npm run build

# 5. Ensure data directory
mkdir -p data

# 6. Start/Restart with PM2
echo "🚀 Starting server..."
pm2 delete kuma-server 2>/dev/null || true
pm2 start dist/index.js --name kuma-server -- --port "$PORT"
pm2 save

echo ""
echo "✅ Deploy complete!"
echo "📍 Server running on port $PORT"
echo "📊 Logs: pm2 logs kuma-server"
echo "🔄 Status: pm2 status"
