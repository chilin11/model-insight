#!/usr/bin/env bash
# Mock Linux/systemd integration; never start services, create real users or sudo.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BASE=$(mktemp -d "${PI_SCRATCH_DIR:-${TMPDIR:-/tmp}}/model-insight-tests.XXXXXX")
BASE=$(cd "$BASE" && pwd -P)
trap 'rm -rf "$BASE"' EXIT
export REAL_MV=$(command -v mv) REAL_OD=$(command -v od) REAL_STAT=$(command -v stat) REAL_OS=$(uname -s)
mkdir "$BASE/bin"
cat > "$BASE/bin/mock" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
name=${0##*/}
printf '%s %s\n' "$name" "$*" >> "$MOCK_STATE/calls"
case "$name" in
  uname) if [[ ${1:-} == -m ]]; then printf '%s\n' "${MOCK_ARCH:-x86_64}"; else printf 'Linux\n'; fi ;;
  id) printf '0\n' ;;
  mv)
    if [[ "$REAL_OS" == Darwin && ${1:-} == -Tf ]]; then shift; exec "$REAL_MV" -fh "$@"; fi
    if [[ "$REAL_OS" == Darwin && ${1:-} == -T ]]; then shift; exec "$REAL_MV" -h "$@"; fi
    exec "$REAL_MV" "$@" ;;
  od)
    for item in "$@"; do last=$item; done
    case "$last" in
      bin/model-insight-linux-*|*/bin/model-insight-linux-*)
        if [[ "$*" == *-j18* ]]; then case "$last" in *amd64) printf ' 3e 00\n' ;; *arm64) printf ' b7 00\n' ;; esac
        else printf ' 7f 45 4c 46\n'; fi ;;
      *) exec "$REAL_OD" "$@" ;;
    esac ;;
  stat)
    if [[ "$REAL_OS" == Darwin ]]; then mode=$("$REAL_STAT" -f '%Lp' "$3"); else mode=$("$REAL_STAT" -c '%a' "$3"); fi
    printf '%s:0\n' "$mode" ;;
  chown|sleep) : ;;
  getent)
    if [[ "$1" == passwd && -f "$MOCK_STATE/user" ]]; then cat "$MOCK_STATE/user"; else exit 2; fi ;;
  useradd)
    home=;while (($#)); do if [[ "$1" == --home-dir ]]; then home=$2; shift; fi; shift; done
    printf 'model-insight:x:987:987:Model Insight managed go v2:%s:/usr/sbin/nologin\n' "$home" > "$MOCK_STATE/user" ;;
  runuser)
    [[ ! -f "$MOCK_STATE/deny-read" ]] || exit 1
    [[ ! -f "$MOCK_STATE/config-fail" ]] || exit 1 ;;
  curl) [[ ! -f "$MOCK_STATE/health-fail" ]] && printf 'ok\n' ;;
  ss)
    for item in "$@"; do last=$item; done; port=${last##*:};port=${port// /}
    if [[ -f "$MOCK_STATE/conflict" ]]; then printf 'LISTEN 0 128 0.0.0.0:%s 0.0.0.0:* users:(("other",pid=999,fd=3))\n' "$port"
    elif [[ -f "$MOCK_STATE/active" && -f "$MOCK_STATE/port" && $(cat "$MOCK_STATE/port") == "$port" ]]; then printf 'LISTEN 0 128 127.0.0.1:%s 0.0.0.0:* users:(("model-insight",pid=123,fd=3))\n' "$port"; fi ;;
  systemctl)
    if [[ "$1" == daemon-reload ]]; then exit 0; fi
    if [[ "$1" == list-units ]]; then [[ ! -f "$MOCK_STATE/no-systemd" ]]; exit; fi
    for item in "$@"; do last=$item; done
    [[ "$last" == model-insight.service ]] || { printf 'forbidden service: %s\n' "$*" >&2; exit 99; }
    case "$1" in
      show)
        case "$3" in
          MainPID) printf '123\n' ;;
          FragmentPath) if [[ -f "$MOCK_STATE/unknown-fragment" ]];then printf '/lib/systemd/system/model-insight.service\n';elif [[ -f "$MOCK_UNIT" ]];then printf '%s\n' "$MOCK_UNIT";fi ;;
          DropInPaths) if [[ -f "$MOCK_STATE/dropin" ]];then printf '/etc/systemd/system/model-insight.service.d/unknown.conf\n';fi ;;
          *) exit 99 ;;
        esac ;;
      is-active) [[ -f "$MOCK_STATE/active" ]] ;;
      is-enabled) [[ -f "$MOCK_STATE/enabled" ]] ;;
      start|restart)
        if [[ -f "$MOCK_STATE/start-fail" ]]; then rm "$MOCK_STATE/start-fail"; exit 1; fi
        touch "$MOCK_STATE/active"
        sed -n 's/^LISTEN_ADDR=127.0.0.1://p' "$MOCK_ENV" > "$MOCK_STATE/port" ;;
      stop) rm -f "$MOCK_STATE/active" ;;
      enable) touch "$MOCK_STATE/enabled" ;;
      disable) rm -f "$MOCK_STATE/enabled" ;;
      *) exit 99 ;;
    esac ;;
  apt-get|nginx|docker|sudo) printf 'FORBIDDEN side effect\n' >&2;exit 99 ;;
  *) exit 99 ;;
