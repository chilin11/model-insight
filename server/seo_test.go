package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
)

const seoTestTemplate = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Old title</title><meta content='OLD DESCRIPTION' name='description'><link href='/old' rel='canonical'><meta property="og:title" content="OLD OG"><meta name="twitter:card" content="old"><link rel="alternate" type="application/rss+xml" href="/old-rss"><script type="application/ld+json">{"old":true}</script><link rel="stylesheet" href="/assets/app-12345678.css"></head><body><div id="root"></div><script type="module" src="/assets/app-12345678.js"></script></body></html>`

func seoFixture(t *testing.T) *App {
	t.Helper()
	app := fixture(t)
	if err := os.WriteFile(filepath.Join(app.webDir, "index.html"), []byte(seoTestTemplate), 0600); err != nil {
		t.Fatal(err)
	}
	return app
}

func seoRequest(app *App, target, ua string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", target, nil)
	r.Header.Set("User-Agent", ua)
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	return w
}

func seoRequireText(t *testing.T, text string, values ...string) {
	t.Helper()
	for _, value := range values {
		if !strings.Contains(text, value) {
			t.Fatalf("missing %q in response:\n%s", value, text)
		}
	}
}

func seoGraph(t *testing.T, page string) map[string]map[string]any {
	t.Helper()
	re := regexp.MustCompile(`(?s)<script type="application/ld\+json" id="site-structured-data">(.*?)</script>`)
	matches := re.FindAllStringSubmatch(page, -1)
	if len(matches) != 1 {
		t.Fatalf("want one JSON-LD graph, got %d", len(matches))
	}
	var doc struct {
		Context string           `json:"@context"`
		Graph   []map[string]any `json:"@graph"`
	}
	if err := json.Unmarshal([]byte(matches[0][1]), &doc); err != nil || doc.Context != "https://schema.org" {
		t.Fatalf("invalid structured data: %v %s", err, matches[0][1])
	}
	graph := map[string]map[string]any{}
	for _, entry := range doc.Graph {
		graph[entry["@type"].(string)] = entry
	}
	return graph
}

func TestSEOHomeInitialHTMLAllPublishedAndEmpty(t *testing.T) {
	app := seoFixture(t)
	app.store.mu.Lock()
	for i := 0; i < 18; i++ {
		a := published(fmt.Sprintf("news-%02d", i))
		a.Title = fmt.Sprintf("真实新闻 %d", i)
		a.Description = fmt.Sprintf("完整摘要 %d", i)
		app.store.content.Articles = append(app.store.content.Articles, a)
	}
	app.store.content.FeaturedID = "news-17"
	app.store.content.Articles[1].Title = "PRIVATE DRAFT TITLE"
	app.store.content.Articles[1].Body = "PRIVATE DRAFT BODY"
	app.store.mu.Unlock()
	w := seoRequest(app, "https://news.example.test/?utm_source=test", "Mozilla/5.0")
	status(t, w, 200)
	page := w.Body.String()
	seoRequireText(t, page, `<main id="server-content" data-page="home">`, `<h1>模型智见</h1>`, `<h2><a href="/a/existing">`, `href="https://news.example.test/"`, `property="og:type" content="website"`, `name="twitter:card"`, `href="/rss.xml"`, `<div id="root"></div>`, `/assets/app-12345678.js`, `/assets/app-12345678.css`)
	for i := 0; i < 18; i++ {
		seoRequireText(t, page, fmt.Sprintf(`href="/a/news-%02d"`, i), fmt.Sprintf("真实新闻 %d", i), fmt.Sprintf("完整摘要 %d", i))
	}
	if strings.Index(page, `href="/a/news-17"`) > strings.Index(page, `href="/a/news-00"`) {
		t.Fatal("featured article was not the headline")
	}
	if strings.Index(page, `</main>`) > strings.Index(page, `<div id="root">`) {
		t.Fatal("server content was put inside the React root")
	}
	for _, forbidden := range []string{"PRIVATE", "secret-draft", "OLD DESCRIPTION", "OLD OG", "Old title", "utm_source", `<input`, `<form`} {
		if strings.Contains(page, forbidden) {
			t.Fatalf("unexpected private/stale/form content %q", forbidden)
		}
	}
	for _, tag := range []string{"<title>", `name="description"`, `rel="canonical"`, `type="application/rss+xml"`, `id="site-structured-data"`, `id="server-content"`} {
		if strings.Count(page, tag) != 1 {
			t.Fatalf("duplicate or missing %s", tag)
		}
	}
	graph := seoGraph(t, page)
	if len(graph) != 2 || graph["Organization"]["name"] != "模型智见" || graph["WebSite"]["url"] != "https://news.example.test/" {
		t.Fatalf("wrong home graph: %+v", graph)
	}
	for _, ua := range []string{"Googlebot", "curl/8", "", "Mozilla/5.0"} {
		if other := seoRequest(app, "https://news.example.test/", ua).Body.String(); other != page {
			t.Fatal("UA-dependent content or noncanonical tracking query")
		}
	}
	app.store.mu.Lock()
	app.store.content.Articles = []Article{{ID: "private", Status: "draft", Title: "PRIVATE"}}
	app.store.mu.Unlock()
	w = seoRequest(app, "https://news.example.test/", "Googlebot")
	status(t, w, 200)
	seoRequireText(t, w.Body.String(), "暂无已发布文章。")
	if strings.Contains(w.Body.String(), "PRIVATE") || strings.Contains(w.Body.String(), `href="/a/`) {
		t.Fatal("empty library fabricated public content")
	}
}

