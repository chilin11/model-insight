# 轻量发布平台部署（单 Go 进程、无容器）

**推荐：在 VPS 上运行一行命令，从 GitHub Release 安装或更新，再把现有 cloudflared 指向 `127.0.0.1:8188`。** VPS 只运行一个 Go 进程，同时提供前台、`/admin`、JSON API 和图片；无需 Nginx、Node.js、数据库或 Go 工具链。不调用模型、不抓取来源或远程图片，不安装任何系统软件。

## 0. 一键安装 / 更新

```sh
curl -fsSL https://raw.githubusercontent.com/chilin11/model-insight/main/install.sh | sudo bash
```

`install.sh` 会做这几件事：

1. 查询最新 Release 的版本号，从**同一版本**下载 `model-insight-vps.tar.gz` 和 `.sha256`（不会把不同版本的文件混在一起）。
2. 校验 SHA256，拒绝包含绝对路径或 `..` 的压缩包。
3. 解压到 `/var/tmp` 下的新临时目录，然后用 `validate-dist.sh` 校验 SHA256SUMS。
4. 执行 `deploy.sh`，完成后删除临时目录。

参数说明：

- 选项会原样传给 `deploy.sh`，例如 `| sudo bash -s -- --port 8288`。
- `MODEL_INSIGHT_VERSION=v0.2.3` 安装指定版本，可用于回到旧版。
- `MODEL_INSIGHT_DRY_RUN=1` 只下载和校验，不部署。

更新时再次运行同一条命令即可。已有的 env、文章、评论和图片都会保留，部署失败时会自动恢复旧版本。

SHA256 只能确认文件下载完整，**不是签名**。从 `curl | sudo bash` 开始，你就信任了这个 GitHub 仓库及其 Release，请只在自己控制的仓库上使用。想先审查再运行，可以先下载 `install.sh` 查看，再执行 `sudo bash install.sh`。

下面的第 1、2 节是不经 GitHub、手动构建上传的方式。

## 支持范围与隔离

- Linux + systemd，amd64/arm64（自动选择）。推荐 Debian 12/13、Ubuntu 22.04/24.04；需要 Bash、coreutils/findutils、grep/awk、`ss`（iproute2）、curl、getent/useradd/runuser。缺依赖直接退出，需管理员人工安装。macOS 只能构建和测试。
- 默认 `127.0.0.1:8188`；首次可 `sudo PORT=8288 bash deploy.sh` 或 `--port 8288`。拒绝低位端口、5173/5188，不改 80/443、其他服务、DNS、tunnel、防火墙，不自动安装/启动 Nginx。
- 专用低权限用户/组 `model-insight`；只有 `/var/lib/model-insight` 可写。systemd 开启 NoNewPrivileges、ProtectSystem、ProtectHome 等隔离。
- 程序 `/opt/model-insight/releases/<version>/`，`current` 原子切换；独立数据 `/var/lib/model-insight/content.json`、`content.json.bak`、`comments.json`（读者评论，首条评论时创建）、`analytics.json`（匿名访问汇总）、`media/`；密钥 `/etc/model-insight.env`（root:root、0600）。**更新从不覆盖数据或已有 env，不自动删除文章、图片和旧版本。**
- 只管理带 `# model-insight managed go v2` 及匹配路径标记的目录、env 和 unit。未知同名用户/组、unit、systemd drop-in、目录（即使为空）、符号链接路径均拒绝接管。旧 Nginx 部署 v1 不自动迁移：先人工确认/归档原 unit，停止且仅停本站旧服务，保留旧站数据，再安装；绝不覆盖未知 unit。

## 1. 本机构建

本机准备 Node.js/npm、Go 1.23+；没有 Go 在 PATH 时指定 `GO_BIN` 绝对路径。脚本不全局安装任何工具：

```sh
npm ci
GO_BIN=/path/to/go bash scripts/package-deploy.sh
```

