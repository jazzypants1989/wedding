#!/usr/bin/env node
/**
 * Deploy to production
 * Usage: node scripts/deploy.js
 */

import { execSync } from "node:child_process"

const VPS_HOST = "jesse@jovial-penguin-1"
const VPS_PORT = "2420"

const remoteScript = `
set -e

echo "==> Connected to $(hostname)"
echo "    Working directory: ~/services/wedding"
cd ~/services/wedding

echo ""
echo "==> Current state:"
echo "    Git branch: $(git branch --show-current)"
echo "    Git commit: $(git log -1 --format='%h %s')"
echo "    Container:  $(docker inspect --format='{{.State.Status}} ({{.State.Health.Status}})' wedding 2>/dev/null || echo 'not found')"

echo ""
echo "==> Backing up database..."
echo "    Running: docker exec wedding cp /app/data/wedding.db /app/data/wedding.db.backup"
if docker exec wedding cp /app/data/wedding.db /app/data/wedding.db.backup 2>/dev/null; then
    echo "    Backup created at /app/data/wedding.db.backup"
else
    echo "    Skipping backup (container not running or no database yet)"
fi

echo ""
echo "==> Pulling latest code..."
echo "    Running: git pull"
git pull

echo ""
echo "==> New state after pull:"
echo "    Git commit: $(git log -1 --format='%h %s')"

echo ""
echo "==> Rebuilding and restarting..."
echo "    Running: docker compose up -d --build"
docker compose up -d --build

echo ""
echo "==> Waiting for container to be healthy..."
for i in {1..30}; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' wedding 2>/dev/null || echo "starting")
    echo "    [$i/30] Status: $STATUS"
    if [ "$STATUS" = "healthy" ]; then
        echo ""
        echo "==> Container is healthy!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo ""
        echo "==> ERROR: Health check timed out after 30 seconds"
        echo "    Last 20 lines of logs:"
        docker logs --tail 20 wedding
        exit 1
    fi
    sleep 1
done

echo ""
echo "==> Deploy complete!"
echo "    Site: https://jordanaandjesse.com"
`

console.log("Deploying to production...\n")

try {
    execSync(`ssh -p ${VPS_PORT} ${VPS_HOST} bash -s`, {
        input: remoteScript,
        stdio: ["pipe", "inherit", "inherit"],
    })
} catch (err) {
    console.error("\nDeploy failed!")
    process.exit(1)
}
