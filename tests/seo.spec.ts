import { test, expect, type APIRequestContext, type Page } from '@playwright/test'
import type { Article } from '../src/content'

const base = 'http://127.0.0.1:8198'
const headers = { Origin: base, 'X-Requested-With': 'model-insight' }
const seedID = 'kimi-k31-pro-release'
const markdown = `## 可抓取的完整正文

开头有 **重点**，脚注在这里[^source]。

| 项目 | 数值 | 口径 |
| --- | --- | --- |
| 测试值 | 42 | 仅测试 |

行内长代码：\`${'very_long_inline_code_'.repeat(25)}\`

\`\`\`text
${'long_code_line_'.repeat(40)}
\`\`\`

- [x] 完整列表

[外部资料](https://example.com/article)

[^source]: 脚注说明与 [原文](https://example.com/footnote)

正文末尾标记。`

async function create(request: APIRequestContext, extra: Record<string, unknown> = {}) {
  const login = await request.post('/api/admin/login', { headers, data: { token: 'cms-browser-test-admin-token-not-for-production' } })
  expect(login.status()).toBe(200)
  const id = `seo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const article = {
    id, status: 'published', title: `搜索测试 ${id}`, description: '完整正文、真实来源与抓取测试。',
    model: '跨模型', tone: 'industry', category: '模型动态', time: 3, label: '测试',
    takeaway: '测试结论，不是模型成绩。', quote: '', sections: [], body: markdown,
    publishedAt: '2026-10-26', verifiedAt: '2026-10-26', eventNote: '自动测试样例。',
    sources: [{ label: '测试资料', url: 'https://example.com/source', kind: 'official' }], ...extra,
  }
  const response = await request.post('/api/admin/articles', { headers, data: { article } })
  expect(response.status()).toBe(201)
  return (await response.json()).article as Article
}
async function remove(request: APIRequestContext, article: Article) {
  if (article.status === 'published') {
    const response = await request.put(`/api/admin/articles/${article.id}`, { headers, data: { article: { ...article, status: 'draft' }, expectedRevision: article.revision } })
    expect(response.status()).toBe(200)
  }
  expect((await request.delete(`/api/admin/articles/${article.id}`, { headers })).status()).toBe(200)
}
async function schema(page: Page) {
  await expect(page.locator('#site-structured-data')).toHaveCount(1)
  return JSON.parse((await page.locator('#site-structured-data').textContent())!)['@graph'] as Record<string, unknown>[]
}
async function uniqueMeta(page: Page, path: string) {
  await expect(page.locator('head title')).toHaveCount(1)
  await expect(page.locator('meta[name="description"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${base}${path}`)
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${base}${path}`)
  await expect(page.locator('meta[name="twitter:title"]')).toHaveCount(1)
}

test('no-JavaScript home exposes every published article through real links', async ({ browser, request }) => {
  const publication = await (await request.get('/api/articles')).json() as { articles: Article[] }
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } })
  try {
    const reader = await context.newPage()
    expect((await reader.goto(base))!.status()).toBe(200)
    await expect(reader.locator('#server-content[data-page="home"] h1')).toHaveText('模型智见')
    const links = reader.locator('#server-content h2 a')
    await expect(links).toHaveCount(publication.articles.length)
    for (const article of publication.articles) await expect(reader.locator(`#server-content h2 a[href="/a/${article.id}"]`)).toHaveText(article.title)
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const target = publication.articles[0]
    await reader.locator(`h2 a[href="/a/${target.id}"]`).click()
    await expect(reader.locator('#server-content h1')).toHaveText(target.title)
    await uniqueMeta(reader, `/a/${target.id}`)
  } finally { await context.close() }
})

test('no-JavaScript legacy article preserves sections, tables, chart values and sources', async ({ browser, request }) => {
  const publication = await (await request.get('/api/articles')).json() as { articles: Article[] }
  const article = publication.articles.find(a => a.id === seedID)!
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const reader = await context.newPage()
    await reader.goto(`${base}/a/${seedID}`)
    const content = reader.locator('#server-content')
    for (const section of article.sections) {
      await expect(content).toContainText(section.heading)
      await expect(content).toContainText(section.text)
      if (section.table) {
        await expect(content).toContainText(section.table.caption)
        await expect(content).toContainText(section.table.note)
        for (const row of section.table.rows) for (const cell of row) await expect(content).toContainText(cell)
      }
      if (section.chart) for (const row of section.chart.rows) {
        await expect(content).toContainText(row.label)
        await expect(content).toContainText(String(row.value))
      }
    }
    for (const source of article.sources) await expect(content.locator(`a[href="${source.url}"]`)).toHaveText(source.label)
    for (const width of [320, 390, 768, 1440]) {
      await reader.setViewportSize({ width, height: 900 })
      expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `legacy overflow at ${width}`).toBe(true)
    }
  } finally { await context.close() }
})

