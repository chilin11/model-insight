import { useState } from 'react'
import { Check, EyeOff, RotateCcw, Trash2 } from 'lucide-react'
import type { Article } from './content'

export type AdminComment = { id: string; articleId: string; name: string; body: string; status: 'pending' | 'approved' | 'hidden'; createdAt: string; moderatedAt?: string }
type Filter = 'pending' | 'approved' | 'hidden' | 'all'
const labels: Record<AdminComment['status'], string> = { pending: '待审核', approved: '已公开', hidden: '已隐藏' }
const formatTime = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false }) }

export default function AdminComments({ comments, articles, busy, onModerate, onDelete, onReload }: {
  comments: AdminComment[]
  articles: Article[]
  busy: boolean
  onModerate: (comment: AdminComment, status: AdminComment['status']) => void
  onDelete: (comment: AdminComment) => void
  onReload: () => void
}) {
  const [filter, setFilter] = useState<Filter>('pending')
  const [query, setQuery] = useState('')
  const titles = new Map(articles.map(article => [article.id, article.title || '未命名草稿']))
  const counts = { pending: 0, approved: 0, hidden: 0, all: comments.length }
  comments.forEach(comment => { counts[comment.status]++ })
  const term = query.trim().toLowerCase()
  const shown = comments.filter(comment => (filter === 'all' || comment.status === filter) && (!term || `${comment.name} ${comment.body} ${titles.get(comment.articleId) || ''}`.toLowerCase().includes(term)))

  return <section className="admin-comments" aria-labelledby="comments-heading">
    <div className="admin-editor-heading"><div><h2 id="comments-heading">评论审核</h2><p>读者评论默认不公开；通过后显示在文章底部。隐藏可随时恢复，删除不可撤销。</p></div><button className="button button-outline" onClick={onReload} disabled={busy}><RotateCcw size={16} />刷新</button></div>
    <div className="admin-comment-filters">
      <div className="admin-tabs" role="group" aria-label="评论状态">{(['pending', 'approved', 'hidden', 'all'] as Filter[]).map(key => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === 'all' ? '全部' : labels[key]} {counts[key]}</button>)}</div>
      <input type="search" aria-label="搜索评论" placeholder="搜索昵称、内容或文章" value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    {shown.length === 0 ? <p className="admin-empty">{filter === 'pending' ? '没有待审核评论。' : '没有符合条件的评论。'}</p> : <ol className="admin-comment-list">{shown.map(comment => <li key={comment.id} className={`is-${comment.status}`}>
      <div className="admin-comment-meta"><span className={`comment-badge badge-${comment.status}`}>{labels[comment.status]}</span><strong>{comment.name}</strong><time dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time></div>
      <p className="admin-comment-body">{comment.body}</p>
      <p className="admin-comment-article">文章：{titles.has(comment.articleId) ? <a href={`/a/${comment.articleId}`} target="_blank" rel="noopener noreferrer">{titles.get(comment.articleId)} ↗</a> : <em>文章已删除（{comment.articleId}）</em>}</p>
      <div className="admin-comment-actions">
        {comment.status !== 'approved' && <button className="button button-blue" disabled={busy} onClick={() => onModerate(comment, 'approved')}><Check size={15} />通过并公开</button>}
        {comment.status !== 'hidden' && <button className="button button-outline" disabled={busy} onClick={() => onModerate(comment, 'hidden')}><EyeOff size={15} />{comment.status === 'approved' ? '撤下' : '隐藏'}</button>}
        {comment.status === 'hidden' && <button className="button button-outline" disabled={busy} onClick={() => onModerate(comment, 'pending')}><RotateCcw size={15} />移回待审</button>}
        <button className="button admin-danger" disabled={busy} aria-label={`删除评论：${comment.name}`} onClick={() => onDelete(comment)}><Trash2 size={15} />删除</button>
      </div>
    </li>)}</ol>}
  </section>
}
