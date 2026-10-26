#!/usr/bin/env bash
# Build locally; VPS needs neither Node nor Go, and no containers.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
if (($#)); then printf 'Usage: GO_BIN=/path/to/go bash scripts/package-deploy.sh\n' >&2; exit 1; fi
GO_BIN=${GO_BIN:-$(command -v go || true)}
[[ -n "$GO_BIN" && -x "$GO_BIN" ]] || { printf '本机需要 Go 1.23+；可设置 GO_BIN（不自动安装工具链）。\n' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { printf '本机需要 Node.js/npm。\n' >&2; exit 1; }
[[ -f scripts/export-content.mjs ]] || { printf '缺少 scripts/export-content.mjs。\n' >&2; exit 1; }
if command -v sha256sum >/dev/null 2>&1; then HASH=(sha256sum); else HASH=(shasum -a 256); fi
STAGE=$(mktemp -d "${PI_SCRATCH_DIR:-${TMPDIR:-/tmp}}/model-insight-package.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
npm run build
# Exporter accepts an output path, so no generated seed/data enters the source tree.
node scripts/export-content.mjs "$STAGE/seed.json"
(cd server && CGO_ENABLED=0 "$GO_BIN" run . -check-seed "$STAGE/seed.json")
(cd server && "$GO_BIN" test ./...)
mkdir "$STAGE/bin" "$STAGE/deploy"
for arch in amd64 arm64; do
  (cd server && CGO_ENABLED=0 GOOS=linux GOARCH=$arch "$GO_BIN" build -trimpath -ldflags='-s -w' -o "$STAGE/bin/model-insight-linux-$arch" .)
done
cp -R dist "$STAGE/www"
cp deploy/validate-dist.sh "$STAGE/deploy/"
cp deploy.sh DEPLOY.md "$STAGE/"
for script in deploy.sh deploy/validate-dist.sh scripts/package-deploy.sh; do bash -n "$script"; done
(
  cd "$STAGE"
  while IFS= read -r file; do
    digest=$("${HASH[@]}" "$file"); digest=${digest%% *}; printf '%s  %s\n' "$digest" "$file"
  done < <(find www bin deploy -type f | LC_ALL=C sort; printf '%s\n' seed.json deploy.sh DEPLOY.md) > SHA256SUMS
)
bash "$STAGE/deploy/validate-dist.sh" "$STAGE" --require-checksums
mkdir -p release
[[ ! -L release && ! -L release/model-insight-vps.tar.gz ]] || { printf 'release 路径不允许符号链接。\n' >&2; exit 1; }
tar -czf "$STAGE/model-insight-vps.tar.gz" -C "$STAGE" bin www seed.json deploy deploy.sh DEPLOY.md SHA256SUMS
mv -f "$STAGE/model-insight-vps.tar.gz" release/model-insight-vps.tar.gz
printf '部署包：%s/release/model-insight-vps.tar.gz（无源码/依赖/密钥/运行数据）\n' "$ROOT"