先 `npm run build`，再 `node scripts/export-content.mjs <scratch>/seed.json` 导出保留的文章；校验 seed、运行后端测试，然后以 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64/arm64` 构建两种二进制。输出：

```text
release/model-insight-vps.tar.gz
├── bin/model-insight-linux-amd64
├── bin/model-insight-linux-arm64
├── www/                         # dist 的内容
├── seed.json                    # 仅供首次初始化
├── deploy/validate-dist.sh
├── deploy.sh
├── DEPLOY.md
└── SHA256SUMS
```

仅打包以上白名单；不含源码、node_modules、研究原文、密钥或运行数据。SHA256 检查文件完整性，**不是签名**；只部署自己构建/可信 Release 的包，安装器会执行其中的二进制。不要对陌生压缩包直接 sudo。

## 2. VPS 安装与首次访问

```sh
scp release/model-insight-vps.tar.gz user@VPS:~/
ssh user@VPS
mkdir ~/model-insight-upload-YYYYMMDD-HHMMSS
cd ~/model-insight-upload-YYYYMMDD-HHMMSS
tar -xzf ~/model-insight-vps.tar.gz
sudo bash deploy.sh
curl -fsS http://127.0.0.1:8188/healthz  # ok
sudo systemctl status model-insight.service
```

每次上传解压到新的空目录。脚本先检查包、架构、seed、目录所有权、配置和端口，再安装候选版本并以低权限用户校验现有数据/密钥，最后切换链接并 start/restart + 健康检查。失败恢复旧 current、unit、启用状态及原服务；保留失败版本便于诊断。**失败首次安装也保留生成的私密 env、用户和数据，重试不会重置密钥/文章。**

首次在 VPS **私密终端**读取管理员令牌（安装器不会打印令牌值）：

```sh
sudo sed -n 's/^ADMIN_TOKEN=//p' /etc/model-insight.env
```

通过 HTTPS 站点的 `/admin` 登录；没有域名时可使用 SSH 隧道：

```sh
# 在自己的电脑运行；浏览器打开 http://127.0.0.1:8288/admin
ssh -N -L 8288:127.0.0.1:8188 user@VPS
```

AI 接入令牌独立读取：

```sh
sudo sed -n 's/^API_TOKEN=//p' /etc/model-insight.env
```

**上述输出不得提交 GitHub、写进网页、截图、共享日志或 AI 提示词。** 仅给受信任调用端配置 API_TOKEN；它可以创建草稿，不能发布/编辑已有文章。ADMIN_TOKEN 只用于后台登录，不是 Bearer API 密钥。

## 3. 使用已有 cloudflared

在现有 tunnel 的 ingress / Zero Trust Public Hostname 中增加本站域名（保留其他规则）：

```yaml
ingress:
  - hostname: news.example.com
    service: http://127.0.0.1:8188
  # 保留其他域名及最后的兜底规则
  - service: http_status:404
