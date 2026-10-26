package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

const siteTitle = "模型智见 · AI 模型新闻、评测与社区评价"
const siteDescription = "模型智见：AI 模型发布、评测解读和社区评价。官方信息、社区体验与编辑观点分开呈现，附原始资料、数据表格与核验日期。"

// Every selector is scoped to the removable fallback, never the React root.
const fallbackCSS = `<style id="server-content-style">
#server-content{box-sizing:border-box;max-width:1000px;margin:0 auto;padding:28px 20px 56px;background:#fff;color:#171717;font:16px/1.8 system-ui,-apple-system,"PingFang SC",sans-serif;overflow-wrap:anywhere}
#server-content *{box-sizing:border-box;min-width:0}#server-content a{color:#175cbd;text-decoration:underline;text-underline-offset:3px}#server-content h1,#server-content h2,#server-content h3{line-height:1.4;color:#111}#server-content h1{font-size:clamp(25px,5vw,38px)}#server-content h2{font-size:23px}#server-content nav,#server-content .meta{font-size:14px;color:#555}#server-content nav{display:flex;flex-wrap:wrap;gap:16px;border-bottom:1px solid #ddd;padding-bottom:16px}#server-content article,#server-content section{margin:28px 0}#server-content .news-item{padding-bottom:24px;border-bottom:1px solid #ddd}#server-content .summary{font-size:18px;color:#444}#server-content .takeaway{border-left:3px solid #175cbd;padding:12px 18px;background:#f3f7fc}#server-content p{white-space:pre-line}#server-content img{display:block;max-width:100%;height:auto}#server-content figure{margin:24px 0}#server-content figcaption{font-size:14px;color:#555}#server-content table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:16px 0;white-space:normal}#server-content th,#server-content td{border:1px solid #ddd;padding:8px 12px;text-align:left;min-width:90px}#server-content caption{font-weight:600;text-align:left}#server-content pre{max-width:100%;overflow-x:auto;background:#f4f4f4;padding:16px;line-height:1.6}#server-content code{font-size:14px;white-space:pre}#server-content blockquote{margin:20px 0;border-left:3px solid #999;padding:8px 18px;background:#fafafa}#server-content .sources li{margin:12px 0}#server-content .sources a{overflow-wrap:anywhere}#server-content .task-mark{font-family:monospace}#server-content .footnotes{font-size:14px;border-top:1px solid #ddd}#server-content .section-text{white-space:pre-line}@media(max-width:480px){#server-content{padding:18px 12px 36px}#server-content h2{font-size:21px}#server-content th,#server-content td{padding:6px 8px}}
#server-content :not(pre)>code{white-space:break-spaces;overflow-wrap:anywhere}
</style>`

var seoFootnoteURL = regexp.MustCompile(`^#(?:fn|fnref)[:-][A-Za-z0-9:_-]+$`)

// Markdown destinations can contain character references or escaped punctuation.
// Normalize those before validating, then assign the validated value to the AST.
// Percent-decoding is used for inspection too, not to change the resource URL.
func seoURL(raw string, image bool) (string, bool) {
	s := html.UnescapeString(string(util.UnescapePunctuations([]byte(raw))))
	decoded, err := url.PathUnescape(s)
	if err != nil {
		return "", false
	}
	for _, candidate := range []string{s, decoded} {
		for _, c := range candidate {
			if unicode.IsSpace(c) || unicode.IsControl(c) || c == '\\' {
				return "", false
			}
		}
	}
	if image && mediaPattern.MatchString(s) {
		return s, true
	}
	if !image && seoFootnoteURL.MatchString(s) {
		return s, true
	}
	u, err := url.Parse(s)
	if err != nil || u.User != nil || strings.HasPrefix(s, "//") {
		return "", false
	}
	scheme := strings.ToLower(u.Scheme)
	if image {
		return s, scheme == "https" && u.Hostname() != "" && u.Opaque == ""
	}
	if scheme == "mailto" {
		return s, u.Opaque != "" && !strings.HasPrefix(u.Opaque, "//")
	}
	return s, (scheme == "http" || scheme == "https") && u.Hostname() != "" && u.Opaque == ""
}