func TestSEOArticleFullLegacyMarkdownAndStructuredData(t *testing.T) {
	app := seoFixture(t)
	a := published("existing")
	a.Title = "完整标题 & 新闻"
	a.Description = "新闻摘要"
	a.PublishedAt = "2026-10-26T23:00:00+08:00"
	a.UpdatedAt = "2026-10-27T01:00:00+08:00"
	a.VerifiedAt = "2027-01-02"
	a.EventNote = "根据官方发布记录整理，未独立复测"
	a.Takeaway = "主要结论"
	a.Highlight = "补充强调"
	a.Image = &Image{URL: "/media/test-image.png", Alt: "真实图片说明", Caption: "真实图片来源图注"}
	a.Body = "## Markdown 小标题\n\n正文 **加粗** 与 ~~删除线~~，引用脚注[^note]。\n\n> Markdown 引用内容\n\n- [x] 已完成任务\n- [ ] 未完成任务\n\n| 模型 | 分数 |\n| --- | --- |\n| 模型 A | 91 |\n\n```html\n<script>alert('code')</script>\n```\n\n[资料](https://example.com/news?a=1&b=2) [邮件](mailto:reader@example.com)\n\n[^note]: 脚注完整内容\n"
	a.Sections = []Section{{Heading: "旧版完整内容", Text: "第一行旧版文本\n第二行保留", SourceNumbers: []int{1, 2}, Table: &Table{Caption: "旧版表格标题", Columns: []string{"指标", "结果"}, Rows: [][]string{{"准确率", "97.5%"}, {"延迟", "25ms"}}, Note: "表格口径说明"}, Chart: &Chart{Title: "旧版图表标题", Unit: "分", Max: 100, Rows: []ChartRow{{Label: "评估组 A", Value: 82.5}, {Label: "评估组 B", Value: 93}}, Note: "图表样本说明"}}}
	a.Quote = "主观编辑观点，不是测评成绩"
	a.Sources = append(a.Sources, Source{Label: "第二份社区资料", URL: "https://example.org/thread", Kind: "community"})
	app.store.mu.Lock()
	app.store.content.Articles[0] = a
	app.store.mu.Unlock()
	w := seoRequest(app, "https://news.example.test/a/existing?utm_campaign=x", "Googlebot")
	status(t, w, 200)
	page := w.Body.String()
	seoRequireText(t, page, `<main id="server-content" data-page="article">`, `<h1>完整标题 &amp; 新闻</h1>`, a.Description, a.EventNote, a.VerifiedAt, a.Takeaway, a.Highlight, `<img src="/media/test-image.png"`, a.Image.Alt, a.Image.Caption, `<h2>Markdown 小标题</h2>`, `<strong>加粗</strong>`, `<del>删除线</del>`, "Markdown 引用内容", "脚注完整内容", `href="#fn:1"`, `href="#fnref:1"`, "已完成任务", "未完成任务", `class="task-mark"`, "模型 A", "91", `&lt;script&gt;alert`, `href="mailto:reader@example.com"`, "旧版完整内容", "第一行旧版文本", "第二行保留", "旧版表格标题", "准确率", "97.5%", "25ms", "表格口径说明", "资料编号：1、2", "旧版图表标题", "评估组 A", "82.5", "评估组 B", "93", "100", "图表样本说明", "编辑观点", a.Quote, "Source", "第二份社区资料", "https://example.org/thread", `article:modified_time" content="2026-10-27T01:00:00+08:00"`, `rel="canonical" href="https://news.example.test/a/existing"`, `og:image" content="https://news.example.test/media/test-image.png"`)
	if strings.Contains(page, `<input`) || strings.Contains(page, `utm_campaign`) || strings.Contains(page, `<script>alert`) {
		t.Fatal("form/unsafe code/tracking URL leaked")
	}
	graph := seoGraph(t, page)
	article := graph["Article"]
	if article["headline"] != a.Title || article["description"] != a.Description || article["datePublished"] != a.PublishedAt || article["dateModified"] != a.UpdatedAt || article["url"] != "https://news.example.test/a/existing" || article["image"] != "https://news.example.test/media/test-image.png" {
		t.Fatalf("article schema mismatches actual article: %+v", article)
	}
	if graph["Organization"]["name"] != "模型智见" || !reflect.DeepEqual(article["author"], article["publisher"]) || graph["BreadcrumbList"] == nil {
		t.Fatalf("missing organization/breadcrumb: %+v", graph)
	}
	for _, key := range []string{"review", "aggregateRating", "rating", "verifiedAt"} {
		if _, ok := article[key]; ok {
			t.Fatalf("fabricated article schema field %s", key)
		}
	}
	if other := seoRequest(app, "https://news.example.test/a/existing", "Mozilla/5.0").Body.String(); other != page {
		t.Fatal("article content differs for browser and crawler")
	}
}

