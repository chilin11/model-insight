# AI 与写作 API

所有接口与网页同源，无 CORS。API JSON 错误统一为 `{"error":"说明"}`；文章缺失页是 HTML 404。公网请求必须走 HTTPS。

## AI：新增草稿

`API_TOKEN` 与 `ADMIN_TOKEN` 是两个不同的服务端密钥。AI 不应得到管理员密钥，也不能读取管理员内容库、修改既有稿件或发布文章。

```sh
# 在你自己的服务端环境设置，不要写入公开前端或 Git。
export API_TOKEN='从部署服务器安全读取的独立密钥'
export SITE_URL='https://你的域名'

# 连通检查
curl --fail-with-body "$SITE_URL/api/ingest/ping" \
  -H "Authorization: Bearer $API_TOKEN"

# 修改 examples/ai-draft.json 的 id 和内容，再提交。
curl --fail-with-body "$SITE_URL/api/ingest/articles" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @examples/ai-draft.json
```

- `GET /api/ingest/ping`：成功 `200 {"ok":true}`。
- `POST /api/ingest/articles`：请求 `{"article":{...}}`；成功 `201 {"article":{...}}`，响应包含服务器分配的 `revision`、`createdAt`、`updatedAt`。
- `id` 必填且唯一，格式 `^[a-z0-9][a-z0-9-]{0,79}$`。重复 ID 为 409，不更新原稿。超时后重试前先去后台确认是否已保存，不能把冲突当成功。
- `status` 使用 `draft`。提交 `published` 会被拒绝，AI 没有发布能力。
- 可从最小 `{ "article": { "id":"unique-news-id", "status":"draft", "title":"待审核标题", "body":"Markdown 正文" } }` 开始；完整示例见 [examples/ai-draft.json](../examples/ai-draft.json)。
- `sources` 可先为空，但发布前必须人工补齐至少一个合法来源。
- AI 草稿不会出现在公开 API。管理员打开 `/admin`，点击「重新读取列表」即可审核。

## 文章字段

| 字段 | 格式 / 用途 |
| --- | --- |
| `id` | 唯一稳定 ID，保存后不可更改 |
| `status` | `draft` / `published`；AI 仅 draft |
| `title`, `description` | 标题与摘要 |
| `category` | 模型动态 / 评测解读 / 社区声音 / 深度观点 |
| `model` | Kimi / OpenAI / Claude / DeepSeek / Qwen / 跨模型 |
| `tone` | 展示色，例如 kimi / openai / claude / deepseek / qwen / industry |
| `time`, `label` | 阅读分钟数与栏目标签 |
| `takeaway`, `quote` | 先看结论、编辑观点（可选） |
| `body` | Markdown 正文；不执行原始 HTML |
| `sections` | 旧稿结构化段落，支持 table / chart，默认空数组 |
| `sources` | `[{"label":"原始资料标题", "url":"https://…", "kind":"official"}]` |
| `sources[].kind` | official / benchmark / community |
| `publishedAt`, `verifiedAt` | YYYY-MM-DD 或 RFC3339，发布前必填 |
| `eventNote` | 事件时间、测试环境、资料范围等 |
| `image` | `{"url":"/media/安全文件名.png", "alt":"替代文字", "caption":"说明与出处"}`，也允许 HTTPS URL |
| `highlight` | 标题中要高亮的连续片段，可选 |
| `commentsClosed` | `true` 时读者不能再提交评论，可选 |
| `revision`, `createdAt`, `updatedAt` | 服务端维护；更新使用当前 revision 作冲突检查 |

来源只接受合法 HTTP(S) URL；图片只接受上传文件路径或 HTTPS URL，均不得含用户名密码。拒绝未知字段和重复 JSON key，避免新版字段被静默丢弃。正文最多 150 KiB，JSON 请求最多 2 MiB，文章上限 5000。draft 允许缺少发布必填项，但不接受不合法字段值。

## 公开读取

`GET /api/articles` → `{"articles":[已发布文章],"featuredId":"头条id"}`。不返回草稿。网站按 `publishedAt` 倒序展示（同日保持存储顺序），新发布的文章会排在前面；撤回头条后服务端选择其余已发布稿件。`GET /healthz` 为存活检查。

## 公开页面、搜索与 RSS

