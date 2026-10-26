import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BarChart3, RotateCcw } from 'lucide-react'
import { ApiError, request } from './api'
import './admin-stats.css'

type Counts = { pageViews: number; articleViews: number }
type Day = Counts & { date: string }
export type Stats = {
  startedAt: string; updatedAt: string; timezone: string; days: number
  totals: Counts; today: Counts; period: Counts; daily: Day[]
  articles: { id: string; title: string; status: string; views: number; periodViews: number; todayViews: number }[]
}
const number = (n: number) => n.toLocaleString('zh-CN')
const stamp = (s: string) => s ? new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无记录'
const dateInShanghai = (s: string) => new Date(Date.parse(s) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
function Trend({ daily, startedAt }: { daily: Day[]; startedAt: string }) {
  const started = dateInShanghai(startedAt)
  const max = Math.max(2, Math.ceil(Math.max(0, ...daily.flatMap(d => [d.pageViews, d.articleViews])) / 2) * 2)
  const measured = daily.map((d, i) => ({ ...d, x: 44 + i * 892 / Math.max(1, daily.length - 1) })).filter(d => d.date >= started)
  const points = (key: keyof Counts) => measured.map(d => `${d.x},${172 - d[key] / max * 140}`).join(' ')
  const last = measured.at(-1)
  return <div className="stats-chart"><div className="stats-legend"><span>页面访问</span><span>文章阅读</span></div>
    <svg viewBox="0 0 960 210" role="img" aria-label={`近 ${daily.length} 天访问与阅读趋势；精确数据见下方按日明细`}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1="44" x2="936" y1={172 - f * 140} y2={172 - f * 140} stroke="#e5e9ef" /><text x="34" y={176 - f * 140} textAnchor="end">{number(Math.round(max * f))}</text></g>)}
      {measured[0] && measured[0].x > 44 && <g><rect x="44" y="25" width={measured[0].x - 44} height="147" fill="#f5f7fa" /><text x={(44 + measured[0].x) / 2} y="102" textAnchor="middle">启用前未统计</text></g>}
      <polyline points={points('pageViews')} fill="none" stroke="#91a2b7" strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points={points('articleViews')} fill="none" stroke="#1e5eff" strokeWidth="3" strokeLinejoin="round" />
      {last && <><circle cx={last.x} cy={172 - last.pageViews / max * 140} r="4" fill="#91a2b7" /><circle cx={last.x} cy={172 - last.articleViews / max * 140} r="4" fill="#1e5eff" /></>}
      <text x="44" y="200">{daily[0]?.date.slice(5)}</text><text x="936" y="200" textAnchor="end">{daily.at(-1)?.date.slice(5)}</text>
    </svg>
  </div>
}