func TestSEOMarkdownURLPolicyAndEscaping(t *testing.T) {
	for _, raw := range []string{"javascript:alert(1)", "java&#x73;cript:alert(1)", "data:text/html,evil", "//evil.test/path", "https://user:pass@evil.test/", "https://example.com/a b", "https://example.com/%0aevil", "https://example.com/\tevil", "https:\\evil.test", "/relative", "#arbitrary", "vbscript:evil"} {
		t.Run(raw, func(t *testing.T) {
			if _, ok := seoURL(raw, false); ok {
				t.Fatalf("unsafe href accepted: %q", raw)
			}
			md := "before [preserve **link label**](<" + raw + ">) after"
			out := renderSEOMarkdown(md)
			if strings.Contains(out, "href=") || !strings.Contains(out, "before") || !strings.Contains(out, "link label") || !strings.Contains(out, "after") {
				t.Fatalf("unsafe URL rendered or lost label: %s", out)
			}
		})
	}
	for _, raw := range []string{"http://example.com/i.png", "data:image/svg+xml,evil", "//evil.test/i.png", "https://u:p@evil.test/i.png", "/media/../i.png", "/media/a.svg", "/media/a.png?x=1", "https://example.com/%20i.png"} {
		if _, ok := seoURL(raw, true); ok {
			t.Fatalf("unsafe src accepted: %q", raw)
		}
		out := renderSEOMarkdown("before ![preserve image alt](<" + raw + ">) after")
		if strings.Contains(out, "<img") || !strings.Contains(out, "preserve image alt") {
			t.Fatalf("unsafe image rendered or alt lost: %s", out)
		}
	}
	for _, raw := range []string{"http://example.com/a", "https://example.com/a?x=1&y=2", "mailto:reader@example.com", "#fn:1", "#fnref:1"} {
		if _, ok := seoURL(raw, false); !ok {
			t.Fatalf("safe href rejected: %s", raw)
		}
	}
	for _, raw := range []string{"https://example.com/a.png", "/media/image_01-abc.jpg"} {
		out := renderSEOMarkdown("![safe image](" + raw + ")")
		seoRequireText(t, out, `<img src="`+raw+`"`)
	}
	out := renderSEOMarkdown("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[entity](javascript&colon;alert%281%29) [escaped](java\\script:alert%281%29) <ftp://evil.test/file>\n\n```js\n</script><img src=x onerror=alert(1)>\n```\n\n![alt](https://example.com/a.png \"x\\\" onerror=\\\"evil\")")
	for _, forbidden := range []string{"<script>", "<img src=x", `href="javascript`, `href="ftp:`, `src="data:`, ` onerror="evil"`} {
		if strings.Contains(out, forbidden) {
			t.Fatalf("executable markup %q in %s", forbidden, out)
		}
	}
}

