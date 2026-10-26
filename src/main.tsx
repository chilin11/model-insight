import { StrictMode, lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App, { articleFromHash } from './App'
import { loadPublication, type Publication } from './api'
import { prepareArticleMarkdown } from './ArticleContent'
import { markMissingArticle } from './seo'
import './styles.css'
const Admin = lazy(() => import('./Admin'))
function Frontend() {
  const [publication, setPublication] = useState<Publication | null>(null)
  const [error, setError] = useState('')
  const [serverPage] = useState(() => document.getElementById('server-content')?.dataset.page)
  const requestedID = /^\/a\/([a-z0-9-]+)$/.exec(location.pathname)?.[1]
  const missing = !!publication && !!requestedID && !publication.articles.some(article => article.id === requestedID)
  useEffect(() => {
    if (serverPage === 'not-found') return
    let active = true
    loadPublication().then(async result => {
      // Leave real server content readable until the interactive article is ready.
      await prepareArticleMarkdown(articleFromHash(result.articles))
      if (active) setPublication(result)
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '文章加载失败') })
    return () => { active = false }
  }, [serverPage])
  useLayoutEffect(() => {
    if (!publication) return
    document.getElementById('server-content')?.remove()
    if (missing) markMissingArticle()
  }, [publication, missing])
  if (serverPage === 'not-found') return null
  if (error) return <main className="boot-message"><h1>{serverPage ? '互动界面暂时不可用' : '暂时无法读取文章'}</h1><p role="alert">{error}</p>{serverPage && <p>页面仍保留服务器返回的正文与文章目录，可继续阅读。</p>}<button className="button button-blue" onClick={() => location.reload()}>重新加载</button></main>
  if (!publication) return serverPage ? null : <main className="boot-message" role="status">正在读取文章…</main>
  if (missing) return <main className="boot-message"><h1>文章不存在或已撤回</h1><p>请返回首页查看已发布文章。</p><a className="text-link" href="/">返回首页 →</a></main>
  if (!publication.articles.length) return <main className="boot-message"><h1>模型智见</h1><p>暂时没有已发布文章。</p><a className="text-link" href="/admin">进入写作后台 →</a></main>
  return <App publication={publication} />
}
ReactDOM.createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<main className="boot-message">正在打开写作后台…</main>}>{location.pathname === '/admin' || location.pathname.startsWith('/admin/') ? <Admin /> : <Frontend />}</Suspense></StrictMode>)