export default function AdminStats({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const unauthorized = useRef(onUnauthorized)
  unauthorized.current = onUnauthorized
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setStats(null)
    request<Stats>(`/api/admin/stats?days=${days}`).then(result => {
      if (!active) return
      if (result.days !== days || !Array.isArray(result.daily) || !Array.isArray(result.articles) || !result.totals || !result.today || !result.period) throw new Error('统计数据格式异常，未显示为零。')
      setStats(result)
    }).catch(reason => {
      if (!active) return
      if (reason instanceof ApiError && reason.status === 401) unauthorized.current()
      setError(reason instanceof Error ? reason.message : '统计加载失败，请稍后重试。')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [days, refresh])
  const ranked = stats?.articles.filter(a => `${a.title} ${a.id}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.periodViews - a.periodViews || b.views - a.views || a.id.localeCompare(b.id)) || []
  return <section className="admin-stats" aria-labelledby="stats-heading">
    <div className="admin-editor-heading"><div><h1 id="stats-heading"><BarChart3 size={22} />访问统计</h1><p>匿名累计次数，不是独立访客数，也不是曝光点击率。</p></div><button className="button button-outline" onClick={() => setRefresh(n => n + 1)} disabled={loading}><RotateCcw size={16} />刷新统计</button></div>
    <div className="stats-controls"><div className="admin-tabs" role="group" aria-label="统计时间范围">{[7, 30, 90].map(n => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>近 {n} 天</button>)}</div><span>北京时间 · 含今天</span></div>
    {loading && <p role="status" className="stats-state">正在读取统计…</p>}
    {error && <div className="stats-state"><p role="alert" className="admin-error">{error}</p><p className="admin-help">统计不可用不会影响阅读或发稿。请检查是否已更新服务及 analytics.json 文件权限；不要删除数据文件来消除错误。</p><button className="button button-outline" onClick={() => setRefresh(n => n + 1)}>重新读取</button></div>}
    {stats && <>
      <div className="stats-summary">{[
        ['今日访问', stats.today.pageViews], ['今日阅读', stats.today.articleViews],
        [`近 ${days} 天访问`, stats.period.pageViews], [`近 ${days} 天阅读`, stats.period.articleViews],
        ['累计访问', stats.totals.pageViews], ['累计阅读', stats.totals.articleViews],
      ].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{number(Number(value))}</strong><small>次</small></div>)}</div>
      {stats.totals.pageViews === 0 && stats.totals.articleViews === 0 && <p className="stats-empty">统计已启用，暂时没有记录。只记录启用后的访问，不补造历史；管理员登录后的阅读不计入。</p>}
      <div className="stats-section"><h2>访问与阅读趋势</h2><Trend daily={stats.daily} startedAt={stats.startedAt} /><details className="stats-daily"><summary>查看按日明细</summary><div className="stats-table-wrap"><table><thead><tr><th scope="col">日期</th><th scope="col">页面访问</th><th scope="col">文章阅读</th></tr></thead><tbody>{[...stats.daily].reverse().map(day => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.date < dateInShanghai(stats.startedAt) ? '未统计' : number(day.pageViews)}</td><td>{day.date < dateInShanghai(stats.startedAt) ? '未统计' : number(day.articleViews)}</td></tr>)}</tbody></table></div></details></div>
      <div className="stats-section"><div className="stats-rank-heading"><div><h2>文章阅读排行</h2><p>按近 {days} 天阅读次数排序；含分享链接直接进入的阅读。</p></div><input type="search" className="admin-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文章" aria-label="搜索统计文章" /></div>
        <div className="stats-table-wrap"><table className="stats-ranking"><thead><tr><th scope="col">文章</th><th scope="col">今日</th><th scope="col">近 {days} 天</th><th scope="col">累计</th></tr></thead><tbody>{ranked.map(a => <tr key={a.id}><th scope="row">{a.status === 'published' ? <a href={`/a/${encodeURIComponent(a.id)}`} target="_blank" rel="noopener noreferrer">{a.title || a.id}<ArrowUpRight size={13} aria-hidden="true" /></a> : <span>{a.title || a.id}<small> · 已撤回或删除</small></span>}</th><td>{number(a.todayViews)}</td><td>{number(a.periodViews)}</td><td>{number(a.views)}</td></tr>)}</tbody></table></div>{!ranked.length && <p className="admin-help">没有符合条件的文章。</p>}
      </div>
      <div className="stats-method"><h2>这些数字怎样计算</h2><ul><li>页面可见满 1 秒后记一次访问；同一页面打开同一篇文章，可见满 1 秒后只记一次阅读，刷新可再次计数。不是读完率，也不是去重人数。</li><li>不保存访问者身份、IP、来源或指纹，不设统计 Cookie；尊重浏览器 DNT / GPC。登录管理员与常见爬虫不计，后台预览不计。</li><li>浏览器拦截、断网、防刷限制或未执行 JavaScript 会漏计；无法完全排除机器人。仅供编辑参考，不用于结算或广告审计。</li><li>按日数据保留最近 90 天；累计次数从启用时开始，早于启用的日期不代表已经测量的零。</li></ul><p>开始记录：{stamp(stats.startedAt)}<br />最近记录更新：{stamp(stats.updatedAt)}<br />本次读取：{new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</p></div>
    </>}
  </section>
}
