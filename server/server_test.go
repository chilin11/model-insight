package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const adminSecret = "admin-0123456789-ABCdefghijklmnop"
const apiSecret = "api-0123456789-ABCdefghijklmnop-XYZ"

func published(id string) Article {
	return Article{ID: id, Title: "Title", Description: "Description", Model: "跨模型", Category: "深度观点", Status: "published", Body: "# Markdown\n\nBody", PublishedAt: "2026-10-26", VerifiedAt: "2026-10-26", Sources: []Source{{Label: "Source", URL: "https://example.com/news", Kind: "official"}}, Sections: []Section{}}
}
func writeJSON(t *testing.T, path string, v any) {
	t.Helper()
	b, e := json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(path, b, 0600); e != nil {
		t.Fatal(e)
	}
}
func fixture(t *testing.T) *App {
	t.Helper()
	dir := t.TempDir()
	seed := filepath.Join(dir, "seed.json")
	writeJSON(t, seed, Content{Articles: []Article{published("existing"), {ID: "secret-draft", Status: "draft"}}, FeaturedID: "existing"})
	store, e := newStore(filepath.Join(dir, "data"), seed)
	if e != nil {
		t.Fatal(e)
	}
	auth, e := newAuth(adminSecret, apiSecret)
	if e != nil {
		t.Fatal(e)
	}
	web := filepath.Join(dir, "www")
	media := filepath.Join(dir, "data", "media")
	for _, p := range []string{web, media, filepath.Join(web, "assets")} {
		if e = os.MkdirAll(p, 0700); e != nil {
			t.Fatal(e)
		}
	}
	os.WriteFile(filepath.Join(web, "index.html"), []byte("<!doctype html><div id=\"root\"></div>"), 0600)
	os.WriteFile(filepath.Join(web, "assets", "app-12345678.js"), []byte("console.log(1)"), 0600)
	comments, e := newCommentStore(filepath.Join(dir, "data"))
	if e != nil {
		t.Fatal(e)
	}
	return &App{store: store, auth: auth, comments: comments, limiter: newRateLimiter(), webDir: web, mediaDir: media}
}
func request(app *App, method, path string, v any, cookie *http.Cookie, origin, csrf, bearer string) *httptest.ResponseRecorder {
	var b []byte
	if v != nil {
		b, _ = json.Marshal(v)
	}
	r := httptest.NewRequest(method, "http://example.test"+path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", origin)
	r.Header.Set("X-Requested-With", csrf)
	if bearer != "" {
		r.Header.Set("Authorization", "Bearer "+bearer)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	return w
}
func status(t *testing.T, w *httptest.ResponseRecorder, want int) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("status %d want %d: %s", w.Code, want, w.Body.String())
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing nosniff")
	}
}
func login(t *testing.T, app *App) *http.Cookie {
	t.Helper()
	w := request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, "http://example.test", "model-insight", "")
	status(t, w, 200)
	return w.Result().Cookies()[0]
}
func adminRequest(app *App, m, p string, v any, c *http.Cookie) *httptest.ResponseRecorder {
	return request(app, m, p, v, c, "http://example.test", "model-insight", "")
}
func TestAuthenticationAndCSRF(t *testing.T) {
	app := fixture(t)
	for _, keys := range [][2]string{{"", apiSecret}, {adminSecret, "short"}, {apiSecret, apiSecret}, {strings.Repeat("a", 30), apiSecret}} {
		if _, e := newAuth(keys[0], keys[1]); e == nil {
			t.Fatal("weak keys accepted")
		}
	}
	status(t, request(app, "GET", "/api/admin/articles", nil, nil, "", "", ""), 401)
	status(t, request(app, "GET", "/api/admin/session", nil, nil, "", "", ""), 200)
	for _, bad := range []struct{ o, h string }{{"http://evil.test", "model-insight"}, {"null", "model-insight"}, {"http://user@example.test", "model-insight"}, {"http://example.test/", "model-insight"}, {"http://example.test", ""}} {
		status(t, request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, bad.o, bad.h, ""), 403)
	}
	// Non-browser login may omit Origin, but must send the explicit CSRF header.
	status(t, request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, "", "model-insight", ""), 200)
	c := login(t, app)
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.MaxAge != 28800 {
		t.Fatal("unsafe cookie")
	}
	for _, bad := range []struct{ o, h string }{{"", "model-insight"}, {"http://evil.test", "model-insight"}, {"http://example.test", ""}, {"http://example.test:80", "model-insight"}} {
		status(t, request(app, "POST", "/api/admin/articles", map[string]any{"article": Article{ID: "new", Status: "draft"}}, c, bad.o, bad.h, ""), 403)
	}
	status(t, request(app, "GET", "/api/admin/articles", nil, nil, "", "", apiSecret), 401)
	status(t, request(app, "GET", "/api/ingest/ping", nil, c, "", "", ""), 401)
	status(t, request(app, "GET", "/api/ingest/ping", nil, nil, "", "", adminSecret), 401)
	status(t, request(app, "GET", "/api/ingest/ping", nil, nil, "", "", apiSecret), 200)
	status(t, adminRequest(app, "POST", "/api/admin/logout", nil, c), 200)
	status(t, adminRequest(app, "GET", "/api/admin/articles", nil, c), 401)
	c = login(t, app)
	app.auth.now = func() time.Time { return time.Now().Add(9 * time.Hour) }
	status(t, adminRequest(app, "GET", "/api/admin/articles", nil, c), 401)
	app.auth, _ = newAuth(adminSecret, apiSecret)
	status(t, adminRequest(app, "GET", "/api/admin/articles", nil, c), 401)
	secure := request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, "https://example.test", "model-insight", "")
	status(t, secure, 200)
	if !secure.Result().Cookies()[0].Secure {
		t.Fatal("https cookie lacks Secure")
	}
}
func TestLoginRateLimit(t *testing.T) {
	app := fixture(t)
	for i := 0; i < 10; i++ {
		status(t, request(app, "POST", "/api/admin/login", map[string]string{"token": "bad"}, nil, "", "model-insight", ""), 401)
	}
	status(t, request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, "", "model-insight", ""), 429)
	app.auth.now = func() time.Time { return time.Now().Add(16 * time.Minute) }
	status(t, request(app, "POST", "/api/admin/login", map[string]string{"token": adminSecret}, nil, "", "model-insight", ""), 200)
}
func TestDraftsPublishEditAndFeatured(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	public := request(app, "GET", "/api/articles", nil, nil, "", "", "")
	status(t, public, 200)
	if strings.Contains(public.Body.String(), "secret-draft") {
		t.Fatal("draft leaked")
	}
	a := published("ai-draft")
	status(t, request(app, "POST", "/api/ingest/articles", map[string]any{"article": a}, nil, "", "", apiSecret), 400)
	a.Status = ""
	a.Title = ""
	a.Body = ""
	w := request(app, "POST", "/api/ingest/articles", map[string]any{"article": a}, nil, "", "", apiSecret)
	status(t, w, 201)
	var response struct {
		Article Article `json:"article"`
	}
	json.Unmarshal(w.Body.Bytes(), &response)
	if response.Article.Status != "draft" || response.Article.Revision != 1 {
		t.Fatal("draft or revision incorrect")
	}
	status(t, request(app, "POST", "/api/ingest/articles", map[string]any{"article": a}, nil, "", "", apiSecret), 409)
	status(t, adminRequest(app, "POST", "/api/admin/featured", map[string]string{"id": a.ID}, c), 404)
	a = published("ai-draft")
	a.Sections = []Section{{Heading: "Structured", Text: "Section", SourceNumbers: []int{1}, Table: &Table{Columns: []string{"a"}, Rows: [][]string{{"1"}}, Note: "Keep note"}, Chart: &Chart{Title: "Chart", Max: 100, Rows: []ChartRow{{Label: "row", Value: 9}}}}}
	a.Image = &Image{URL: "https://images.example.com/photo.png", Alt: "image", Caption: "caption"}
	w = adminRequest(app, "PUT", "/api/admin/articles/ai-draft", map[string]any{"article": a, "expectedRevision": 1}, c)
	status(t, w, 200)
	json.Unmarshal(w.Body.Bytes(), &response)
	if response.Article.Revision != 2 || response.Article.Sections[0].Table.Note != "Keep note" || response.Article.Image.Caption != "caption" {
		t.Fatal("fields lost")
	}
	status(t, adminRequest(app, "PUT", "/api/admin/articles/ai-draft", map[string]any{"article": a, "expectedRevision": 1}, c), 409)
	status(t, adminRequest(app, "PUT", "/api/admin/articles/other-id", map[string]any{"article": a, "expectedRevision": 2}, c), 400)
	status(t, adminRequest(app, "POST", "/api/admin/featured", map[string]string{"id": a.ID}, c), 200)
	a.Status = "draft"
	status(t, adminRequest(app, "PUT", "/api/admin/articles/ai-draft", map[string]any{"article": a, "expectedRevision": 2}, c), 200)
	var content Content
	public = request(app, "GET", "/api/articles", nil, nil, "", "", "")
	json.Unmarshal(public.Body.Bytes(), &content)
	if content.FeaturedID != "existing" || len(content.Articles) != 1 {
		t.Fatal("public fallback failed")
	}
	if app.store.snapshot(false).FeaturedID != "ai-draft" {
		t.Fatal("persisted featured overwritten")
	}
}
func TestValidationAndLimits(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	for _, mutate := range []func(*Article){func(a *Article) { a.ID = "../bad" }, func(a *Article) { a.Status = "sample" }, func(a *Article) { a.Title = "" }, func(a *Article) { a.Description = "" }, func(a *Article) { a.Body = "" }, func(a *Article) { a.Sources = nil }, func(a *Article) { a.PublishedAt = "2026-02-30" }, func(a *Article) { a.VerifiedAt = "" }, func(a *Article) { a.Model = "Unknown" }, func(a *Article) { a.Category = "全部" }, func(a *Article) { a.Body = strings.Repeat("x", maxBody+1) }, func(a *Article) { a.Sources[0].URL = "https://user:pass@example.com" }, func(a *Article) { a.Sources[0].URL = "javascript:alert(1)" }, func(a *Article) { a.Image = &Image{URL: "http://example.com/x.png"} }, func(a *Article) { a.Image = &Image{URL: "/media/../content.json"} }} {
		a := published("invalid")
		mutate(&a)
		status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": a}, c), 400)
	}
	for _, raw := range []string{`{"article":{"id":"new","status":"draft","futureField":1}}`, `{"article":{"id":"new","status":"draft","sections":[{"heading":"x","future":true}]}}`, `{"article":{"id":"new","id":"other","status":"draft"}}`, `{"article":{"id":"new","status":"draft"}} {}`} {
		r := httptest.NewRequest("POST", "http://example.test/api/admin/articles", strings.NewReader(raw))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", "http://example.test")
		r.Header.Set("X-Requested-With", "model-insight")
		r.AddCookie(c)
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		status(t, w, 400)
	}
	status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": Article{ID: "empty", Status: "draft"}}, c), 201)
	huge := map[string]any{"article": Article{ID: "huge", Status: "draft", Body: strings.Repeat("x", maxRequest)}}
	status(t, adminRequest(app, "POST", "/api/admin/articles", huge, c), 413)
	app.store.content.Articles = make([]Article, maxArticles)
	status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": Article{ID: "limit", Status: "draft"}}, c), 409)
}
func TestWriterFailureReloadPreserveAndCorruptStore(t *testing.T) {
	app := fixture(t)
	before, _ := os.ReadFile(app.store.path)
	app.store.write = func(path string, b []byte) error {
		if strings.HasSuffix(path, ".bak") {
			return atomicWrite(path, b)
		}
		return errors.New("disk full")
	}
	if _, e := app.store.save(Article{ID: "lost", Status: "draft"}, 0, true); e == nil {
		t.Fatal("write failure accepted")
	}
	after, _ := os.ReadFile(app.store.path)
	if !bytes.Equal(before, after) || len(app.store.snapshot(false).Articles) != 2 {
		t.Fatal("failed write changed content")
	}
	app.store.write = atomicWrite
	a := published("existing")
	a.Body = "New Markdown"
	a.Sections = []Section{{Heading: "Original", Text: "Preserved"}}
	if _, e := app.store.save(a, 1, false); e != nil {
		t.Fatal(e)
	}
	backup, _ := os.ReadFile(app.store.path + ".bak")
	if !bytes.Equal(before, backup) {
		t.Fatal("previous version not backed up")
	}
	dir := filepath.Dir(app.store.path)
	reloaded, e := newStore(dir, "missing-seed")
	if e != nil {
		t.Fatal(e)
	}
	got := reloaded.snapshot(false).Articles[0]
	if got.Body != "New Markdown" || got.Sections[0].Text != "Preserved" || got.Revision != 2 {
		t.Fatal("reload lost data")
	}
	for _, bad := range []string{`{"articles":[`, `{"articles":null,"featuredId":""}`, `{"articles":[{"id":"bad","status":"bogus"}]}`, `{"articles":[],"featuredId":"","future":true}`} {
		os.WriteFile(app.store.path, []byte(bad), 0600)
		if _, e = newStore(dir, "missing-seed"); e == nil {
			t.Fatal("corrupt store accepted")
		}
		unchanged, _ := os.ReadFile(app.store.path)
		if string(unchanged) != bad {
			t.Fatal("corrupt store overwritten")
		}
	}
	os.Remove(app.store.path)
	if _, e = newStore(dir, "missing-seed"); e == nil {
		t.Fatal("missing main with backup not failed closed")
	}
}
func TestConcurrentRevision(t *testing.T) {
	app := fixture(t)
	var wg sync.WaitGroup
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := app.store.save(published("existing"), 1, false)
			results <- e
			_ = app.store.snapshot(true)
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for e := range results {
		if e == nil {
			successes++
		} else if !errors.Is(e, errConflict) {
			t.Fatal(e)
		}
	}
	if successes != 1 {
		t.Fatalf("lost update: %d successes", successes)
	}
}
func TestMediaAndPath(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	upload := func(data []byte, name string) *httptest.ResponseRecorder {
		var b bytes.Buffer
		mw := multipart.NewWriter(&b)
		p, _ := mw.CreateFormFile("file", name)
		p.Write(data)
		mw.Close()
		r := httptest.NewRequest("POST", "http://example.test/api/admin/media", &b)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		r.Header.Set("Origin", "http://example.test")
		r.Header.Set("X-Requested-With", "model-insight")
		r.AddCookie(c)
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		return w
	}
	var pngData bytes.Buffer
	png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 3, 3)))
	w := upload(pngData.Bytes(), "../../original.html")
	status(t, w, 201)
	var out map[string]string
	json.Unmarshal(w.Body.Bytes(), &out)
	if !mediaPattern.MatchString(out["url"]) || strings.Contains(out["url"], "original") {
		t.Fatal("unsafe filename")
	}
	media := request(app, "GET", out["url"], nil, nil, "", "", "")
	status(t, media, 200)
	if media.Header().Get("Content-Type") != "image/png" || !strings.Contains(media.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("bad media headers")
	}
	status(t, upload([]byte("<svg onload=\"alert(1)\"/>"), "evil.png"), 415)
	status(t, upload([]byte("<html>evil</html>"), "evil.jpg"), 415)
	status(t, upload(pngData.Bytes()[:25], "broken.png"), 400)
	status(t, upload(make([]byte, maxMedia+1), "big.png"), 413)
	os.Symlink(app.store.path, filepath.Join(app.webDir, "assets", "leak-12345678.js"))
	os.Symlink(app.store.path, filepath.Join(app.mediaDir, strings.Repeat("a", 32)+".png"))
	for _, p := range []string{"/media", "/media/", "/media/../content.json", "/media/%2e%2e/content.json", "/media/" + strings.Repeat("a", 32) + ".png", "/assets", "/assets/missing.js", "/missing.png", "/unknown", "/api/missing", "/api/admin/articles/../session", "/assets/leak-12345678.js", "/.env", "/media/%2fetc%2fpasswd"} {
		status(t, request(app, "GET", p, nil, nil, "", "", ""), 404)
	}
	for _, p := range []string{"/", "/admin"} {
		page := request(app, "GET", p, nil, nil, "", "", "")
		status(t, page, 200)
		if !strings.Contains(page.Header().Get("Cache-Control"), "no-cache") {
			t.Fatal("HTML cached")
		}
	}
	asset := request(app, "GET", "/assets/app-12345678.js", nil, nil, "", "", "")
	status(t, asset, 200)
	if !strings.Contains(asset.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("hashed asset not immutable")
	}
}
func TestSeedRejectDuplicatesAndUpgradeRevision(t *testing.T) {
	dir := t.TempDir()
	seed := filepath.Join(dir, "seed.json")
	a := published("original")
	a.Sections = []Section{{Heading: "H", Text: "text"}}
	a.Revision = 0
	writeJSON(t, seed, Content{Articles: []Article{a}, FeaturedID: a.ID})
	s, e := newStore(filepath.Join(dir, "data"), seed)
	if e != nil {
		t.Fatal(e)
	}
	if s.snapshot(false).Articles[0].Revision != 1 {
		t.Fatal("legacy revision not upgraded")
	}
	writeJSON(t, seed, Content{Articles: []Article{a, a}, FeaturedID: a.ID})
	if _, e = newStore(filepath.Join(dir, "duplicate"), seed); e == nil {
		t.Fatal("duplicate seed accepted")
	}
}
