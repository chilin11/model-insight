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
# macOS bsdtar would otherwise add AppleDouble `._*` entries and LIBARCHIVE.xattr
# headers, which GNU tar on the VPS warns about and validate-dist.sh rejects.
TAR_OPTS=()
if tar --version 2>/dev/null | grep -qi bsdtar; then
  TAR_OPTS=(--format ustar --no-xattrs --no-mac-metadata --no-acls --uid 0 --gid 0 --uname root --gname root)
  if command -v xattr >/dev/null 2>&1; then xattr -cr "$STAGE" 2>/dev/null || true; fi
fi
COPYFILE_DISABLE=1 tar ${TAR_OPTS[@]+"${TAR_OPTS[@]}"} -czf "$STAGE/model-insight-vps.tar.gz" -C "$STAGE" bin www seed.json deploy deploy.sh DEPLOY.md SHA256SUMS
# bsdtar's own listing hides AppleDouble entries, so inspect raw member names.
if command -v python3 >/dev/null 2>&1; then
  python3 - "$STAGE/model-insight-vps.tar.gz" <<'PY' || { printf '部署包含 macOS 元数据或扩展头，已停止。\n' >&2; exit 1; }
import sys, tarfile
members = tarfile.open(sys.argv[1]).getmembers()
bad = [m.name for m in members if '/._' in '/' + m.name or m.name.endswith('.DS_Store') or m.pax_headers]
sys.exit(1 if bad else 0)
PY
elif gzip -dc "$STAGE/model-insight-vps.tar.gz" | LC_ALL=C grep -aq '/\._\|^\._'; then printf '部署包含 macOS 元数据文件，已停止。\n' >&2; exit 1; fi
if gzip -dc "$STAGE/model-insight-vps.tar.gz" | LC_ALL=C grep -aq 'LIBARCHIVE\.'; then printf '部署包含 macOS 扩展属性头，已停止。\n' >&2; exit 1; fi
mv -f "$STAGE/model-insight-vps.tar.gz" release/model-insight-vps.tar.gz
printf '部署包：%s/release/model-insight-vps.tar.gz（无源码/依赖/密钥/运行数据）\n' "$ROOT"