// GFM task lists remain readable but are not form fields in the fallback.
type seoTaskRenderer struct{}

func (seoTaskRenderer) RegisterFuncs(r renderer.NodeRendererFuncRegisterer) {
	r.Register(extast.KindTaskCheckBox, func(w util.BufWriter, _ []byte, n ast.Node, entering bool) (ast.WalkStatus, error) {
		if entering {
			mark, label := "[ ]", "未完成"
			if n.(*extast.TaskCheckBox).IsChecked {
				mark, label = "[x]", "已完成"
			}
			_, err := fmt.Fprintf(w, `<span class="task-mark" aria-label="%s">%s</span> `, label, mark)
			return ast.WalkContinue, err
		}
		return ast.WalkContinue, nil
	})
}

// A fresh parser/renderer per call avoids sharing mutable extension state across
// concurrent requests. Raw HTML and user-supplied attributes are never enabled.
func renderSEOMarkdown(body string) string {
	md := goldmark.New(goldmark.WithExtensions(extension.GFM, extension.Footnote),
		goldmark.WithRendererOptions(renderer.WithNodeRenderers(util.Prioritized(seoTaskRenderer{}, 100))))
	source := []byte(body)
	doc := md.Parser().Parse(text.NewReader(source))
	var invalid []ast.Node
	_ = ast.Walk(doc, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch v := n.(type) {
		case *ast.Link:
			if dest, ok := seoURL(string(v.Destination), false); ok {
				v.Destination = []byte(dest)
			} else {
				invalid = append(invalid, n)
			}
		case *ast.Image:
			if dest, ok := seoURL(string(v.Destination), true); ok {
				v.Destination = []byte(dest)
			} else {
				invalid = append(invalid, n)
			}
		case *ast.AutoLink:
			if _, ok := seoURL(string(v.URL(source)), false); !ok {
				invalid = append(invalid, n)
			}
		}
		return ast.WalkContinue, nil
	})
	// Unwrap invalid links/images, preserving their readable label/alt children.
	for _, n := range invalid {
		p := n.Parent()
		if p == nil {
			continue
		}
		if a, ok := n.(*ast.AutoLink); ok {
			p.InsertBefore(p, n, ast.NewString(a.Label(source)))
		} else {
			for child := n.FirstChild(); child != nil; child = n.FirstChild() {
				n.RemoveChild(n, child)
				p.InsertBefore(p, n, child)
			}
		}
		p.RemoveChild(p, n)
	}
	var out bytes.Buffer
	if err := md.Renderer().Render(&out, source, doc); err != nil {
		return "<p>" + html.EscapeString(body) + "</p>"
	}
	return out.String()
}

func fallbackNav() string {
	return `<nav aria-label="站点导航"><a href="/">模型智见</a><a href="/rss.xml">RSS 订阅</a><a href="/admin">管理</a></nav>`
}

func renderSEOHome(c Content) string {
	var b strings.Builder
	b.WriteString(`<main id="server-content" data-page="home">` + fallbackNav() + `<header><h1>模型智见</h1><p class="summary">AI 模型发布、评测解读与社区评价</p></header>`)
	articles := sortedPublished(c)
	// Keep chronological order except for the explicitly selected headline.
	for i, a := range articles {
		if a.ID == c.FeaturedID && i > 0 {
			copy(articles[1:i+1], articles[:i])
			articles[0] = a
			break
		}
	}
	if len(articles) == 0 {
		b.WriteString(`<p>暂无已发布文章。</p>`)
	}
	for _, a := range articles {
		b.WriteString(`<article class="news-item"><p class="meta">` + html.EscapeString(a.Category))
		if a.PublishedAt != "" {
			b.WriteString(` · <time>` + html.EscapeString(a.PublishedAt) + `</time>`)
		}
		b.WriteString(`</p><h2><a href="/a/` + html.EscapeString(a.ID) + `">` + html.EscapeString(a.Title) + `</a></h2><p>` + html.EscapeString(a.Description) + `</p></article>`)
	}
	b.WriteString(`</main>`)
	return b.String()
}

