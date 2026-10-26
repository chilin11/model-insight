# 搜索抓取与站长平台

本站的搜索基础由同一个 Go 服务提供，不需要 Docker、Nginx、常驻 Node 或额外渲染服务。**能抓取不等于已经收录，也不保证排名或流量。**

## 已提供的基础

- 首页 `/` 直接返回所有已发布文章的标题、摘要、日期及真实 `/a/<id>` 链接，尊重后台选择的头条。
- `/a/<id>` 在初始 HTML 中包含完整正文、Markdown 表格/脚注/代码、旧版结构化段落、图表数值和注释、来源与资料口径。不运行 JavaScript 仍可阅读和导航。
- 对普通浏览器与爬虫返回相同正文，不按 User-Agent 换内容。JavaScript 成功取得真实内容库及所需正文模块后才接管；API 或正文模块失败时保留服务器正文，不拿 seed 冒充恢复。
- 首页和文章有唯一 title、description、canonical、OG/Twitter 元数据及 JSON-LD。文章 schema 仅使用实际标题、摘要、发布/更新时间和站点编辑组织，不虚构人物作者、评级或本站实测。互动阅读打开、切换和关闭时同步元数据。
- `/sitemap.xml` 动态列出首页和全部已发布文章；发布、修改、撤回后立即反映，无需重建。文章 `lastmod` 只取真实 `updatedAt` / `publishedAt`，不用核验日期或请求时间冒充更新。首页不伪造 `lastmod`。
- `/robots.txt` 允许公开页面、assets 和 media 抓取，禁止 `/admin`、`/api/`、`/healthz`，声明 sitemap 绝对地址。后台、API 和健康检查另带 `X-Robots-Tag: noindex, nofollow`；这不是认证替代品。
- 草稿、未知和已撤回文章返回真实 HTTP 404、通用提示及 noindex，不泄露私稿；不会返回 200 首页。`/index.html` 永久重定向到 `/`，canonical 不带跟踪 query 或 hash。
- 公开 HTML、sitemap、robots 支持 GET/HEAD，避免陈旧缓存。分享和抓取使用 `/a/<id>`；旧 `/#read/<id>` 仍兼容站内阅读，但不要再把 hash 链接提交给搜索引擎。

## 先升级并从公网验收

在 VPS 上执行既有安装/更新命令；程序升级保留文章、评论、统计、图片、词库与密钥：

```sh
curl -fsSL https://raw.githubusercontent.com/chilin11/model-insight/main/install.sh | sudo bash
```

升级完成、健康检查正常后，在自己的终端检查正式域名（不需要任何密钥）：

```sh
SITE=https://blogs.chipubliclinks.online
curl -fsS "$SITE/sitemap.xml"
curl -fsS "$SITE/robots.txt"
curl -fsS "$SITE/a/domestic-models-delivery-not-demo" | grep -o 'id="server-content"'
curl -sS -o /dev/null -w '%{http_code}\n' "$SITE/a/unknown-search-check"  # 应为 404
curl -sSI "$SITE/admin" | grep -i x-robots-tag
```

再用浏览器查看网页源代码，而不只是开发者工具里 JavaScript 运行后的 DOM：文章标题、正文末尾、来源应已在源码中。也可在临时浏览器配置中关闭 JavaScript，检查首页目录与文章是否可读。

**Cloudflare / Tunnel 注意：**

- 保留原始公网 Host；canonical、sitemap 和社交预览的绝对地址由它推导。不要强制改成 localhost。
- 检查的是公网最终响应。Cloudflare 的托管 robots / Content Signals 可能追加或接管 `/robots.txt`；最终内容必须仍允许目标搜索爬虫抓取公开页，并包含正确 Sitemap。若只有边缘注释而没有本站规则，先核对边缘配置，不要一概关闭安全防护。
- 不要把首页、文章 HTML、sitemap 和 robots 配成长期 Cache Everything；现有源站响应为不缓存。若自行配过边缘缓存，更新后核对并按需只清理这些本站路径。
- 验收真实搜索抓取是否遭遇验证页或 403。不要因单次 curl 被拦就关闭全站防护，也不要伪造 UA 绕过限制；以站长平台的真实网址检查结果为准，再有针对性检查规则。

## Google Search Console

1. 站长本人打开 [Google Search Console](https://search.google.com/search-console/)，添加 `blogs.chipubliclinks.online` 的**网域资源**，或使用已经验证且覆盖该子域的父网域资源。
2. 按平台显示的 DNS TXT 值完成所有权验证。TXT 名称和值以平台当次显示为准；不要更改 tunnel 的 CNAME、现有记录或其他服务。此步骤需要站长的 DNS 权限，本项目不自动操作账号/DNS。
3. 验证通过后，在「站点地图」提交：
   `https://blogs.chipubliclinks.online/sitemap.xml`
4. 使用「网址检查」分别测试首页和一篇文章的实际网址。核对抓取允许、响应 200、可见正文及 canonical；必要时对重要页面请求编入索引，不必每天重复提交。
5. 后续看「网页索引」和「效果」：有效索引、真实搜索词、展示与点击，比只搜索 `site:` 更可靠。站点访问统计只记录匿名浏览事件，不知道搜索词，也不是搜索点击率。

若选择网址前缀资源，也必须使用平台实际支持且能长期保留的验证方式。不要临时把验证文件塞进 `/opt/model-insight/current/www`：程序更新会替换该目录；需要持久验证文件/标签时再单独接入，不把它当作本次已完成项。

## Bing Webmaster Tools

1. 站长本人打开 [Bing Webmaster Tools](https://www.bing.com/webmasters/)。可按平台提供的流程从已验证的 Search Console 导入本站，或独立添加并完成 DNS 所有权验证。
2. 提交同一份 `https://blogs.chipubliclinks.online/sitemap.xml`。
3. 检查网址抓取、索引状态与错误；确认公开页没有被 robots、边缘验证页或错误 canonical 排除。

本次不代登录、不索取管理员密钥，也不自动提交 IndexNow 或创建验证凭据。平台验证和提交完成后仍由搜索引擎决定是否、何时收录。

## 维护习惯

发稿继续走后台或 AI 草稿 API，不改 seed 来发稿。标题明确具体问题，摘要与正文一致，来源可核查；修改正文才更新内容，不为制造「新鲜度」反复改时间。不群发重复文章、不创建虚假评测/评分，不为爬虫准备另一套正文。

本地完整 SEO 验证使用 Go + 生产构建（`GO_BIN=/path/to/go npm run test:cms`，临时数据、8198）；Vite 的 5188 开发入口不是服务端直出验收环境。无需改动 5173 上的其他项目。
