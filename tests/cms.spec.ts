import { test, expect, type Page } from '@playwright/test'
import { allArticles } from '../src/content'
const adminToken = 'cms-browser-test-admin-token-not-for-production'
const apiToken = 'cms-browser-test-ingest-token-not-for-production'
const writeHeaders = { 'X-Requested-With': 'model-insight', Origin: 'http://127.0.0.1:8198' }
const bearer = { Authorization: `Bearer ${apiToken}` }
const uniqueID = () => `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
async function login(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('管理员密钥').fill(adminToken)
  await page.getByRole('button', { name: '登录后台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文章库', exact: true })).toBeVisible()
}

test('seed keeps all nine original articles with full structured content', async ({ request }) => {
  const result = await (await request.get('/api/articles')).json()
  for (const original of allArticles) {
    const actual = result.articles.find((a: { id: string }) => a.id === original.id)
    expect(actual).toMatchObject(original)
  }
})

test('login is required, token is not stored, logout ends the session', async ({ page }) => {
  expect((await page.request.get('/api/admin/articles')).status()).toBe(401)
  await login(page)
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('cms-browser-test')))).toBe(false)
  const cookies = await page.context().cookies()
  expect(cookies.some(c => c.httpOnly && c.sameSite === 'Strict')).toBe(true)
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page.getByLabel('管理员密钥')).toBeVisible()
  expect((await page.request.get('/api/admin/articles')).status()).toBe(401)
})

test('write, preview, save draft, publish, feature and withdraw without rebuild', async ({ page }) => {
  const id = uniqueID()
  await login(page)
  await page.locator('.admin-new').click()
  await page.getByLabel('文章标题', { exact: true }).fill(`平台测试文章 ${id}`)
  await page.getByLabel('一句话摘要').fill('新文章由后台即时发布，不改代码。')
  await page.getByLabel('Markdown 正文', { exact: true }).fill('## 新稿正文\n\n测试正文包含 **重点**。\n\n| 数据 | 数值 |\n| --- | --- |\n| 样例 | 12 |')
  await page.getByText('链接与标题高亮', { exact: true }).click()
  await page.getByLabel('文章 ID', { exact: true }).fill(id)
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await page.getByLabel('来源 1 名称').fill('测试来源')
  await page.getByLabel('来源 1 链接').fill('https://example.com/official')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('新稿正文')
  await expect(page.getByRole('dialog').getByRole('table')).toBeVisible()
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('草稿已保存')
  let publicData = await (await page.request.get('/api/articles')).json()
  expect(publicData.articles.some((a: { id: string }) => a.id === id)).toBe(false)
  await page.getByRole('button', { name: '发布文章', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('已发布')
  await page.getByRole('button', { name: '设为首页头条', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('首页头条已更新')
  const reader = await page.context().newPage()
  await reader.goto(`/#read/${id}`)
  await expect(reader.getByRole('heading', { level: 1 })).toContainText(id)
  await expect(reader.getByRole('dialog')).toContainText('新稿正文')
  await reader.close()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '撤回为草稿', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('草稿已保存')
  publicData = await (await page.request.get('/api/articles')).json()
  expect(publicData.articles.some((a: { id: string }) => a.id === id)).toBe(false)
  expect(publicData.featuredId).not.toBe(id)
})

test('AI submits drafts only, cannot overwrite, drafts are editable in admin', async ({ page, request }) => {
  const id = uniqueID()
  const article = { id, status: 'draft', title: `AI 草稿 ${id}`, model: '跨模型', category: '模型动态', body: '## AI 提交\n\n等待人工核验。' }
  expect((await request.post('/api/ingest/articles', { headers: bearer, data: { article: { ...article, status: 'published' } } })).status()).toBe(400)
  expect((await request.post('/api/ingest/articles', { headers: bearer, data: { article } })).status()).toBe(201)
  expect((await request.post('/api/ingest/articles', { headers: bearer, data: { article } })).status()).toBe(409)
  const publicData = await (await request.get('/api/articles')).json()
  expect(publicData.articles.some((a: { id: string }) => a.id === id)).toBe(false)
  expect((await request.get('/api/admin/articles', { headers: bearer })).status()).toBe(401)
  await login(page)
  await page.getByRole('button', { name: '草稿', exact: true }).click()
  await page.getByLabel('搜索后台文章').fill(id)
  await page.locator('.admin-list > button').click()
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue(article.title)
  await expect(page.getByLabel('Markdown 正文', { exact: true })).toHaveValue(article.body)
})

