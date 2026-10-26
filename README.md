# 模型智见 · Model Insight

一个文字优先、带写作后台和 AI 草稿 API 的 AI 模型资讯网站。React + TypeScript 前端，Go 标准库后端。**无 Docker、无数据库、无 Nginx/Node 常驻要求**；低配 VPS 只运行一个 Go 进程。

## 日常使用

- **读文章**：`https://你的域名/`
- **自己写稿**：`https://你的域名/admin` → 登录 → 写新文章 → 保存草稿 → 预览 → 发布。
- **AI 接入**：`POST /api/ingest/articles`，使用独立 Bearer `API_TOKEN`；只能新增草稿，由你审核发布。
- **访问统计**：后台看今日/累计访问与阅读、7/30/90 天趋势、文章排行；匿名汇总，不设追踪 Cookie，不存访客身份，不把次数冒充 UV 或点击率。
- 新稿使用 Markdown：编辑器工具栏一键插入标题、链接、引用、提示框、代码块（语法高亮 + 复制按钮）、表格、脚注；截图可直接粘贴或拖入上传，支持分屏实时预览。
- **分享**：每篇文章有带社交预览卡片的链接 `/a/<id>`；读者可复制链接、系统分享、微信扫码、微博、X、Telegram、邮件。另有 RSS `/rss.xml`。
- **评论**：读者无需注册即可评论，**审核后公开**；后台「评论审核」可通过、撤下、删除，单篇可关闭评论。有限流和防垃圾字段，IP 不落盘。
- 草稿可删除；已发布文章需先撤回。
- 修改、发布、撤回、设置头条立即写入服务端；**不需要改源码或重新部署**。已打开的读者页面刷新后看到更新。
- 支持版本冲突提示、未保存提醒、当前稿 JSON 导出和 Cmd/Ctrl + S 保存。

👉 [固定发稿方法（本站域名与批量命令）](docs/PUBLISHING.md) · [快速写作说明](docs/WRITING.md) · [AI / 管理 API](docs/API.md) · [部署、升级与备份](DEPLOY.md)

## 一键部署 / 更新（systemd Linux）

在 VPS 上直接运行（需要 root 权限，不需要 Docker、Node、Go 或数据库）：

```sh
curl -fsSL https://raw.githubusercontent.com/chilin11/model-insight/main/install.sh | sudo bash
```

脚本从 GitHub Release 下载最新部署包，校验 SHA256 和包内文件清单后执行 `deploy.sh`，自动识别 amd64 / arm64。**以后更新再运行同一条命令即可**，文章、评论、图片和密钥都会保留。

- 首次指定端口：`curl -fsSL …/install.sh | sudo bash -s -- --port 8288`
- 安装指定版本：`curl -fsSL …/install.sh | sudo MODEL_INSIGHT_VERSION=v0.2.3 bash`
- 只下载校验、不部署：`… | sudo MODEL_INSIGHT_DRY_RUN=1 bash`

默认监听 `127.0.0.1:8188`，将宿主机上的 cloudflared 源站指向 `http://127.0.0.1:8188`（保留原始 Host），通过公网 HTTPS 访问。首次部署会生成管理员和 AI 两个不同的密钥：

```sh
sudo sed -n 's/^ADMIN_TOKEN=//p' /etc/model-insight.env   # 登录 /admin
sudo sed -n 's/^API_TOKEN=//p' /etc/model-insight.env     # AI 接入
```

手动上传部署包、回滚、备份等见 [DEPLOY.md](DEPLOY.md)。

### 发布新版本（维护者）

```sh
npm ci
GO_BIN=/path/to/go bash scripts/release.sh v0.2.2   # 构建前端与 Linux 二进制，上传 Release（含 install.sh）
```

发布前须已提交并推送 main。VPS 再跑一次安装命令即可升级到这个版本。

**程序与数据分离**：程序在 `/opt/model-insight`，文章和图片在 `/var/lib/model-insight`，密钥在 `/etc/model-insight.env`。更新程序保留已有文章、草稿、配图、评论和密钥，不重复导入 seed。

## 现有文章完整保留

首装种子包含 9 篇正式文章，保留来源、事件口径、发布时间、核验时间、分节正文、表格和 SVG 数据图。资料编译与编辑分析，不是本站独立产品实测；AI 辅助整理与写作。

`src/content.ts` **只作为空内容库首次初始化的 seed**，不是上线后日常发稿位置。后续内容以服务器 `DATA_DIR/content.json` 为准。新 seed 不会覆盖已经存在的内容库；坏文件会拒绝启动，不能以旧 seed 冒充恢复成功。

分类：模型动态、评测解读、社区声音、深度观点。模型：Kimi、OpenAI、Claude、DeepSeek、Qwen、跨模型。

## 本地开发

需要 Node.js（支持 Vite 6）及 Go 1.23+。

```sh
npm ci
npm run build
node scripts/export-content.mjs "$TMPDIR/model-insight-seed.json"

# 开发用随机密钥，仅在当前终端环境使用。不要提交真实密钥。
export ADMIN_TOKEN="$(openssl rand -hex 24)"
export API_TOKEN="$(openssl rand -hex 32)"
export DATA_DIR="$HOME/.local/share/model-insight-dev"
export SEED_FILE="$TMPDIR/model-insight-seed.json"
export WEB_DIR="$PWD/dist"
export LISTEN_ADDR=127.0.0.1:8188
(cd server && go run .)
```

另一终端 `npm run dev` → `http://localhost:5188`，`/api` 与 `/media` 代理到 8188。管理员密钥在第一个终端通过 `printf '%s\n' "$ADMIN_TOKEN"` 读取。开发端口固定 **5188 / strictPort**，5173 属于其他项目，不停止、不复用。仅看前台时可以不启动 Go，开发模式会读取本地 seed；生产模式 API 失败会显示错误，绝不回退成旧稿。

## 验证

```sh
npm run build
npx playwright install chromium
npm run test:e2e                 # 前台桌面 / 手机回归，5188
npm run test:cms                 # 真后端 + 生产前端，独立临时数据，8198
(cd server && go test -race ./...)
(cd server && go vet ./...)
```

Go 不在 PATH 时可为 CMS 测试传入 `GO_BIN=/绝对路径/go`。部署脚本检查与隔离测试见 [DEPLOY.md](DEPLOY.md)。测试不使用线上数据。

## 内容与安全边界

- AI token 只建草稿，不能使用管理员 API、发布或覆盖旧稿；不绑定 AI 厂商，不在 VPS 上常驻大模型。
- 管理员密钥建立 8 小时 HttpOnly / SameSite=Strict 会话，不存 localStorage。公网后台必须走 HTTPS；密钥只放服务端。
- Markdown 不执行 HTML；链接协议受限；上传拒绝 SVG/HTML，最多 5 MiB。
- 文章链接为 `/#read/<id>`；搜索、分类、收藏、阅读进度、下一篇和响应式排版保留。
- 收藏只在当前浏览器存储，沿用 `a-little-new:bookmarks`；邮箱意向沿用 `a-little-new:newsletter-email`，**未接邮件服务，不发送邮件**。
- 不包含公开注册、多人权限、评论、自动定时发布或模型调用计费。基础设施可能记录访问日志；外部来源/图片适用原站隐私规则。