func TestSEOUntrustedFieldsAndJSONLDScriptCloser(t *testing.T) {
	app := seoFixture(t)
	attack := `</script><script>alert("x")</script><img src=x onerror=alert(1)> & "`
	a := published("existing")
	a.Title, a.Description, a.Takeaway, a.Highlight, a.EventNote, a.Quote = attack, attack, attack, attack, attack, attack
	a.Image = &Image{URL: "http://unsafe.test/image.png", Alt: attack, Caption: attack}
	a.Sections = []Section{{Heading: attack, Text: attack, Table: &Table{Caption: attack, Columns: []string{attack}, Rows: [][]string{{attack}}, Note: attack}, Chart: &Chart{Title: attack, Unit: attack, Rows: []ChartRow{{Label: attack, Value: 3}}, Note: attack}}}
	a.Sources = []Source{{Label: attack, URL: "javascript:alert(1)", Kind: attack}}
	app.store.mu.Lock()
	app.store.content.Articles[0] = a
	app.store.mu.Unlock()
	for _, path := range []string{"/", "/a/existing"} {
		w := seoRequest(app, "https://news.example.test"+path, "Googlebot")
		status(t, w, 200)
		page := w.Body.String()
		if strings.Contains(page, attack) || strings.Contains(page, `<script>alert`) || strings.Contains(page, `<img src=x`) || strings.Contains(page, `href="javascript:`) || strings.Contains(page, `src="http://unsafe`) {
			t.Fatalf("untrusted field executed: %s", page)
		}
		seoRequireText(t, page, html.EscapeString(attack))
		graph := seoGraph(t, page)
		if path != "/" {
			if graph["Article"]["headline"] != attack {
				t.Fatal("JSON-LD escaped content did not round trip")
			}
			if _, ok := graph["Article"]["image"]; ok {
				t.Fatal("unsafe image entered structured data")
			}
			seoRequireText(t, page, `\u003c/script\u003e`)
		}
		// Only the existing module script and inert JSON-LD script may exist.
		if len(seoScriptTag.FindAllString(page, -1)) != 2 {
			t.Fatal("unexpected injected script tag")
		}
	}
}

func TestSEONotFoundNoLeaksAndNoStaleCache(t *testing.T) {
	app := seoFixture(t)
	app.store.mu.Lock()
	app.store.content.Articles[1].Title = "PRIVATE-TITLE"
	app.store.content.Articles[1].Description = "PRIVATE-DESCRIPTION"
	app.store.content.Articles[1].Body = "PRIVATE-BODY"
	app.store.mu.Unlock()
	for _, id := range []string{"unknown", "secret-draft"} {
		w := seoRequest(app, "https://news.example.test/a/"+id, "Googlebot")
		status(t, w, 404)
		seoRequireText(t, w.Body.String(), `<main id="server-content" data-page="not-found">`, "文章不存在或已撤回", `<div id="root"></div>`)
		if w.Header().Get("X-Robots-Tag") != "noindex" || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
			t.Fatal("404 can be indexed or negatively cached")
		}
		for _, private := range []string{"PRIVATE", "og:title", "site-structured-data", `rel="canonical"`, "OLD"} {
			if strings.Contains(w.Body.String(), private) {
				t.Fatalf("404 leaked %q", private)
			}
		}
	}
	cookie := login(t, app)
	a := published("unknown")
	status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": a}, cookie), 201)
	w := seoRequest(app, "https://news.example.test/a/unknown", "Googlebot")
	status(t, w, 200)
	if w.Header().Get("X-Robots-Tag") != "" {
		t.Fatal("newly published article inherited 404 robots header")
	}
}

