import type { Article } from './content'

const siteTitle = '模型智见 · AI 模型新闻、评测与社区评价'
const siteDescription = '模型智见：AI 模型发布、评测解读和社区评价。官方信息、评分口径、社区体验与编辑观点分开呈现，附原始资料、数据表格与核验日期。'
function meta(key: string, value?: string, attribute: 'name' | 'property' = 'name') {
  const matches = [...document.head.querySelectorAll<HTMLMetaElement>(`meta[${attribute}="${key}"]`)]
  const first = matches.shift()
  matches.forEach(node => node.remove())
  if (value === undefined) { first?.remove(); return }
  const node = first || document.createElement('meta')
  node.setAttribute(attribute, key); node.content = value
  if (!first) document.head.append(node)
}
function canonical(value?: string) {
  const nodes = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]')]
  const first = nodes.shift(); nodes.forEach(node => node.remove())
  if (!value) { first?.remove(); return }
  const node = first || document.createElement('link'); node.rel = 'canonical'; node.href = value
  if (!first) document.head.append(node)
}
const validDate = (s?: string) => s && Number.isFinite(Date.parse(s)) ? s : undefined
const modifiedDate = (article: Article) => {
  const published = validDate(article.publishedAt), updated = validDate(article.updatedAt)
  return updated && (!published || Date.parse(updated) >= Date.parse(published)) ? updated : published
}
function imageURL(article?: Article) {
  if (!article?.image?.url) return undefined
  try {
    const url = new URL(article.image.url, location.origin)
    if (url.username || url.password || /[\s\u0000-\u001f]/.test(article.image.url)) return undefined
    return url.protocol === 'https:' || /^\/media\/[a-zA-Z0-9_.-]+$/.test(article.image.url) ? url.href : undefined
  } catch { return undefined }
}

// Keep share/canonical metadata in sync when the existing reader overlay opens
// or closes. Direct requests still receive full metadata from the Go service.
export function updatePublicMeta(article?: Article | null) {
  const base = location.origin
  const url = article ? `${base}/a/${article.id}` : `${base}/`
  const title = article ? `${article.title} · 模型智见` : siteTitle
  const description = article?.description || siteDescription
  const image = imageURL(article || undefined)
  document.title = title
  canonical(url)
  meta('description', description)
  meta('robots', undefined)
  for (const [key, value] of Object.entries({
    'og:type': article ? 'article' : 'website', 'og:site_name': '模型智见',
    'og:title': article?.title || siteTitle, 'og:description': description, 'og:url': url, 'og:image': image,
    'article:published_time': article ? validDate(article.publishedAt) : undefined,
    'article:modified_time': article ? modifiedDate(article) : undefined,
  })) meta(key, value, 'property')
  meta('twitter:card', image ? 'summary_large_image' : 'summary')
  meta('twitter:title', article?.title || siteTitle)
  meta('twitter:description', description)
  meta('twitter:image', image)
  const organization = { '@type': 'Organization', '@id': `${base}/#organization`, name: '模型智见', url: `${base}/` }
  const website = { '@type': 'WebSite', '@id': `${base}/#website`, name: '模型智见', url: `${base}/`, inLanguage: 'zh-CN', publisher: { '@id': organization['@id'] } }
  const graph: Record<string, unknown>[] = [organization, website]
  if (article) {
    graph.push({ '@type': 'Article', '@id': `${url}#article`, headline: article.title, description, url,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url }, inLanguage: 'zh-CN', articleSection: article.category,
      datePublished: validDate(article.publishedAt), dateModified: modifiedDate(article),
      author: { '@id': organization['@id'] }, publisher: { '@id': organization['@id'] },
      ...(image ? { image: [image] } : {}), ...(article.sources.length ? { citation: article.sources.map(source => source.url) } : {}),
    }, { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '模型智见', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: article.title, item: url },
    ] })
  }
  const schemas = [...document.head.querySelectorAll<HTMLScriptElement>('script#site-structured-data')]
  const first = schemas.shift(); schemas.forEach(node => node.remove())
  const schema = first || document.createElement('script')
  schema.id = 'site-structured-data'; schema.type = 'application/ld+json'
  schema.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')
  if (!first) document.head.append(schema)
}

export function markMissingArticle() {
  document.title = '文章不存在或已撤回 · 模型智见'
  canonical(undefined)
  meta('robots', 'noindex, nofollow')
  meta('description', '文章不存在或已撤回，请返回首页查看已发布内容。')
  document.head.querySelectorAll('script#site-structured-data, meta[property^="og:"], meta[property^="article:"], meta[name^="twitter:"]').forEach(node => node.remove())
}
