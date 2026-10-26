package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const maxComments = 20000
const maxPendingComments = 500
const maxCommentRunes = 2000
const maxNameRunes = 40

var errQueueFull = errors.New("comment moderation queue is full")
var errCommentNotFound = errors.New("comment not found")

type Comment struct {
	ID          string `json:"id"`
	ArticleID   string `json:"articleId"`
	Name        string `json:"name"`
	Body        string `json:"body"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	ModeratedAt string `json:"moderatedAt,omitempty"`
}

// PublicComment omits moderation metadata and article linkage.
type PublicComment struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
}

type CommentStore struct {
	mu       sync.RWMutex
	comments []Comment
	path     string
	write    func(string, []byte) error
}

func loadComments(path string) ([]Comment, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var document struct {
		Comments *[]Comment `json:"comments"`
	}
	if err = strictJSON(f, &document); err != nil {
		return nil, err
	}
	if document.Comments == nil {
		return nil, errors.New("comments file requires comments array")
	}
	seen := map[string]bool{}
	for _, c := range *document.Comments {
		if !idPattern.MatchString(c.ID) || seen[c.ID] || !idPattern.MatchString(c.ArticleID) || !oneOf(c.Status, "pending", "approved", "hidden") || !validDate(c.CreatedAt) {
			return nil, errors.New("invalid comment record")
		}
		seen[c.ID] = true
	}
	if len(*document.Comments) > maxComments {
		return nil, errors.New("comment limit exceeded")
	}
	return *document.Comments, nil
}

// A missing file means no comments yet; a damaged file fails closed.
func newCommentStore(dir string) (*CommentStore, error) {
	s := &CommentStore{path: filepath.Join(dir, "comments.json"), write: atomicWrite, comments: []Comment{}}
	info, err := os.Lstat(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("comments.json must be a regular file")
	}
	s.comments, err = loadComments(s.path)
	return s, err
}

func (s *CommentStore) commit(next []Comment) error {
	b, err := json.MarshalIndent(map[string][]Comment{"comments": next}, "", "  ")
	if err != nil {
		return err
	}
	if err = s.write(s.path, append(b, '\n')); err != nil {
		return err
	}
	s.comments = next
	return nil
}

func (s *CommentStore) public(articleID string) []PublicComment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []PublicComment{}
	for _, c := range s.comments {
		if c.ArticleID == articleID && c.Status == "approved" {
			out = append(out, PublicComment{ID: c.ID, Name: c.Name, Body: c.Body, CreatedAt: c.CreatedAt})
		}
	}
	return out
}

func (s *CommentStore) all() []Comment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := append([]Comment{}, s.comments...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

func (s *CommentStore) add(c Comment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	pending := 0
	for _, v := range s.comments {
		if v.Status == "pending" {
			pending++
		}
	}
	if pending >= maxPendingComments || len(s.comments) >= maxComments {
		return errQueueFull
	}
	return s.commit(append(append([]Comment{}, s.comments...), c))
}

func (s *CommentStore) moderate(id, status string) (Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := append([]Comment{}, s.comments...)
	for i := range next {
		if next[i].ID == id {
			next[i].Status = status
			next[i].ModeratedAt = time.Now().UTC().Format(time.RFC3339)
			if err := s.commit(next); err != nil {
				return Comment{}, err
			}
			return next[i], nil
		}
	}
	return Comment{}, errCommentNotFound
}

func (s *CommentStore) remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, c := range s.comments {
		if c.ID == id {
			next := append(append([]Comment{}, s.comments[:i]...), s.comments[i+1:]...)
			return s.commit(next)
		}
	}
	return errCommentNotFound
}

// Rate limits are kept in memory only; client addresses are never written to disk.
type RateLimiter struct {
	mu     sync.Mutex
	hits   map[string][]time.Time
	global []time.Time
	now    func() time.Time
}

func newRateLimiter() *RateLimiter {
	return &RateLimiter{hits: map[string][]time.Time{}, now: time.Now}
}

func recent(times []time.Time, since time.Time) []time.Time {
	first := 0
	for first < len(times) && times[first].Before(since) {
		first++
	}
	return times[first:]
}

// allow permits 5 comments per client per 10 minutes and 120 site-wide per hour.
func (l *RateLimiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.global = recent(l.global, now.Add(-time.Hour))
	if len(l.hits) > 10000 {
		for k, v := range l.hits {
			if len(recent(v, now.Add(-10*time.Minute))) == 0 {
				delete(l.hits, k)
			}
		}
	}
	mine := recent(l.hits[key], now.Add(-10*time.Minute))
	if len(mine) >= 5 || len(l.global) >= 120 || len(l.hits) > 20000 {
		l.hits[key] = mine
		return false
	}
	l.hits[key] = append(mine, now)
	l.global = append(l.global, now)
	return true
}

// The service listens on loopback behind cloudflared, so Cloudflare's visitor
// header is only trusted when the TCP peer itself is local.
func clientKey(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if parsed := net.ParseIP(ip); parsed != nil && parsed.IsLoopback() {
		if cf := net.ParseIP(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); cf != nil {
			return cf.String()
		}
	}
	return ip
}

func cleanText(s string, multiline bool) (string, bool) {
	if !utf8.ValidString(s) {
		return "", false
	}
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n")
	for _, c := range s {
		if (unicode.IsControl(c) && !(multiline && (c == '\n' || c == '\t'))) || c == '\u202e' || c == '\u202d' {
			return "", false
		}
	}
	return strings.TrimSpace(s), true
}

func (app *App) submitComment(w http.ResponseWriter, r *http.Request, articleID string) {
	if !checkWrite(r, false) {
		apiError(w, 403, "invalid origin or CSRF header")
		return
	}
	var body struct {
		Name    string `json:"name"`
		Body    string `json:"body"`
		Website string `json:"website"`
	}
	if !decodeRequest(w, r, &body) {
		return
	}
	article, ok := app.store.published(articleID)
	if !ok {
		apiError(w, 404, "article not found")
		return
	}
	if article.CommentsClosed {
		apiError(w, 403, "comments are closed for this article")
		return
	}
	name, okName := cleanText(body.Name, false)
	text, okBody := cleanText(body.Body, true)
	if !okName || !okBody || utf8.RuneCountInString(name) > maxNameRunes || utf8.RuneCountInString(text) < 2 || utf8.RuneCountInString(text) > maxCommentRunes {
		apiError(w, 400, "nickname up to 40 characters; comment 2-2000 characters without control characters")
		return
	}
	if !app.limiter.allow(clientKey(r)) {
		w.Header().Set("Retry-After", "600")
		apiError(w, 429, "too many comments; try again later")
		return
	}
	// Honeypot: automated submissions get the same response but are not stored.
	if strings.TrimSpace(body.Website) != "" {
		jsonResponse(w, 202, map[string]string{"status": "pending"})
		return
	}
	if name == "" {
		name = "匿名读者"
	}
	id, err := randomID(10)
	if err != nil {
		apiError(w, 500, "unable to save comment")
		return
	}
	c := Comment{ID: id, ArticleID: articleID, Name: name, Body: text, Status: "pending", CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	if err = app.comments.add(c); err != nil {
		if errors.Is(err, errQueueFull) {
			apiError(w, 503, "comment moderation queue is full")
		} else {
			apiError(w, 500, "comment could not be saved")
		}
		return
	}
	jsonResponse(w, 202, map[string]string{"status": "pending"})
}

func (app *App) commentsAPI(w http.ResponseWriter, r *http.Request) bool {
	p := r.URL.Path
	switch {
	case strings.HasPrefix(p, "/api/articles/") && strings.HasSuffix(p, "/comments"):
		id := strings.TrimSuffix(strings.TrimPrefix(p, "/api/articles/"), "/comments")
		if !idPattern.MatchString(id) {
			apiError(w, 404, "article not found")
			return true
		}
		switch r.Method {
		case "GET":
			if _, ok := app.store.published(id); !ok {
				apiError(w, 404, "article not found")
				return true
			}
			jsonResponse(w, 200, map[string][]PublicComment{"comments": app.comments.public(id)})
		case "POST":
			app.submitComment(w, r, id)
		default:
			apiError(w, 405, "method not allowed")
		}
		return true
	case p == "/api/admin/comments" && r.Method == "GET":
		jsonResponse(w, 200, map[string][]Comment{"comments": app.comments.all()})
		return true
	case strings.HasPrefix(p, "/api/admin/comments/"):
		id := strings.TrimPrefix(p, "/api/admin/comments/")
		if !idPattern.MatchString(id) {
			apiError(w, 404, errCommentNotFound.Error())
			return true
		}
		switch r.Method {
		case "PUT":
			var body struct {
				Status string `json:"status"`
			}
			if !decodeRequest(w, r, &body) {
				return true
			}
			if !oneOf(body.Status, "approved", "hidden", "pending") {
				apiError(w, 400, "status must be approved, hidden or pending")
				return true
			}
			c, err := app.comments.moderate(id, body.Status)
			if err != nil {
				app.commentError(w, err)
				return true
			}
			jsonResponse(w, 200, map[string]Comment{"comment": c})
		case "DELETE":
			if err := app.comments.remove(id); err != nil {
				app.commentError(w, err)
				return true
			}
			jsonResponse(w, 200, map[string]bool{"deleted": true})
		default:
			apiError(w, 405, "method not allowed")
		}
		return true
	}
	return false
}

func (app *App) commentError(w http.ResponseWriter, err error) {
	if errors.Is(err, errCommentNotFound) {
		apiError(w, 404, err.Error())
		return
	}
	apiError(w, 500, "comment could not be saved")
}