esac
MOCK
chmod +x "$BASE/bin/mock"
for name in uname id mv od stat chown sleep getent useradd runuser curl ss systemctl apt-get nginx docker sudo;do ln -s mock "$BASE/bin/$name";done
export PATH="$BASE/bin:$PATH"
if command -v sha256sum >/dev/null 2>&1;then HASH=(sha256sum);else HASH=(shasum -a 256);fi
checksums() { (
 cd "$PAYLOAD"
 while IFS= read -r file;do digest=$("${HASH[@]}" "$file");digest=${digest%% *};printf '%s  %s\n' "$digest" "$file";done < <(find www bin deploy -type f | LC_ALL=C sort;printf '%s\n' seed.json deploy.sh DEPLOY.md) > SHA256SUMS
); }
fixture() {
 CASE_DIR=$BASE/$1;PAYLOAD=$CASE_DIR/payload;APP=$CASE_DIR/opt/model-insight;DATA=$CASE_DIR/var/model-insight;UNITS=$CASE_DIR/systemd
 export MOCK_STATE=$CASE_DIR/state MOCK_ENV=$CASE_DIR/etc/model-insight.env MOCK_UNIT=$UNITS/model-insight.service
 mkdir -p "$PAYLOAD/deploy" "$PAYLOAD/www/assets" "$PAYLOAD/bin" "$MOCK_STATE" "$UNITS" "$CASE_DIR/etc"
 cp "$ROOT/deploy.sh" "$ROOT/DEPLOY.md" "$PAYLOAD/";cp "$ROOT/deploy/validate-dist.sh" "$PAYLOAD/deploy/"
 printf '<div id="root"></div><script src="/assets/app-12345678.js"></script><link href="/assets/app-12345678.css">\n' > "$PAYLOAD/www/index.html"
 printf 'console.log("version1");\n' > "$PAYLOAD/www/assets/app-12345678.js";printf 'body{color:black}\n' > "$PAYLOAD/www/assets/app-12345678.css"
 printf '{"articles":[],"featuredId":""}\n' > "$PAYLOAD/seed.json"
 for arch in amd64 arm64;do
  cat > "$PAYLOAD/bin/model-insight-linux-$arch" <<'BINARY'
#!/usr/bin/env bash
# ELF header is mocked separately; no Linux executable runs on macOS.
[[ "$1" == -check-seed && ! -f "$MOCK_STATE/seed-fail" ]]
BINARY
  chmod +x "$PAYLOAD/bin/model-insight-linux-$arch"
 done
 checksums
}
run_deploy() { bash "$PAYLOAD/deploy.sh" --app-dir "$APP" --data-dir "$DATA" --env-file "$MOCK_ENV" --systemd-dir "$UNITS" "$@" </dev/null > "$CASE_DIR/output" 2>&1; }
assert() { "$@" || { printf 'FAIL: %s\n' "$*" >&2;cat "$CASE_DIR/output" >&2;exit 1; }; }
expect_fail() { if run_deploy "$@";then printf 'FAIL: expected deployment failure\n' >&2;exit 1;fi; }
pass() { printf 'PASS %s\n' "$*"; }
fixture install-update
run_deploy || { cat "$CASE_DIR/output"; exit 1; }
first=$(readlink "$APP/current")
assert test -f "$APP/$first/www/index.html";assert test -x "$APP/$first/model-insight";assert test -f "$MOCK_STATE/enabled"
assert grep -Fq 'User=model-insight' "$MOCK_UNIT";assert grep -Fq 'ProtectSystem=strict' "$MOCK_UNIT";assert grep -Fq 'LISTEN_ADDR=127.0.0.1:8188' "$MOCK_ENV"
assert test "$(stat -c '%a:%u' "$MOCK_ENV")" = 600:0
admin=$(sed -n 's/^ADMIN_TOKEN=//p' "$MOCK_ENV");api=$(sed -n 's/^API_TOKEN=//p' "$MOCK_ENV");assert test ${#admin} = 64;assert test ${#api} = 64;assert test "$admin" != "$api"
if grep -Fq "$admin" "$CASE_DIR/output" || grep -Fq "$api" "$MOCK_STATE/calls";then printf 'FAIL secrets logged\n';exit 1;fi
pass 'first install: isolated low-privilege Go service, private distinct tokens'
printf 'user content\n' > "$DATA/content.json";cp "$MOCK_ENV" "$CASE_DIR/env-before"
printf '<!-- version2 -->\n' >> "$PAYLOAD/www/index.html";checksums
run_deploy || { cat "$CASE_DIR/output"; exit 1; }
second=$(readlink "$APP/current");assert test "$first" != "$second";assert test -f "$APP/$first/www/index.html";assert grep -Fq version2 "$APP/current/www/index.html"
assert cmp -s "$MOCK_ENV" "$CASE_DIR/env-before";assert grep -Fq 'user content' "$DATA/content.json";assert grep -Fq 'systemctl restart model-insight.service' "$MOCK_STATE/calls"
pass 'repeat update preserves env/data/old releases and owns existing port'
before=$second;cp "$MOCK_UNIT" "$CASE_DIR/unit-before"
touch "$MOCK_STATE/conflict";expect_fail;assert test "$(readlink "$APP/current")" = "$before";assert cmp -s "$MOCK_UNIT" "$CASE_DIR/unit-before";rm "$MOCK_STATE/conflict"
pass 'port conflict never changes running release'
touch "$MOCK_STATE/config-fail";expect_fail;assert test "$(readlink "$APP/current")" = "$before";rm "$MOCK_STATE/config-fail"
pass 'candidate config failure leaves live link untouched'
for failure in start-fail health-fail;do
 touch "$MOCK_STATE/$failure";expect_fail;assert test "$(readlink "$APP/current")" = "$before";assert cmp -s "$MOCK_UNIT" "$CASE_DIR/unit-before";assert test -f "$MOCK_STATE/active";assert test -f "$MOCK_STATE/enabled";assert grep -Fq '原站点状态已恢复' "$CASE_DIR/output";assert grep -Fq 'user content' "$DATA/content.json";rm -f "$MOCK_STATE/$failure"
 pass "$failure restores old running service/current/unit and preserves data"
done
mkdir "$APP/.deploy-lock";expect_fail;assert test -d "$APP/.deploy-lock";assert test "$(readlink "$APP/current")" = "$before";rmdir "$APP/.deploy-lock";pass 'held lock respected'
expect_fail --port 8288;assert cmp -s "$MOCK_ENV" "$CASE_DIR/env-before";pass 'existing env cannot be accidentally overwritten by PORT'
fixture custom-port-arm64
MOCK_ARCH=arm64 PORT=8288 run_deploy || { cat "$CASE_DIR/output"; exit 1; }; assert grep -Fq 'LISTEN_ADDR=127.0.0.1:8288' "$MOCK_ENV"; pass 'first-install PORT and arm64 selection'
fixture fresh-failure
touch "$MOCK_STATE/start-fail";expect_fail;assert test ! -L "$APP/current";assert test ! -e "$MOCK_UNIT";assert test ! -f "$MOCK_STATE/active";assert test ! -f "$MOCK_STATE/enabled";assert test -f "$MOCK_ENV";pass 'failed first activation restores absent service, retaining private config/data'
fixture protect-directory
mkdir -p "$APP";printf 'keep\n' > "$APP/user-data";expect_fail;assert grep -Fq keep "$APP/user-data";assert test ! -e "$MOCK_ENV";pass 'unmanaged directory preserved'
fixture protect-unit
printf 'another project\n' > "$MOCK_UNIT";expect_fail;assert grep -Fq 'another project' "$MOCK_UNIT";assert test ! -e "$APP";pass 'unknown unit preserved'
fixture protect-env
printf 'other config\n' > "$MOCK_ENV";expect_fail;assert grep -Fq 'other config' "$MOCK_ENV";assert test ! -e "$APP";pass 'unknown env preserved'
for flag in unknown-fragment dropin;do fixture "protect-$flag";touch "$MOCK_STATE/$flag";expect_fail;assert test ! -e "$APP";pass "$flag rejected";done
fixture unknown-user
printf 'model-insight:x:501:20:Other owner:/home/someone:/bin/bash\n' > "$MOCK_STATE/user";expect_fail;assert test ! -e "$APP";pass 'unknown user not repurposed'
fixture bad-checksum
printf 'tampered\n' >> "$PAYLOAD/www/assets/app-12345678.js";expect_fail;assert test ! -e "$APP";pass 'corrupt checksum rejected before install'
fixture missing-resource
rm "$PAYLOAD/www/assets/app-12345678.css";checksums;expect_fail;assert test ! -e "$APP";pass 'missing static resource rejected'
fixture symlink-resource
ln -s "$PAYLOAD/www/index.html" "$PAYLOAD/www/assets/unsafe-12345678.txt";expect_fail;assert test ! -e "$APP";pass 'payload symlink rejected'
fixture bad-seed
touch "$MOCK_STATE/seed-fail";expect_fail;assert test ! -e "$APP";pass 'invalid seed rejected before install'
fixture denied-permission
touch "$MOCK_STATE/deny-read";expect_fail;assert test ! -L "$APP/current";assert test ! -e "$MOCK_UNIT";pass 'worker permission failure rejected before activation'
fixture forbidden-port
for port in 80 443 5173 5188 08188 65536;do expect_fail --port "$port";done;assert test ! -e "$APP";pass 'protected/invalid ports rejected'
fixture no-systemd
touch "$MOCK_STATE/no-systemd"; expect_fail; assert test ! -e "$APP"; pass 'non-systemd Linux rejected before installation'
if grep -E '^(apt-get|nginx|docker|sudo) ' "$MOCK_STATE/calls";then printf 'FAIL forbidden side effect\n';exit 1;fi
printf 'All deployment mock tests passed.\n'
