package main

import (
	"bytes"
	"encoding/xml"
	"html"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var titleTag = regexp.MustCompile(`(?s)<title>.*?</title>`)
var descriptionTag = regexp.MustCompile(`<meta name="description"[^>]*>`)

func (s *Store) published(id string) (Article, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, a := range s.content.Articles {
		if a.ID == id && a.Status == "published" {
			return a, true
		}
	}
	return Article{}, false
}

// remove deletes drafts only; published articles must be withdrawn first.
func (s *Store) remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.content.Articles {
		if a.ID != id {
			continue
		}
		if a.Status == "published" {
			return errConflict
		}
		c := Content{FeaturedID: s.content.FeaturedID, Articles: append(append([]Article{}, s.content.Articles[:i]...), s.content.Articles[i+1:]...)}
		if c.FeaturedID == id {
			c.FeaturedID = ""
			for _, v := range c.Articles {
				if v.Status == "published" {
					c.FeaturedID = v.ID
					break
				}
			}
		}
		return s.commit(c)
	}
	return errNotFound
}

// Newest publication date first; equal dates keep storage order.
func sortedPublished(c Content) []Article {
	out := append([]Article{}, c.Articles...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].PublishedAt > out[j].PublishedAt })
	return out
}

// siteBase derives the public origin. The service only listens on loopback, so
// the Host is the one cloudflared forwards; local hosts use plain HTTP.
func siteBase(r *http.Request) string {
	host := r.Host
	name := host
	if h, _, err := net.SplitHostPort(host); err == nil {
		name = h
	}
	scheme := "https"
	if ip := net.ParseIP(name); name == "localhost" || (ip != nil && ip.IsLoopback()) {
		scheme = "http"
	}
	if p := r.Header.Get("X-Forwarded-Proto"); p == "http" || p == "https" {
		scheme = p
	}
	return scheme + "://" + host
}

func (app *App) serveSharePage(w http.ResponseWriter, r *http.Request, id string) {
	f, err := openRegular(app.webDir, "index.html")
	if err != nil {
		apiError(w, 404, "not found")
		return
	}
	defer f.Close()
	var buf bytes.Buffer
	if _, err = buf.ReadFrom(f); err != nil {
		apiError(w, 500, "unable to read page")
		return
	}
	page := buf.String()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	a, ok := app.store.published(id)
	if !ok {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(page))
		return
	}
	base := siteBase(r)
	url := base + "/a/" + id
	e := html.EscapeString
	meta := []string{
		`<meta name="description" content="` + e(a.Description) + `" />`,
		`<link rel="canonical" href="` + e(url) + `" />`,
		`<meta property="og:type" content="article" />`,
		`<meta property="og:site_name" content="模型智见" />`,
		`<meta property="og:title" content="` + e(a.Title) + `" />`,
		`<meta property="og:description" content="` + e(a.Description) + `" />`,
		`<meta property="og:url" content="` + e(url) + `" />`,
	}
	card := "summary"
	if a.Image != nil {
		image := a.Image.URL
		if strings.HasPrefix(image, "/") {
			image = base + image
		}
		meta = append(meta, `<meta property="og:image" content="`+e(image)+`" />`, `<meta name="twitter:image" content="`+e(image)+`" />`)
		card = "summary_large_image"
	}
	if a.PublishedAt != "" {
		meta = append(meta, `<meta property="article:published_time" content="`+e(a.PublishedAt)+`" />`)
	}
	meta = append(meta, `<meta name="twitter:card" content="`+card+`" />`, `<meta name="twitter:title" content="`+e(a.Title)+`" />`, `<meta name="twitter:description" content="`+e(a.Description)+`" />`)
	page = descriptionTag.ReplaceAllString(page, "")
	page = titleTag.ReplaceAllLiteralString(page, "<title>"+e(a.Title)+" · 模型智见</title>")
	page = strings.Replace(page, "</head>", strings.Join(meta, "\n    ")+"\n  </head>", 1)
	_, _ = w.Write([]byte(page))
}

type rssItem struct {
	Title       string `xml:"title"`
	Link        string `xml:"link"`
	GUID        string `xml:"guid"`
	PubDate     string `xml:"pubDate,omitempty"`
	Category    string `xml:"category,omitempty"`
	Description string `xml:"description"`
}

func rssDate(s string) string {
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC().Format(time.RFC1123Z)
		}
	}
	return ""
}

func (app *App) serveRSS(w http.ResponseWriter, r *http.Request) {
	base := siteBase(r)
	items := []rssItem{}
	for _, a := range sortedPublished(app.store.snapshot(true)) {
		if len(items) == 30 {
			break
		}
		link := base + "/a/" + a.ID
		items = append(items, rssItem{Title: a.Title, Link: link, GUID: link, PubDate: rssDate(a.PublishedAt), Category: a.Category, Description: a.Description})
	}
	feed := struct {
		XMLName xml.Name `xml:"rss"`
		Version string   `xml:"version,attr"`
		Channel struct {
			Title       string    `xml:"title"`
			Link        string    `xml:"link"`
			Description string    `xml:"description"`
			Language    string    `xml:"language"`
			Items       []rssItem `xml:"item"`
		} `xml:"channel"`
	}{Version: "2.0"}
	feed.Channel.Title = "模型智见"
	feed.Channel.Link = base + "/"
	feed.Channel.Description = "AI 模型发布、评测解读与社区评价"
	feed.Channel.Language = "zh-CN"
	feed.Channel.Items = items
	b, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		apiError(w, 500, "unable to render feed")
		return
	}
	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(append([]byte(xml.Header), b...))
}

// validateCommentsFile is used by -check-config so a damaged comments file is
// reported before the service is restarted.
func validateCommentsFile(dir string) error {
	path := filepath.Join(dir, "comments.json")
	if _, err := os.Lstat(path); os.IsNotExist(err) {
		return nil
	}
	_, err := loadComments(path)
	return err
}
