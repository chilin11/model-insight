import { useReadStats } from './analytics'
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Bookmark, Check, Copy, FileText, Hash, Mail, Menu, Rss, Search, Share2, SlidersHorizontal, X } from 'lucide-react'
import { categories, models, type Article, type Category, type ModelFilter } from './content'
import type { Publication } from './api'
import ArticleContent from './ArticleContent'
import Comments from './Comments'
import SharePanel, { shareURL } from './SharePanel'

type PanelKind = 'search' | 'saved' | 'about' | 'privacy'
type Overlay = { kind: 'article'; article: Article } | { kind: PanelKind } | null
const BOOKMARK_KEY = 'a-little-new:bookmarks'
const NEWSLETTER_KEY = 'a-little-new:newsletter-email'
const motionBehavior = (): ScrollBehavior => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
const statusLabel = (article: Article) => article.status === 'sample' ? '选题样稿' : article.label
const toneOf = (name: string) => name.toLowerCase()

function readBookmarks(allArticles: Article[]): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && allArticles.some(article => article.id === id)))] : []
  } catch { return [] }
}
function readEmail(): string {
  try { return localStorage.getItem(NEWSLETTER_KEY) || '' } catch { return '' }
}
// In-app reading uses #read/<id>; shared links use the server-rendered /a/<id> page.
function articleFromHash(allArticles: Article[]) {
  const fromHash = allArticles.find(article => window.location.hash === `#read/${article.id}`)
  if (fromHash || window.location.hash.startsWith('#read/')) return fromHash
  const match = /^\/a\/([a-z0-9-]+)$/.exec(window.location.pathname)
  return match ? allArticles.find(article => article.id === match[1]) : undefined
}
function clearArticleURL() {
  if (location.pathname.startsWith('/a/')) history.replaceState(null, '', `/${location.search}`)
  else if (location.hash.startsWith('#read/')) history.replaceState(null, '', `${location.pathname}${location.search}`)
}
const byNewest = (list: Article[]) => list.map((article, index) => ({ article, index })).sort((a, b) => (b.article.publishedAt || '').localeCompare(a.article.publishedAt || '') || a.index - b.index).map(item => item.article)
function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M8 29V11l9 10 9-10v18M32 11v18" stroke="currentColor" strokeWidth="3" /></svg></span><span className="brand-type">模型智见<span>MODEL INSIGHT</span></span></span>
}
function ModelMark({ tone, label }: { tone: string; label: string }) {
  return <span className={`model-mark tone-${tone}`}><i aria-hidden="true" />{label}</span>
}
function Highlighted({ text, mark }: { text: string; mark?: string }) {
  const at = mark ? text.indexOf(mark) : -1
  if (!mark || at < 0) return <>{text}</>
  return <>{text.slice(0, at)}<mark>{mark}</mark>{text.slice(at + mark.length)}</>
}
const topics = [
  { label: 'Kimi K3.1 Pro', term: 'K3.1' },
  { label: 'DeepSeek 新版', term: 'DeepSeek' },
  { label: 'Claude 降价', term: 'Claude' },
  { label: 'API 成本', term: '缓存' },
  { label: '本地部署', term: '部署' },
  { label: '社区评价', term: '社区' },
]