func renderSEOArticle(a Article) string {
	e := html.EscapeString
	var b strings.Builder
	b.WriteString(`<main id="server-content" data-page="article">` + fallbackNav() + `<article><header><p class="meta">` + e(a.Category) + ` · ` + e(a.Model) + `</p><h1>` + e(a.Title) + `</h1><p class="summary">` + e(a.Description) + `</p>`)
	for _, item := range []struct{ label, value string }{{"发布", a.PublishedAt}, {"更新", a.UpdatedAt}, {"核验日期", a.VerifiedAt}, {"事件说明", a.EventNote}} {
		if item.value != "" {
			b.WriteString(`<p class="meta">` + item.label + `：` + e(item.value) + `</p>`)
		}
	}
	b.WriteString(`</header><p class="meta">根据下列公开资料撰写，非本站产品实测。价格、开放状态及帖子内容可能变化。</p>`)
	if a.Takeaway != "" {
		b.WriteString(`<aside class="takeaway"><h2>要点</h2><p>` + e(a.Takeaway) + `</p></aside>`)
	}
	if a.Highlight != "" {
		b.WriteString(`<p>` + e(a.Highlight) + `</p>`)
	}
	if a.Image != nil {
		b.WriteString(`<figure>`)
		if src, ok := seoURL(a.Image.URL, true); ok {
			b.WriteString(`<img src="` + e(src) + `" alt="` + e(a.Image.Alt) + `" />`)
		} else if a.Image.Alt != "" {
			b.WriteString(`<p>` + e(a.Image.Alt) + `</p>`)
		}
		if a.Image.Caption != "" {
			b.WriteString(`<figcaption>` + e(a.Image.Caption) + `</figcaption>`)
		}
		b.WriteString(`</figure>`)
	}
	if a.Body != "" {
		b.WriteString(`<div class="markdown">` + renderSEOMarkdown(a.Body) + `</div>`)
	}
	for _, s := range a.Sections {
		b.WriteString(`<section>`)
		if s.Heading != "" {
			b.WriteString(`<h2>` + e(s.Heading) + `</h2>`)
		}
		if s.Text != "" {
			b.WriteString(`<p class="section-text">` + e(s.Text) + `</p>`)
		}
		if len(s.SourceNumbers) > 0 {
			b.WriteString(`<p class="meta">资料编号：`)
			for i, n := range s.SourceNumbers {
				if i > 0 {
					b.WriteString(`、`)
				}
				b.WriteString(strconv.Itoa(n))
			}
			b.WriteString(`</p>`)
		}
		if t := s.Table; t != nil {
			b.WriteString(`<table>`)
			if t.Caption != "" {
				b.WriteString(`<caption>` + e(t.Caption) + `</caption>`)
			}
			b.WriteString(`<thead><tr>`)
			for _, col := range t.Columns {
				b.WriteString(`<th scope="col">` + e(col) + `</th>`)
			}
			b.WriteString(`</tr></thead><tbody>`)
			for _, row := range t.Rows {
				b.WriteString(`<tr>`)
				for _, cell := range row {
					b.WriteString(`<td>` + e(cell) + `</td>`)
				}
				b.WriteString(`</tr>`)
			}
			b.WriteString(`</tbody></table>`)
			if t.Note != "" {
				b.WriteString(`<p class="meta">` + e(t.Note) + `</p>`)
			}
		}
		if c := s.Chart; c != nil {
			b.WriteString(`<figure><table><caption>` + e(c.Title) + `</caption><thead><tr><th scope="col">项目</th><th scope="col">数值`)
			if c.Unit != "" {
				b.WriteString(`（` + e(c.Unit) + `）`)
			}
			b.WriteString(`</th></tr></thead><tbody>`)
			for _, row := range c.Rows {
				b.WriteString(`<tr><th scope="row">` + e(row.Label) + `</th><td>` + e(strconv.FormatFloat(row.Value, 'f', -1, 64)) + `</td></tr>`)
			}
			b.WriteString(`</tbody></table><figcaption>`)
			if c.Max != 0 {
				b.WriteString(`图表量程：` + e(strconv.FormatFloat(c.Max, 'f', -1, 64)) + ` ` + e(c.Unit) + `。`)
			}
			b.WriteString(e(c.Note) + `</figcaption></figure>`)
		}
		b.WriteString(`</section>`)
	}
	if a.Quote != "" {
		b.WriteString(`<aside><h2>编辑观点</h2><blockquote><p>` + e(a.Quote) + `</p></blockquote><p class="meta">编辑意见，不代表独立测试结论。</p></aside>`)
	}
	if len(a.Sources) > 0 {
		b.WriteString(`<section class="sources"><h2>原始资料与来源</h2><ol>`)
		for _, s := range a.Sources {
			b.WriteString(`<li>`)
			if href, ok := seoURL(s.URL, false); ok {
				b.WriteString(`<a href="` + e(href) + `" rel="noopener noreferrer">` + e(s.Label) + `</a><br><span>` + e(s.URL) + `</span>`)
			} else {
				b.WriteString(e(s.Label))
			}
			if label := map[string]string{"official": "官方资料", "benchmark": "独立评测", "community": "社区原帖"}[s.Kind]; label != "" {
				b.WriteString(` <span class="meta">（` + label + `）</span>`)
			}
			b.WriteString(`</li>`)
		}
		b.WriteString(`</ol><p class="meta">厂商成绩不等于独立实测，社区个体体验不代表共识，编辑观点不等同于事实。图表由本站依据所列资料绘制，算术示例单独标注。</p></section>`)
	}
	b.WriteString(`</article></main>`)
	return b.String()
}

