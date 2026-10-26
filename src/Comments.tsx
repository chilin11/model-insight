import { useEffect, useRef, useState, type FormEvent } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { request } from './api'
import './social.css'

type PublicComment = { id: string; name: string; body: string; createdAt: string }
const NAME_KEY = 'model-insight:comment-name'
const formatTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function Comments({ articleId, closed }: { articleId: string; closed?: boolean }) {
  const [comments, setComments] = useState<PublicComment[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState(() => { try { return localStorage.getItem(NAME_KEY) || '' } catch { return '' } })
  const [body, setBody] = useState('')
  const [website, setWebsite] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const delivered = useRef<PublicComment[]>([])

  useEffect(() => {
    let active = true
    delivered.current = []; setComments(null); setLoadError(''); setStatus(null); setBody('')
    fetch(`/api/articles/${encodeURIComponent(articleId)}/comments`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
      .then(async response => {
        if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw new Error()
        const data = await response.json() as { comments?: PublicComment[] }
        if (active) { const merged = new Map((Array.isArray(data.comments) ? data.comments : []).map(c => [c.id, c])); delivered.current.forEach(c => merged.set(c.id, c)); setComments([...merged.values()]) }
      })
      .catch(() => { if (active) { setComments([...delivered.current]); setLoadError(delivered.current.length ? '' : '评论暂时无法加载。') } })
    return () => { active = false }
  }, [articleId])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (sending) return
    const text = body.trim()
    if (text.length < 2) { setStatus({ ok: false, text: '评论至少需要 2 个字。' }); textarea.current?.focus(); return }
    setSending(true); setStatus(null)
    try {
      const result = await request<{ status: 'approved' | 'pending'; masked?: boolean; comment?: PublicComment }>(`/api/articles/${encodeURIComponent(articleId)}/comments`, { name: name.trim(), body: text, website })
      const rememberedName = name.trim() ? result.comment?.name || name.trim() : ''
      try { if (rememberedName) localStorage.setItem(NAME_KEY, rememberedName); else localStorage.removeItem(NAME_KEY) } catch { /* optional convenience */ }
      if (result.comment) { const saved = result.comment; delivered.current = [...delivered.current.filter(c => c.id !== saved.id), saved]; setComments(current => [...(current || []).filter(c => c.id !== saved.id), saved]); setLoadError(''); setName(rememberedName) }
      setBody('')
      setStatus({ ok: true, text: result.status === 'pending' ? '已提交，等待公开。' : result.masked ? '评论已发布，命中的敏感或隐私片段已用星号遮盖。' : '评论已发布。' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : ''
      setStatus({ ok: false, text: /too many/.test(message) ? '提交太频繁，请 10 分钟后再试。' : /closed/.test(message) ? '本文已关闭评论。' : /capacity|queue/.test(message) ? '评论容量已满，请稍后再试。' : /nickname|comment 2-2000/.test(message) ? '昵称最多 40 字，评论需 2–2000 字。' : '提交失败，请稍后重试。内容已保留。' })
    } finally { setSending(false) }
  }

  return <section className="comments" aria-labelledby="comments-title">
    <h3 id="comments-title"><MessageSquare size={18} aria-hidden="true" />读者评论{comments && comments.length > 0 && <span>{comments.length}</span>}</h3>
    {comments === null ? <p className="comments-note" role="status">正在加载评论…</p>
      : loadError ? <p className="comments-note">{loadError}</p>
      : comments.length === 0 ? <p className="comments-note">还没有公开评论。</p>
      : <ol className="comment-list">{comments.map(comment => <li key={comment.id}><div className="comment-meta"><strong>{comment.name}</strong><time dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time></div><p>{comment.body}</p></li>)}</ol>}
    {closed ? <p className="comments-note comments-closed">本文已关闭评论。</p> : <form className="comment-form" onSubmit={submit} aria-busy={sending}>
      <div className="comment-honeypot" aria-hidden="true"><label>网站<input tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} name="website" /></label></div>
      <label htmlFor={`comment-name-${articleId}`}>昵称<span>（可选）</span></label>
      <input id={`comment-name-${articleId}`} value={name} maxLength={40} autoComplete="nickname" placeholder="匿名读者" onChange={event => setName(event.target.value)} disabled={sending} />
      <label htmlFor={`comment-body-${articleId}`}>你的看法</label>
      <textarea id={`comment-body-${articleId}`} ref={textarea} value={body} maxLength={2000} rows={4} required placeholder="补充实测经验、指出错误或分享不同观点" onChange={event => { setBody(event.target.value); setStatus(null) }} disabled={sending} />
      <div className="comment-actions"><span className="comment-count">{body.length} / 2000</span><button className="button button-blue" disabled={sending}><Send size={15} />{sending ? '提交中…' : '提交评论'}</button></div>
      <p className="comments-note">评论提交后直接公开，命中的敏感词及疑似隐私片段会用星号遮盖。自动规则不能识别所有语义；请勿发布隐私、广告或违法内容。</p>
      {status && <p className={`comment-status ${status.ok ? 'is-ok' : 'is-error'}`} role={status.ok ? 'status' : 'alert'}>{status.text}</p>}
    </form>}
  </section>
}