```

按原方式校验/重载 tunnel；不要为本站开放 VPS 的 8188 公网入口。Tunnel 必须保留原始 Host，不能强制覆盖成 localhost，否则后台 Origin 校验会拒绝请求。脚本不修改 tunnel。HTTPS Origin 的同 Host 校验兼容 TLS 在 tunnel 终止，登录 cookie 自动带 Secure；不要通过明文公网 HTTP 登录。

## 配置、更新与恢复

`/etc/model-insight.env` 使用字面量 `KEY=value`，不执行 shell，不支持引号、变量插值、命令替换或额外键：

| 键 | 默认 |
| --- | --- |
| LISTEN_ADDR | `127.0.0.1:8188` |
| DATA_DIR | `/var/lib/model-insight` |
| WEB_DIR | `/opt/model-insight/current/www` |
| SEED_FILE | `/opt/model-insight/current/seed.json` |
| ADMIN_TOKEN | 首次随机生成 64 位十六进制 |
| API_TOKEN | 另一个随机生成 64 位十六进制 |

更新只需新包解压后再次 `sudo bash deploy.sh`；**已有 env 原样保留**，不要重复传不同 PORT 覆盖。改端口请先检查空闲端口，`sudoedit /etc/model-insight.env` 修改 LISTEN_ADDR，再运行部署以检查并重启，并同步修改 tunnel 入口。不改变其他配置路径。轮换密钥也用 sudoedit，两个值必须不同、无空白、至少 8 种不同字符，ADMIN_TOKEN ≥24 字节、API_TOKEN ≥32 字节；推荐用密码管理器/系统随机数生成 64 位十六进制值，然后只重启本站服务。会话在重启后失效。

- 锁 `.deploy-lock` 防重复部署；残留锁先确认没有部署进程，再人工处理，不盲删。
- 自动回滚不回滚 `content.json`：避免丢失用户已保存的新内容。后端本版保持原 JSON 结构，缺失 revision 升级为 1，未知字段/重复 ID/坏文件拒绝启动，绝不回退 seed 覆盖。升级后端 schema 前仍应先备份。
- 写文件使用同目录临时文件、0600、fsync + rename；保留上一版 `.bak`，只有落盘成功才更新内存。目录 fsync 在不支持的文件系统上尽力执行。**只运行一个服务实例**，不要让两个进程同时写同一 DATA_DIR；不要在线手工编辑 content.json。
- 当前文件损坏/缺失但存在 `.bak` 时 fail closed；不自动恢复/清空。先停止服务、归档全部 DATA_DIR，再人工核验备份并恢复为 content.json，最后启动；不要直接删坏文件绕过校验。
- 评论：`comments.json` 损坏时服务和 `-check-config` 都会拒绝启动，不会清空评论；评论限流使用 cloudflared 在本机连接上带来的 `CF-Connecting-IP`，IP 不写盘。分享页 `/a/<id>` 与 RSS `/rss.xml` 用请求 Host 生成绝对链接，所以 tunnel 必须保留原始 Host。
- 评论策略：新评论先本地脱敏再直接公开，不保存新评论被替换片段的原文。可选的 `DATA_DIR/comment-sensitive-words.txt` 追加词库仅启动时加载，不随更新覆盖；坏词库会使启动及 `-check-config` 失败，不会绕过过滤。旧待审评论不在启动时自动公开，后台显式「按规则处理旧评论」才处理，已隐藏评论不恢复。规则局限与格式见 [写作说明](docs/WRITING.md#评论自动公开与脱敏)。
- 统计：`analytics.json` 从功能启用后开始累计，不补历史；按北京时间保留最近 90 天明细及累计次数。单独文件损坏时正常启动仅禁用统计并警告，不覆盖原文件；`-check-config` 则拒绝带坏统计文件的更新。恢复前先归档坏文件，禁止直接删除绕过错误。低流量实现每次原子保存，按 IP 30 次/分钟、全站 120 次/分钟及 10 次/秒防刷；统计是参考次数，不是 UV/CTR。
- 备份：维护窗口先停止本站服务，把整个 `/var/lib/model-insight`（含文章、评论、统计、图片）和私密 env 分开备份到可信位置再启动。只保留 `.bak` 不是完整备份；不能放进 www/GitHub/Release。
- 程序日志仅启动/失败状态，不记录请求体、令牌或 cookie；`sudo journalctl -u model-insight.service -n 50 --no-pager` 查看。
- 首次健康检查失败且无法自动恢复时，脚本保留 `.transaction.*` 并提示路径，先人工诊断，不立即覆盖重试。

手动回退程序（仅同 schema、已核验的本站版本）：

```sh
sudo ls -l /opt/model-insight/current
sudo ls /opt/model-insight/releases
# 将 VERSION 替换为实际存在的本站版本，记录旧链接以便反向恢复。
sudo ln -s releases/VERSION /opt/model-insight/.current-manual
sudo mv -Tf /opt/model-insight/.current-manual /opt/model-insight/current
sudo systemctl restart model-insight.service
curl -fsS http://127.0.0.1:8188/healthz
```

自定义目录参数 `--app-dir`、`--data-dir` 必须以 `/model-insight` 结尾且互不嵌套；`--env-file`、`--systemd-dir` 用于自定义系统/沙盒，首次之后必须保持一致。不可选 home 私有目录（ProtectHome）；生产使用默认路径。

## HTTP 接口与安全约定

所有错误为 JSON `{ "error": "…" }`；不支持 CORS。JSON 请求最多 2 MiB、Markdown body 最多 150 KiB、文章最多 5000；无删除接口。ID 为 `^[a-z0-9][a-z0-9-]{0,79}$`，重复 ID 或旧 revision 为 409。发布须标题、摘要、Markdown 或非空 sections、合法来源、publishedAt/verifiedAt；日期支持 YYYY-MM-DD / RFC3339。草稿允许空标题/正文，类别/模型可暂空；非空时仍严格枚举。来源仅 http/https、无 userinfo；封面只安全 `/media/<filename>.png|jpg|jpeg|gif` 或 https、无 userinfo。后端不联网下载。

| 接口 | 鉴权 / 结果 |
| --- | --- |
| `GET /healthz` | `ok` |
| `GET /api/articles` | `{articles, featuredId}`，仅已发布；指定精选未发布则回退第一篇已发布 |
| `POST /api/admin/login` `{token}` | `{authenticated:true}` + 8 小时 HttpOnly/SameSite=Strict 随机会话 cookie |
| `GET /api/admin/session` | `{authenticated:boolean}` |
| `POST /api/admin/logout` | `{authenticated:false}`，注销/清除 cookie |
| `GET /api/admin/articles` | cookie；全部文章及持久化 featuredId |
| `POST /api/admin/articles` `{article}` | cookie；201 `{article}`，初始 revision=1 |
| `PUT /api/admin/articles/{id}` `{article,expectedRevision}` | cookie；200 `{article}`，revision+1；ID 不匹配 400 |
| `POST /api/admin/featured` `{id}` | cookie；仅已发布文章；`{featuredId}` |
| `POST /api/admin/media` multipart `file` | cookie；201 `{url,alt:''}`；仅 PNG/JPEG/GIF，最多 5 MiB / 1200 万像素，嗅探+解码；不支持 WebP/SVG/HTML |
| `GET /api/ingest/ping` | `Authorization: Bearer API_TOKEN`；`{ok:true}` |
| `POST /api/ingest/articles` `{article}` | Bearer；201 `{article}`；强制 draft，指定 published 400，重复 ID 409，不覆盖旧文 |

**CSRF 精确行为：** 所有后台 POST/PUT（含 login/logout/media）必须 `X-Requested-With: model-insight`。除 login 外，cookie 写接口必须同时有 `Origin: http[s]://<请求 Host>`，不允许路径、userinfo、跨主机或不同端口。login 为 CLI 允许省略 Origin，但只要携带就严格校验，且 custom header 仍必需。Bearer ingest 不要求 Origin/CSRF，不接受 cookie 替代 Bearer；admin API 不接受任何 Authorization 头。登录失败每实际连接 IP 15 分钟最多 10 次，第 11 次 429，忽略可伪造 X-Forwarded-For；tunnel 统一连接 IP 时会共享限额，这是保守保护。会话仅内存保存、重启失效；令牌采用 SHA256 后 constant-time 比较。服务端维护 createdAt/updatedAt/revision，未知字段（含嵌套字段）、重复 JSON key 拒绝而非静默丢弃。

