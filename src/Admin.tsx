import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, BarChart3, Check, Code2, Copy, Download, Eye, FilePlus2, FileText, ImagePlus, LogOut, MessageSquare, Save, Send, Star, Trash2, X } from 'lucide-react'
import { categories, models, type Article, type Source } from './content'
import { ApiError, request, type Publication } from './api'
import ArticleContent from './ArticleContent'
import MarkdownEditor, { countWords, readingMinutes } from './MarkdownEditor'
import AdminComments, { type AdminComment } from './AdminComments'
import AdminStats from './AdminStats'
import './admin.css'

const dateNow = () => new Date().toISOString().slice(0, 10)
const sectionsText = (article: Article) => JSON.stringify(article.sections || [], null, 2)
const fingerprint = (article: Article, sections: string) => JSON.stringify([article, sections])
function newArticle(): Article {
  return { id: `article-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`, title: '', description: '', model: '跨模型', tone: 'industry', category: '模型动态', time: 3, label: '最新文章', status: 'draft', publishedAt: dateNow(), verifiedAt: dateNow(), eventNote: '', takeaway: '', body: '', sections: [], quote: '', sources: [] }
}
function errorText(error: unknown) { return error instanceof Error ? error.message : '请求失败，请稍后重试。' }
function prepared(article: Article, sections: string): Article {
  let parsed: unknown
  try { parsed = JSON.parse(sections) } catch { throw new Error('结构化正文不是有效 JSON，请检查后再保存。原有内容没有被覆盖。') }
  const text = (value: unknown) => typeof value === 'string'
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(text)
  const valid = Array.isArray(parsed) && parsed.every(s => s && text(s.heading) && text(s.text)
    && (!s.sourceNumbers || Array.isArray(s.sourceNumbers) && s.sourceNumbers.every((n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= article.sources.length))
    && (!s.table || text(s.table.caption) && text(s.table.note) && strings(s.table.columns) && Array.isArray(s.table.rows) && s.table.rows.every((row: unknown) => strings(row) && row.length === s.table.columns.length))
    && (!s.chart || text(s.chart.title) && text(s.chart.unit) && text(s.chart.note) && Number.isFinite(s.chart.max) && s.chart.max > 0 && Array.isArray(s.chart.rows) && s.chart.rows.every((row: { label?: unknown; value?: unknown } | null) => row && text(row.label) && typeof row.value === 'number' && Number.isFinite(row.value) && row.value >= 0 && row.value <= s.chart.max)))
  if (!valid) throw new Error('结构化正文格式不正确，请检查段落、表格单元格、图表数值和来源编号。原有内容没有被覆盖。')
  return { ...article, sections: parsed as Article['sections'], sources: article.sources.filter(s => s.label.trim() || s.url.trim()) }
}
function Preview({ article, close }: { article: Article; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const element = dialog.current; element?.showModal(); const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { element?.close(); document.body.style.overflow = previous } }, [])
  return <dialog ref={dialog} className="admin-preview" aria-labelledby="preview-title" onCancel={event => { event.preventDefault(); close() }}>
    <div className="admin-preview-bar"><span>未发布的编辑预览 · 不会保存修改</span><button className="icon-button" aria-label="关闭预览" onClick={close}><X size={20} /></button></div>
    <article className="reader"><header className="reader-heading"><p>{article.model} / {article.category}</p><h2 id="preview-title">{article.title || '未命名文章'}</h2><p className="reader-description">{article.description}</p></header><div className="reader-body"><ArticleContent article={{ ...article, status: 'draft' }} /></div></article>
  </dialog>
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [publication, setPublication] = useState<Publication>({ articles: [], featuredId: '' })
  const [article, setArticle] = useState<Article | null>(null)
  const [sections, setSections] = useState('[]')
  const [baseline, setBaseline] = useState('')
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<Article | null>(null)
  const [tab, setTab] = useState<'all' | 'draft' | 'published'>('all')
  const [view, setView] = useState<'articles' | 'comments' | 'stats'>('articles')
  const [comments, setComments] = useState<AdminComment[]>([])
  const editorHeading = useRef<HTMLHeadingElement>(null)
  const dirty = article !== null && fingerprint(article, sections) !== baseline
  const draftCount = publication.articles.filter(a => a.status === 'draft').length
  const pendingCount = comments.filter(c => c.status === 'pending').length
  const sortedArticles = [...publication.articles].sort((a, b) => (b.updatedAt || b.publishedAt || '').localeCompare(a.updatedAt || a.publishedAt || ''))
  const filtered = sortedArticles.filter(a => (tab === 'all' || a.status === tab) && `${a.title} ${a.id}`.toLowerCase().includes(query.toLowerCase()))

  function showError(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false)
    setError(reason instanceof ApiError && reason.status === 409 ? '此文章已被另一个窗口修改。未覆盖服务器版本。请先导出当前稿，再从列表重新打开最新版本后合并。' : errorText(reason))
    setMessage('')
  }
  async function reloadList() {
    const result = await request<Publication>('/api/admin/articles')
    setPublication(result)
    return result
  }
  async function reloadComments() {
    const result = await request<{ comments: AdminComment[] }>('/api/admin/comments')
    setComments(result.comments)
  }
  useEffect(() => {
    let active = true
    request<{ authenticated: boolean }>('/api/admin/session').then(async result => {
      if (!active) return
      setAuthenticated(result.authenticated)
      if (result.authenticated) { const data = await request<Publication>('/api/admin/articles'); if (active) setPublication(data); request<{ comments: AdminComment[] }>('/api/admin/comments').then(list => { if (active) setComments(list.comments) }).catch(() => undefined) }
    }).catch(reason => { if (active) { setAuthenticated(false); setError(errorText(reason)) } })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (authenticated && article && !busy && !uploading) void save(article.status === 'published' ? 'published' : 'draft') } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  function confirmDiscard() { return !dirty || window.confirm('当前修改尚未保存，确定放弃这些修改吗？') }
  function openArticle(next: Article, fresh = false) {
    if (!confirmDiscard()) return
    const copy = structuredClone(next)
    const text = sectionsText(copy)
    setArticle(copy); setSections(text); setBaseline(fresh ? '' : fingerprint(copy, text)); setIsNew(fresh); setMessage(''); setError('')
    requestAnimationFrame(() => { editorHeading.current?.focus({ preventScroll: true }); if (window.innerWidth < 900) editorHeading.current?.scrollIntoView({ behavior: 'auto', block: 'start' }) })
  }
  function update<K extends keyof Article>(key: K, value: Article[K]) { setArticle(current => current ? { ...current, [key]: value } : current) }
  function updateSource(index: number, value: Partial<Source>) { if (article) update('sources', article.sources.map((s, i) => i === index ? { ...s, ...value } : s)) }
  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try { await request('/api/admin/login', { token }); setToken(''); await reloadList(); await reloadComments().catch(() => undefined); setAuthenticated(true); setMessage('已登录。管理员密钥不会保存在浏览器本地存储。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function logout() {
    if (!confirmDiscard()) return
    setBusy(true); setError('')
    try { await request('/api/admin/logout', {}); setAuthenticated(false); setArticle(null); setPublication({ articles: [], featuredId: '' }); setMessage('已退出登录。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function save(status: 'draft' | 'published') {
    if (!article || busy || uploading) return
    if (status === 'draft' && article.status === 'published' && !window.confirm('撤回后，公开页面将不再显示这篇文章。确定撤回为草稿吗？')) return
    setBusy(true); setError(''); setMessage('')
    try {
      const outgoing = { ...prepared(article, sections), status }
      if (status === 'published' && (!outgoing.title.trim() || !outgoing.description.trim() || !(outgoing.body?.trim() || outgoing.sections.length) || !outgoing.sources.length || !outgoing.publishedAt || !outgoing.verifiedAt)) throw new Error('发布前请填写标题、摘要、正文、至少一个来源，以及发布和核验日期。')
      const result = await request<{ article: Article }>(isNew ? '/api/admin/articles' : `/api/admin/articles/${article.id}`, isNew ? { article: outgoing } : { article: outgoing, expectedRevision: article.revision }, isNew ? 'POST' : 'PUT')
      const text = sectionsText(result.article)
      setArticle(result.article); setSections(text); setBaseline(fingerprint(result.article, text)); setIsNew(false)
      setPublication(current => ({ ...current, articles: [result.article, ...current.articles.filter(a => a.id !== result.article.id)] }))
      setMessage(status === 'published' ? '已发布。公开页面刷新后即可看到，无需重新构建。' : '草稿已保存到服务器，公开页面不可见。')
      try { await reloadList() } catch { setMessage('文章已保存，但列表刷新失败。请稍后重新读取列表。') }
    } catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  function showPreview() { if (!article) return; try { setPreview(prepared(article, sections)); setError('') } catch (reason) { showError(reason) } }
  async function feature() {
    if (!article || isNew || dirty || article.status !== 'published') return
    setBusy(true); setError('')
    try { const result = await request<{ featuredId: string }>('/api/admin/featured', { id: article.id }); setPublication(current => ({ ...current, featuredId: result.featuredId })); setMessage('首页头条已更新。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function uploadMedia(file: File) {
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif'].includes(file.type)) throw new Error('请选择不超过 5 MiB 的 PNG、JPEG 或 GIF 图片。不接受 SVG。')
    setUploading(true); setError('')
    try { const form = new FormData(); form.append('file', file); const result = await request<{ url: string }>('/api/admin/media', form); setMessage('图片已上传并插入。请填写图片描述，然后保存文章。'); return result.url }
    catch (reason) { if (reason instanceof ApiError && reason.status === 401) setAuthenticated(false); throw reason }
    finally { setUploading(false) }
  }
  async function upload(file?: File) {
    if (!file || !article) return
    try { const url = await uploadMedia(file); setArticle(current => current ? { ...current, image: { url, alt: current.image?.alt || '', caption: current.image?.caption || '' } } : current); setMessage('图片已上传，请填写替代文字并保存文章。') }
    catch (reason) { showError(reason) }
  }
  async function deleteDraft() {
    if (!article || isNew || article.status === 'published' || busy) return
    if (!window.confirm(`确定永久删除草稿「${article.title || article.id}」吗？此操作不能撤销。`)) return
    setBusy(true); setError('')
    try { await request(`/api/admin/articles/${article.id}`, {}, 'DELETE'); setArticle(null); setBaseline(''); await reloadList(); setMessage('草稿已删除。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function moderate(comment: AdminComment, status: AdminComment['status']) {
    setBusy(true); setError('')
    try { await request(`/api/admin/comments/${comment.id}`, { status }, 'PUT'); await reloadComments(); setMessage(status === 'approved' ? '评论已公开。' : status === 'hidden' ? '评论已隐藏，读者不可见。' : '评论已移回待审核。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function deleteComment(comment: AdminComment) {
    if (!window.confirm(`确定永久删除「${comment.name}」的评论吗？`)) return
    setBusy(true); setError('')
    try { await request(`/api/admin/comments/${comment.id}`, {}, 'DELETE'); await reloadComments(); setMessage('评论已删除。') }
    catch (reason) { showError(reason) } finally { setBusy(false) }
  }
  async function copyShareLink() {
    if (!article) return
    try { await navigator.clipboard.writeText(`${location.origin}/a/${article.id}`); setMessage('分享链接已复制。社交平台会显示标题、摘要和配图。') }
    catch { setError(`浏览器未允许复制，请手动复制：${location.origin}/a/${article.id}`) }
  }
  function estimateTime() {
    if (!article) return
    const text = `${article.body || ''}\n${article.sections.map(s => s.text).join('\n')}`
    update('time', readingMinutes(countWords(text)))
  }
  function exportDraft() {
    if (!article) return
    const blob = new Blob([JSON.stringify({ article, structuredSectionsText: sections }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${/^[a-z0-9-]+$/.test(article.id) ? article.id : 'draft'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (authenticated === null) return <main className="boot-message" role="status">正在检查后台会话…</main>
  if (!authenticated) return <main className="admin-login"><a className="text-link" href="/"><ArrowLeft size={16} />返回网站</a><h1>模型智见 · 写作后台</h1><p>写草稿、预览、发布。现有文章和上传图片保存在服务器，更新程序不会替换内容库。</p><form onSubmit={login}><label htmlFor="admin-token">管理员密钥</label><input id="admin-token" type="password" autoComplete="current-password" value={token} onChange={event => setToken(event.target.value)} required autoFocus /><p className="admin-help">首次部署后，在服务器终端按部署脚本提示读取 ADMIN_TOKEN。请通过 HTTPS 访问公网后台。</p><button className="button button-blue" disabled={busy}>{busy ? '正在登录…' : '登录后台'}</button></form>{error && <p className="admin-error" role="alert">{error}</p>}<p className="admin-help">密钥只用于建立 HttpOnly 会话，不写入 localStorage。AI 接入使用另一个 API_TOKEN。</p></main>

  return <div className="admin-app">
    <header className="admin-header"><a href="/" onClick={event => { if (!confirmDiscard()) event.preventDefault() }}><strong>模型智见</strong><span>写作后台</span></a>
      <nav className="admin-nav" aria-label="后台栏目"><button aria-current={view === 'articles' ? 'page' : undefined} onClick={() => setView('articles')}><FileText size={15} />文章</button><button aria-current={view === 'comments' ? 'page' : undefined} onClick={() => { setView('comments'); reloadComments().catch(showError) }}><MessageSquare size={15} />评论审核{pendingCount > 0 && <span className="admin-badge" aria-label={`${pendingCount} 条待审核`}>{pendingCount}</span>}</button><button aria-current={view === 'stats' ? 'page' : undefined} onClick={() => setView('stats')}><BarChart3 size={15} />访问统计</button></nav>
      <div><a className="button button-outline" href="/" target="_blank" rel="noopener noreferrer">查看网站 ↗</a><button className="button" onClick={() => void logout()} disabled={busy || uploading}><LogOut size={16} />退出</button></div></header>
    {view === 'stats' ? <main><AdminStats onUnauthorized={() => setAuthenticated(false)} /></main> :
    view === 'comments' ? <main className="admin-layout admin-layout-single"><section className="admin-editor"><div className="admin-notices">{error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-success" role="status"><Check size={17} />{message}</p>}</div><AdminComments comments={comments} articles={publication.articles} busy={busy} onModerate={(c, s) => void moderate(c, s)} onDelete={c => void deleteComment(c)} onReload={() => { setBusy(true); reloadComments().then(() => setMessage('评论列表已刷新。')).catch(showError).finally(() => setBusy(false)) }} /></section></main> :
    <main className="admin-layout">
      <aside className="admin-sidebar" aria-label="文章管理"><div className="admin-list-heading"><h1>文章库</h1><span>{publication.articles.length} 篇 · {draftCount} 篇草稿</span></div><button className="button button-blue admin-new" onClick={() => openArticle(newArticle(), true)} disabled={busy || uploading}><FilePlus2 size={18} />写新文章</button>
        <input className="admin-search" type="search" aria-label="搜索后台文章" placeholder="搜索标题或文章 ID" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="admin-tabs" role="group" aria-label="文章状态">{([['all', '全部'], ['draft', '草稿'], ['published', '已发布']] as const).map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}</div>
        <div className="admin-list">{filtered.map(item => <button key={item.id} className={article?.id === item.id && !isNew ? 'selected' : ''} disabled={busy || uploading} onClick={() => openArticle(item)}><span>{item.status === 'published' ? '已发布' : '草稿'}{publication.featuredId === item.id && item.status === 'published' ? ' · 头条' : ''}</span><strong>{item.title || '未命名草稿'}</strong><small>{item.model || '未选模型'} · {item.updatedAt?.slice(0, 10) || item.publishedAt || '尚未发布'}</small></button>)}{!filtered.length && <p className="admin-help">没有符合条件的文章。</p>}</div>
        <button className="text-link" disabled={busy || uploading} onClick={() => { setBusy(true); reloadList().then(() => setMessage('列表已刷新，当前编辑内容保持不变。')).catch(showError).finally(() => setBusy(false)) }}>重新读取列表</button>
        <details className="admin-api"><summary><Code2 size={16} />AI 接入说明</summary><p>任意 AI 工作流均可调用 <code>POST /api/ingest/articles</code>，使用独立 API_TOKEN。只会新增草稿，不能发布或覆盖。</p><pre>{`curl https://你的域名/api/ingest/articles \\\n  -H "Authorization: Bearer $API_TOKEN" \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @article.json`}</pre><p><code>article.json</code> 最小示例：</p><pre>{JSON.stringify({ article: { id: 'my-first-news', status: 'draft', title: '待核验的新闻标题', category: '模型动态', model: '跨模型', body: '## 事件\n这里写 Markdown 正文。', sources: [] } }, null, 2)}</pre><p>成功返回 201。到后台「草稿」补齐摘要、来源和日期，核验后发布。重复 ID 返回冲突，不覆盖旧稿。</p><a className="text-link" href="/api/ingest/ping" onClick={event => { event.preventDefault(); setMessage('连通检查：GET /api/ingest/ping，同样需要 Authorization: Bearer API_TOKEN。请在服务端调用，不要把密钥嵌入公开网页。') }}>如何检查连通性</a></details>
      </aside>
      <section className="admin-editor" aria-label="文章编辑器">
        <div className="admin-notices">{error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-success" role="status"><Check size={17} />{message}</p>}</div>
        {!article ? <div className="admin-welcome"><FilePlus2 size={36} strokeWidth={1.4} /><h2>下一篇，从这里开始。</h2><p>选择已有文章继续编辑，或写一篇新稿。AI 提交的文章会出现在左侧草稿列表。</p><button className="button button-blue" onClick={() => openArticle(newArticle(), true)}>写新文章</button><p className="admin-help">先保存草稿 → 检查预览与来源 → 发布。无须改代码或重新部署。</p></div> : <>
          <div className="admin-editor-heading"><div><h2 ref={editorHeading} tabIndex={-1}>{isNew ? '写新文章' : '编辑文章'}</h2><p>{article.status === 'published' ? '已发布' : '草稿'} · {dirty ? '有未保存修改' : '已保存'}{article.revision ? ` · 版本 ${article.revision}` : ''}</p></div><button className="button button-outline" onClick={exportDraft}><Download size={16} />导出当前稿</button></div>
          <fieldset disabled={busy || uploading} className="admin-fields">
            <label>文章标题<input aria-label="文章标题" value={article.title} maxLength={500} placeholder="把最值得读的变化，写进标题" onChange={event => update('title', event.target.value)} /></label>
            <label>一句话摘要<textarea aria-label="一句话摘要" value={article.description} rows={3} placeholder="告诉读者发生了什么，以及为什么值得关注。" onChange={event => update('description', event.target.value)} /></label>
            <div className="admin-field-grid"><label>分类<select value={article.category} onChange={event => update('category', event.target.value as Article['category'])}>{categories.filter(c => c !== '全部').map(c => <option key={c}>{c}</option>)}</select></label><label>模型<select value={article.model} onChange={event => { update('model', event.target.value); update('tone', event.target.value === '跨模型' ? 'industry' : event.target.value.toLowerCase()) }}>{['跨模型', ...models.filter(m => m !== '全部模型')].map(m => <option key={m}>{m}</option>)}</select></label><label>阅读分钟<span className="admin-inline-field"><input type="number" min={1} max={120} value={article.time} onChange={event => update('time', Number(event.target.value))} /><button type="button" className="text-link" onClick={estimateTime} title="按正文字数估算">估算</button></span></label><label>栏目标签<input value={article.label} placeholder="如：发布解读" onChange={event => update('label', event.target.value)} /></label></div>
            <label>先看结论<textarea value={article.takeaway} rows={2} placeholder="用一两句话写清最重要的判断；不要把厂商说法当实测。" onChange={event => update('takeaway', event.target.value)} /></label>
            <div className="admin-body-heading"><h3>正文</h3><span>Markdown · 链接、引用、代码、表格、脚注和图片</span></div><label className="admin-sr-only" htmlFor="article-body">Markdown 正文</label>
            <MarkdownEditor value={article.body || ''} onChange={value => update('body', value)} onUpload={uploadMedia} onError={text => { setError(text); setMessage('') }} disabled={busy} uploading={uploading} />
            <details className="admin-structured"><summary>结构化正文、原有表格与图表（{article.sections.length} 节）</summary><p className="admin-help">旧文章的完整内容保留在这里，不修改就不会丢失。Markdown 正文会显示在这些段落前。高级编辑请保持 JSON 字段结构，来源编号从 1 开始。</p><label className="admin-sr-only" htmlFor="structured-body">结构化正文 JSON</label><textarea id="structured-body" className="admin-code" rows={16} value={sections} spellCheck={false} onChange={event => setSections(event.target.value)} /></details>
            <section className="admin-section"><h3>文章图片</h3><p className="admin-help">可选，上传真实截图或配图。PNG / JPEG / GIF，最多 5 MiB。上传不会自动保存文章。</p><label className="button button-outline admin-upload"><ImagePlus size={16} />{uploading ? '正在上传…' : '上传图片'}<input aria-label="上传文章图片" type="file" accept="image/png,image/jpeg,image/gif" onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>{article.image && <div className="admin-image-fields"><img src={article.image.url} alt={article.image.alt} referrerPolicy="no-referrer" /><label>图片地址<input value={article.image.url} readOnly /></label><label>替代文字<input aria-label="图片替代文字" value={article.image.alt} onChange={event => update('image', { ...article.image!, alt: event.target.value })} /></label><label>图片说明与出处<input value={article.image.caption || ''} onChange={event => update('image', { ...article.image!, caption: event.target.value })} /></label><button className="text-link" onClick={() => update('image', undefined)}>移除文章配图（保留服务器文件）</button><p className="admin-help">也可在正文用 ![替代文字](图片地址) 插入图片。外部图片仅支持 HTTPS。</p></div>}</section>
            <section className="admin-section"><h3>来源与核验</h3><p className="admin-help">发表前至少添加一个可追溯来源。区分官方资料、独立评测与社区原帖。</p>{article.sources.map((source, index) => <div className="admin-source" key={index}><div><strong>来源 {index + 1}</strong><button className="icon-button" aria-label={`移除来源 ${index + 1}`} onClick={() => update('sources', article.sources.filter((_, i) => i !== index))}><X size={16} /></button></div><label>来源类型<select value={source.kind} onChange={event => updateSource(index, { kind: event.target.value as Source['kind'] })}><option value="official">官方资料</option><option value="benchmark">独立评测</option><option value="community">社区原帖</option></select></label><label>来源名称<input aria-label={`来源 ${index + 1} 名称`} value={source.label} placeholder="发布方、原帖作者或资料标题" onChange={event => updateSource(index, { label: event.target.value })} /></label><label>原文链接<input aria-label={`来源 ${index + 1} 链接`} type="url" value={source.url} placeholder="https://…" onChange={event => updateSource(index, { url: event.target.value })} /></label></div>)}<button className="button button-outline" onClick={() => update('sources', [...article.sources, { label: '', url: '', kind: 'official' }])}>添加来源</button>
              <div className="admin-field-grid admin-dates"><label>发布日期<input type="date" aria-label="发布日期" value={article.publishedAt?.slice(0, 10) || ''} onChange={event => update('publishedAt', event.target.value)} /></label><label>资料核验日期<input type="date" aria-label="资料核验日期" value={article.verifiedAt?.slice(0, 10) || ''} onChange={event => update('verifiedAt', event.target.value)} /></label></div><label>事件时间与资料口径<input value={article.eventNote || ''} placeholder="如：官方发布于某日；本文并非今日快讯" onChange={event => update('eventNote', event.target.value)} /></label><label>编辑观点（可选）<textarea rows={2} value={article.quote} onChange={event => update('quote', event.target.value)} /></label>
            </section>
            <section className="admin-section"><h3>互动与分享</h3><label className="admin-check"><input type="checkbox" checked={!!article.commentsClosed} onChange={event => update('commentsClosed', event.target.checked || undefined)} />关闭本文评论<small>已公开的评论仍会显示；读者不能再提交新评论。</small></label><p className="admin-help">发布后的分享链接：<code>/a/{article.id}</code>。社交平台抓取时会显示标题、摘要和文章配图。</p></section>
            <details className="admin-advanced"><summary>链接与标题高亮</summary><label>文章 ID<input aria-label="文章 ID" value={article.id} disabled={!isNew} pattern="[a-z0-9][a-z0-9-]{0,79}" onChange={event => update('id', event.target.value)} /></label><p className="admin-help">仅小写英文字母、数字和连字符，最长 80 字符，保存后不可更改。分享链接格式：/a/文章ID。</p><label>标题高亮片段（可选）<input value={article.highlight || ''} onChange={event => update('highlight', event.target.value)} /></label></details>
          </fieldset>
          <div className="admin-savebar"><span aria-live="polite">{uploading ? '图片上传中…' : busy ? '正在保存…' : dirty ? '尚未保存' : '所有修改已保存'}</span><div>{!isNew && article.status !== 'published' && <button className="button admin-danger" onClick={() => void deleteDraft()} disabled={busy || uploading}><Trash2 size={16} />删除草稿</button>}<button className="button button-outline" onClick={showPreview} disabled={busy || uploading}><Eye size={16} />预览</button><button className="button button-outline" onClick={() => void save(article.status === 'published' ? 'published' : 'draft')} disabled={busy || uploading}><Save size={16} />{article.status === 'published' ? '保存修改' : '保存草稿'}</button>{article.status !== 'published' ? <button className="button button-blue" disabled={busy || uploading} onClick={() => void save('published')}><Send size={16} />发布文章</button> : <button className="button" disabled={busy || uploading} onClick={() => void save('draft')}>撤回为草稿</button>}</div></div>
          {article.status === 'published' && !isNew && <div className="admin-feature"><button className="text-link" onClick={() => void feature()} disabled={busy || dirty || publication.featuredId === article.id}><Star size={16} />{publication.featuredId === article.id ? '当前首页头条' : '设为首页头条'}</button>{dirty && <small>保存修改后才能设置头条</small>}<button className="text-link" onClick={() => void copyShareLink()}><Copy size={16} />复制分享链接</button><a className="text-link" href={`/a/${article.id}`} target="_blank" rel="noopener noreferrer">查看已发布版本 ↗</a></div>}
        </>}
      </section>
    </main>}
    {preview && <Preview article={preview} close={() => setPreview(null)} />}
  </div>
}
