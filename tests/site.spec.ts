import { test, expect } from '@playwright/test'
import { allArticles, articles, featured } from '../src/content'

const first = articles[0]
const price = articles.find(article => article.id === 'api-cache-cost-math')!
const categoryCount = (category: string) => articles.filter(article => article.category === category).length

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('news homepage renders stories without runtime errors, slogans or sample labels', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.reload()
  await expect(page).toHaveTitle(/模型智见/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(featured.title)
  await expect(page.locator('body')).not.toContainText(/模型很快|判断要准|少一点噪声|选题样稿|编辑预览/)
  await expect(page.locator('.article-card')).toHaveCount(6)
  await expect(page.locator('.must-read li')).toHaveCount(3)
  expect(errors).toEqual([])
})

test('categories, keyboard tabs and load-more work', async ({ page }) => {
  await page.getByRole('tab', { name: '社区声音', exact: true }).click()
  await expect(page.locator('.article-card')).toHaveCount(categoryCount('社区声音'))
  await page.getByRole('tab', { name: '社区声音', exact: true }).press('ArrowRight')
  await expect(page.getByRole('tab', { name: '深度观点', exact: true })).toBeFocused()
  await expect(page.locator('.article-card')).toHaveCount(categoryCount('深度观点'))
  await page.getByRole('tab', { name: '全部', exact: true }).click()
  await expect(page.locator('.article-card')).toHaveCount(6)
  await page.getByRole('button', { name: '加载更多文章', exact: true }).click()
  await expect(page.locator('.article-card')).toHaveCount(articles.length)
  await expect(page.getByRole('button', { name: '加载更多文章', exact: true })).toHaveCount(0)
})

test('search handles empty results and opens an article', async ({ page }) => {
  await page.getByRole('button', { name: '搜索文章', exact: true }).click()
  const input = page.getByRole('textbox', { name: '搜索关键词' })
  await expect(input).toBeFocused()
  await input.fill('unmatchedxyz999')
  await expect(page.locator('.result-item')).toHaveCount(0)
  await input.fill('把缓存这笔账算给你看')
  await expect(page.locator('.result-item')).toHaveCount(1)
  await page.locator('.result-item').click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(price.title)
  await expect(page).toHaveURL(new RegExp(`#read/${price.id}$`))
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})

test('bookmarks persist and can be removed from the reading list', async ({ page }) => {
  await page.getByRole('button', { name: `收藏：${first.title}`, exact: true }).click()
  await expect(page.getByRole('button', { name: `取消收藏：${first.title}`, exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.getByRole('button', { name: '我的收藏，1 篇', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText(first.title)
  await page.getByRole('dialog').getByRole('button', { name: `取消收藏：${first.title}`, exact: true }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('a-little-new:bookmarks') || '[]'))).toEqual([])
})

test('article URLs open directly and Escape closes them', async ({ page }) => {
  await page.goto(`/#read/${featured.id}`)
  await expect(page.getByRole('dialog')).toHaveAccessibleName(featured.title)
  await expect(page.locator('.article-provenance')).toContainText('资料核验：2026-10-26')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).not.toHaveURL(/#read\//)
})

test('newsletter clearly remains local-only', async ({ page }) => {
  await page.getByRole('textbox', { name: '你的邮箱地址' }).fill('reader@example.com')
  await page.getByRole('button', { name: '保存邮箱意向' }).click()
  await expect(page.locator('.newsletter-disclaimer')).toContainText(/未开通|未接入|不发送|不会发送|不会发信/)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('a-little-new:newsletter-email'))).toBe('reader@example.com')
})

test('malformed saved data does not break the page', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('a-little-new:bookmarks', '{invalid'))
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '我的收藏，0 篇', exact: true })).toBeVisible()
})

test('reduced motion is respected', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).scrollBehavior)).toBe('auto')
  const duration = await page.locator('.article-card').first().evaluate(element => getComputedStyle(element).transitionDuration)
  expect(Math.max(...duration.split(',').map(parseFloat))).toBeLessThanOrEqual(0.01)
  for (const item of await page.locator('[data-reveal]').all()) {
    await expect(item).toHaveCSS('opacity', '1')
    await expect(item).toHaveCSS('transform', 'none')
  }
})