test('revision conflicts preserve local edits and reject silent overwrite', async ({ page }) => {
  const id = uniqueID()
  await page.request.post('/api/ingest/articles', { headers: bearer, data: { article: { id, status: 'draft', title: `冲突测试 ${id}`, model: '跨模型', category: '模型动态', body: '原始正文' } } })
  await login(page)
  await page.getByLabel('搜索后台文章').fill(id)
  await page.locator('.admin-list > button').click()
  const data = await (await page.request.get('/api/admin/articles')).json()
  const serverArticle = data.articles.find((a: { id: string }) => a.id === id)
  const result = await page.request.put(`/api/admin/articles/${id}`, { headers: writeHeaders, data: { article: { ...serverArticle, title: '服务器的新标题' }, expectedRevision: serverArticle.revision } })
  expect(result.status()).toBe(200)
  await page.getByLabel('文章标题', { exact: true }).fill('我还没保存的标题')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('未覆盖服务器版本')
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('我还没保存的标题')
  const latest = await (await page.request.get('/api/admin/articles')).json()
  expect(latest.articles.find((a: { id: string }) => a.id === id).title).toBe('服务器的新标题')
})

test('image uploads are served safely and SVG files are refused', async ({ page }) => {
  await login(page)
  await page.locator('.admin-new').click()
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 2, height: 2 } })
  await page.getByLabel('上传文章图片').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: png })
  await expect(page.locator('.admin-success')).toContainText('图片已上传')
  await page.getByLabel('图片替代文字').fill('测试图片说明')
  const imageURL = await page.getByLabel('图片地址', { exact: true }).inputValue()
  const response = await page.request.get(imageURL)
  expect(response.status()).toBe(200)
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  const refused = await page.request.post('/api/admin/media', { headers: writeHeaders, multipart: { file: { name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') } } })
  expect(refused.status()).toBe(415)
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('草稿已保存')
})

test('unsaved edits are guarded and Markdown cannot run raw HTML or unsafe URLs', async ({ page }) => {
  await login(page)
  await page.locator('.admin-new').click()
  await page.getByLabel('文章标题', { exact: true }).fill('安全预览')
  await page.getByLabel('Markdown 正文', { exact: true }).fill('<script>window.bad=1</script>\n\n<img src=x onerror="window.bad=1">\n\n[unsafe](javascript:alert(1))\n\n![unsafe](data:image/svg+xml;base64,AAAA)\n\n[real](https://example.com)')
  page.once('dialog', dialog => dialog.dismiss())
  await page.locator('.admin-new').click()
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('安全预览')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('script, iframe, img')).toHaveCount(0)
  await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(dialog.getByRole('link', { name: 'real', exact: true })).toHaveAttribute('rel', 'noopener noreferrer')
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
})

test('admin editor fits 320px through desktop widths and keeps old figures in preview', async ({ page }) => {
  await login(page)
  await page.getByLabel('搜索后台文章').fill('kimi-k31-pro-release')
  await page.locator('.admin-list > button').click()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `admin overflow at ${width}`).toBe(true)
  }
  await page.getByRole('button', { name: '预览', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('table')).toHaveCount(1)
  await expect(page.getByRole('dialog').locator('.data-chart')).toHaveCount(1)
  await page.setViewportSize({ width: 320, height: 844 })
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('production API failures never replace server content with bundled seed', async ({ page }) => {
  await page.route('**/api/articles', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '暂时无法读取文章' })).toBeVisible()
  await expect(page.locator('.article-card')).toHaveCount(0)
})

const origin = { 'X-Requested-With': 'model-insight', Origin: 'http://127.0.0.1:8198' }
async function publishArticle(page: Page, extra: Record<string, unknown>) {
  const id = uniqueID()
  const article = { id, status: 'published', title: `富文本测试 ${id}`, description: '测试摘要 & 说明', model: '跨模型', tone: 'industry', category: '模型动态', time: 3, label: '测试', takeaway: '', quote: '', sections: [], publishedAt: '2099-01-01', verifiedAt: '2099-01-01', sources: [{ label: '测试来源', url: 'https://example.com/source', kind: 'official' }], ...extra }
  const response = await page.request.post('/api/admin/articles', { headers: origin, data: { article } })
  expect(response.status()).toBe(201)
  return article as typeof article & { id: string; title: string }
}

