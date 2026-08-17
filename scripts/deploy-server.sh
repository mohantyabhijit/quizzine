#!/usr/bin/env bash
set -euo pipefail

site_path="$1"
upload_token="$2"
storage_key="$3"

# Keep a locally rotated bridge key across deploys if GitHub Actions cannot
# update its secret immediately. The file is root-only and is never synced.
if test -r "$site_path/.quizzine-storage-key"; then
  storage_key=$(cat "$site_path/.quizzine-storage-key")
fi

if ! command -v soffice >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get -f install -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y libreoffice-impress
fi

mkdir -p "$site_path/data" "$site_path/public/uploads"
test -f "$site_path/data/quizzes.json" || printf '[]\n' > "$site_path/data/quizzes.json"

if test -f "$site_path/quizzine-api.pid" && kill -0 "$(cat "$site_path/quizzine-api.pid")" 2>/dev/null; then
  kill "$(cat "$site_path/quizzine-api.pid")"
fi

cd "$site_path"
nohup env QUIZZINE_UPLOAD_TOKEN="$upload_token" QUIZZINE_STORAGE_URL="https://quizzine.org" QUIZZINE_STORAGE_KEY="$storage_key" PORT=8081 ./quizzine-api > quizzine-api.log 2>&1 &
echo $! > quizzine-api.pid
