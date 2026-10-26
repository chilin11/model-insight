#!/usr/bin/env bash
# model-insight: single Go process, no proxy/container/package installation.
set -euo pipefail
umask 077
SOURCE=$(cd "$(dirname "$0")" && pwd)
APP_DIR=/opt/model-insight
DATA_DIR=/var/lib/model-insight
ENV_FILE=/etc/model-insight.env
SYSTEMD_DIR=/etc/systemd/system
REQUESTED_PORT=${PORT:-}
MARKER='# model-insight managed go v2'
USER_MARKER='Model Insight managed go v2'
fail() { printf '部署失败：%s\n' "$*" >&2; exit 1; }
usage() { printf '%s\n' 'Usage: sudo bash deploy.sh [--port 8188] [--app-dir /opt/model-insight]' '  [--data-dir /var/lib/model-insight] [--env-file /etc/model-insight.env]' '  [--systemd-dir /etc/systemd/system]' 'Linux + systemd only; PORT= sets first-install port. Existing env is preserved.'; }
while (($#)); do
  case "$1" in
    --port|--app-dir|--data-dir|--env-file|--systemd-dir)
      (($# >= 2)) || fail "$1 缺少参数"
      case "$1" in --port) REQUESTED_PORT=$2 ;; --app-dir) APP_DIR=$2 ;; --data-dir) DATA_DIR=$2 ;; --env-file) ENV_FILE=$2 ;; --systemd-dir) SYSTEMD_DIR=$2 ;; esac
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知选项：$1" ;;
  esac
done
[[ $(uname -s) == Linux ]] || fail '只支持 Linux systemd VPS；不要在 macOS 运行 sudo 部署。'
[[ $(id -u) == 0 ]] || fail '请使用 sudo bash deploy.sh。'
case $(uname -m) in x86_64|amd64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; *) fail '只支持 amd64/arm64。' ;; esac
for cmd in systemctl ss install find readlink awk grep cp mv ln curl runuser getent useradd chown stat od tr; do command -v "$cmd" >/dev/null 2>&1 || fail "缺少命令 $cmd；请先人工安装依赖。"; done
systemctl list-units --no-legend --all >/dev/null 2>&1 || fail '无法连接 systemd system manager（不支持非 systemd Linux）。'
safe_path() {
  local p=$1
  [[ "$p" =~ ^/[a-zA-Z0-9_./-]+$ && "$p" != / && "$p" != */ && "$p" != *'//'* && "$p/" != *'/./'* && "$p/" != *'/../'* ]] || fail '路径必须是无空格、无跳转的绝对路径。'
  while [[ "$p" != / ]]; do [[ ! -L "$p" ]] || fail "路径不允许符号链接：$p"; p=$(dirname "$p"); done
}
for p in "$APP_DIR" "$DATA_DIR" "$ENV_FILE" "$SYSTEMD_DIR"; do safe_path "$p"; done
[[ "$APP_DIR" == */model-insight && "$DATA_DIR" == */model-insight && "$APP_DIR" != "$DATA_DIR" && "$APP_DIR/" != "$DATA_DIR/"* && "$DATA_DIR/" != "$APP_DIR/"* ]] || fail '程序和数据必须是互不嵌套、名为 model-insight 的独立目录。'
[[ -d "$SYSTEMD_DIR" && -d $(dirname "$ENV_FILE") ]] || fail 'systemd/env 父目录不存在。'
UNIT=$SYSTEMD_DIR/model-insight.service
OWNERSHIP=$(printf '%s\n# App: %s\n# Data: %s\n# Env: %s\n' "$MARKER" "$APP_DIR" "$DATA_DIR" "$ENV_FILE")
owned_file() {
  local file=$1 line
  [[ -f "$file" && ! -L "$file" ]] || fail "拒绝覆盖非普通文件：$file"
  while IFS= read -r line; do grep -Fqx "$line" "$file" || fail "拒绝接管未知文件：$file"; done <<< "$OWNERSHIP"
}
for dir in "$APP_DIR" "$DATA_DIR"; do
  if [[ -e "$dir" ]]; then [[ -d "$dir" ]] || fail "不是目录：$dir"; owned_file "$dir/.model-insight-managed"; fi
