package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func publicPost(app *App, path string, v any, origin string) *httptest.ResponseRecorder {
	return request(app, "POST", path, v, nil, origin, "model-insight", "")
}

func TestCommentsModerationFlow(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	comment := map[string]string{"name": " 读者 ", "body": "第一条评论\r\n第二行"}
	status(t, publicPost(app, "/api/articles/existing/comments", comment, "http://evil.test"), 403)
	status(t, request(app, "POST", "/api/articles/existing/comments", comment, nil, "http://example.test", "", ""), 403)
	status(t, publicPost(app, "/api/articles/secret-draft/comments", comment, "http://example.test"), 404)
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "x"}, "http://example.test"), 400)
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "bad\u0000text"}, "http://example.test"), 400)
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "ok", "extra": "x"}, "http://example.test"), 400)
	status(t, publicPost(app, "/api/articles/existing/comments", comment, "http://example.test"), 202)
	// Honeypot submissions look successful but are not stored.
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "spam link", "website": "http://spam"}, "http://example.test"), 202)

	w := request(app, "GET", "/api/articles/existing/comments", nil, nil, "", "", "")
	status(t, w, 200)
	if strings.Contains(w.Body.String(), "第一条") {
		t.Fatal("pending comment leaked before moderation")
	}
	status(t, request(app, "GET", "/api/admin/comments", nil, nil, "", "", ""), 401)
	w = adminRequest(app, "GET", "/api/admin/comments", nil, c)
	status(t, w, 200)
	var all struct{ Comments []Comment }
	json.Unmarshal(w.Body.Bytes(), &all)
	if len(all.Comments) != 1 || all.Comments[0].Name != "读者" || all.Comments[0].Body != "第一条评论\n第二行" || all.Comments[0].Status != "pending" {
		t.Fatalf("unexpected stored comments: %+v", all.Comments)
	}
	id := all.Comments[0].ID
	status(t, request(app, "PUT", "/api/admin/comments/"+id, map[string]string{"status": "approved"}, c, "http://example.test", "", ""), 403)
	status(t, adminRequest(app, "PUT", "/api/admin/comments/"+id, map[string]string{"status": "bogus"}, c), 400)
	status(t, adminRequest(app, "PUT", "/api/admin/comments/"+id, map[string]string{"status": "approved"}, c), 200)
	w = request(app, "GET", "/api/articles/existing/comments", nil, nil, "", "", "")
	if !strings.Contains(w.Body.String(), "第一条评论") || strings.Contains(w.Body.String(), "articleId") || strings.Contains(w.Body.String(), "status") {
		t.Fatalf("approved public comment wrong: %s", w.Body.String())
	}
	status(t, adminRequest(app, "PUT", "/api/admin/comments/"+id, map[string]string{"status": "hidden"}, c), 200)
	if strings.Contains(request(app, "GET", "/api/articles/existing/comments", nil, nil, "", "", "").Body.String(), "第一条") {
		t.Fatal("hidden comment still public")
	}
	// Reload from disk keeps moderation state.
	reloaded, err := newCommentStore(filepath.Dir(app.comments.path))
	if err != nil || len(reloaded.comments) != 1 || reloaded.comments[0].Status != "hidden" {
		t.Fatalf("comments not persisted: %v %+v", err, reloaded)
	}
	status(t, adminRequest(app, "DELETE", "/api/admin/comments/"+id, nil, c), 200)
	status(t, adminRequest(app, "DELETE", "/api/admin/comments/"+id, nil, c), 404)
}