test('no-JavaScript Markdown keeps tables, code, task lists and working footnotes at 320px', async ({ browser, request }, testInfo) => {
  const article = await create(request)
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } })
  try {
    const reader = await context.newPage()
    await reader.goto(`${base}/a/${article.id}`)
    await expect(reader.locator('#server-content strong')).toHaveText('重点')
    await expect(reader.locator('#server-content table')).toContainText('测试值')
    await expect(reader.locator('#server-content pre')).toContainText('long_code_line_')
    await expect(reader.locator('#server-content .task-mark')).toHaveText('[x]')
    await expect(reader.locator('#server-content')).toContainText('正文末尾标记。')
    await reader.locator('sup a').first().click()
    expect(new URL(reader.url()).hash).toMatch(/^#fn/)
    await expect(reader.locator('.footnotes')).toContainText('脚注说明')
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await reader.screenshot({ path: testInfo.outputPath('seo-nojs-markdown-320.png'), fullPage: true })
  } finally { await context.close(); await remove(request, article) }
})

test('interactive takeover and article open/close keep unique matching metadata', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`/a/${seedID}?utm_source=test`)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#server-content')).toHaveCount(0)
  await uniqueMeta(page, `/a/${seedID}`)
  expect((await schema(page)).find(item => item['@type'] === 'Article')?.url).toBe(`${base}/a/${seedID}`)
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await uniqueMeta(page, '/')
  expect((await schema(page)).some(item => item['@type'] === 'Article')).toBe(false)
  await expect(page.locator('meta[property="article:published_time"]')).toHaveCount(0)
  const link = page.locator('#root a[href^="/a/"]').first()
  const path = (await link.getAttribute('href'))!
  await link.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await uniqueMeta(page, path)
  expect((await schema(page)).find(item => item['@type'] === 'Article')?.url).toBe(`${base}${path}`)
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await uniqueMeta(page, '/')
  expect(errors).toEqual([])
})

test('real article href supports a separate tab instead of intercepting modified clicks', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('#server-content')).toHaveCount(0)
  const link = page.locator('#root a[href^="/a/"]').first()
  const path = (await link.getAttribute('href'))!
  const popupEvent = context.waitForEvent('page')
  await link.click({ button: 'middle' })
  const popup = await popupEvent
  try {
    await popup.waitForURL(`${base}${path}`)
    await expect(popup.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally { await popup.close() }
})