test('mobile menu and desktop navigation filter content', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: '打开菜单', exact: true }).click()
    await expect(page.getByRole('navigation', { name: '移动端导航' })).toBeVisible()
    await page.getByRole('navigation', { name: '移动端导航' }).getByRole('button', { name: '评测解读', exact: true }).click()
    await expect(page.getByRole('navigation', { name: '移动端导航' })).not.toBeVisible()
  } else {
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '评测解读', exact: true }).click()
  }
  await expect(page.getByRole('tab', { name: '评测解读', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.article-card')).toHaveCount(categoryCount('评测解读'))
})

test('narrow, tablet and wide layouts do not overflow', async ({ page }) => {
  for (const width of [320, 375, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `overflow at ${width}px`).toBe(true)
  }
})

test('reading and search panels keep mastheads visible and fit all screens', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  async function expectPanelToFit(width: number) {
    const fit = await page.getByRole('dialog').evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const content = element.querySelector('.dialog-content')!
      const brand = element.querySelector('.dialog-topbar > .brand')!.getBoundingClientRect()
      return {
        horizontal: bounds.left >= 0 && bounds.right <= window.innerWidth,
        vertical: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
        content: content.scrollWidth <= content.clientWidth,
        masthead: brand.width > 0 && brand.left >= bounds.left && brand.left - bounds.left <= 28,
      }
    })
    expect(fit, `panel layout at ${width}px`).toEqual({ horizontal: true, vertical: true, content: true, masthead: true })
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/#read/${featured.id}`)
    await expect(page.getByRole('dialog')).toHaveAccessibleName(featured.title)
    await expectPanelToFit(width)
    await page.locator('.next-article').scrollIntoViewIfNeeded()
    await expectPanelToFit(width)
    await page.getByRole('button', { name: '关闭面板' }).click()
    await page.getByRole('button', { name: '搜索文章', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索关键词' }).fill('Kimi')
    await expect(page.locator('.result-item')).not.toHaveCount(0)
    await expectPanelToFit(width)
    await page.getByRole('button', { name: '关闭面板' }).click()
  }
})

test('each news item is visible when scrolled into view', async ({ page }) => {
  for (const card of await page.locator('.article-card').all()) {
    await card.scrollIntoViewIfNeeded()
    await expect(card).toHaveCSS('opacity', '1')
  }
})

