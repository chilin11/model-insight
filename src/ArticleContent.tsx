import type { Article, ArticleChart, ArticleTable } from './content'
import { lazy, Suspense } from 'react'
// Markdown and syntax highlighting load only for articles that use them.
const MarkdownBody = lazy(() => import('./MarkdownBody'))
import './article-content.css'

function DataTable({ table }: { table: ArticleTable }) {
  return <figure className="data-figure">
    <div className="table-scroll" role="region" aria-label={table.caption} tabIndex={0}>
      <table><caption>{table.caption}</caption><thead><tr>{table.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>)}</tr>)}</tbody></table>
    </div>
    <figcaption>{table.note}</figcaption>
  </figure>
}
function DataChart({ chart }: { chart: ArticleChart }) {
  return <figure className="data-figure chart-figure">
    <h4>{chart.title}</h4>
    <div className="data-chart" role="img" aria-label={`${chart.title}；${chart.rows.map(row => `${row.label}：${row.value}${chart.unit}`).join('；')}；坐标从 0 到 ${chart.max}${chart.unit}`}>
      <div className="chart-scale" aria-hidden="true"><span>0</span><span>{chart.max} {chart.unit}</span></div>
      {chart.rows.map((row, i) => <div className="chart-row" key={row.label} aria-hidden="true">
        <div className="chart-row-label"><span>{row.label}</span><strong>{row.value} {chart.unit}</strong></div>
        <svg viewBox="0 0 100 4" preserveAspectRatio="none" focusable="false" aria-hidden="true"><rect width="100" height="4" rx="1" fill="#e8ecf2" /><rect className="chart-bar" width={row.value / chart.max * 100} height="4" rx="1" fill={i % 2 ? '#2454d6' : '#8594ad'} /></svg>
      </div>)}
    </div>
    <figcaption>{chart.note}</figcaption>
  </figure>
}
const sourceLabels = { official: '官方资料', benchmark: '独立评测', community: '社区原帖' }
export default function ArticleContent({ article }: { article: Article }) {
  return <>
    {article.status !== 'published' ? <p className="reader-preview">草稿预览，尚未发布。请核验事实、表格和来源后再发布。</p> : <div className="article-provenance"><p>{article.eventNote}</p><p>本文发布：{article.publishedAt} · 资料核验：{article.verifiedAt}（UTC）</p><p>根据下列公开资料撰写，非本站产品实测。价格、开放状态及帖子内容可能变化。</p></div>}
    {article.takeaway && <aside className="takeaway"><span className="key-label">先看结论</span><p>{article.takeaway}</p></aside>}
    {article.image && <figure className="article-image"><img src={article.image.url} alt={article.image.alt} loading="lazy" referrerPolicy="no-referrer" />{article.image.caption && <figcaption>{article.image.caption}</figcaption>}</figure>}
    {article.body && <Suspense fallback={<p className="markdown-loading" role="status">正在加载正文…</p>}><MarkdownBody body={article.body} /></Suspense>}
    {article.sections.map((section, index) => <section className="reader-section" key={section.heading}>
      <span className="reader-section-number">{String(index + 1).padStart(2, '0')}</span><h3>{section.heading}</h3>
      {section.text.split('\n\n').map((paragraph, i) => <p key={i}>{paragraph}</p>)}
      {section.table && <DataTable table={section.table} />}
      {section.chart && <DataChart chart={section.chart} />}
      {section.sourceNumbers && <nav className="section-citations" aria-label={`${section.heading}的来源`}>来源：{section.sourceNumbers.map(number => {
        const source = article.sources[number - 1]
        return source ? <a key={number} href={source.url} target="_blank" rel="noopener noreferrer" aria-label={`来源 ${number}：${source.label}`}>[{number}]</a> : null
      })}</nav>}
    </section>)}
    {article.quote && <blockquote><span>编辑观点</span>{article.quote}</blockquote>}
    <section className="source-note"><h3>来源与核验</h3><ol>{article.sources.map((source, index) => <li key={`${source.kind}-${source.url}`}><span>[{index + 1}] {sourceLabels[source.kind]}</span><a href={source.url} target="_blank" rel="noopener noreferrer">{source.label} ↗</a></li>)}</ol><p className="source-principle">厂商成绩不等于独立实测，社区个体体验不代表共识，编辑观点不等同于事实。图表由本站依据所列资料绘制，算术示例单独标注。</p></section>
  </>
}