func TestCommentRateLimitClosedAndCorruptFile(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	for i := 0; i < 5; i++ {
		status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "评论内容"}, "http://example.test"), 202)
	}
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "评论内容"}, "http://example.test"), 429)

	a := published("existing")
	a.CommentsClosed = true
	w := adminRequest(app, "GET", "/api/admin/articles", nil, c)
	var content Content
	json.Unmarshal(w.Body.Bytes(), &content)
	a.Revision = content.Articles[0].Revision
	status(t, adminRequest(app, "PUT", "/api/admin/articles/existing", map[string]any{"article": a, "expectedRevision": a.Revision}, c), 200)
	app.limiter = newRateLimiter()
	status(t, publicPost(app, "/api/articles/existing/comments", map[string]string{"body": "评论内容"}, "http://example.test"), 403)

	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "comments.json"), []byte(`{"comments":[{"id":"x","articleId":"a","name":"n","body":"b","status":"weird","createdAt":"2026-10-26"}]}`), 0600)
	if _, err := newCommentStore(dir); err == nil {
		t.Fatal("invalid comment file accepted")
	}
	if validateCommentsFile(dir) == nil {
		t.Fatal("check-config accepted invalid comments")
	}
}

func TestDeleteDraftsOnly(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	status(t, adminRequest(app, "DELETE", "/api/admin/articles/existing", nil, c), 409)
	status(t, adminRequest(app, "DELETE", "/api/admin/articles/secret-draft", nil, c), 200)
	status(t, adminRequest(app, "DELETE", "/api/admin/articles/secret-draft", nil, c), 404)
	status(t, request(app, "DELETE", "/api/admin/articles/existing", nil, c, "http://evil.test", "model-insight", ""), 403)
	if _, err := loadContent(app.store.path); err != nil {
		t.Fatalf("content invalid after delete: %v", err)
	}
}

func TestSharePageAndRSS(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	os.WriteFile(filepath.Join(app.webDir, "index.html"), []byte("<!doctype html><html><head><meta name=\"description\" content=\"site\" /><title>模型智见</title></head><body><div id=\"root\"></div></body></html>"), 0600)
	a := published("share-test")
	a.Title = `标题 "<script>alert(1)</script>`
	a.Description = "摘要 & 说明"
	a.Image = &Image{URL: "/media/0123456789abcdef0123456789abcdef.png", Alt: "图"}
	a.PublishedAt = "2026-10-27"
	status(t, adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": a}, c), 201)

	r := httptest.NewRequest("GET", "https://news.example.com/a/share-test", nil)
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	status(t, w, 200)
	body := w.Body.String()
	for _, want := range []string{`og:title" content="标题 &#34;&lt;script&gt;`, `og:url" content="https://news.example.com/a/share-test"`, `og:image" content="https://news.example.com/media/0123456789abcdef0123456789abcdef.png"`, "摘要 &amp; 说明", `<div id="root">`} {
		if !strings.Contains(body, want) {
			t.Fatalf("share page missing %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "<script>alert") || strings.Count(body, "<title>") != 1 || strings.Contains(body, `content="site"`) {
		t.Fatalf("share page not escaped or duplicated: %s", body)
	}
	for _, path := range []string{"/a/secret-draft", "/a/missing"} {
		w = httptest.NewRecorder()
		app.ServeHTTP(w, httptest.NewRequest("GET", "http://example.test"+path, nil))
		status(t, w, 404)
		if strings.Contains(w.Body.String(), "og:title") {
			t.Fatal("draft metadata leaked")
		}
	}
	w = httptest.NewRecorder()
	app.ServeHTTP(w, httptest.NewRequest("GET", "http://example.test/a/../x", nil))
	if w.Code == 200 {
		t.Fatal("unsafe share path served")
	}

	w = httptest.NewRecorder()
	app.ServeHTTP(w, httptest.NewRequest("GET", "https://news.example.com/rss.xml", nil))
	status(t, w, 200)
	feed := w.Body.String()
	if !strings.Contains(w.Header().Get("Content-Type"), "rss+xml") || !strings.Contains(feed, "<link>https://news.example.com/a/share-test</link>") || strings.Contains(feed, "secret-draft") {
		t.Fatalf("bad feed: %s", feed)
	}
	if strings.Index(feed, "share-test") > strings.Index(feed, "/a/existing") {
		t.Fatal("feed is not newest first")
	}
}