test('reader notifications, sharing and next-article reset work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/#read/${featured.id}`)
  await expect(page.getByRole('dialog')).toHaveAccessibleName(featured.title)
  await page.getByRole('dialog').getByRole('button', { name: `收藏：${featured.title}`, exact: true }).click()
  await expect(page.locator('.dialog-toast')).toBeVisible()
  await page.getByRole('button', { name: '复制链接', exact: true }).click()
  await expect(page.locator('.dialog-toast')).toContainText('链接已复制')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(new RegExp(`/a/${featured.id}$`))
  await page.getByRole('button', { name: '分享', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文章分享链接' })).toHaveValue(new RegExp(`/a/${featured.id}$`))
  await page.getByRole('button', { name: '微信扫码' }).click()
  await expect(page.getByRole('img', { name: `文章二维码：${featured.title}` })).toBeVisible()
  await expect(page.getByRole('link', { name: '微博' })).toHaveAttribute('href', /service\.weibo\.com.*%2Fa%2F/)
  await page.getByRole('button', { name: '收起分享' }).click()
  await page.locator('.next-article').click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(first.title)
  await expect.poll(() => page.locator('.dialog-content').evaluate(element => element.scrollTop)).toBe(0)
})

test('model filter combines with content categories', async ({ page }) => {
  const filters = page.getByRole('group', { name: '模型筛选' })
  await filters.getByRole('button', { name: 'Kimi', exact: true }).click()
  await expect(page.locator('.article-card')).toHaveCount(articles.filter(article => article.model === 'Kimi').length)
  await expect(filters.getByRole('button', { name: 'Kimi', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('tab', { name: '评测解读', exact: true }).click()
  await expect(page.locator('.article-card')).toHaveCount(0)
  await page.getByRole('button', { name: '清除模型筛选' }).click()
  await expect(page.locator('.article-card')).toHaveCount(categoryCount('评测解读'))
})

test('topic navigation and related stories open matching articles', async ({ page }) => {
  await page.getByRole('group', { name: '话题导航' }).getByRole('button', { name: 'Kimi K3.1 Pro', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '搜索关键词' })).toHaveValue('K3.1')
  await page.locator('.result-item').filter({ hasText: featured.title }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(featured.title)
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('complementary', { name: '延伸阅读' }).getByRole('link', { name: price.title }).click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName(price.title)
})

test('headline highlight settles', async ({ page }) => {
  const highlight = page.locator('.lead-title mark')
  await expect(highlight).toHaveCSS('animation-name', 'mark-sweep')
  await expect(highlight).toHaveCSS('background-size', '100% 100%')
})

test('published content has valid dates, citations, tables and honest chart scales', () => {
  expect(allArticles.length).toBe(9)
  expect(new Set(allArticles.map(article => article.id)).size).toBe(allArticles.length)
  for (const article of allArticles) {
    expect(article.status).toBe('published')
    expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(article.verifiedAt).toBe('2026-10-26')
    expect(article.eventNote).toBeTruthy()
    expect(article.sources.length).toBeGreaterThan(0)
    for (const source of article.sources) expect(new URL(source.url).protocol).toBe('https:')
    for (const section of article.sections) {
      for (const number of section.sourceNumbers || []) expect(article.sources[number - 1]).toBeDefined()
      if (section.table) for (const row of section.table.rows) expect(row.length).toBe(section.table.columns.length)
      if (section.chart) for (const row of section.chart.rows) {
        expect(row.value).toBeGreaterThanOrEqual(0)
        expect(row.value).toBeLessThanOrEqual(section.chart.max)
      }
    }
  }
  expect(0.1 * 2 + 0.9 * 0.1 + 0.1 * 10).toBeCloseTo(1.29)
  expect(0.1 * 4 + 0.9 * 0.2 + 0.1 * 20).toBeCloseTo(2.58)
})

test('every published article renders its source links and figures at 320px', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 844 })
  for (const article of allArticles) {
    await page.goto(`/#read/${article.id}`)
    await expect(page.getByRole('dialog')).toHaveAccessibleName(article.title)
    await expect(page.locator('.source-note ol a')).toHaveCount(article.sources.length)
    await expect(page.locator('.table-scroll table')).toHaveCount(article.sections.filter(section => section.table).length)
    await expect(page.locator('.data-chart')).toHaveCount(article.sections.filter(section => section.chart).length)
    expect(await page.locator('.dialog-content').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    for (const [i, source] of article.sources.entries()) await expect(page.locator('.source-note ol a').nth(i)).toHaveAttribute('href', source.url)
    await page.getByRole('button', { name: '关闭面板' }).click()
  }
})

test('data tables scroll independently and chart labels remain readable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto(`/#read/${featured.id}`)
  const table = page.locator('.table-scroll').first()
  await table.scrollIntoViewIfNeeded()
  expect(await table.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true)
  await table.evaluate(el => { el.scrollLeft = el.scrollWidth })
  expect(await table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
  await page.locator('.data-chart').scrollIntoViewIfNeeded()
  await expect(page.getByRole('img', { name: /事实断言幻觉率/ })).toBeVisible()
  await expect(page.locator('.chart-row-label').last()).toContainText('8.3 %')
  await expect(page.locator('.chart-row-label').first()).toHaveCSS('font-size', '14px')
})

test('shared /a/<id> links open the article and closing returns home', async ({ page }) => {
  await page.goto(`/a/${price.id}`)
  await expect(page.getByRole('dialog')).toHaveAccessibleName(price.title)
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(featured.title)
})
