#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose is not available." >&2
  exit 1
fi

if [[ ! -f "docker-compose.yml" ]]; then
  echo "Error: docker-compose.yml not found in $ROOT_DIR." >&2
  exit 1
fi

echo "==> Updating git branch (fast-forward only)"
git pull --ff-only

echo "==> Stopping and removing compose resources"
docker compose down --remove-orphans

echo "==> Removing local compose-built images"
docker compose down --rmi local --remove-orphans

echo "==> Pruning dangling Docker image cache"
docker image prune -f
docker builder prune -f

if [[ ! -f "config/ojs.json" ]]; then
  if [[ -f "config/ojs.example.json" ]]; then
    echo "==> Creating config/ojs.json from template"
    cp "config/ojs.example.json" "config/ojs.json"
    echo "Reminder: edit config/ojs.json with your OJS endpoint(s) and API token(s)."
  else
    echo "Warning: config/ojs.example.json not found; skipping OJS config bootstrap."
  fi
else
  echo "==> Found existing config/ojs.json"
fi

echo "==> Rebuilding and recreating compose stack"
docker compose up -d --build --force-recreate

echo
echo "Done. Quick checks:"
echo "  docker compose ps"
echo "  docker compose logs graphql | rg \"OJS|ojs|config/ojs.json\""