- `GET/HEAD /`：初始 HTML 列全部已发布文章的真实 `/a/{id}` 链接、标题、摘要和日期；空内容库诚实显示空状态。
- `GET/HEAD /a/{id}`：已发布文章的完整可读 HTML，含 Markdown/旧版段落、表格/图表数值、资料来源及元数据；JavaScript 取得真实数据及正文模块后增强为互动阅读，失败保留正文。草稿、不存在和已撤回返回 404 + noindex，通用提示不泄露元数据。
- 首页/文章提供唯一 title、description、canonical、OG/Twitter 和 JSON-LD（WebSite/Organization/Article/BreadcrumbList）；canonical 不带 query/hash，不编造作者、评分或日期。对所有 UA 返回相同正文。
- `GET/HEAD /sitemap.xml`：XML，仅首页和已发布文章；动态反映发布/修改/撤回，lastmod 取实际 updatedAt/publishedAt，不用 verifiedAt 或请求时间。
- `GET/HEAD /robots.txt`：允许公开抓取，禁止 `/admin`、`/api/`、`/healthz`，指向绝对 sitemap；不禁止 assets/media。私有路由另带 noindex/nofollow，所有普通 404 带 noindex；不替代身份认证。
- `GET/HEAD /index.html`：301 到 `/`，保留 query；`GET /rss.xml`：RSS 2.0，最新 30 篇已发布文章，按 publishedAt 倒序。
- 站点地址由请求 Host 推导：本机地址用 http，其余用 https（`X-Forwarded-Proto` 可覆盖）。cloudflared 需保留原始 Host。搜索平台验证、提交及 Cloudflare 公网验收见 [搜索说明](SEARCH.md)。

## 读者评论

| 方法 / 路径 | 说明 |
| --- | --- |
| GET `/api/articles/{id}/comments` | 公开，`{comments:[{id,name,body,createdAt}]}`，只含已公开评论 |
| POST `/api/articles/{id}/comments` | 公开，`{name?, body, website?}` → 201 `{status:"approved",masked:boolean,comment:{id,name,body,createdAt}}`；先脱敏再保存并公开，需 `X-Requested-With: model-insight` 与同源 `Origin` |
| GET `/api/admin/comments` | Cookie；全部评论（含 articleId、status），新的在前 |
| PUT `/api/admin/comments/{id}` | Cookie；`{status}`，取值 approved / hidden / pending；恢复 approved 时再次脱敏 |
| DELETE `/api/admin/comments/{id}` | Cookie；永久删除 |
| POST `/api/admin/comments/auto-publish` | Cookie + CSRF；`{}` → `{published,masked}`，单次原子处理：公开稿且未关闭评论的待审项脱敏后公开，已公开项重新脱敏，已隐藏项不恢复；失败不部分写入 |

规则：昵称 ≤40 字（空则显示「匿名读者」），内容 2–2000 字，拒绝控制字符；文章须已发布且未设 `commentsClosed`。每个访客 10 分钟最多 5 条、全站每小时最多 120 条（429），评论总数上限 20000（503）。`website` 是隐藏防垃圾字段：有值时返回成功状态但不保存（comment 为 null）。访客 IP 只在内存中用于限流，不写盘；位于 cloudflared 之后时只信任本机连接带来的 `CF-Connecting-IP`。评论保存在 `DATA_DIR/comments.json`，原子写入，文件损坏时服务拒绝启动、不覆盖。

过滤是轻量本地规则，不是语义审核：默认常见辱骂/色情招揽词、国内手机号、邮箱、18 位身份证样式、通过 Luhn 校验的疑似银行卡号，以及部分 API 密钥/Bearer/JWT/密码赋值样式。命中片段在昵称和正文中替换成星号（最多 3 个），未命中部分保留；不会仅因批评模型而屏蔽评论。支持部分全角、大小写、零宽及拆字变体，不能保证覆盖暗语、所有隐私格式或未知敏感内容。