func TestSEOSitemapEscapingDatesAndCMSFreshness(t *testing.T) {
	app := seoFixture(t)
	app.store.mu.Lock()
	app.store.content.Articles[0].PublishedAt = "2026-10-27T02:00:00+08:00"
	app.store.content.Articles[0].UpdatedAt = "2026-10-26T21:00:00Z" // Later instant, despite the lexical date.
	app.store.content.Articles[0].VerifiedAt = "2099-01-01"
	app.store.content.Articles = append(app.store.content.Articles, Article{ID: "no-date", Status: "published", Title: "No date"})
	app.store.mu.Unlock()
	w := seoRequest(app, "https://news.example.test/sitemap.xml?tracking=x", "Googlebot")
	status(t, w, 200)
	var doc struct {
		XMLName xml.Name
		URLs    []seoSitemapURL `xml:"url"`
	}
	if err := xml.Unmarshal(w.Body.Bytes(), &doc); err != nil || doc.XMLName.Space != "http://www.sitemaps.org/schemas/sitemap/0.9" || len(doc.URLs) != 3 {
		t.Fatalf("invalid sitemap: %v %s", err, w.Body.String())
	}
	if doc.URLs[0].Location != "https://news.example.test/" || doc.URLs[0].LastMod != "" || doc.URLs[1].LastMod != "2026-10-26T21:00:00Z" || doc.URLs[2].LastMod != "" {
		t.Fatalf("fabricated or wrong sitemap date: %+v", doc.URLs)
	}
	if strings.Contains(w.Body.String(), "2099") || strings.Contains(w.Body.String(), "secret-draft") || strings.Contains(w.Body.String(), "tracking") {
		t.Fatal("sitemap leaked drafts or fabricated timestamps")
	}
	if w.Header().Get("Content-Type") != "application/xml; charset=utf-8" || !strings.Contains(w.Header().Get("Cache-Control"), "no-cache") {
		t.Fatal("wrong sitemap headers")
	}
	// Host strings still go through encoding/xml, not string interpolation.
	r := httptest.NewRequest("GET", "http://example.test/sitemap.xml", nil)
	r.Host = "news.example.test&escaped"
	escaped := httptest.NewRecorder()
	app.ServeHTTP(escaped, r)
	seoRequireText(t, escaped.Body.String(), "news.example.test&amp;escaped")
	cookie := login(t, app)
	a := published("fresh-news")
	status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": a}, cookie), 201)
	w = seoRequest(app, "https://news.example.test/sitemap.xml", "Googlebot")
	seoRequireText(t, w.Body.String(), "/a/fresh-news")
	fresh, ok := app.store.published(a.ID)
	if !ok {
		t.Fatal("fresh article not saved")
	}
	fresh.Status = "draft"
	status(t, adminRequest(app, "PUT", "/api/admin/articles/"+a.ID, map[string]any{"article": fresh, "expectedRevision": fresh.Revision}, cookie), 200)
	for _, path := range []string{"/", "/sitemap.xml"} {
		w = seoRequest(app, "https://news.example.test"+path, "Googlebot")
		if strings.Contains(w.Body.String(), "/a/fresh-news") {
			t.Fatal("withdrawn article stayed crawlable")
		}
	}
	status(t, seoRequest(app, "https://news.example.test/a/fresh-news", "Googlebot"), 404)
	for _, a := range []Article{
		{PublishedAt: "2026-11-01", UpdatedAt: "2026-10-31", VerifiedAt: "2099-01-01"},
		{PublishedAt: "2026-11-01", UpdatedAt: "bad"},
	} {
		if seoLastModified(a) != "2026-11-01" {
			t.Fatal("lastmod did not use the actual later publication/modification")
		}
	}
	undated := published("undated")
	undated.PublishedAt, undated.UpdatedAt, undated.CreatedAt = "", "", ""
	graph := seoGraph(t, seoStructuredData("https://example.test", &undated))
	for _, key := range []string{"datePublished", "dateModified", "image"} {
		if _, ok := graph["Article"][key]; ok {
			t.Fatalf("fabricated %s for undated/unillustrated article", key)
		}
	}
}