test('rich Markdown: highlighted code with copy, callouts, quotes, footnotes and safe links', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await login(page)
  const body = '## 代码\n\n```ts\nconst answer: number = 42\n```\n\n> 引用一段官方原文\n\n> [!WARNING]\n> 厂商自测，非独立评测。\n\n正文引用来源[^1]，以及 [外部链接](https://example.com/x)。\n\n- [x] 已核验\n\n[^1]: 官方公告 [原文](https://example.com/a)'
  const article = await publishArticle(page, { body })
  await page.goto(`/a/${article.id}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName(article.title)
  await expect(dialog.locator('.code-block .hljs-keyword').first()).toHaveText('const')
  await expect(dialog.locator('.code-toolbar')).toContainText('ts')
  await dialog.getByRole('button', { name: '复制代码' }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('const answer: number = 42')
  await expect(dialog.locator('blockquote')).toContainText('引用一段官方原文')
  await expect(dialog.getByRole('note', { name: '注意' })).toContainText('厂商自测')
  await expect(dialog.getByRole('note', { name: '注意' })).not.toContainText('[!WARNING]')
  await expect(dialog.getByRole('link', { name: '外部链接' })).toHaveAttribute('target', '_blank')
  await expect(dialog.getByRole('heading', { name: '注释与来源' })).toBeVisible()
  const url = page.url()
  await dialog.locator('sup a').first().click()
  await expect(dialog).toBeVisible()
  expect(page.url()).toBe(url)
})

test('editor toolbar inserts formatting, uploads images inline and previews side by side', async ({ page }, testInfo) => {
  await login(page)
  await page.locator('.admin-new').click()
  const editor = page.getByLabel('Markdown 正文', { exact: true })
  await editor.fill('重点')
  await editor.selectText()
  await page.getByRole('button', { name: '加粗（⌘B）' }).click()
  await expect(editor).toHaveValue('**重点**')
  // The toolbar re-selects the wrapped text on the next frame.
  await expect.poll(() => editor.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd])).toEqual([2, 4])
  await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  await page.getByRole('button', { name: '代码块' }).click()
  await expect(editor).toHaveValue(/```text\n在这里粘贴代码\n```/)
  const caretToEnd = async () => {
    await page.waitForTimeout(50)
    await editor.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length))
  }
  await caretToEnd()
  await page.getByRole('button', { name: '脚注 / 引用来源' }).click()
  await expect(editor).toHaveValue(/\[\^1\][\s\S]*\[\^1\]: 来源说明/)
  await caretToEnd()
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 4, height: 4 } })
  await page.locator('.markdown-editor input[type="file"]').setInputFiles({ name: 'inline.png', mimeType: 'image/png', buffer: png })
  await expect(editor).toHaveValue(/!\[请填写图片描述\]\(\/media\/[a-f0-9]{32}\.png "图片说明与出处"\)/)
  await expect(page.locator('.editor-status')).toContainText('字')
  if (testInfo.project.name === 'desktop') {
    await page.getByRole('button', { name: '分屏' }).click()
    await expect(page.locator('.editor-preview .code-block')).toBeVisible()
    await expect(page.locator('.editor-preview img')).toHaveAttribute('src', /\/media\//)
  } else {
    await page.getByRole('button', { name: '效果' }).click()
    await expect(page.locator('.editor-preview strong').first()).toHaveText('重点')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('reader comments publish immediately and can still be hidden or restored', async ({ page, browser }, testInfo) => {
  await login(page)
  const article = await publishArticle(page, { body: '评论测试正文' })
  const reader = await browser.newPage({ extraHTTPHeaders: { 'CF-Connecting-IP': testInfo.project.name === 'mobile' ? '198.51.100.211' : '198.51.100.210' } })
  try {
    await reader.goto(`http://127.0.0.1:8198/a/${article.id}`)
    await expect(reader.getByText('还没有公开评论。')).toBeVisible()
    await reader.getByLabel('昵称').fill('测试读者')
    await reader.getByLabel('你的看法').fill('这篇文章\n有两行')
    await reader.getByRole('button', { name: '提交评论' }).click()
    await expect(reader.locator('.comment-status')).toHaveText('评论已发布。')
    await expect(reader.locator('.comment-list p')).toHaveText('这篇文章\n有两行')
    await reader.reload()
    await expect(reader.locator('.comment-list')).toContainText('测试读者')
    await page.reload()
    await page.getByRole('button', { name: /评论管理/ }).click()
    const item = page.locator('.admin-comment-list > li').filter({ hasText: '测试读者' }).filter({ hasText: article.title })
    await expect(item).toContainText('有两行')
    await item.getByRole('button', { name: '撤下', exact: true }).click()
    await expect(page.locator('.admin-success')).toContainText('评论已隐藏')
    await reader.reload()
    await expect(reader.getByText('还没有公开评论。')).toBeVisible()
    await item.getByRole('button', { name: '脱敏并公开' }).click()
    await expect(page.locator('.admin-success')).toContainText('评论已公开')
    await reader.reload()
    await expect(reader.locator('.comment-list p')).toHaveText('这篇文章\n有两行')
  } finally { await reader.close() }
})