新评论不保存被替换的原文。旧评论不会在启动时自动改状态；站长显式调用批处理可将旧公开/待审内容脱敏落盘，已隐藏评论不修改。旧备份仍可能含处理前的原文，应作为私密运维数据保管。自定义词库位置与限制见 [评论策略](WRITING.md#评论自动公开与脱敏)。

## 管理员：Cookie 会话

网页后台已封装下列操作，一般不需要手写脚本。

| 方法 / 路径 | 请求 / 响应 |
| --- | --- |
| POST `/api/admin/login` | `{token}` → `{authenticated:true}`，8 小时 HttpOnly / SameSite=Strict cookie |
| GET `/api/admin/session` | `{authenticated:boolean}` |
| POST `/api/admin/logout` | `{}` → `{authenticated:false}` |
| GET `/api/admin/articles` | 返回全部文章（包含草稿）和 featuredId |
| POST `/api/admin/articles` | `{article}` → 201 `{article}` |
| PUT `/api/admin/articles/{id}` | `{article,expectedRevision}` → `{article}`；冲突为 409，ID 不允许变更 |
| DELETE `/api/admin/articles/{id}` | 只能删除草稿 → `{deleted:true}`；已发布文章返回 409，需先撤回 |
| POST `/api/admin/featured` | `{id}` → `{featuredId}`；只能选择已发布文章 |
| POST `/api/admin/media` | multipart `file` → 201 `{url,alt}` |
Cookie 写请求必须携带 `X-Requested-With: model-insight` 和与 Host 同源的 `Origin`（登录请求可省略 Origin，若提供仍校验）。没有通配 CORS。不要通过不可信反向代理改写 Host/Origin；cloudflared 的源站配置见部署文档。


图片最大 5 MiB，只接受 PNG/JPEG/GIF，服务端检查真实内容，拒绝 SVG/HTML，随机命名并带 nosniff；不会代理下载外部图片。移除文章配图不会删除已上传文件，避免其他文章引用失效。

## 错误与重试

- 400：无效 JSON/字段、缺少发布内容、非法来源、非法图片等；修正请求，不盲目重试。
- 401：密钥无效或管理员会话已过期。
- 403：同源 / 自定义请求头检查失败。
- 409：文章 ID 已存在，或 revision 冲突；不覆盖。保留本地副本，读取新版本后人工合并。
- 413：请求或上传体积过大。
- 429：登录失败过多，请稍后再试。
- 500：持久化等服务端错误。不要假定保存成功；检查服务日志、磁盘和文件权限。

密钥轮换后重启服务；会话也会失效。日志不记录请求正文或密钥；代理日志规则由运营者配置。内容库和 media 属于私有运维数据，不推到源码仓库。

## 匿名访问统计

- `POST /api/stats/event`：JSON `{ "type": "pageview" }` 或 `{ "type": "article", "articleId": "已发布文章ID" }`，需同源 Origin 与 `X-Requested-With: model-insight`，JSON 限 1 KiB。不接受额外字段或查询参数。成功返回空 204；已登录管理员、常见爬虫、DNT/GPC 请求返回同样的 204 但不计数。
- `GET /api/admin/stats?days=7|30|90`：Cookie 管理员认证；默认 30 天，包含今天。返回 `startedAt / updatedAt / timezone / days / totals / today / period / daily / articles`。各汇总为 `{pageViews,articleViews}`；daily 为按北京时间升序的 `{date,pageViews,articleViews}`；articles 为 `{id,title,status,views,periodViews,todayViews}`，包含已发布文章的零值项，历史下架/删除稿使用固定名称，不存历史标题。
- 前台页面可见满 1 秒记访问；文章打开可见满 1 秒记阅读；同一文档内同一文章只报一次，刷新可再计。是**事件次数，不是 UV、读完率或曝光点击率**。后台预览不上报。
- 不设统计 Cookie、不存身份/IP/来源/UA/指纹；IP 只用于短期内存防刷。每 IP 每分钟最多 30 个事件，全站每分钟 120、每秒 10 个（429），异常流量会漏计。拦截、断网、禁用 JS 也可能漏计，不能用于广告审计或结算。
- 数据单独存 `DATA_DIR/analytics.json`，保留累计和最近 90 天日数据，从功能安装后开始，不补造历史。每次成功事件原子持久化；保存失败返回 503，不推进确认计数。GET 仍返回最后成功保存的数据。
- 文件损坏/无法读取时不自动清零或覆盖：正常运行禁用统计、GET 返回 503，其余阅读与发稿照常；`-check-config` 会明确失败阻止有问题的更新。先归档数据并检查日志，不能直接删文件来“修复”。

具体站点与站长批量发布脚本见 [固定发稿方法](PUBLISHING.md)。
