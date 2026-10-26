import { useEffect, useRef } from 'react'

// No visitor identifier, storage or external tracker. A document counts once;
// each article counts once per document after one visible second, not per click.
export function useReadStats(articleId?: string) {
  const reported = useRef(new Set<string>())
  useEffect(() => {
    const browser = navigator as Navigator & { globalPrivacyControl?: boolean }
    if (navigator.doNotTrack === '1' || browser.globalPrivacyControl) return
    const keys = ['pageview', ...(articleId ? [`article:${articleId}`] : [])]
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState !== 'visible') return
      timer = setTimeout(() => {
        for (const key of keys) {
          if (reported.current.has(key)) continue
          reported.current.add(key)
          const event = key === 'pageview' ? { type: 'pageview' } : { type: 'article', articleId: key.slice(8) }
          // Best effort, no retry: failed tracking must never interrupt reading.
          void fetch('/api/stats/event', {
            method: 'POST', credentials: 'same-origin', keepalive: true,
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'model-insight' },
            body: JSON.stringify(event), signal: AbortSignal.timeout(5_000),
          }).catch(() => undefined)
        }
      }, 1000)
    }
    schedule()
    document.addEventListener('visibilitychange', schedule)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', schedule) }
  }, [articleId])
}