图片丢弃原名并用随机文件名；只静态提供安全图片名，无目录 listing/路径跳转/子树符号链接。`/`、`/admin` 返回不缓存 index.html；hashed assets 与 media immutable；其他 missing 静态文件和 `/api/*` 不返回 SPA HTML，均 404。ReadHeader 5 秒，Read/Write 30 秒，Idle 60 秒，header 最多 32 KiB；含 CSP/nosniff/frame 等安全响应头。

## 本机验证与维护者发布

```sh
(cd server && /path/to/go test -race ./...)
(cd server && /path/to/go vet ./...)
for f in deploy.sh deploy/validate-dist.sh scripts/package-deploy.sh tests/deploy.test.sh; do bash -n "$f"; done
bash tests/deploy.test.sh
```

后端覆盖鉴权/CSRF、草稿隔离、发布编辑、并发 revision、写失败、重载保留、坏存储、图片与路径；部署测试全部使用 scratch 中 mock Linux/systemd/二进制，不需要 root，不创建系统用户、不运行本机服务。**mock 通过不等于已在 VPS 验收**；首次真实 Linux 安装仍需管理员执行 health/API/后台验收。

GitHub：源码仓库与部署附件分离，默认私有；仅在全部内容/测试稳定且明确授权后初始化提交、创建私有仓库及上传 Release 附件。发布前人工检查所有待上传文件无 env、content.json、media、密钥、依赖、研究原文；`.gitignore` 不是保密审查替代。不要把 VPS 生成的配置塞回部署包。

卸载仅停本站并保留全部数据：核验 unit 所有权后 `sudo systemctl disable --now model-insight.service`，移除这个 unit 再 daemon-reload；归档 `/etc/model-insight.env`、`/opt/model-insight`、`/var/lib/model-insight`，不要删除其他服务/用户/目录。不自动移除专用用户/数据，避免误删。

### 修改本地评论词库后校验

默认安装路径下，在私密终端执行；不打印密钥，不将密钥放入命令参数。自定义目录请用对应 env 与服务二进制路径：

```sh
sudo bash -c '
  set +x
  set -a
  . /etc/model-insight.env
  set +a
  exec runuser -u model-insight -- /opt/model-insight/current/model-insight -check-config
' && sudo systemctl restart model-insight
```

先确保词库对 `model-insight` 用户可读（例如 root:model-insight、0640）；校验失败时不会执行重启。新增过滤词不会自动重写旧评论，需后台明确执行处理旧评论。备份整个 DATA_DIR 时词库也一并保留。