func seoDate(s string) (time.Time, bool) {
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// Verification date and request time are not publication/modification dates.
func seoLastModified(a Article) string {
	latest := ""
	var when time.Time
	for _, s := range []string{a.PublishedAt, a.UpdatedAt} {
		if t, ok := seoDate(s); ok && (latest == "" || t.After(when)) {
			latest, when = s, t
		}
	}
	return latest
}

func seoStructuredData(base string, a *Article) string {
	org := map[string]any{"@type": "Organization", "@id": base + "/#organization", "name": "模型智见", "url": base + "/"}
	website := map[string]any{"@type": "WebSite", "@id": base + "/#website", "name": "模型智见", "url": base + "/", "inLanguage": "zh-CN", "publisher": map[string]string{"@id": base + "/#organization"}}
	graph := []any{org, website}
	if a != nil {
		link := base + "/a/" + a.ID
		article := map[string]any{"@type": "Article", "@id": link + "#article", "url": link, "mainEntityOfPage": link, "headline": a.Title, "description": a.Description, "inLanguage": "zh-CN", "articleSection": a.Category, "author": map[string]string{"@id": base + "/#organization"}, "publisher": map[string]string{"@id": base + "/#organization"}, "isPartOf": map[string]string{"@id": base + "/#website"}}
		if _, ok := seoDate(a.PublishedAt); ok {
			article["datePublished"] = a.PublishedAt
		}
		if _, ok := seoDate(a.UpdatedAt); ok {
			article["dateModified"] = seoLastModified(*a)
		}
		if a.Image != nil {
			if image, ok := seoURL(a.Image.URL, true); ok {
				if strings.HasPrefix(image, "/media/") {
					image = base + image
				}
				article["image"] = image
			}
		}
		graph = append(graph, article, map[string]any{"@type": "BreadcrumbList", "itemListElement": []any{
			map[string]any{"@type": "ListItem", "position": 1, "name": "模型智见", "item": base + "/"},
			map[string]any{"@type": "ListItem", "position": 2, "name": a.Title, "item": link},
		}})
	}
	// Marshal's default HTML escaping keeps even </script> inside JSON strings.
	b, err := json.Marshal(map[string]any{"@context": "https://schema.org", "@graph": graph})
	if err != nil {
		return ""
	}
	return `<script type="application/ld+json" id="site-structured-data">` + string(b) + `</script>`
}

func seoMetadata(base string, a *Article, missing bool) string {
	e := html.EscapeString
	title, description, link, typ := siteTitle, siteDescription, base+"/", "website"
	if missing {
		return `<title>文章不存在或已撤回 · 模型智见</title><meta name="description" content="文章不存在或已撤回" /><meta name="robots" content="noindex" />`
	}
	if a != nil {
		title, description, link, typ = a.Title+" · 模型智见", a.Description, base+"/a/"+a.ID, "article"
	}
	meta := `<title>` + e(title) + `</title><meta name="description" content="` + e(description) + `" /><link rel="canonical" href="` + e(link) + `" /><link rel="alternate" type="application/rss+xml" title="模型智见" href="/rss.xml" />`
	ogTitle := title
	if a != nil {
		ogTitle = a.Title
	}
	for _, item := range []struct{ name, value string }{{"og:type", typ}, {"og:site_name", "模型智见"}, {"og:title", ogTitle}, {"og:description", description}, {"og:url", link}} {
		meta += `<meta property="` + item.name + `" content="` + e(item.value) + `" />`
	}
	card := "summary"
	if a != nil {
		if a.Image != nil {
			if image, ok := seoURL(a.Image.URL, true); ok {
				if strings.HasPrefix(image, "/media/") {
					image = base + image
				}
				meta += `<meta property="og:image" content="` + e(image) + `" /><meta name="twitter:image" content="` + e(image) + `" />`
				card = "summary_large_image"
			}
		}
		if _, ok := seoDate(a.PublishedAt); ok {
			meta += `<meta property="article:published_time" content="` + e(a.PublishedAt) + `" />`
		}
		if _, ok := seoDate(a.UpdatedAt); ok {
			meta += `<meta property="article:modified_time" content="` + e(seoLastModified(*a)) + `" />`
		}
	}
	for _, item := range []struct{ name, value string }{{"twitter:card", card}, {"twitter:title", ogTitle}, {"twitter:description", description}} {
		meta += `<meta name="` + item.name + `" content="` + e(item.value) + `" />`
	}
	return meta + seoStructuredData(base, a)
}

// The template is trusted application markup, not article HTML. Replace its SEO
// tags centrally while retaining the existing root, assets and module scripts.
var seoTitleTag = regexp.MustCompile(`(?is)<title\b[^>]*>.*?</title\s*>`)
var seoMetaTag = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
var seoLinkTag = regexp.MustCompile(`(?is)<link\b[^>]*>`)
var seoAttr = regexp.MustCompile(`(?i)([a-z_:][a-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))`)
var seoScriptTag = regexp.MustCompile(`(?is)<script\b[^>]*>.*?</script\s*>`)
var seoStyleTag = regexp.MustCompile(`(?is)<style\b[^>]*>.*?</style\s*>`)
var seoHeadEnd = regexp.MustCompile(`(?i)</head\s*>`)
var seoBodyStart = regexp.MustCompile(`(?i)<body\b[^>]*>`)
var seoHTMLStart = regexp.MustCompile(`(?i)<html\b[^>]*>`)
var seoDoctype = regexp.MustCompile(`(?i)<!doctype\b[^>]*>`)

func seoAttrs(tag string) map[string]string {
	attrs := map[string]string{}
	for _, m := range seoAttr.FindAllStringSubmatch(tag, -1) {
		attrs[strings.ToLower(m[1])] = html.UnescapeString(m[2] + m[3] + m[4])
	}
	return attrs
}

func injectSEOPage(page, metadata, fallback string) string {
	page = seoTitleTag.ReplaceAllString(page, "")
	page = seoMetaTag.ReplaceAllStringFunc(page, func(tag string) string {
		a := seoAttrs(tag)
		for _, key := range []string{"name", "property"} {
			v := strings.ToLower(a[key])
			if v == "description" || v == "robots" || strings.HasPrefix(v, "og:") || strings.HasPrefix(v, "twitter:") || strings.HasPrefix(v, "article:") {
				return ""
			}
		}
		return tag
	})
	page = seoLinkTag.ReplaceAllStringFunc(page, func(tag string) string {
		a := seoAttrs(tag)
		if strings.EqualFold(a["rel"], "canonical") || (strings.EqualFold(a["rel"], "alternate") && strings.EqualFold(a["type"], "application/rss+xml")) {
			return ""
		}
		return tag
	})
	page = seoScriptTag.ReplaceAllStringFunc(page, func(tag string) string {
		if strings.EqualFold(seoAttrs(tag)["type"], "application/ld+json") {
			return ""
		}
		return tag
	})
	page = seoStyleTag.ReplaceAllStringFunc(page, func(tag string) string {
		if seoAttrs(tag)["id"] == "server-content-style" {
			return ""
		}
		return tag
	})
	head := metadata + fallbackCSS
	if at := seoHeadEnd.FindStringIndex(page); at != nil {
		page = page[:at[0]] + head + page[at[0]:]
	} else {
		at := 0
		if m := seoHTMLStart.FindStringIndex(page); m != nil {
			at = m[1]
		} else if m := seoDoctype.FindStringIndex(page); m != nil {
			at = m[1]
		}
		page = page[:at] + "<head>" + head + "</head>" + page[at:]
	}
	if at := seoBodyStart.FindStringIndex(page); at != nil {
		return page[:at[1]] + fallback + page[at[1]:]
	}
	at := seoHeadEnd.FindStringIndex(page)
	return page[:at[1]] + fallback + page[at[1]:]
}

func (app *App) serveSEOPage(w http.ResponseWriter, r *http.Request, a *Article, missing bool) {
	f, err := openRegular(app.webDir, "index.html")
	if err != nil {
		apiError(w, 404, "not found")
		return
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, maxRequest+1))
	if err != nil || len(b) > maxRequest {
		apiError(w, 500, "unable to read page")
		return
	}
	var fallback string
	code := 200
	if missing {
		code = 404
		w.Header().Set("X-Robots-Tag", "noindex")
		fallback = `<main id="server-content" data-page="not-found">` + fallbackNav() + `<h1>文章不存在或已撤回</h1><p>请返回首页浏览已发布文章。</p></main>`
	} else if a != nil {
		fallback = renderSEOArticle(*a)
	} else {
		fallback = renderSEOHome(app.store.snapshot(true))
	}
	page := injectSEOPage(string(b), seoMetadata(siteBase(r), a, missing), fallback)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Length", strconv.Itoa(len(page)))
	w.WriteHeader(code)
	if r.Method != "HEAD" {
		_, _ = io.WriteString(w, page)
	}
}

