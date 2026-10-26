#!/usr/bin/env bash
# Build the VPS package and publish it as a GitHub Release with install.sh.
#   GO_BIN=/path/to/go bash scripts/release.sh v0.2.1
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
TAG=${1:-}
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Usage: GO_BIN=/path/to/go bash scripts/release.sh vX.Y.Z\n' >&2; exit 1; }
command -v gh >/dev/null 2>&1 || { printf '需要 GitHub CLI（gh）。\n' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { printf '工作区有未提交修改，先提交再发布。\n' >&2; exit 1; }
git fetch -q origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || { printf 'HEAD 与 origin/main 不一致，先推送。\n' >&2; exit 1; }
! gh release view "$TAG" >/dev/null 2>&1 || { printf 'Release %s 已存在。\n' "$TAG" >&2; exit 1; }
bash -n install.sh
bash scripts/package-deploy.sh
if command -v sha256sum >/dev/null 2>&1; then HASH=(sha256sum); else HASH=(shasum -a 256); fi
(cd release && "${HASH[@]}" model-insight-vps.tar.gz > model-insight-vps.tar.gz.sha256)
cp install.sh release/install.sh
gh release create "$TAG" release/model-insight-vps.tar.gz release/model-insight-vps.tar.gz.sha256 release/install.sh \
  --target "$(git rev-parse HEAD)" --title "$TAG" --latest \
  --notes "VPS 一键安装 / 更新：

\`\`\`sh
curl -fsSL https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/latest/download/install.sh | sudo bash
\`\`\`

安装脚本会下载部署包、校验 SHA256 后执行 deploy.sh。文章、评论、图片和密钥在更新时保留。"
printf '已发布 %s\n' "$TAG"
