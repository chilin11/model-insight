import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { loadPublication, type Publication } from './api'
import './styles.css'
const Admin = lazy(() => import('./Admin'))
function Frontend() {
  const [publication, setPublication] = useState<Publication | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; loadPublication().then(result => { if (active) setPublication(result) }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '文章加载失败') }); return () => { active = false } }, [])
  if (error) return <main className="boot-message"><h1>暂时无法读取文章</h1><p role="alert">{error}</p><button className="button button-blue" onClick={() => location.reload()}>重新加载</button></main>
  if (!publication) return <main className="boot-message" role="status">正在读取文章…</main>
  if (!publication.articles.length) return <main className="boot-message"><h1>模型智见</h1><p>暂时没有已发布文章。</p><a className="text-link" href="/admin">进入写作后台 →</a></main>
  return <App publication={publication} />
}
ReactDOM.createRoot(document.getElementById('root')!).render(<StrictMode><Suspense fallback={<main className="boot-message">正在打开写作后台…</main>}>{location.pathname === '/admin' || location.pathname.startsWith('/admin/') ? <Admin /> : <Frontend />}</Suspense></StrictMode>)
