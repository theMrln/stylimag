#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Pull Stylimag images from Docker Hub and run locally via docker compose.

Usage:
  scripts/docker-run-from-hub.sh --user <dockerhub_user> [options]

Options:
  --user <name>          Docker Hub username/namespace (required)
  --tag <tag>            Image tag to pull (default: latest)
  --skip-bootstrap       Do not create missing .env/config files from examples
  --no-up                Only pull + tag; do not start compose services
  -h, --help             Show this help

Examples:
  scripts/docker-run-from-hub.sh --user themrln
  scripts/docker-run-from-hub.sh --user themrln --tag v1.2.0
EOF
}

DOCKERHUB_USER=""
IMAGE_TAG="latest"
SKIP_BOOTSTRAP=false
RUN_UP=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      DOCKERHUB_USER="${2:-}"
      shift 2
      ;;
    --tag)
      IMAGE_TAG="${2:-}"
      shift 2
      ;;
    --skip-bootstrap)
      SKIP_BOOTSTRAP=true
      shift
      ;;
    --no-up)
      RUN_UP=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$DOCKERHUB_USER" ]]; then
  echo "Error: --user is required." >&2
  usage >&2
  exit 1
fi

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

if [[ "$SKIP_BOOTSTRAP" == false ]]; then
  if [[ ! -f ".env" && -f "stylo-example.env" ]]; then
    echo "==> Creating .env from stylo-example.env"
    cp "stylo-example.env" ".env"
  fi

  if [[ ! -f "config/ojs.json" && -f "config/ojs.example.json" ]]; then
    echo "==> Creating config/ojs.json from config/ojs.example.json"
    cp "config/ojs.example.json" "config/ojs.json"
  fi
fi

GRAPHQL_REMOTE_IMAGE="${DOCKERHUB_USER}/stylimag-graphql:${IMAGE_TAG}"
FRONT_REMOTE_IMAGE="${DOCKERHUB_USER}/stylimag-front:${IMAGE_TAG}"
GRAPHQL_LOCAL_IMAGE="stylimag-graphql:latest"
FRONT_LOCAL_IMAGE="stylimag-front:latest"

echo "==> Pulling images from Docker Hub"
docker pull "$GRAPHQL_REMOTE_IMAGE"
docker pull "$FRONT_REMOTE_IMAGE"

echo "==> Tagging to local compose image names"
docker tag "$GRAPHQL_REMOTE_IMAGE" "$GRAPHQL_LOCAL_IMAGE"
docker tag "$FRONT_REMOTE_IMAGE" "$FRONT_LOCAL_IMAGE"

if [[ "$RUN_UP" == true ]]; then
  echo "==> Starting local compose stack without rebuild"
  docker compose up -d --no-build mongo graphql front
fi

echo
echo "Done."
echo "Using:"
echo "  - $GRAPHQL_REMOTE_IMAGE -> $GRAPHQL_LOCAL_IMAGE"
echo "  - $FRONT_REMOTE_IMAGE -> $FRONT_LOCAL_IMAGE"
echo
echo "Mongo note: compose uses upstream mongo:6 (pulled automatically if needed)."
