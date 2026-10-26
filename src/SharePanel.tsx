import { useEffect, useState } from 'react'
import { Copy, QrCode, Share2, X } from 'lucide-react'
import type { Article } from './content'
import './social.css'

export const shareURL = (article: Article) => `${location.origin}/a/${article.id}`

export default function SharePanel({ article, notify, close }: { article: Article; notify: (message: string) => void; close: () => void }) {
  const url = shareURL(article)
  const text = `${article.title}｜模型智见`
  const [qr, setQr] = useState('')
  const [showQr, setShowQr] = useState(false)
  const canNativeShare = typeof navigator.share === 'function'

  useEffect(() => {
    if (!showQr || qr) return
    let active = true
    import('qrcode').then(QR => QR.toString(url, { type: 'svg', margin: 1, width: 180, errorCorrectionLevel: 'M' }))
      .then(svg => { if (active) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`) })
      .catch(() => { if (active) notify('二维码生成失败，请复制链接分享。') })
    return () => { active = false }
  }, [showQr, qr, url, notify])

  async function copy() {
    try { await navigator.clipboard.writeText(url); notify('文章链接已复制') }
    catch { notify('浏览器未允许复制，请从地址栏手动复制文章链接。') }
  }
  async function nativeShare() {
    try { await navigator.share({ title: article.title, text: article.description, url }) }
    catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) notify('系统分享不可用，请复制链接。') }
  }
  const e = encodeURIComponent
  const targets = [
    ['微博', `https://service.weibo.com/share/share.php?url=${e(url)}&title=${e(text)}`],
    ['X', `https://x.com/intent/post?text=${e(text)}&url=${e(url)}`],
    ['Telegram', `https://t.me/share/url?url=${e(url)}&text=${e(text)}`],
    ['邮件', `mailto:?subject=${e(text)}&body=${e(`${article.description}\n\n${url}`)}`],
  ]

  return <div className="share-panel" role="group" aria-label="分享这篇文章">
    <div className="share-head"><strong>分享这篇文章</strong><button className="icon-button" aria-label="收起分享" onClick={close}><X size={16} /></button></div>
    <div className="share-link"><input readOnly value={url} aria-label="文章分享链接" onFocus={event => event.currentTarget.select()} /><button className="button button-outline" onClick={copy}><Copy size={15} />复制链接</button></div>
    <div className="share-targets">
      {canNativeShare && <button className="share-target" onClick={nativeShare}><Share2 size={15} />系统分享</button>}
      <button className="share-target" aria-expanded={showQr} onClick={() => setShowQr(value => !value)}><QrCode size={15} />微信扫码</button>
      {targets.map(([label, href]) => <a className="share-target" key={label} href={href} target={href.startsWith('mailto:') ? undefined : '_blank'} rel="noopener noreferrer">{label}</a>)}
    </div>
    {showQr && <div className="share-qr">{qr ? <img src={qr} width={180} height={180} alt={`文章二维码：${article.title}`} /> : <span role="status">正在生成二维码…</span>}<p>用微信扫一扫打开，再分享给朋友或朋友圈。</p></div>}
  </div>
}
