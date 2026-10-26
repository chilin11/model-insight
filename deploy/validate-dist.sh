#!/usr/bin/env bash
# Validate the explicit binary/static release allowlist, never execute a payload.
set -euo pipefail
ROOT=${1:-$(cd "$(dirname "$0")/.." && pwd)}
cd "$ROOT"
fail() { printf '校验失败：%s\n' "$*" >&2; exit 1; }
for file in www/index.html deploy/validate-dist.sh deploy.sh DEPLOY.md seed.json; do
  [[ -f "$file" && -s "$file" && ! -L "$file" ]] || fail "缺少普通文件：$file"
done
for dir in www www/assets bin deploy; do [[ -d "$dir" && ! -L "$dir" ]] || fail "缺少目录：$dir"; done
[[ -z $(find www bin deploy -type l -print -quit) ]] || fail '不允许符号链接。'
[[ -z $(find www bin deploy ! -type f ! -type d -print -quit) ]] || fail '不允许特殊文件。'
while IFS= read -r -d '' file; do
  [[ "$file" =~ ^[a-zA-Z0-9_./-]+$ && "$file" != *'/.'* && -s "$file" ]] || fail "不安全/空文件：$file"
done < <(find www bin deploy -type f -print0)
for arch in amd64 arm64; do
  binary=bin/model-insight-linux-$arch
  [[ -s "$binary" && -x "$binary" ]] || fail "缺少可执行文件：$binary"
  magic=$(od -An -N4 -tx1 "$binary" | tr -d ' \n')
  machine=$(od -An -j18 -N2 -tx1 "$binary" | tr -d ' \n')
  [[ "$magic" == 7f454c46 ]] || fail "不是 ELF：$binary"
  case "$arch:$machine" in amd64:3e00|arm64:b700) ;; *) fail "ELF 架构错误：$binary" ;; esac
done
[[ -n $(find www/assets -type f -name '*.js' -print -quit) && -n $(find www/assets -type f -name '*.css' -print -quit) ]] || fail '缺少 JS/CSS。'
while IFS= read -r -d '' file; do [[ "${file##*/}" =~ -[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$ ]] || fail "assets 未使用内容哈希：$file"; done < <(find www/assets -type f -print0)
grep -q 'id="root"' www/index.html || fail 'HTML 缺少 React root。'
while IFS= read -r attr; do
  ref=${attr#*\"}; ref=${ref%\"}
  case "$ref" in https://*|http://*|//*|data:*|\#*|/rss.xml) continue ;; esac
  ref=${ref%%\?*}; ref=${ref%%\#*}; ref=${ref#/}; ref=${ref#./}
  [[ -n "$ref" && "$ref" != *'..'* && -s "www/$ref" && -f "www/$ref" ]] || fail "HTML 引用缺失：$ref"
done < <(grep -Eo '(src|href)="[^"]+"' www/index.html)
if [[ ${2:-} == --require-checksums ]]; then
  [[ -s SHA256SUMS && ! -L SHA256SUMS ]] || fail '缺少 SHA256SUMS。'
  if command -v sha256sum >/dev/null 2>&1; then HASH=(sha256sum); else HASH=(shasum -a 256); fi
  count=0
  while IFS= read -r file; do
    digest=$("${HASH[@]}" "$file"); digest=${digest%% *}
    grep -Fqx "$digest  $file" SHA256SUMS || fail "文件损坏或未收录：$file"
    count=$((count+1))
  done < <(find www bin deploy -type f | LC_ALL=C sort; printf '%s\n' seed.json deploy.sh DEPLOY.md)
  [[ $(wc -l < SHA256SUMS) -eq "$count" ]] || fail 'SHA256SUMS 有额外/重复条目。'
fi
printf 'Go 部署包校验通过。\n'
