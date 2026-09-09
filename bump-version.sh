#!/bin/bash
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <new-version>"
  echo "Example: $0 2.3.0"
  exit 1
fi

NEW_VER="$1"
CURRENT_VER=$(node -p "require('./package.json').version")

echo "Bumping version: v$CURRENT_VER → v$NEW_VER"

# package.json
node -e "
const p = require('./package.json');
p.version = '$NEW_VER';
require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2) + '\n');
"

# plugin.json
if [ -f "./plugin.json" ]; then
  node -e "
  const p = require('./plugin.json');
  p.version = '$NEW_VER';
  require('fs').writeFileSync('./plugin.json', JSON.stringify(p, null, 2) + '\n');
  "
fi

# docs/index.html
sed -i '' "s|v$CURRENT_VER|v$NEW_VER|g" docs/index.html

echo "✅ Version bumped to v$NEW_VER in:"
echo "   - package.json"
echo "   - plugin.json"
echo "   - docs/index.html"