test('closed comments hide the form; spam honeypot is silently dropped', async ({ page }) => {
  await login(page)
  const closed = await publishArticle(page, { body: '关闭评论', commentsClosed: true })
  await page.goto(`/a/${closed.id}`)
  await expect(page.getByText('本文已关闭评论。')).toBeVisible()
  await expect(page.getByRole('button', { name: '提交评论' })).toHaveCount(0)
  const open = await publishArticle(page, { body: '开放评论' })
  const spam = await page.request.post(`/api/articles/${open.id}/comments`, { headers: origin, data: { name: 'bot', body: 'buy now', website: 'http://spam.example' } })
  expect(spam.status()).toBe(201)
  const all = await (await page.request.get('/api/admin/comments')).json()
  expect(all.comments.some((c: { name: string }) => c.name === 'bot')).toBe(false)
  expect((await page.request.post(`/api/articles/${open.id}/comments`, { headers: { 'X-Requested-With': 'model-insight', Origin: 'https://evil.example' }, data: { body: '跨站提交' } })).status()).toBe(403)
})

test('share pages carry social metadata, RSS lists published articles, drafts can be deleted', async ({ page, request }) => {
  await login(page)
  const article = await publishArticle(page, { body: '分享测试', image: { url: 'https://example.com/cover.png', alt: '封面' } })
  const html = await (await request.get(`/a/${article.id}`)).text()
  expect(html).toContain(`<meta property="og:title" content="${article.title}"`)
  expect(html).toContain('og:description" content="测试摘要 &amp; 说明"')
  expect(html).toContain('og:image" content="https://example.com/cover.png"')
  await page.goto(`/a/${article.id}`)
  await expect(page).toHaveTitle(new RegExp(article.title))
  const feed = await (await request.get('/rss.xml')).text()
  expect(feed).toContain(`/a/${article.id}</link>`)
  expect(feed.indexOf(article.id)).toBeLessThan(feed.indexOf('kimi-k31-pro-release'))
  const draftID = uniqueID()
  await request.post('/api/ingest/articles', { headers: bearer, data: { article: { id: draftID, status: 'draft', title: `待删除 ${draftID}`, model: '跨模型', category: '模型动态', body: 'x' } } })
  expect(feed).not.toContain(draftID)
  await page.goto('/admin')
  await page.getByLabel('搜索后台文章').fill(draftID)
  await page.locator('.admin-list > button').click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '删除草稿' }).click()
  await expect(page.locator('.admin-success')).toContainText('草稿已删除')
  const list = await (await page.request.get('/api/admin/articles')).json()
  expect(list.articles.some((a: { id: string }) => a.id === draftID)).toBe(false)
  expect((await page.request.delete(`/api/admin/articles/${article.id}`, { headers: origin })).status()).toBe(409)
})

