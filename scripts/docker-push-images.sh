#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

usage() {
  cat <<'EOF'
Build and push Stylimag app images to Docker Hub.

Usage:
  scripts/docker-push-images.sh --user <dockerhub_user> [options]

Options:
  --user <name>         Docker Hub username/namespace (required)
  --tag <tag>           Image tag to push (default: current git short SHA)
  --no-latest           Do not also tag/push :latest
  --skip-login          Skip docker login check/login
  --no-verify-pull      Skip pull verification after push
  -h, --help            Show this help

Examples:
  scripts/docker-push-images.sh --user themrln
  scripts/docker-push-images.sh --user themrln --tag v1.2.0
  scripts/docker-push-images.sh --user themrln --tag v1.2.0 --no-latest
EOF
}

DOCKERHUB_USER=""
CUSTOM_TAG=""
PUSH_LATEST=true
SKIP_LOGIN=false
VERIFY_PULL=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user)
      DOCKERHUB_USER="${2:-}"
      shift 2
      ;;
    --tag)
      CUSTOM_TAG="${2:-}"
      shift 2
      ;;
    --no-latest)
      PUSH_LATEST=false
      shift
      ;;
    --skip-login)
      SKIP_LOGIN=true
      shift
      ;;
    --no-verify-pull)
      VERIFY_PULL=false
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

if [[ -n "$CUSTOM_TAG" ]]; then
  TAG="$CUSTOM_TAG"
else
  if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is required to auto-generate a tag. Use --tag instead." >&2
    exit 1
  fi
  TAG="$(git rev-parse --short HEAD)"
fi

GRAPHQL_LOCAL_IMAGE="stylimag-graphql:latest"
FRONT_LOCAL_IMAGE="stylimag-front:latest"
GRAPHQL_REMOTE_TAGGED="${DOCKERHUB_USER}/stylimag-graphql:${TAG}"
FRONT_REMOTE_TAGGED="${DOCKERHUB_USER}/stylimag-front:${TAG}"
GRAPHQL_REMOTE_LATEST="${DOCKERHUB_USER}/stylimag-graphql:latest"
FRONT_REMOTE_LATEST="${DOCKERHUB_USER}/stylimag-front:latest"

echo "==> Docker Hub user: ${DOCKERHUB_USER}"
echo "==> Tag: ${TAG}"
echo "==> Push latest: ${PUSH_LATEST}"
echo

if [[ "$SKIP_LOGIN" == false ]]; then
  echo "==> Docker login"
  docker login
fi

echo "==> Building compose images (graphql, front)"
docker compose build graphql front

echo "==> Tagging images"
docker tag "$GRAPHQL_LOCAL_IMAGE" "$GRAPHQL_REMOTE_TAGGED"
docker tag "$FRONT_LOCAL_IMAGE" "$FRONT_REMOTE_TAGGED"

if [[ "$PUSH_LATEST" == true ]]; then
  docker tag "$GRAPHQL_LOCAL_IMAGE" "$GRAPHQL_REMOTE_LATEST"
  docker tag "$FRONT_LOCAL_IMAGE" "$FRONT_REMOTE_LATEST"
fi

echo "==> Pushing tagged images"
docker push "$GRAPHQL_REMOTE_TAGGED"
docker push "$FRONT_REMOTE_TAGGED"

if [[ "$PUSH_LATEST" == true ]]; then
  docker push "$GRAPHQL_REMOTE_LATEST"
  docker push "$FRONT_REMOTE_LATEST"
fi

if [[ "$VERIFY_PULL" == true ]]; then
  echo "==> Verifying pull for tagged images"
  docker pull "$GRAPHQL_REMOTE_TAGGED"
  docker pull "$FRONT_REMOTE_TAGGED"
fi

echo
echo "Done."
echo "Pushed:"
echo "  - $GRAPHQL_REMOTE_TAGGED"
echo "  - $FRONT_REMOTE_TAGGED"
if [[ "$PUSH_LATEST" == true ]]; then
  echo "  - $GRAPHQL_REMOTE_LATEST"
  echo "  - $FRONT_REMOTE_LATEST"
fi
echo
echo "Mongo note: compose uses upstream mongo:6; this script does not push Mongo."
