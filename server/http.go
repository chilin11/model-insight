package main

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"path"
	"strings"
)

type App struct {
	store            *Store
	auth             *Auth
	comments         *CommentStore
	analytics        *AnalyticsStore
	limiter          *RateLimiter
	webDir, mediaDir string
}

func jsonResponse(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func apiError(w http.ResponseWriter, status int, message string) {
	jsonResponse(w, status, map[string]string{"error": message})
}
func decodeRequest(w http.ResponseWriter, r *http.Request, v any) bool {
	typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		apiError(w, 415, "Content-Type must be application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequest)
	if err = strictJSON(r.Body, v); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			apiError(w, 413, "request exceeds 2 MiB")
		} else {
			apiError(w, 400, "invalid JSON, duplicate key or unknown field")
		}
		return false
	}
	return true
}
func (app *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
	p := r.URL.Path
	if strings.Contains(p, "\\") || strings.ContainsRune(p, 0) || path.Clean(p) != p {
		apiError(w, 404, "not found")
		return
	}
	if p == "/api" || strings.HasPrefix(p, "/api/") {
		app.api(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		apiError(w, 405, "method not allowed")
		return
	}
	if p == "/healthz" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok\n"))
		return
	}
	if p == "/rss.xml" {
		app.serveRSS(w, r)
		return
	}
	if strings.HasPrefix(p, "/a/") {
		if id := strings.TrimPrefix(p, "/a/"); idPattern.MatchString(id) {
			app.serveSharePage(w, r, id)
			return
		}
		apiError(w, 404, "not found")
		return
	}
	if strings.HasPrefix(p, "/media/") || p == "/media" {
		app.serveMedia(w, r)
		return
	}
	app.serveWeb(w, r)
}
func (app *App) api(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	if strings.HasPrefix(p, "/api/admin/") {
		if r.Header.Get("Authorization") != "" {
			apiError(w, 401, "admin API requires a cookie, not Bearer")
			return
		}
		switch p {
		case "/api/admin/login":
			if r.Method != "POST" {
				apiError(w, 405, "method not allowed")
				return
			}
			app.auth.login(w, r)
			return
		case "/api/admin/session":
			if r.Method != "GET" {
				apiError(w, 405, "method not allowed")
				return
			}
			jsonResponse(w, 200, map[string]bool{"authenticated": app.auth.authenticated(r)})
			return
		case "/api/admin/logout":
			if r.Method != "POST" {
				apiError(w, 405, "method not allowed")
				return
			}
			app.auth.logout(w, r)
			return
		}
		if !app.auth.authenticated(r) {
			apiError(w, 401, "authentication required")
			return
		}
		if r.Method != "GET" && !checkWrite(r, false) {
			apiError(w, 403, "invalid origin or CSRF header")
			return
		}
	}
	if strings.HasPrefix(p, "/api/ingest/") {
		if !app.auth.bearer(r) {
			apiError(w, 401, "invalid Bearer token")
			return
		}
	}
	if app.commentsAPI(w, r) {
		return
	}
	switch {
	case p == "/api/stats/event":
		if r.Method != "POST" {
			apiError(w, 405, "method not allowed")
			return
		}
		app.analyticsEvent(w, r)
	case p == "/api/admin/stats":
		if r.Method != "GET" {
			apiError(w, 405, "method not allowed")
			return
		}
		app.adminStats(w, r)
	case p == "/api/articles" && r.Method == "GET":
		jsonResponse(w, 200, app.store.snapshot(true))
	case p == "/api/admin/articles" && r.Method == "GET":
		jsonResponse(w, 200, app.store.snapshot(false))
	case p == "/api/ingest/ping" && r.Method == "GET":
		jsonResponse(w, 200, map[string]bool{"ok": true})
	case (p == "/api/admin/articles" || p == "/api/ingest/articles") && r.Method == "POST":
		var body struct {
			Article Article `json:"article"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		if p == "/api/ingest/articles" {
			if body.Article.Status != "" && body.Article.Status != "draft" {
				apiError(w, 400, "ingest only accepts drafts")
				return
			}
			body.Article.Status = "draft"
		}
		app.saveArticle(w, body.Article, 0, true)
	case strings.HasPrefix(p, "/api/admin/articles/") && r.Method == "DELETE":
		if err := app.store.remove(strings.TrimPrefix(p, "/api/admin/articles/")); err != nil {
			if errors.Is(err, errConflict) {
				apiError(w, 409, "withdraw the article before deleting it")
			} else {
				app.storeError(w, err)
			}
			return
		}
		jsonResponse(w, 200, map[string]bool{"deleted": true})
	case strings.HasPrefix(p, "/api/admin/articles/") && r.Method == "PUT":
		id := strings.TrimPrefix(p, "/api/admin/articles/")
		var body struct {
			Article          Article `json:"article"`
			ExpectedRevision int     `json:"expectedRevision"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		if !idPattern.MatchString(id) || body.Article.ID != id {
			apiError(w, 400, "article id mismatch")
			return
		}
		app.saveArticle(w, body.Article, body.ExpectedRevision, false)
	case p == "/api/admin/featured" && r.Method == "POST":
		var body struct {
			ID string `json:"id"`
		}
		if !decodeRequest(w, r, &body) {
			return
		}
		if err := app.store.feature(body.ID); err != nil {
			app.storeError(w, err)
			return
		}
		jsonResponse(w, 200, map[string]string{"featuredId": body.ID})
	case p == "/api/admin/media" && r.Method == "POST":
		app.uploadMedia(w, r)
	default:
		apiError(w, 404, "API route or method not found")
	}
}
func (app *App) saveArticle(w http.ResponseWriter, a Article, expected int, create bool) {
	if err := validateArticle(a); err != nil {
		apiError(w, 400, err.Error())
		return
	}
	saved, err := app.store.save(a, expected, create)
	if err != nil {
		app.storeError(w, err)
		return
	}
	status := 200
	if create {
		status = 201
	}
	jsonResponse(w, status, map[string]Article{"article": saved})
}
func (app *App) storeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errConflict):
		apiError(w, 409, errConflict.Error())
	case errors.Is(err, errNotFound):
		apiError(w, 404, errNotFound.Error())
	case errors.Is(err, errLimit):
		apiError(w, 409, errLimit.Error())
	default:
		apiError(w, 500, "content could not be saved")
	}
}
