import type { Article } from './content'
export type Publication = { articles: Article[]; featuredId: string }
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function request<T>(path: string, data?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, {
    method: data === undefined ? 'GET' : method,
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'model-insight', ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => ({ error: '服务器没有返回有效 JSON。请检查服务是否启动。' }))
  if (!response.ok) throw new ApiError(result.error || `请求失败（${response.status}）`, response.status)
  return result as T
}
export async function loadPublication(): Promise<Publication> {
  const response = await fetch('/api/articles', { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
  // Static frontend preview only. Production never masks an API failure with the old seed.
  if (import.meta.env.DEV && ([404, 500, 502, 503].includes(response.status) || response.headers.get('content-type')?.includes('text/html'))) {
    const seed = await import('./content')
    return { articles: seed.allArticles, featuredId: seed.featured.id }
  }
  if (!response.ok) throw new Error(`文章服务暂时不可用（${response.status}），请稍后重试。`)
  const result = await response.json() as Publication
  if (!Array.isArray(result.articles) || typeof result.featuredId !== 'string' || !result.articles.every(a => a && a.status === 'published' && typeof a.id === 'string' && typeof a.title === 'string' && Array.isArray(a.sections) && Array.isArray(a.sources))) throw new Error('文章数据格式异常，未使用旧数据替代。请检查服务日志。')
  return result
}