test('sensitive comments and nicknames are masked before immediate publication', async ({ page, browser }, testInfo) => {
  await login(page)
  const article = await publishArticle(page, { body: '自动脱敏测试正文' })
  const reader = await browser.newPage({ extraHTTPHeaders: { 'CF-Connecting-IP': testInfo.project.name === 'mobile' ? '198.51.100.213' : '198.51.100.212' } })
  try {
    await reader.goto(`http://127.0.0.1:8198/a/${article.id}`)
    await reader.getByLabel('昵称').fill('reader@example.com')
    await reader.getByLabel('你的看法').fill('联系我13800138000，模型能力不行。')
    await reader.getByRole('button', { name: '提交评论' }).click()
    await expect(reader.locator('.comment-status')).toContainText('已用星号遮盖')
    await expect(reader.locator('.comment-list p')).toHaveText('联系我***，模型能力不行。')
    await expect(reader.locator('.comment-meta strong')).toHaveText('***')
    await expect(reader.getByLabel('昵称')).toHaveValue('***')
    expect(await reader.evaluate(() => localStorage.getItem('model-insight:comment-name'))).toBe('***')
    await reader.reload()
    await expect(reader.locator('.comment-list')).not.toContainText('13800138000')
    await expect(reader.locator('.comment-list')).not.toContainText('reader@example.com')
    const all = await (await page.request.get('/api/admin/comments')).json()
    const saved = all.comments.find((c: { articleId: string }) => c.articleId === article.id)
    expect(saved).toMatchObject({ status: 'approved', name: '***', body: '联系我***，模型能力不行。' })
    await reader.setViewportSize({ width: 320, height: 844 })
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  } finally { await reader.close() }
})

test('bulk legacy policy publishes pending but never restores hidden comments', async ({ page }, testInfo) => {
  await login(page)
  const article = await publishArticle(page, { body: '旧评论处理测试' })
  const headers = { ...origin, 'CF-Connecting-IP': testInfo.project.name === 'mobile' ? '198.51.100.215' : '198.51.100.214' }
  const pending = await (await page.request.post(`/api/articles/${article.id}/comments`, { headers, data: { name: '旧待审读者', body: '旧待审评论内容' } })).json()
  const hidden = await (await page.request.post(`/api/articles/${article.id}/comments`, { headers, data: { name: '旧隐藏读者', body: '人工隐藏的内容' } })).json()
  expect((await page.request.put(`/api/admin/comments/${pending.comment.id}`, { headers: origin, data: { status: 'pending' } })).ok()).toBe(true)
  expect((await page.request.put(`/api/admin/comments/${hidden.comment.id}`, { headers: origin, data: { status: 'hidden' } })).ok()).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: /评论管理/ }).click()
  page.once('dialog', d => d.dismiss())
  await page.getByRole('button', { name: '按规则处理旧评论', exact: true }).click()
  await expect(page.locator('.admin-comment-list > li').filter({ hasText: '旧待审读者' }).filter({ hasText: article.title })).toHaveClass('is-pending')
  page.once('dialog', d => d.accept())
  await page.getByRole('button', { name: '按规则处理旧评论', exact: true }).click()
  await expect(page.locator('.admin-success')).toContainText('1 条待审评论已公开')
  await expect(page.locator('.admin-comment-list > li').filter({ hasText: '旧隐藏读者' }).filter({ hasText: article.title })).toHaveClass('is-hidden')
  const visible = await (await page.request.get(`/api/articles/${article.id}/comments`)).json()
  expect(visible.comments.map((c: { name: string }) => c.name)).toEqual(['旧待审读者'])
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
})

test('failed comment publication preserves the reader input', async ({ page }) => {
  await page.goto('/a/kimi-k31-pro-release')
  await page.route('**/api/articles/*/comments', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"comment could not be saved"}' })
    else await route.continue()
  })
  await page.getByLabel('你的看法').fill('未保存的评论内容')
  await page.getByRole('button', { name: '提交评论' }).click()
  await expect(page.locator('.comment-status')).toContainText('内容已保留')
  await expect(page.getByLabel('你的看法')).toHaveValue('未保存的评论内容')
})

test('slow initial comment loading cannot erase a just-published comment', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/articles/kimi-k31-pro-release/comments', async route => {
    if (route.request().method() === 'GET') {
      await gate
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"comments":[]}' })
    } else await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'approved', masked: false, comment: { id: 'slow-load-comment', name: '匿名读者', body: '慢加载时仍保留新评论', createdAt: '2026-10-26T00:00:00Z' } }) })
  })
  try {
    await page.goto('/a/kimi-k31-pro-release')
    await page.getByLabel('你的看法').fill('慢加载时仍保留新评论')
    await page.getByRole('button', { name: '提交评论' }).click()
    await expect(page.locator('.comment-list p')).toHaveText('慢加载时仍保留新评论')
    const loaded = page.waitForResponse(r => r.url().endsWith('/kimi-k31-pro-release/comments') && r.request().method() === 'GET')
    release(); await loaded; await page.waitForTimeout(100)
    await expect(page.locator('.comment-list p')).toHaveText('慢加载时仍保留新评论')
  } finally { release() }
})