function App({ publication }: { publication: Publication }) {
  const allArticles = byNewest(publication.articles)
  const featured = allArticles.find(article => article.id === publication.featuredId) || allArticles[0]
  const articles = allArticles.filter(article => article.id !== featured.id)
  const mustRead = articles.slice(0, 3)
  const [category, setCategory] = useState<Category>('全部')
  const [model, setModel] = useState<ModelFilter>('全部模型')
  const [visibleCount, setVisibleCount] = useState(6)
  const [saved, setSaved] = useState<string[]>(() => readBookmarks(allArticles))
  const [overlay, setOverlay] = useState<Overlay>(() => { const article = articleFromHash(allArticles); return article ? { kind: 'article', article } : null })
  const [query, setQuery] = useState('')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [toast, setToast] = useState('')
  const [email, setEmail] = useState(readEmail)
  const [newsletterStatus, setNewsletterStatus] = useState('')
  const [newsletterSaving, setNewsletterSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [readingProgress, setReadingProgress] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const dialogContent = useRef<HTMLDivElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const newsletterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const storageAvailable = useRef(true)
  const isOpen = overlay !== null
  const activeArticle = overlay?.kind === 'article' ? overlay.article : null
  useReadStats(activeArticle?.id)
  const filtered = articles.filter(article => (category === '全部' || article.category === category) && (model === '全部模型' || article.model === model))
  const searchTerms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const searchResults = allArticles.filter(article => {
    const text = `${article.title} ${article.description} ${article.category} ${article.model} ${article.label} ${article.takeaway} ${article.body || ''} ${article.sections.map(section => `${section.heading} ${section.text}`).join(' ')}`.toLocaleLowerCase()
    return searchTerms.every(term => text.includes(term))
  })
  const nextArticle = activeArticle ? allArticles[(allArticles.findIndex(article => article.id === activeArticle.id) + 1) % allArticles.length] : null

  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(''), 3800)
  }
  function closeOverlay() {
    setOverlay(null)
    setToast('')
    setSharing(false)
    clearArticleURL()
  }
  function rememberFocus() {
    if (!dialog.current?.open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function openArticle(article: Article) {
    rememberFocus()
    setToast('')
    setOverlay({ kind: 'article', article })
    setMobileMenu(false)
    setSharing(false)
    history.replaceState(null, '', `${location.pathname.startsWith('/a/') ? '/' : ''}#read/${article.id}`)
  }
  function openPanel(kind: PanelKind) {
    rememberFocus()
    clearArticleURL()
    setToast('')
    setOverlay({ kind })
    setMobileMenu(false)
    if (kind === 'search') setQuery('')
  }
  function openSearch(term: string) {
    openPanel('search')
    setQuery(term)
  }
  function selectCategory(next: Category, scroll = false) {
    setCategory(next)
    setVisibleCount(6)
    setMobileMenu(false)
    if (scroll) document.getElementById('latest')?.scrollIntoView({ behavior: motionBehavior() })
  }
  function selectModel(next: ModelFilter) {
    setModel(next)
    setVisibleCount(6)
  }
  function resetFilters() { setCategory('全部'); setModel('全部模型'); setVisibleCount(6) }
  function toggleSaved(article: Article) {
    // Read the latest persisted list to avoid overwriting changes from another tab.
    const current = storageAvailable.current ? readBookmarks(allArticles) : saved
    const wasSaved = current.includes(article.id)
    const next = wasSaved ? current.filter(id => id !== article.id) : [...current, article.id]
    setSaved(next)
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(next))
      storageAvailable.current = true
      notify(wasSaved ? '已从收藏中移除' : '已加入收藏，仅保存在本机浏览器。')
    } catch {
      storageAvailable.current = false
      notify('浏览器无法持久保存，收藏仅在本次访问中有效。')
    }
  }
  async function copyArticleLink() {
    setCopying(true)
    try { await navigator.clipboard.writeText(activeArticle ? shareURL(activeArticle) : location.href); notify('文章链接已复制') }
    catch { notify('浏览器未允许复制，请从地址栏手动复制文章链接。') }
    finally { setCopying(false) }
  }
  function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newsletterSaving) return
    setNewsletterSaving(true)
    setNewsletterStatus('正在保存到本机浏览器…')
    // Defer the local write so assistive technology can announce the saving state.
    newsletterTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(NEWSLETTER_KEY, email.trim())
        setNewsletterStatus('已在本机保存邮箱意向。订阅尚未开通，不会发送邮件。')
      } catch { setNewsletterStatus('保存失败：浏览器不允许本地存储，邮箱未被保存。') }
      setNewsletterSaving(false)
    }, 180)
  }
  function clearNewsletter() {
    try { localStorage.removeItem(NEWSLETTER_KEY); setEmail(''); setNewsletterStatus('已清除本机保存的邮箱意向。'); notify('已清除本机邮箱意向') }
    catch { notify('浏览器不允许修改本地存储，请在浏览器设置中清除网站数据。') }
  }
  function handleTabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % categories.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + categories.length) % categories.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = categories.length - 1
    else return
    event.preventDefault()
    selectCategory(categories[next])
    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus()
  }

  useEffect(() => {
    const onScroll = () => { setShowTop(window.scrollY > 700); setScrolled(window.scrollY > 8) }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openPanel('search') }
      if (event.key === 'Escape') setMobileMenu(false)
    }
    const onHash = () => {
      const article = articleFromHash(allArticles)
      if (article) { rememberFocus(); setOverlay({ kind: 'article', article }) }
      else setOverlay(null)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === BOOKMARK_KEY || event.key === null) { storageAvailable.current = true; setSaved(readBookmarks(allArticles)) }
      if (event.key === NEWSLETTER_KEY || event.key === null) { setEmail(readEmail()); setNewsletterStatus('') }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('storage', onStorage)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('storage', onStorage)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      if (newsletterTimer.current) clearTimeout(newsletterTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const element = dialog.current
    const previousOverflow = document.body.style.overflow
    const previousPadding = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`
    if (element && !element.open) element.showModal()
    return () => {
      element?.close()
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPadding
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true })
    }
  }, [isOpen])

  useEffect(() => {
    if (!overlay) return
    setReadingProgress(0)
    const frame = requestAnimationFrame(() => {
      const content = dialogContent.current
      content?.scrollTo({ top: 0, behavior: 'instant' })
      if (overlay.kind === 'search') searchInput.current?.focus({ preventScroll: true })
      else document.getElementById('dialog-title')?.focus({ preventScroll: true })
      if (content && activeArticle && content.scrollHeight <= content.clientHeight) setReadingProgress(1)
    })
    return () => cancelAnimationFrame(frame)
  }, [overlay, activeArticle])

  // Scroll reveal: elements start slightly lowered and transparent, then settle once visible.
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-shown])'))
    const show = (element: Element) => element.setAttribute('data-shown', '')
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { targets.forEach(show); return }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { show(entry.target); observer.unobserve(entry.target) }
    }), { rootMargin: '0px 0px -6% 0px', threshold: 0.05 })
    targets.forEach(target => observer.observe(target))
    return () => observer.disconnect()
  }, [category, model, visibleCount])

  function bookmarkButton(article: Article, extraClass = '') {
    const isSaved = saved.includes(article.id)
    return <button className={`icon-button bookmark-button ${isSaved ? 'is-saved' : ''} ${extraClass}`} aria-label={`${isSaved ? '取消收藏' : '收藏'}：${article.title}`} aria-pressed={isSaved} onClick={() => toggleSaved(article)}><Bookmark size={18} fill={isSaved ? 'currentColor' : 'none'} /></button>
  }
  function readProps(article: Article) {
    return { href: `#read/${article.id}`, onClick: (event: ReactMouseEvent) => { event.preventDefault(); openArticle(article) } }
  }
  function renderCard(article: Article, index: number) {
    return <article className="article-card" key={article.id} data-reveal style={{ '--reveal-delay': `${(index % 3) * 70}ms` } as CSSProperties}>
      <div className="card-meta"><ModelMark tone={article.tone} label={article.model} /><span>{article.category}</span></div>
      <h3><a {...readProps(article)}>{article.title}</a></h3>
      <p className="card-dek">{article.description}</p>
      <div className="card-footer"><span>{article.time} 分钟读完</span><span className="status-text">{statusLabel(article)}{article.status === 'published' && article.publishedAt ? ` · ${article.publishedAt}` : ''}</span></div>
      {bookmarkButton(article)}
    </article>
  }
  function resultButton(article: Article) {
    return <button className="result-item" onClick={() => openArticle(article)}><span className="result-text"><small><ModelMark tone={article.tone} label={article.model} /><span>{article.category} · {statusLabel(article)}</span></small><strong>{article.title}</strong></span><ArrowUpRight size={18} /></button>
  }

  return <>
    <a className="skip-link" href="#main">跳到主要内容</a>
    <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="header-inner container">
        <a href="#main" className="brand-link" aria-label="模型智见首页" onClick={event => { event.preventDefault(); setMobileMenu(false); resetFilters(); window.scrollTo({ top: 0, behavior: motionBehavior() }) }}><Brand /></a>
        <nav className="desktop-nav" aria-label="主导航">{categories.filter(item => item !== '全部').map(item => <button key={item} className={category === item ? 'is-active' : ''} onClick={() => selectCategory(item, true)}>{item}</button>)}</nav>
        <div className="header-actions">
          <button className="icon-button search-trigger" aria-label="搜索文章" title="搜索文章（⌘ / Ctrl K）" onClick={() => openPanel('search')}><Search size={19} /><kbd>⌘ K</kbd></button>
          <button className="icon-button saved-trigger" aria-label={`我的收藏，${saved.length} 篇`} onClick={() => openPanel('saved')}><Bookmark size={19} />{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</button>
          <a href="#newsletter" className="button button-blue newsletter-link">订阅简报 <ArrowUpRight size={15} /></a>
          <button ref={menuButton} className="icon-button mobile-menu-button" aria-label={mobileMenu ? '关闭菜单' : '打开菜单'} aria-expanded={mobileMenu} aria-controls="mobile-nav" onClick={() => setMobileMenu(!mobileMenu)}>{mobileMenu ? <X size={22} /> : <Menu size={22} />}</button>
        </div>
      </div>
      {mobileMenu && <nav id="mobile-nav" className="mobile-nav" aria-label="移动端导航" onKeyDown={event => { if (event.key === 'Escape') { setMobileMenu(false); menuButton.current?.focus() } }}>{categories.map(item => <button key={item} onClick={() => selectCategory(item, true)}>{item === '全部' ? '全部文章' : item}<ArrowRight size={16} /></button>)}<a href="#newsletter" onClick={() => setMobileMenu(false)}>订阅简报<Mail size={16} /></a></nav>}
    </header>

    <main id="main">
      <div className="topic-bar container">
        <span className="topic-label"><Hash size={15} aria-hidden="true" />话题</span>
        <div className="topic-list" role="group" aria-label="话题导航">{topics.map((topic, index) => <button key={topic.term} style={{ '--i': index } as CSSProperties} onClick={() => openSearch(topic.term)}>{topic.label}</button>)}</div>
        <span className="sample-note">本期资料核验 · {featured.verifiedAt}</span>
      </div>

      <section className="front container" aria-label="头条与编辑推荐">
        <article className="lead-story">
          <div className="lead-tags"><span className="hot-tag">头条</span><span>{featured.category}</span><span className="sample-tag">{statusLabel(featured)}</span></div>
          <h1 className="lead-title"><a {...readProps(featured)}><Highlighted text={featured.title} mark={featured.highlight} /></a></h1>
          <p className="lead-dek">{featured.description}</p>
          <div className="key-points"><span className="key-label">看点</span><p className="key-summary">{featured.takeaway}</p></div>
          <div className="lead-footer"><a className="text-link lead-read" {...readProps(featured)}>阅读全文 <ArrowRight size={17} /></a><span>{featured.time} 分钟阅读</span>{bookmarkButton(featured)}</div>
        </article>
        <aside className="must-read" aria-labelledby="must-read-title">
          <div className="block-heading"><h2 id="must-read-title">编辑推荐</h2><span>深度阅读</span></div>
          <ol>{mustRead.slice(0, 3).map((article, index) => <li key={article.id} style={{ '--i': index } as CSSProperties}><span className="rank">{String(index + 1).padStart(2, '0')}</span><div><span className="must-meta"><ModelMark tone={article.tone} label={article.model} /><span>{article.category}</span></span><h3><a {...readProps(article)}>{article.title}</a></h3></div></li>)}</ol>
        </aside>
      </section>

      <div className="model-filter container" role="group" aria-label="模型筛选"><span className="model-filter-label"><SlidersHorizontal size={15} aria-hidden="true" /> 按模型看</span><div className="model-buttons">{models.map(item => <button key={item} className={model === item ? 'selected' : ''} aria-pressed={model === item} onClick={() => selectModel(item)}>{item !== '全部模型' && <i className={`tone-dot tone-${toneOf(item)}`} aria-hidden="true" />}{item}</button>)}</div></div>

      <section className="latest-section container" id="latest" aria-labelledby="latest-title">
        <div className="news-layout">
          <div className="news-main">
            <div className="block-heading feed-heading"><h2 id="latest-title">最新文章</h2><span className="article-count" aria-live="polite">共 {filtered.length} 篇</span></div>
            <div className="filter-row"><div className="category-tabs" role="tablist" aria-label="文章分类">{categories.map((item, index) => <button key={item} id={`tab-${index}`} role="tab" aria-selected={category === item} aria-controls="article-grid" tabIndex={category === item ? 0 : -1} onKeyDown={event => handleTabKeys(event, index)} onClick={() => selectCategory(item)}>{item}</button>)}</div></div>
            <div className="active-filter-note" aria-live="polite">{model !== '全部模型' ? <><span>正在看：<strong>{model}</strong></span><button onClick={() => selectModel('全部模型')}>清除模型筛选 <X size={13} /></button></> : <span>发布解读、社区观察与观点 · 各篇附来源及核验日期</span>}</div>
            <div className="article-grid" id="article-grid" role="tabpanel" aria-labelledby={`tab-${categories.indexOf(category)}`} tabIndex={0} key={`${category}-${model}`}>
              {filtered.length ? filtered.slice(0, visibleCount).map(renderCard) : <div className="empty-state"><FileText size={30} strokeWidth={1.5} /><h3>这个方向还没有文章</h3><p>换个分类，或者查看全部模型。</p><button className="button button-outline" onClick={resetFilters}>重置筛选 <ArrowRight size={16} /></button></div>}
            </div>
            {filtered.length > 0 && <div className="more-articles">{filtered.length > visibleCount ? <button className="button button-outline" onClick={() => setVisibleCount(count => count + 3)}>加载更多文章 <ArrowDown size={16} /></button> : <span className="end-note">已经看完这一组文章</span>}<span>{Math.min(filtered.length, visibleCount)} / {filtered.length}</span></div>}
          </div>
          <aside className="editorial-sidebar" aria-label="延伸阅读">
            <section className="related-stories" data-reveal><div className="block-heading"><h2>延伸阅读</h2></div>{articles.slice(-3).map(article => <article key={article.id}><span className="related-category">{article.category}</span><h3><a {...readProps(article)}>{article.title}</a></h3><p>{article.description}</p></article>)}</section>
            <button className="text-link editorial-policy" onClick={() => openPanel('about')}>关于本站与编辑原则 <ArrowUpRight size={15} /></button>
          </aside>
        </div>
      </section>

      <section className="newsletter-section" id="newsletter" aria-labelledby="newsletter-title"><div className="newsletter-inner container" data-reveal><div className="newsletter-copy"><h2 id="newsletter-title">订阅模型简报</h2><p>汇总重要的模型更新、评测解读和社区讨论。邮件服务尚未开通，目前只能在本机登记意向。</p></div><div className="newsletter-form-wrap"><form className="newsletter-form" onSubmit={subscribe} aria-busy={newsletterSaving}><label htmlFor="newsletter-email">你的邮箱地址</label><div className="newsletter-input-row"><input id="newsletter-email" type="email" placeholder="you@example.com" value={email} onChange={event => { setEmail(event.target.value); setNewsletterStatus('') }} required maxLength={254} autoComplete="email" disabled={newsletterSaving} /><button className="button button-blue" type="submit" aria-label="保存邮箱意向" disabled={newsletterSaving}>{newsletterSaving ? '保存中…' : '登记订阅意向'}<ArrowRight size={16} /></button></div></form><p className="newsletter-disclaimer" role="status" aria-live="polite">{newsletterStatus || '本地演示：仅在本机保存邮箱意向，未开通邮件服务，不会发信。'}</p></div></div></section>
    </main>

    <footer className="site-footer container"><div className="footer-top"><div><a href="#main" className="brand-link" aria-label="返回首页"><Brand small /></a><p>关注 AI 模型发布、评测和社区评价。</p></div><div className="footer-links"><button onClick={() => openPanel('about')}>关于模型智见</button><button onClick={() => openPanel('about')}>编辑原则</button><button onClick={() => openPanel('privacy')}>隐私与本地数据</button><a href="/rss.xml"><Rss size={13} /> RSS 订阅</a><a href="/admin">写作后台</a><a href="#newsletter">订阅简报 <ArrowUpRight size={13} /></a></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} 模型智见</span><span>公开资料编译 · AI 辅助写作 · 原始来源见文末</span><button onClick={() => window.scrollTo({ top: 0, behavior: motionBehavior() })}>返回顶部 <ArrowUp size={13} /></button></div></footer>
    <button className={`back-to-top ${showTop ? 'visible' : ''}`} aria-label="回到顶部" tabIndex={showTop ? 0 : -1} onClick={() => window.scrollTo({ top: 0, behavior: motionBehavior() })}><ArrowUp size={18} /></button>
    <div className={`toast ${toast && !overlay ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast && !overlay && <><Check size={16} /><span>{toast}</span></>}</div>

    <dialog ref={dialog} className={`site-dialog ${activeArticle ? 'reader-dialog' : ''}`} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); closeOverlay() }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeOverlay() } }}>
      <div className="dialog-shell">
        <div className="dialog-topbar"><Brand small />{activeArticle && <span>正在阅读 · {activeArticle.time} 分钟读完</span>}<button className="icon-button close-dialog" aria-label="关闭面板" onClick={closeOverlay}><X size={21} /></button></div>
        {activeArticle && <div className="reading-progress" role="progressbar" aria-label="文章阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(readingProgress * 100)}><span style={{ transform: `scaleX(${readingProgress})` }} /></div>}
        <div className="dialog-content" ref={dialogContent} onScroll={event => { const element = event.currentTarget; setReadingProgress(element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 1) }}>
          {overlay?.kind === 'search' && <div className="search-panel"><h2 id="dialog-title" tabIndex={-1}>搜索文章</h2><div className="search-field"><Search size={20} /><input ref={searchInput} value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索关键词" placeholder="搜索模型、标题或正文关键词" autoComplete="off" spellCheck={false} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => { setQuery(''); searchInput.current?.focus() }}><X size={16} /></button>}<kbd>ESC</kbd></div><div className="search-summary" aria-live="polite"><span>{query.trim() ? `找到 ${searchResults.length} 篇相关内容` : '全部文章'}</span><span>标题 / 摘要 / 全文</span></div><div className="result-list">{searchResults.length ? searchResults.map(article => <div key={article.id}>{resultButton(article)}</div>) : <div className="empty-state"><Search size={30} strokeWidth={1.5} /><h3>没有找到相关文章</h3><p>试试更短的关键词，或搜索其他模型。</p><button className="button button-outline" onClick={() => { setQuery(''); searchInput.current?.focus() }}>查看全部文章 <ArrowRight size={16} /></button></div>}</div><p className="panel-footnote">搜索已收录文章及正文。按 Esc 关闭搜索。</p></div>}
          {overlay?.kind === 'saved' && <div className="saved-panel"><h2 id="dialog-title" tabIndex={-1}>我的收藏</h2><p className="panel-description">共 {saved.length} 篇 · 仅保存在当前浏览器，不跨设备同步。</p><div className="result-list">{saved.length ? allArticles.filter(article => saved.includes(article.id)).map(article => <div className="saved-item" key={article.id}>{resultButton(article)}{bookmarkButton(article, 'remove-saved')}</div>) : <div className="empty-state"><Bookmark size={32} strokeWidth={1.5} /><h3>还没有收藏文章</h3><p>点击文章旁的书签，将值得重读的内容保存在这里。</p><button className="button button-blue" onClick={() => { closeOverlay(); requestAnimationFrame(() => document.getElementById('latest')?.scrollIntoView({ behavior: motionBehavior() })) }}>浏览文章 <ArrowRight size={16} /></button></div>}</div></div>}
          {overlay?.kind === 'about' && <div className="about-panel"><h2 id="dialog-title" tabIndex={-1}>关于模型智见</h2><p className="about-lead">模型智见关注模型发布、评测数据和真实使用讨论。文章基于公开资料编译，并加入编辑分析；不是厂商官方站点，也不把资料核验冒充产品实测。</p><div className="preview-notice"><FileText size={19} /><p><strong>内容与数据说明</strong>本站使用 AI 辅助整理与写作。文章列出资料来源、事件时间与核验日期，数据图按所列来源绘制。厂商自报成绩、社区个体意见和编辑观点分别说明。价格和开放状态请以供应商最新信息为准。</p></div><div className="about-block"><h3>官方数据与评测</h3><p>引用原始发布页或模型卡，保留版本、测试设置和局限。不把不同测试版本拼成一张总榜；本站算术计算与厂商结果单独标明。</p></div><div className="about-block"><h3>社区原帖</h3><p>只转述已读取的公开帖子，保留作者、楼层和原帖链接，说明选读范围。不把少数回帖写成社区共识，也不虚构使用体验。</p></div><div className="about-block"><h3>更正与更新</h3><p>文章的发布时间不等于模型发布日。核验日期是资料检查时间，不代表此后持续更新；如发现错误，应核对原始来源并在后续版本更正。</p></div><button className="text-link" onClick={() => openPanel('privacy')}>隐私与本地数据说明 <ArrowRight size={16} /></button></div>}
          {overlay?.kind === 'privacy' && <div className="about-panel"><h2 id="dialog-title" tabIndex={-1}>隐私与本地数据</h2><p className="about-lead">公开阅读不需要账户，不加载第三方统计脚本或字体。本站仅累计匿名访问与文章打开次数，不设置统计 Cookie，不保存访客身份、IP、来源或浏览器指纹，并尊重 DNT / GPC。IP 仅在内存中短暂用于防刷；这些数字不是独立访客数。管理员后台使用会话 Cookie；文章、上传图片和读者评论存放在服务器。Go 服务、Cloudflare Tunnel 等基础设施可能记录访问日志，保留规则由运营者配置。</p><div className="about-block"><h3>文章收藏</h3><p>使用 localStorage 保存文章 ID。同一浏览器、同一站点标签页之间同步，不跨设备。你可以逐篇移除收藏，或清除站点数据。</p></div><div className="about-block"><h3>邮箱意向</h3><p>邮箱仅保存在当前浏览器，不上传、不发送邮件，登记不代表已订阅正式服务。</p><button className="button button-outline" disabled={!email || newsletterSaving} onClick={clearNewsletter}>清除本机邮箱意向 <X size={15} /></button></div><div className="about-block"><h3>读者评论</h3><p>提交评论时，服务器保存昵称、评论内容和提交时间，经编辑审核后才公开昵称与内容。IP 地址只在内存中短暂用于防刷限流，不写入评论文件。昵称会记在本机浏览器，方便下次填写。如需删除已提交评论，请联系站点运营者。</p></div><div className="about-block"><h3>外部来源与图片</h3><p>原始资料在新标签页打开，目标网站适用自己的隐私政策。本站数据图表为本地绘制；后续文章如使用 HTTPS 外部图片，浏览器会直接请求对应网站，不发送本站 Cookie，并隐藏 Referer。</p></div></div>}
          {activeArticle && <article className="reader">
            <header className="reader-heading">
              <div className="reader-kicker"><span><ModelMark tone={activeArticle.tone} label={activeArticle.model} /><span className="kicker-divider">/</span>{activeArticle.category}</span><span className="sample-tag">{statusLabel(activeArticle)}</span></div>
              <h2 id="dialog-title" tabIndex={-1}>{activeArticle.title}</h2><p className="reader-description">{activeArticle.description}</p>
              <div className="reader-meta"><span>模型智见 · 资料编译与评论</span><span>{activeArticle.time} 分钟阅读</span>{activeArticle.publishedAt && <time dateTime={activeArticle.publishedAt}>{activeArticle.publishedAt}</time>}</div>
            </header>
            <div className="reader-body"><ArticleContent article={activeArticle} />
              <div className="reader-actions"><button className={`button button-outline ${saved.includes(activeArticle.id) ? 'bookmarked' : ''}`} aria-label={`${saved.includes(activeArticle.id) ? '取消收藏' : '收藏'}：${activeArticle.title}`} aria-pressed={saved.includes(activeArticle.id)} onClick={() => toggleSaved(activeArticle)}><Bookmark size={16} fill={saved.includes(activeArticle.id) ? 'currentColor' : 'none'} />{saved.includes(activeArticle.id) ? '已收藏' : '收藏文章'}</button><button className="button button-outline" disabled={copying} onClick={copyArticleLink}><Copy size={16} />{copying ? '复制中…' : '复制链接'}</button><button className="button button-outline" aria-expanded={sharing} onClick={() => setSharing(value => !value)}><Share2 size={16} />分享</button></div>
              {sharing && <SharePanel article={activeArticle} notify={notify} close={() => setSharing(false)} />}
              <Comments key={activeArticle.id} articleId={activeArticle.id} closed={activeArticle.commentsClosed} />
              {nextArticle && <button className="next-article" onClick={() => openArticle(nextArticle)}><span><small>下一篇</small><strong>{nextArticle.title}</strong></span><ArrowRight size={23} /></button>}
            </div>
          </article>}
        </div>
        <div className={`toast dialog-toast ${toast && overlay ? 'is-visible' : ''}`} role="status" aria-live="polite">{toast && overlay && <><Check size={16} /><span>{toast}</span></>}</div>
      </div>
    </dialog>
  </>
}

export default App