done
[[ ! -e "$UNIT" && ! -L "$UNIT" ]] || owned_file "$UNIT"
if [[ -e "$ENV_FILE" || -L "$ENV_FILE" ]]; then
  owned_file "$ENV_FILE"
  [[ $(stat -c '%a:%u' "$ENV_FILE") == 600:0 ]] || fail 'env 必须归 root 所有且权限为 0600。'
fi
fragment=$(systemctl show --property FragmentPath --value model-insight.service 2>/dev/null || true)
[[ -z "$fragment" || ( "$fragment" == "$UNIT" && -f "$UNIT" ) ]] || fail '发现其他路径的同名 unit，拒绝接管。'
[[ -z $(systemctl show --property DropInPaths --value model-insight.service 2>/dev/null || true) ]] || fail '同名服务有未知 drop-in 配置，拒绝接管。'
for sub in releases .deploy-lock; do [[ ! -L "$APP_DIR/$sub" ]] || fail '程序子目录不允许符号链接。'; done
[[ ! -e "$APP_DIR/releases" || -d "$APP_DIR/releases" ]] || fail 'releases 不是目录。'
OLD_TARGET=
read_current() {
  OLD_TARGET=
  if [[ -e "$APP_DIR/current" || -L "$APP_DIR/current" ]]; then
    [[ -L "$APP_DIR/current" ]] || fail 'current 必须是版本链接。'
    OLD_TARGET=$(readlink "$APP_DIR/current")
    [[ "$OLD_TARGET" =~ ^releases/[a-zA-Z0-9_-]+$ && -d "$APP_DIR/$OLD_TARGET" && ! -L "$APP_DIR/$OLD_TARGET" ]] || fail 'current 指向未知/缺失版本。'
  fi
}
read_current
# Validate before creating any installation directory, user, env or service.
bash "$SOURCE/deploy/validate-dist.sh" "$SOURCE" --require-checksums
BINARY=$SOURCE/bin/model-insight-linux-$ARCH
"$BINARY" -check-seed "$SOURCE/seed.json" >/dev/null || fail 'seed.json 校验失败。'
PORT=${REQUESTED_PORT:-8188}
CONFIG=()
read_env() {
  local line key value seen='|'
  CONFIG=()
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail 'env 格式错误（只支持 KEY=value，不执行 shell）。'
    key=${line%%=*}; value=${line#*=}
    [[ "$seen" != *"|$key|"* && "$value" =~ ^[a-zA-Z0-9_./:+-]+$ ]] || fail 'env 重复字段或不安全值。'; seen+="$key|"
    case "$key" in
      LISTEN_ADDR) [[ "$value" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || fail 'LISTEN_ADDR 只允许回环地址。'; PORT=${BASH_REMATCH[1]} ;;
      DATA_DIR) [[ "$value" == "$DATA_DIR" ]] || fail 'env DATA_DIR 与部署目录不一致。' ;;
      WEB_DIR) [[ "$value" == "$APP_DIR/current/www" ]] || fail 'env WEB_DIR 与程序目录不一致。' ;;
      SEED_FILE) [[ "$value" == "$APP_DIR/current/seed.json" ]] || fail 'env SEED_FILE 与程序目录不一致。' ;;
      ADMIN_TOKEN|API_TOKEN) : ;;
      *) fail 'env 有未知字段。' ;;
    esac
    CONFIG+=("$key=$value")
  done < "$ENV_FILE"
  [[ ${#CONFIG[@]} == 6 ]] || fail 'env 缺少必要字段。'
}
if [[ -f "$ENV_FILE" ]]; then read_env; [[ -z "$REQUESTED_PORT" || "$REQUESTED_PORT" == "$PORT" ]] || fail '已有 env 的端口保持不变；请先人工编辑 LISTEN_ADDR 再部署。'; fi
[[ "$PORT" =~ ^[1-9][0-9]{3,4}$ ]] && ((PORT >= 1024 && PORT <= 65535)) || fail '端口必须为 1024–65535 的十进制整数。'
case "$PORT" in 5173|5188) fail '禁止使用 5173/5188。' ;; esac
WAS_ACTIVE=0; WAS_ENABLED=0
systemctl is-active --quiet model-insight.service && WAS_ACTIVE=1
systemctl is-enabled --quiet model-insight.service && WAS_ENABLED=1
if ((WAS_ACTIVE)); then [[ -f "$UNIT" && -f "$ENV_FILE" && -n "$OLD_TARGET" ]] || fail '发现无法识别的同名运行服务。'; fi
check_port() {
  local sockets pid line
  sockets=$(ss -H -ltnp "sport = :$PORT") || fail '无法检查端口。'
  [[ -z "$sockets" ]] && return 0
  ((WAS_ACTIVE)) || fail "端口 $PORT 已占用；未更改任何服务。"
  pid=$(systemctl show --property MainPID --value model-insight.service)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || fail '无法确认已有服务 PID。'
  while IFS= read -r line; do [[ $(awk '{print $4}' <<< "$line") == "127.0.0.1:$PORT" && "$line" == *"pid=$pid,"* ]] || fail "端口 $PORT 被其他进程/非回环监听占用。"; done <<< "$sockets"
}
check_port
existing_user=$(getent passwd model-insight || true)
if [[ -n "$existing_user" ]]; then
  IFS=: read -r name password uid gid gecos home shell <<< "$existing_user"
  [[ "$uid" != 0 && "$gecos" == "$USER_MARKER" && "$home" == "$DATA_DIR" && ( "$shell" == /usr/sbin/nologin || "$shell" == /sbin/nologin ) ]] || fail '拒绝接管未知 model-insight 用户。'
else
  [[ -z $(getent group model-insight || true) ]] || fail '拒绝接管未知 model-insight 用户组。'
fi
TXN=; LOCKED=0; CHANGED=0; COMMITTED=0; HAD_UNIT=0
cleanup() {
  local result=$? restore_failed=0
  trap - EXIT INT TERM
  if ((CHANGED && !COMMITTED)); then
    printf '部署未完成，恢复旧 current 和服务；数据目录不回滚、不删除。\n' >&2
    systemctl stop model-insight.service || restore_failed=1
    if [[ -n "$OLD_TARGET" ]]; then ln -s "$OLD_TARGET" "$APP_DIR/.current-rollback" && mv -Tf "$APP_DIR/.current-rollback" "$APP_DIR/current" || restore_failed=1
    else rm -f "$APP_DIR/current" || restore_failed=1; fi
    # Disable while the candidate unit still exists; systemctl cannot disable
    # a nonexistent unit after a failed very first installation.
    if ((!WAS_ENABLED)); then systemctl disable model-insight.service >/dev/null 2>&1 || restore_failed=1; fi
    if ((HAD_UNIT)); then
      rollback_unit=$(mktemp "$SYSTEMD_DIR/.model-insight-rollback.XXXXXX") && install -m 644 "$TXN/old.service" "$rollback_unit" && mv -Tf "$rollback_unit" "$UNIT" || restore_failed=1
    else rm -f "$UNIT" || restore_failed=1; fi
    systemctl daemon-reload || restore_failed=1
    if ((WAS_ACTIVE)); then systemctl start model-insight.service || restore_failed=1; fi
    if ((WAS_ENABLED)); then systemctl enable model-insight.service >/dev/null 2>&1 || restore_failed=1; fi
    if ((restore_failed)); then printf '自动恢复不完整，备份保留于 %s；请人工检查。\n' "$TXN" >&2
    else printf '原站点状态已恢复。\n' >&2; fi
  fi
  if [[ -n "$TXN" ]] && ((!restore_failed)); then rm -rf "$TXN"; fi
  if ((LOCKED)); then rmdir "$APP_DIR/.deploy-lock" || true; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for dir in "$APP_DIR" "$DATA_DIR"; do
  if [[ ! -e "$dir" ]]; then install -d -m 755 "$dir"; printf '%s\n' "$OWNERSHIP" > "$dir/.model-insight-managed"; chmod 644 "$dir/.model-insight-managed"; fi
done
mkdir "$APP_DIR/.deploy-lock" || fail '已有部署锁；确认无部署进程后再人工处理。'
LOCKED=1
# Refresh running-state snapshots only after holding the deployment lock.
read_current
WAS_ACTIVE=0; WAS_ENABLED=0
systemctl is-active --quiet model-insight.service && WAS_ACTIVE=1
systemctl is-enabled --quiet model-insight.service && WAS_ENABLED=1
check_port
if [[ -z "$existing_user" ]]; then
  useradd --system --user-group --no-create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin --comment "$USER_MARKER" model-insight
fi
chown model-insight:model-insight "$DATA_DIR"
chmod 750 "$DATA_DIR"
if [[ ! -e "$ENV_FILE" ]]; then
  ADMIN_TOKEN=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  API_TOKEN=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  env_temp=$(mktemp "${ENV_FILE}.new.XXXXXX")
  printf '%s\nLISTEN_ADDR=127.0.0.1:%s\nDATA_DIR=%s\nWEB_DIR=%s/current/www\nSEED_FILE=%s/current/seed.json\nADMIN_TOKEN=%s\nAPI_TOKEN=%s\n' "$OWNERSHIP" "$PORT" "$DATA_DIR" "$APP_DIR" "$APP_DIR" "$ADMIN_TOKEN" "$API_TOKEN" > "$env_temp"
  chmod 600 "$env_temp"; chown root:root "$env_temp"; mv -T "$env_temp" "$ENV_FILE"
  unset ADMIN_TOKEN API_TOKEN
fi
read_env
TXN=$(mktemp -d "$APP_DIR/.transaction.XXXXXX")
if [[ -f "$UNIT" ]]; then cp "$UNIT" "$TXN/old.service"; HAD_UNIT=1; fi
VERSION=$(date -u +%Y%m%dT%H%M%SZ)-$$
install -d -m 755 "$APP_DIR/releases"
RELEASE=$APP_DIR/releases/$VERSION
mkdir "$RELEASE"; chmod 755 "$RELEASE"
cp -R "$SOURCE/www" "$RELEASE/www"
cp "$SOURCE/seed.json" "$RELEASE/seed.json"
install -m 755 "$BINARY" "$RELEASE/model-insight"
find "$RELEASE/www" -type d -exec chmod 755 {} +
find "$RELEASE/www" -type f -exec chmod 644 {} +
chmod 644 "$RELEASE/seed.json"
runuser -u model-insight -- test -r "$RELEASE/www/index.html" || fail '专用用户无法读取站点（检查父目录权限）。'
# Export only validated literal assignments, never source/eval the env file.
(
  for assignment in "${CONFIG[@]}"; do export "$assignment"; done
  export WEB_DIR="$RELEASE/www" SEED_FILE="$RELEASE/seed.json"
  runuser -u model-insight -- "$RELEASE/model-insight" -check-config
) >/dev/null || fail '候选配置/已有内容检查失败；线上链接未改动。'
cat > "$TXN/new.service" <<UNITFILE
$OWNERSHIP
[Unit]
Description=Model Insight lightweight Go publishing platform
After=network.target
[Service]
Type=simple
User=model-insight
Group=model-insight
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR/current
ExecStart=$APP_DIR/current/model-insight
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
CapabilityBoundingSet=
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
[Install]
WantedBy=multi-user.target
UNITFILE
check_port
CHANGED=1
unit_temp=$(mktemp "$SYSTEMD_DIR/.model-insight-service.XXXXXX")
install -m 644 "$TXN/new.service" "$unit_temp"
mv -Tf "$unit_temp" "$UNIT"
ln -s "releases/$VERSION" "$APP_DIR/.current-$VERSION"
mv -Tf "$APP_DIR/.current-$VERSION" "$APP_DIR/current"
systemctl daemon-reload
if ((WAS_ACTIVE)); then systemctl restart model-insight.service; else systemctl start model-insight.service; fi
systemctl is-active --quiet model-insight.service || fail '服务未运行。'
HEALTHY=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if [[ $(curl --noproxy '*' -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" 2>/dev/null) == ok ]]; then HEALTHY=1; break; fi
  sleep 1
done
((HEALTHY)) || fail '/healthz 检查失败。'
systemctl enable model-insight.service
COMMITTED=1
printf '部署成功：%s\n地址：http://127.0.0.1:%s\n后台：http://你的域名/admin\n' "$RELEASE" "$PORT"
printf '密钥不会显示；首次登录请在 VPS 私密终端读取：sudo sed -n '\''s/^ADMIN_TOKEN=//p'\'' %s\n' "$ENV_FILE"
printf 'AI API_TOKEN 读取：sudo sed -n '\''s/^API_TOKEN=//p'\'' %s\n不要把上述输出提交 GitHub 或粘贴到日志。\n' "$ENV_FILE"