func TestSEORobotsRedirectAndIndexingHeaders(t *testing.T) {
	app := seoFixture(t)
	w := seoRequest(app, "https://news.example.test/robots.txt", "Googlebot")
	status(t, w, 200)
	seoRequireText(t, w.Body.String(), "User-agent: *\n", "Allow: /\n", "Disallow: /admin\n", "Disallow: /api/\n", "Disallow: /healthz\n", "Sitemap: https://news.example.test/sitemap.xml\n")
	if w.Header().Get("Content-Type") != "text/plain; charset=utf-8" || strings.Contains(w.Body.String(), "Disallow: /a/") || strings.Contains(w.Body.String(), "Disallow: /media/") || strings.Contains(w.Body.String(), "Disallow: /assets/") {
		t.Fatal("robots blocks rendering or has wrong content type")
	}
	for _, host := range []string{"localhost:9123", "127.0.0.1:9123", "news.example.test"} {
		r := httptest.NewRequest("GET", "http://"+host+"/robots.txt", nil)
		r.Header.Set("X-Forwarded-Proto", "http")
		w = httptest.NewRecorder()
		app.ServeHTTP(w, r)
		seoRequireText(t, w.Body.String(), "Sitemap: http://"+host+"/sitemap.xml")
	}
	for _, method := range []string{"GET", "HEAD"} {
		w = request(app, method, "/index.html?next=https%3A%2F%2Fevil.test&x=1", nil, nil, "", "", "")
		status(t, w, 301)
		if got := w.Header().Get("Location"); got != "/?next=https%3A%2F%2Fevil.test&x=1" {
			t.Fatalf("index redirect lost query or became open redirect: %q", got)
		}
	}
	for _, path := range []string{"/admin", "/api/articles", "/api/admin/articles", "/api/unknown", "/healthz"} {
		w = seoRequest(app, "https://news.example.test"+path, "Googlebot")
		if w.Header().Get("X-Robots-Tag") != "noindex, nofollow" {
			t.Fatalf("%s missing private-route robots header: %s", path, w.Header())
		}
	}
	for _, path := range []string{"/missing", "/a/invalid_id", "/assets/missing-12345678.js", "/media/missing.png"} {
		w = seoRequest(app, "https://news.example.test"+path, "Googlebot")
		status(t, w, 404)
		if w.Header().Get("X-Robots-Tag") != "noindex" || strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatalf("%s bad 404 indexing/cache headers: %+v", path, w.Header())
		}
	}
	for _, path := range []string{"/", "/a/existing", "/sitemap.xml", "/robots.txt", "/rss.xml", "/assets/app-12345678.js"} {
		w = seoRequest(app, "https://news.example.test"+path, "Googlebot")
		status(t, w, 200)
		if w.Header().Get("X-Robots-Tag") != "" {
			t.Fatalf("public rendering resource noindexed: %s", path)
		}
	}
}

func TestSEOHEADParityAndConcurrentRendering(t *testing.T) {
	app := seoFixture(t)
	// Ephemeral httptest listener only; no running application port is touched.
	server := httptest.NewServer(app)
	defer server.Close()
	client := server.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	for _, path := range []string{"/", "/a/existing", "/a/missing", "/sitemap.xml", "/robots.txt", "/rss.xml", "/admin", "/healthz", "/index.html?x=1", "/unknown"} {
		get, err := client.Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		_, err = io.ReadAll(get.Body)
		get.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		head, err := client.Head(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(head.Body)
		head.Body.Close()
		if err != nil || len(body) != 0 || get.StatusCode != head.StatusCode {
			t.Fatalf("HEAD %s status/body mismatch: %v %d %d %q", path, err, get.StatusCode, head.StatusCode, body)
		}
		for _, key := range []string{"Content-Type", "Cache-Control", "X-Robots-Tag", "Location"} {
			if get.Header.Get(key) != head.Header.Get(key) {
				t.Fatalf("HEAD %s %s differs: %q vs %q", path, key, get.Header.Get(key), head.Header.Get(key))
			}
		}
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for _, path := range []string{"/", "/a/existing", "/sitemap.xml"} {
				w := seoRequest(app, "https://example.test"+path, "Googlebot")
				if w.Code != 200 {
					t.Errorf("concurrent render %s: %d", path, w.Code)
				}
			}
		}()
	}
	wg.Wait()
}
