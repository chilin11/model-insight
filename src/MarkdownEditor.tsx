import { lazy, Suspense, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Bold, Columns2, Eye, Heading2, Heading3, ImagePlus, Info, Italic, Link, List, ListOrdered, Minus, PenLine, Quote, Code, SquareCode, Strikethrough, Superscript, Table } from 'lucide-react'

const MarkdownBody = lazy(() => import('./MarkdownBody'))
type Mode = 'write' | 'split' | 'preview'
type Props = {
  value: string
  onChange: (value: string) => void
  onUpload: (file: File) => Promise<string>
  onError: (message: string) => void
  disabled?: boolean
  uploading?: boolean
}

export const countWords = (text: string) => {
  const plain = text.replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~|-]/g, ' ')
  const cjk = plain.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0
  const latin = plain.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9'.-]*/g)?.length || 0
  return cjk + latin
}
export const readingMinutes = (words: number) => Math.max(1, Math.round(words / 400))

export default function MarkdownEditor({ value, onChange, onUpload, onError, disabled, uploading }: Props) {
  const area = useRef<HTMLTextAreaElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('write')
  const [dragging, setDragging] = useState(false)
  const words = countWords(value)

  // execCommand keeps the browser's native undo history; fall back to a plain update.
  function replace(start: number, end: number, text: string, selectStart?: number, selectEnd?: number) {
    const element = area.current
    if (!element) return
    element.focus()
    element.setSelectionRange(start, end)
    const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!inserted || element.value !== value.slice(0, start) + text + value.slice(end)) {
      const next = value.slice(0, start) + text + value.slice(end)
      onChange(next)
    }
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(start + (selectStart ?? text.length), start + (selectEnd ?? selectStart ?? text.length))
    })
  }
  function selection() {
    const element = area.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    return { start, end, text: value.slice(start, end) }
  }
  function wrap(before: string, after: string, placeholder: string) {
    const { start, end, text } = selection()
    const inner = text || placeholder
    replace(start, end, before + inner + after, before.length, before.length + inner.length)
  }
  function block(prefix: (index: number) => string, placeholder: string) {
    const { start, end, text } = selection()
    const lineStart = value.lastIndexOf('\n', start - 1) + 1
    const chosen = value.slice(lineStart, end) || (text ? '' : placeholder)
    const lines = (chosen || placeholder).split('\n')
    const lead = lineStart > 0 && value[lineStart - 1] !== '\n' ? '\n' : ''
    const result = lead + lines.map((line, i) => prefix(i) + line.replace(/^(#{1,6} |> |- |\d+\. )/, '')).join('\n')
    replace(lineStart, Math.max(end, lineStart), result, result.length, result.length)
  }
  function insertBlock(text: string, selectFrom?: number, selectTo?: number) {
    const { start, end } = selection()
    const before = start > 0 && value[start - 1] !== '\n' ? '\n\n' : start > 1 && value[start - 2] !== '\n' ? '\n' : ''
    const after = value.slice(end).startsWith('\n\n') ? '' : '\n\n'
    replace(start, end, before + text + after, selectFrom === undefined ? undefined : before.length + selectFrom, selectTo === undefined ? undefined : before.length + selectTo)
  }
  function link() {
    const { start, end, text } = selection()
    const url = window.prompt('链接地址（https://…）', 'https://')
    if (!url || url === 'https://') return
    if (!/^(https?:\/\/|mailto:|#)/i.test(url.trim())) { onError('链接必须以 https://、http://、mailto: 或 # 开头。'); return }
    const label = text || '链接文字'
    replace(start, end, `[${label}](${url.trim()})`, 1, 1 + label.length)
  }
  function codeBlock() {
    const { text } = selection()
    const body = text || '在这里粘贴代码'
    insertBlock('```text\n' + body + '\n```', 3, 7)
  }
  function footnote() {
    const used = [...value.matchAll(/\[\^(\d+)\]/g)].map(match => Number(match[1]))
    const n = used.length ? Math.max(...used) + 1 : 1
    // Insert after the selection so selected text is kept, and add the definition at the end.
    const { end } = selection()
    const marker = `[^${n}]`
    const note = `\n\n${marker}: 来源说明，例如 [资料标题](https://example.com)`
    const next = value.slice(0, end) + marker + value.slice(end) + (value.endsWith('\n') ? note.slice(1) : note)
    onChange(next)
    requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(end + marker.length, end + marker.length) })
  }
  async function uploadFiles(files: FileList | File[]) {
    const images = [...files].filter(item => item.type.startsWith('image/'))
    if (!images.length) return
    const { start, end } = selection()
    let inserted = ''
    for (const image of images) {
      try {
        const url = await onUpload(image)
        inserted += `![请填写图片描述](${url} "图片说明与出处")\n\n`
      } catch (reason) { onError(reason instanceof Error ? reason.message : '图片上传失败') }
    }
    if (inserted) {
      const before = start > 0 && value[start - 1] !== '\n' ? '\n\n' : ''
      replace(start, end, before + inserted, before.length + 2, before.length + 2 + '请填写图片描述'.length)
    }
  }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files].filter(item => item.type.startsWith('image/'))
    if (files.length) { event.preventDefault(); void uploadFiles(files) }
  }
  function onDrop(event: DragEvent<HTMLTextAreaElement>) {
    setDragging(false)
    if (event.dataTransfer.files.length) { event.preventDefault(); void uploadFiles(event.dataTransfer.files) }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) {
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && selection().text === '' && /```[^`]*$/.test(value.slice(0, selection().start))) { event.preventDefault(); wrap('  ', '', '') }
      return
    }
    const key = event.key.toLowerCase()
    if (key === 'b') { event.preventDefault(); wrap('**', '**', '加粗文字') }
    else if (key === 'i') { event.preventDefault(); wrap('*', '*', '斜体文字') }
    else if (key === 'k') { event.preventDefault(); link() }
    else if (key === 'e') { event.preventDefault(); wrap('`', '`', 'code') }
  }

  const tools: [string, ReactNode, () => void][] = [
    ['二级标题', <Heading2 size={17} />, () => block(() => '## ', '小标题')],
    ['三级标题', <Heading3 size={17} />, () => block(() => '### ', '小节标题')],
    ['加粗（⌘B）', <Bold size={16} />, () => wrap('**', '**', '加粗文字')],
    ['斜体（⌘I）', <Italic size={16} />, () => wrap('*', '*', '斜体文字')],
    ['删除线', <Strikethrough size={16} />, () => wrap('~~', '~~', '删除文字')],
    ['链接（⌘K）', <Link size={16} />, link],
    ['引用', <Quote size={16} />, () => block(() => '> ', '引用原文，并在后面注明出处')],
    ['提示框', <Info size={16} />, () => insertBlock('> [!NOTE]\n> 需要读者特别注意的说明', 12, 24)],
    ['行内代码（⌘E）', <Code size={16} />, () => wrap('`', '`', 'code')],
    ['代码块', <SquareCode size={16} />, codeBlock],
    ['无序列表', <List size={16} />, () => block(() => '- ', '列表项')],
    ['有序列表', <ListOrdered size={16} />, () => block(i => `${i + 1}. `, '列表项')],
    ['表格', <Table size={16} />, () => insertBlock('| 项目 | 数据 | 口径 / 来源 |\n| --- | --- | --- |\n| 示例 | 0 | 来源 [1] |', 2, 4)],
    ['脚注 / 引用来源', <Superscript size={16} />, footnote],
    ['分隔线', <Minus size={16} />, () => insertBlock('---')],
  ]

  const editor = <textarea id="article-body" ref={area} className={`admin-markdown ${dragging ? 'is-dragging' : ''}`} value={value} maxLength={150_000} rows={18} spellCheck={false} disabled={disabled}
    placeholder={'## 发生了什么\n\n在这里开始写作。可直接粘贴或拖入图片。\n\n> 引用原文\n\n```bash\n代码\n```'}
    onChange={event => onChange(event.target.value)} onPaste={onPaste} onKeyDown={onKeyDown}
    onDragOver={event => { if ([...event.dataTransfer.types].includes('Files')) { event.preventDefault(); setDragging(true) } }}
    onDragLeave={() => setDragging(false)} onDrop={onDrop} aria-describedby="editor-help" />
  const preview = <div className="editor-preview reader-body" aria-label="正文实时预览">{value.trim() ? <Suspense fallback={<p className="admin-help">正在加载预览…</p>}><MarkdownBody body={value} /></Suspense> : <p className="admin-help">正文为空。开始写作后，这里会显示读者看到的效果。</p>}</div>

  return <div className={`markdown-editor mode-${mode}`}>
    <div className="editor-toolbar" role="toolbar" aria-label="正文格式">
      <div className="editor-tools">{tools.map(([label, icon, run]) => <button type="button" key={label} title={label} aria-label={label} disabled={disabled || mode === 'preview'} onMouseDown={event => event.preventDefault()} onClick={run}>{icon}</button>)}
        <button type="button" title="上传并插入图片" aria-label="上传并插入图片" disabled={disabled || mode === 'preview'} onClick={() => file.current?.click()}><ImagePlus size={16} /></button>
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/gif" multiple onChange={event => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = '' }} />
      </div>
      <div className="editor-modes" role="group" aria-label="编辑视图">
        <button type="button" aria-pressed={mode === 'write'} onClick={() => setMode('write')}><PenLine size={14} />编写</button>
        <button type="button" className="split-mode" aria-pressed={mode === 'split'} onClick={() => setMode('split')}><Columns2 size={14} />分屏</button>
        <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}><Eye size={14} />效果</button>
      </div>
    </div>
    <div className="editor-panes">{mode !== 'preview' && editor}{mode !== 'write' && preview}</div>
    <div className="editor-status" id="editor-help"><span>{uploading ? '图片上传中…' : '支持 Markdown；可粘贴或拖入图片'}</span><span>{words.toLocaleString()} 字 · 约 {readingMinutes(words)} 分钟</span></div>
  </div>
}
