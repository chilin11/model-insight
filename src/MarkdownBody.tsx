import { useState, type MouseEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { Check, Copy } from 'lucide-react'
import './markdown.css'

// Only these grammars are bundled; unknown languages render as plain code.
const lowlight = createLowlight({ bash, css, diff, go, java, javascript, json, markdown, python, rust, shell, sql, typescript, xml, yaml })
lowlight.registerAlias({ bash: ['sh', 'zsh'], javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'], python: ['py'], xml: ['html'], yaml: ['yml'], shell: ['console'] })

function rehypeCodeHighlight() {
  const walk = (node: HastNode) => {
    if (node.type === 'element' && node.tagName === 'pre') {
      const code = node.children?.find(child => child.type === 'element' && child.tagName === 'code')
      const classes = Array.isArray(code?.properties?.className) ? (code.properties.className as unknown[]).map(String) : []
      const language = classes.find(name => name.startsWith('language-'))?.slice(9)
      if (code && language && lowlight.registered(language)) {
        code.children = lowlight.highlight(language, textOf(code)).children as HastNode[]
        code.properties = { ...code.properties, className: [...classes, 'hljs'] }
      }
      return
    }
    node.children?.forEach(walk)
  }
  return (tree: HastNode) => walk(tree)
}

const calloutLabels: Record<string, [string, string]> = {
  NOTE: ['note', '说明'], 说明: ['note', '说明'],
  TIP: ['tip', '提示'], 提示: ['tip', '提示'],
  IMPORTANT: ['important', '重点'], 重点: ['important', '重点'],
  WARNING: ['warning', '注意'], 注意: ['warning', '注意'],
  CAUTION: ['caution', '风险'], 风险: ['caution', '风险'],
}

type MdNode = { type: string; value?: string; children?: MdNode[]; data?: { hName?: string; hProperties?: Record<string, unknown> } }

// Turns `> [!NOTE]` (or `> [!提示]`) blockquotes into labelled callouts.
function remarkCallouts() {
  const walk = (node: MdNode) => {
    if (node.type === 'blockquote') {
      const paragraph = node.children?.[0]
      const text = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : undefined
      const match = text?.type === 'text' ? /^\[!([A-Z]+|说明|提示|重点|注意|风险)\][ \t]*\n?/.exec(text.value || '') : null
      const kind = match ? calloutLabels[match[1]] : undefined
      if (text && match && kind) {
        text.value = (text.value || '').slice(match[0].length)
        node.data = { hName: 'aside', hProperties: { className: ['callout', `callout-${kind[0]}`], dataLabel: kind[1] } }
      }
    }
    node.children?.forEach(walk)
  }
  return (tree: MdNode) => walk(tree)
}

function safeURL(value: string, image: boolean) {
  if (image && /^\/media\/[a-zA-Z0-9_.-]+$/.test(value)) return value
  if (!image && /^#[a-zA-Z0-9_-]+$/.test(value)) return value
  try {
    const url = new URL(value)
    if (url.username || url.password || /[\s\u0000-\u001f]/.test(value)) return ''
    if (url.protocol === 'https:') return value
    if (!image && (url.protocol === 'http:' || url.protocol === 'mailto:')) return value
  } catch { /* relative or malformed URLs are dropped */ }
  return ''
}

type HastNode = { type: string; tagName?: string; value?: string; children?: HastNode[]; properties?: Record<string, unknown> }
function textOf(node?: HastNode): string {
  if (!node) return ''
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(textOf).join('')
}

function CodeBlock({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const code = node?.children?.find(child => child.type === 'element')
  const className = code?.properties?.className
  const language = (Array.isArray(className) ? className : []).map(String).find(name => name.startsWith('language-'))?.slice(9)
  async function copy() {
    try { await navigator.clipboard.writeText(textOf(code).replace(/\n$/, '')); setCopied(true); setTimeout(() => setCopied(false), 1600) }
    catch { setCopied(false) }
  }
  return <div className="code-block">
    <div className="code-toolbar"><span>{language || '代码'}</span><button type="button" onClick={copy} aria-label={copied ? '代码已复制' : '复制代码'}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button></div>
    <pre tabIndex={0}>{children}</pre>
  </div>
}

// Same-page links (footnotes) scroll inside the reader instead of changing the
// URL hash, which the site uses for article routing.
function scrollToFragment(event: MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault()
  const target = document.getElementById(decodeURIComponent(href.slice(1)))
  target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  if (target instanceof HTMLElement) { target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }) }
}

export default function MarkdownBody({ body }: { body: string }) {
  return <div className="markdown-body"><ReactMarkdown
    remarkPlugins={[remarkGfm, remarkCallouts]}
    rehypePlugins={[rehypeCodeHighlight]}
    remarkRehypeOptions={{ footnoteLabel: '注释与来源', footnoteBackLabel: '返回正文', footnoteLabelTagName: 'h4', footnoteLabelProperties: {} }}
    skipHtml
    urlTransform={(url, key) => safeURL(url, key === 'src')}
    components={{
      a: ({ href, children, node: _node, ...props }) => href?.startsWith('#')
        ? <a {...props} href={href} onClick={event => scrollToFragment(event, href)}>{children}</a>
        : href ? <a {...props} href={href} target="_blank" rel="noopener noreferrer">{children}<span className="external-mark" aria-hidden="true">↗</span></a> : <span className="unsafe-link">{children}</span>,
      pre: ({ node, children }) => <CodeBlock node={node as HastNode}>{children}</CodeBlock>,
      table: ({ children }) => <div className="table-scroll" role="region" aria-label="正文数据表格" tabIndex={0}><table>{children}</table></div>,
      aside: ({ node, children, className }) => <aside className={className} role="note" aria-label={String((node as HastNode)?.properties?.dataLabel || '提示')}><strong className="callout-label">{String((node as HastNode)?.properties?.dataLabel || '提示')}</strong>{children}</aside>,
      img: ({ src, alt, title }) => {
        if (!src || typeof src !== 'string') return <em className="unsafe-image">图片地址不安全，未加载。</em>
        const image = <img src={src} alt={alt || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        return <span className="markdown-image">{src.startsWith('/media/') ? <a href={src} target="_blank" rel="noopener" aria-label={`查看原图：${alt || title || '图片'}`}>{image}</a> : image}{title && <small>{title}</small>}</span>
      },
    }}
  >{body}</ReactMarkdown></div>
}