test('slow API leaves readable server article until the interactive reader is ready', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/articles', async route => { await gate; await route.continue() })
  try {
    await page.goto(`/a/${seedID}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#server-content[data-page="article"]')).toContainText('原始资料与来源')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally { release() }
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('#server-content')).toHaveCount(0)
  await expect(page.locator('[id="dialog-title"]')).toHaveCount(1)
})

test('failed API preserves the actual server article rather than showing seed or an empty page', async ({ page }) => {
  await page.route('**/api/articles', route => route.abort())
  await page.goto(`/a/${seedID}`)
  await expect(page.getByRole('heading', { name: '互动界面暂时不可用' })).toBeVisible()
  await expect(page.locator('#server-content[data-page="article"]')).toContainText('原始资料与来源')
  await expect(page.locator('.article-card')).toHaveCount(0)
  await uniqueMeta(page, `/a/${seedID}`)
})

test('failed Markdown chunk preserves the full Markdown server article', async ({ page, request }) => {
  const article = await create(request)
  try {
    await page.route('**/assets/MarkdownBody-*.js', route => route.abort())
    await page.goto(`/a/${article.id}`)
    await expect(page.getByRole('heading', { name: '互动界面暂时不可用' })).toBeVisible()
    await expect(page.locator('#server-content')).toContainText('正文末尾标记。')
    await expect(page.locator('#server-content table')).toContainText('测试值')
    await expect(page.getByRole('dialog')).not.toBeVisible()
  } finally { await remove(request, article) }
})

test('draft and unknown article remain real noindex 404s without loading the public app', async ({ page, request }) => {
  const article = await create(request, { status: 'draft', title: 'PRIVATE SEO TITLE', body: 'PRIVATE SEO BODY' })
  const calls: string[] = []
  page.on('request', req => { if (req.url().endsWith('/api/articles')) calls.push(req.url()) })
  try {
    for (const id of [article.id, 'unknown-seo-article']) {
      const response = await page.goto(`/a/${id}`)
      expect(response!.status()).toBe(404)
      expect(response!.headers()['x-robots-tag']).toContain('noindex')
      await expect(page.getByRole('heading', { name: '文章不存在或已撤回' })).toBeVisible()
      await expect(page.locator('body')).not.toContainText('PRIVATE SEO')
      await expect(page.locator('link[rel="canonical"], #site-structured-data')).toHaveCount(0)
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
      await expect(page.locator('.article-card')).toHaveCount(0)
    }
    expect(calls).toEqual([])
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain(article.id)
  } finally { await remove(request, article) }
})

test('article withdrawn between HTML and API response becomes missing, not a fake homepage', async ({ page, request }) => {
  const publication = await (await request.get('/api/articles')).json() as { articles: Article[] }
  await page.route('**/api/articles', route => route.fulfill({ json: { ...publication, articles: publication.articles.filter(a => a.id !== seedID) } }))
  await page.goto(`/a/${seedID}`)
  await expect(page.getByRole('heading', { name: '文章不存在或已撤回' })).toBeVisible()
  await expect(page.locator('#server-content, .article-card')).toHaveCount(0)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(page.locator('link[rel="canonical"], #site-structured-data')).toHaveCount(0)
})

test('sitemap, robots, redirects, HEAD and private route headers are served by the Go process', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.status()).toBe(200)
  expect(sitemap.headers()['content-type']).toContain('application/xml')
  expect(await sitemap.text()).toContain(`${base}/a/${seedID}`)
  const robots = await request.get('/robots.txt')
  expect(robots.headers()['content-type']).toContain('text/plain')
  expect(await robots.text()).toContain(`Sitemap: ${base}/sitemap.xml`)
  expect(await robots.text()).toContain('Disallow: /admin')
  expect(await robots.text()).not.toContain('Disallow: /assets')
  for (const path of ['/', `/a/${seedID}`, '/sitemap.xml', '/robots.txt']) {
    const response = await request.head(path)
    expect(response.status()).toBe(200)
    expect(await response.text()).toBe('')
    expect(Number(response.headers()['content-length'])).toBeGreaterThan(0)
  }
  const redirect = await request.get('/index.html?utm_source=test', { maxRedirects: 0 })
  expect(redirect.status()).toBe(301)
  expect(redirect.headers().location).toBe('/?utm_source=test')
  for (const path of ['/admin', '/api/articles', '/healthz', '/not-a-real-path']) {
    const response = await request.get(path)
    expect(response.headers()['x-robots-tag']).toContain('noindex')
  }
  expect((await request.get('/api/admin/articles')).status()).toBe(401)
})

test('untrusted title and Markdown stay inert and JSON-LD roundtrips after takeover', async ({ page, request }) => {
  const title = '</script><script>window.seoAttack=1</script> 新闻'
  const article = await create(request, { title, body: '## 安全正文\n\n<script>window.seoAttack=2</script>\n\n[危险链接](javascript:alert%281%29)\n\n![危险图片](data:image/svg+xml,evil)\n\n安全正文末尾。' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    const html = await (await request.get(`/a/${article.id}`)).text()
    expect(html).not.toContain('<script>window.seoAttack')
    await page.goto(`/a/${article.id}`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText('安全正文末尾。')
    expect(await page.evaluate(() => 'seoAttack' in window)).toBe(false)
    expect((await schema(page)).find(item => item['@type'] === 'Article')?.headline).toBe(title)
    await expect(page.locator('a[href^="javascript:"], img[src^="data:image/svg"]')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await remove(request, article) }
})

test('Google ownership verification is a public exact static file and supports HEAD', async ({ request }) => {
  const path = '/google131e838ab93fa6cf.html'
  const body = 'google-site-verification: google131e838ab93fa6cf.html'
  const response = await request.get(path, { maxRedirects: 0 })
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/html')
  expect(response.headers()['cache-control']).toContain('no-cache')
  expect(await response.text()).toBe(body)
  const head = await request.head(path, { maxRedirects: 0 })
  expect(head.status()).toBe(200)
  expect(head.headers()['content-length']).toBe(String(Buffer.byteLength(body)))
  expect(await head.text()).toBe('')
  expect(await (await request.get('/sitemap.xml')).text()).not.toContain(path)
})
