import { test, expect, type Page } from '@playwright/test'
const token = 'cms-browser-test-admin-token-not-for-production'
async function statsLogin(page: Page) {
  await page.goto('/admin')
  await page.getByLabel('管理员密钥').fill(token)
  await page.getByRole('button', { name: '登录后台', exact: true }).click()
  await expect(page.getByRole('heading', { name: '文章库', exact: true })).toBeVisible()
}

test('anonymous reads count once per document and direct share links count', async ({ page }) => {
  const events: { type: string; articleId?: string }[] = []
  await page.route('**/api/stats/event', async route => { events.push(route.request().postDataJSON()); await route.fulfill({ status: 204 }) })
  await page.goto('/')
  await expect.poll(() => events.filter(x => x.type === 'pageview').length).toBe(1)
  const link = page.locator('a[href^="#read/"]').first()
  const id = (await link.getAttribute('href'))!.slice(6)
  await link.click()
  await expect.poll(() => events.filter(x => x.type === 'article').length).toBe(1)
  expect(events[1].articleId).toBe(id)
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await link.click()
  await page.waitForTimeout(1300)
  expect(events.filter(x => x.type === 'article')).toHaveLength(1)
  expect(events.filter(x => x.type === 'pageview')).toHaveLength(1)
  await page.goto(`/a/${id}`)
  await expect.poll(() => events.filter(x => x.type === 'article').length).toBe(2)
  await expect.poll(() => events.filter(x => x.type === 'pageview').length).toBe(2)
})

test('privacy preference disables collection and failed events do not block reading', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }))
  const events: string[] = []
  await page.route('**/api/stats/event', async route => { events.push(route.request().url()); await route.abort() })
  await page.goto('/a/kimi-k31-pro-release')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(1300)
  expect(events).toHaveLength(0)
})

test('statistics navigation shows data, ranges and no document overflow', async ({ page }) => {
  await statsLogin(page)
  await page.getByRole('button', { name: '访问统计', exact: true }).click()
  await expect(page.getByRole('heading', { name: '访问统计', exact: true })).toBeVisible()
  await expect(page.locator('.stats-summary')).toBeVisible()
  await expect(page.getByText('启用前未统计', { exact: true })).toBeVisible()
  await page.getByText('查看按日明细', { exact: true }).click()
  await expect(page.locator('.stats-daily td').filter({ hasText: '未统计' }).first()).toBeVisible()
  await expect(page.getByText('匿名累计次数，不是独立访客数，也不是曝光点击率。')).toBeVisible()
  await page.getByRole('button', { name: '近 7 天', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: '近 7 天', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '近 90 天', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: '近 90 天', exact: true })).toBeVisible()
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `statistics overflow at ${width}`).toBe(true)
  }
  await page.getByLabel('搜索统计文章').fill('definitely-nonexistent')
  await expect(page.getByText('没有符合条件的文章。')).toBeVisible()
})

test('statistics failure is an error not a zero and can be retried', async ({ page }) => {
  await statsLogin(page)
  await page.route('**/api/admin/stats?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '统计暂不可用' }) }))
  await page.getByRole('button', { name: '访问统计', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('统计暂不可用')
  await expect(page.locator('.stats-summary')).toHaveCount(0)
  await page.unroute('**/api/admin/stats?*')
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.locator('.stats-summary')).toBeVisible()
})

test('admin reads are excluded, anonymous browser events reach persistence', async ({ page, browser }) => {
  await statsLogin(page)
  const before = await (await page.request.get('/api/admin/stats')).json()
  const same = await page.request.post('/api/stats/event', { headers: { Origin: 'http://127.0.0.1:8198', 'X-Requested-With': 'model-insight' }, data: { type: 'pageview' } })
  expect(same.status()).toBe(204)
  const excluded = await (await page.request.get('/api/admin/stats')).json()
  expect(excluded.totals).toEqual(before.totals)
  const anonymous = await browser.newContext()
  try {
    const reader = await anonymous.newPage()
    const eventResponse = reader.waitForResponse(r => r.url().endsWith('/api/stats/event') && r.request().postDataJSON()?.type === 'article')
    await reader.goto('http://127.0.0.1:8198/a/kimi-k31-pro-release')
    expect((await eventResponse).status()).toBe(204)
    const after = await (await page.request.get('/api/admin/stats')).json()
    expect(after.totals.articleViews).toBe(before.totals.articleViews + 1)
    expect(after.totals.pageViews).toBe(before.totals.pageViews + 1)
    expect(after.articles.find((a: { id: string }) => a.id === 'kimi-k31-pro-release').views).toBeGreaterThan(0)
  } finally { await anonymous.close() }
})

test('failed analytics requests never interrupt reading', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/stats/event', route => route.abort())
  await page.goto('/a/kimi-k31-pro-release')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(1400)
  await expect(page.getByRole('dialog')).toContainText('Kimi')
  await page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(errors).toEqual([])
})
