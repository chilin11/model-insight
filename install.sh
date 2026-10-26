#!/usr/bin/env bash
# 模型智见一键安装 / 更新（Linux + systemd，无 Docker / Nginx / Node）。
#
#   curl -fsSL https://github.com/chilin11/model-insight/releases/latest/download/install.sh | sudo bash
#
# 额外参数会传给 deploy.sh，例如首次指定端口：
#   curl -fsSL …/install.sh | sudo bash -s -- --port 8288
# 指定版本：MODEL_INSIGHT_VERSION=v0.2.1；只下载校验不部署：MODEL_INSIGHT_DRY_RUN=1。
# 再次运行即更新到最新版；文章、评论、图片和密钥保留在 /var/lib/model-insight 与 /etc/model-insight.env。
#
# Everything lives in main(), so bash parses the whole script before running it
# even when it is piped from curl.
set -euo pipefail

main() {
  local repo=${MODEL_INSIGHT_REPO:-chilin11/model-insight}
  local version=${MODEL_INSIGHT_VERSION:-latest}
  local dry_run=${MODEL_INSIGHT_DRY_RUN:-0}
  local asset=model-insight-vps.tar.gz
  fail() { printf '安装失败：%s\n' "$*" >&2; exit 1; }

  [[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'MODEL_INSIGHT_REPO 格式应为 owner/repo。'
  [[ "$version" == latest || "$version" =~ ^v[0-9A-Za-z._-]+$ ]] || fail 'MODEL_INSIGHT_VERSION 应为 latest 或 vX.Y.Z。'
  if [[ "$dry_run" != 1 ]]; then
    [[ $(uname -s) == Linux ]] || fail '只支持 Linux systemd VPS。'
    [[ $(id -u) == 0 ]] || fail '请用 sudo 运行：curl -fsSL … | sudo bash'
  fi
  local cmd
  for cmd in curl tar awk mktemp; do command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令 $cmd。"; done
  local hash
  if command -v sha256sum >/dev/null 2>&1; then hash='sha256sum'; elif command -v shasum >/dev/null 2>&1; then hash='shasum -a 256'; else fail '缺少 sha256sum。'; fi

  local base
  if [[ "$version" == latest ]]; then base="https://github.com/$repo/releases/latest/download"
  else base="https://github.com/$repo/releases/download/$version"; fi

  # /var/tmp rather than /tmp: deploy.sh runs the bundled binary to validate it,
  # and /tmp is often mounted noexec on VPS images.
  local work
  work=$(mktemp -d "${TMPDIR:-/var/tmp}/model-insight-install.XXXXXX")
  trap 'rm -rf "$work"' EXIT

  printf '下载 %s（%s）…\n' "$asset" "$version"
  local fetch=(curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 --connect-timeout 20)
  "${fetch[@]}" -o "$work/$asset" "$base/$asset" || fail "无法下载 $base/$asset"
  "${fetch[@]}" -o "$work/$asset.sha256" "$base/$asset.sha256" || fail '无法下载校验文件。'

  local expected actual
  expected=$(awk 'NR == 1 { print $1 }' "$work/$asset.sha256")
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail '校验文件格式错误。'
  actual=$($hash "$work/$asset" | awk '{ print $1 }')
  [[ "$actual" == "$expected" ]] || fail 'SHA256 不匹配，下载可能损坏，已停止。'
  printf 'SHA256 校验通过：%s\n' "$actual"

  # Refuse archives with absolute paths or parent-directory entries.
  if tar -tzf "$work/$asset" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then fail '部署包包含不安全路径。'; fi
  mkdir "$work/pkg"
  tar -xzf "$work/$asset" -C "$work/pkg" --no-same-owner
  bash "$work/pkg/deploy/validate-dist.sh" "$work/pkg" --require-checksums

  if [[ "$dry_run" == 1 ]]; then
    printf '仅校验模式：部署包完整，未执行部署。\n'
    return 0
  fi
  (cd "$work/pkg" && bash ./deploy.sh "$@" </dev/null)
  printf '\n完成。cloudflared 源站：http://127.0.0.1:8188（或你指定的端口）\n'
  printf '管理员密钥：sudo sed -n "s/^ADMIN_TOKEN=//p" /etc/model-insight.env\n'
  printf 'AI 接入密钥：sudo sed -n "s/^API_TOKEN=//p" /etc/model-insight.env\n'
  printf '以后更新：重新运行同一条安装命令。\n'
}

main "$@"