type seoSitemapURL struct {
	Location string `xml:"loc"`
	LastMod  string `xml:"lastmod,omitempty"`
}

func (app *App) serveSitemap(w http.ResponseWriter, r *http.Request) {
	base := siteBase(r)
	doc := struct {
		XMLName xml.Name        `xml:"urlset"`
		XMLNS   string          `xml:"xmlns,attr"`
		URLs    []seoSitemapURL `xml:"url"`
	}{XMLNS: "http://www.sitemaps.org/schemas/sitemap/0.9", URLs: []seoSitemapURL{{Location: base + "/"}}}
	for _, a := range sortedPublished(app.store.snapshot(true)) {
		doc.URLs = append(doc.URLs, seoSitemapURL{Location: base + "/a/" + a.ID, LastMod: seoLastModified(a)})
	}
	b, err := xml.MarshalIndent(doc, "", "  ")
	if err != nil {
		apiError(w, 500, "unable to render sitemap")
		return
	}
	b = append([]byte(xml.Header), b...)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	if r.Method != "HEAD" {
		_, _ = w.Write(b)
	}
}

func (app *App) serveRobots(w http.ResponseWriter, r *http.Request) {
	body := "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /healthz\nSitemap: " + siteBase(r) + "/sitemap.xml\n"
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	if r.Method != "HEAD" {
		_, _ = io.WriteString(w, body)
	}
}
