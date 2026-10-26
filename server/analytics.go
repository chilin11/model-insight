package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	analyticsTimezone           = "Asia/Shanghai"
	analyticsRetention          = 90
	analyticsHistoryLimit       = 1000 // Deleted IDs, never titles; current articles have their own 5000 limit.
	maxAnalyticsArticles        = maxArticles + analyticsHistoryLimit
	maxAnalyticsFile            = 32 << 20
	maxAnalyticsBody            = 1024
	maxAnalyticsCount     int64 = 1<<53 - 1 // Exact in the browser's JSON number representation.
	analyticsIPLimit            = 30        // Per minute.
	analyticsGlobalLimit        = 120       // Per minute, additionally at most 10 atomic writes per second.
	analyticsBurstLimit         = 10
	analyticsLimiterSize        = 2048
)

var analyticsZone = time.FixedZone(analyticsTimezone, 8*60*60)
var errAnalyticsUnavailable = errors.New("analytics unavailable")

// These are event counts, not unique visitors or click-through rates. No request
// metadata, titles, cookies, user identifiers or addresses belong in this file.
type analyticsCounts struct {
	PageViews    int64 `json:"pageViews"`
	ArticleViews int64 `json:"articleViews"`
}

func (c *analyticsCounts) UnmarshalJSON(b []byte) error {
	var v struct {
		PageViews    *int64 `json:"pageViews"`
		ArticleViews *int64 `json:"articleViews"`
	}
	if err := strictJSON(bytes.NewReader(b), &v); err != nil {
		return err
	}
	if v.PageViews == nil || v.ArticleViews == nil {
		return errAnalyticsUnavailable
	}
	*c = analyticsCounts{*v.PageViews, *v.ArticleViews}
	return nil
}

type analyticsArticle struct {
	Views int64            `json:"views"`
	Daily map[string]int64 `json:"daily"`
}

func (a *analyticsArticle) UnmarshalJSON(b []byte) error {
	var v struct {
		Views *int64            `json:"views"`
		Daily *map[string]int64 `json:"daily"`
	}
	if err := strictJSON(bytes.NewReader(b), &v); err != nil {
		return err
	}
	if v.Views == nil || v.Daily == nil {
		return errAnalyticsUnavailable
	}
	*a = analyticsArticle{*v.Views, *v.Daily}
	return nil
}

type analyticsData struct {
	Version   int                         `json:"version"`
	StartedAt string                      `json:"startedAt"`
	UpdatedAt string                      `json:"updatedAt"`
	Timezone  string                      `json:"timezone"`
	Totals    analyticsCounts             `json:"totals"`
	Daily     map[string]analyticsCounts  `json:"daily"`
	Articles  map[string]analyticsArticle `json:"articles"`
}

type AnalyticsStore struct {
	mu      sync.Mutex
	data    analyticsData
	path    string
	write   func(string, []byte) error
	now     func() time.Time
	limiter *analyticsLimiter
}

func analyticsDate(t time.Time) string { return t.In(analyticsZone).Format("2006-01-02") }
func analyticsMidnight(t time.Time) time.Time {
	t = t.In(analyticsZone)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, analyticsZone)
}
func validAnalyticsCount(n int64) bool { return n >= 0 && n <= maxAnalyticsCount }
func addAnalyticsCount(sum *int64, n int64) bool {
	if !validAnalyticsCount(n) || *sum > maxAnalyticsCount-n {
		return false
	}
	*sum += n
	return true
}

// Loading and -check-config are read-only, size bounded, and reject partial
// schemas as well as malformed JSON. A corrupt file is never a fresh deployment.
func loadAnalytics(path string) (analyticsData, error) {
	var out analyticsData
	info, err := os.Lstat(path)
	if err != nil {
		return out, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxAnalyticsFile {
		return out, errAnalyticsUnavailable
	}
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	var v struct {
		Version   *int                         `json:"version"`
		StartedAt *string                      `json:"startedAt"`
		UpdatedAt *string                      `json:"updatedAt"`
		Timezone  *string                      `json:"timezone"`
		Totals    *analyticsCounts             `json:"totals"`
		Daily     *map[string]analyticsCounts  `json:"daily"`
		Articles  *map[string]analyticsArticle `json:"articles"`
	}
	b, err := io.ReadAll(io.LimitReader(f, maxAnalyticsFile+1))
	if err != nil || len(b) > maxAnalyticsFile {
		return out, errAnalyticsUnavailable
	}
	if err = strictJSON(bytes.NewReader(b), &v); err != nil {
		return out, err
	}
	if v.Version == nil || v.StartedAt == nil || v.UpdatedAt == nil || v.Timezone == nil || v.Totals == nil || v.Daily == nil || v.Articles == nil {
		return out, errAnalyticsUnavailable
	}
	out = analyticsData{*v.Version, *v.StartedAt, *v.UpdatedAt, *v.Timezone, *v.Totals, *v.Daily, *v.Articles}
	if err = validateAnalyticsData(out); err != nil {
		return analyticsData{}, err
	}
	return out, nil
}

func validateAnalyticsData(d analyticsData) error {
	start, e1 := time.Parse(time.RFC3339Nano, d.StartedAt)
	updated, e2 := time.Parse(time.RFC3339Nano, d.UpdatedAt)
	if e1 != nil || e2 != nil || start.IsZero() || updated.Before(start) || d.Version != 1 || d.Timezone != analyticsTimezone || d.Daily == nil || d.Articles == nil || len(d.Daily) > analyticsRetention || len(d.Articles) > maxAnalyticsArticles || !validAnalyticsCount(d.Totals.PageViews) || !validAnalyticsCount(d.Totals.ArticleViews) {
		return errAnalyticsUnavailable
	}
	first := analyticsDate(analyticsMidnight(updated).AddDate(0, 0, 1-analyticsRetention))
	last := analyticsDate(updated)
	started := analyticsDate(start)
	validDay := func(day string) bool {
		t, err := time.Parse("2006-01-02", day)
		return err == nil && t.Format("2006-01-02") == day && day >= first && day >= started && day <= last
	}
	var sum analyticsCounts
	for day, c := range d.Daily {
		if !validDay(day) || !addAnalyticsCount(&sum.PageViews, c.PageViews) || !addAnalyticsCount(&sum.ArticleViews, c.ArticleViews) {
			return errAnalyticsUnavailable
		}
	}
	if sum.PageViews > d.Totals.PageViews || sum.ArticleViews > d.Totals.ArticleViews {
		return errAnalyticsUnavailable
	}
	var total int64
	byDay := map[string]int64{}
	for id, a := range d.Articles {
		if !idPattern.MatchString(id) || a.Views <= 0 || !addAnalyticsCount(&total, a.Views) || a.Daily == nil || len(a.Daily) > analyticsRetention {
			return errAnalyticsUnavailable
		}
		var sum int64
		for day, n := range a.Daily {
			if !validDay(day) || n <= 0 || !addAnalyticsCount(&sum, n) {
				return errAnalyticsUnavailable
			}
			v := byDay[day]
			if !addAnalyticsCount(&v, n) || v > d.Daily[day].ArticleViews {
				return errAnalyticsUnavailable
			}
			byDay[day] = v
		}
		if sum > a.Views {
			return errAnalyticsUnavailable
		}
	}
	if total > d.Totals.ArticleViews {
		return errAnalyticsUnavailable
	}
	return nil
}

func validateAnalyticsFile(dir string) error {
	_, err := loadAnalytics(filepath.Join(dir, "analytics.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func newAnalyticsStore(dir string) (*AnalyticsStore, error) {
	s := &AnalyticsStore{path: filepath.Join(dir, "analytics.json"), write: atomicWrite, now: time.Now, limiter: newAnalyticsLimiter()}
	d, err := loadAnalytics(s.path)
	if errors.Is(err, os.ErrNotExist) {
		stamp := s.now().UTC().Format(time.RFC3339Nano)
		d = analyticsData{Version: 1, StartedAt: stamp, UpdatedAt: stamp, Timezone: analyticsTimezone, Daily: map[string]analyticsCounts{}, Articles: map[string]analyticsArticle{}}
		// Persist the deployment start even if no visitor ever submits an event.
		if err = s.commit(d); err != nil {
			return nil, err
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	s.data = d
	return s, nil
}

// The rename inside atomicWrite is the commit point. Never advance the confirmed
// in-memory counters on failure. No analytics backup/seed can replace this file.
func (s *AnalyticsStore) commit(d analyticsData) error {
	b, err := json.Marshal(d)
	if err != nil {
		return err
	}
	if len(b)+1 > maxAnalyticsFile {
		return errAnalyticsUnavailable
	}
	if err = s.write(s.path, append(b, '\n')); err != nil {
		return err
	}
	s.data = d
	return nil
}

func (s *AnalyticsStore) effectiveNow() time.Time {
	now := s.now()
	updated, _ := time.Parse(time.RFC3339Nano, s.data.UpdatedAt)
	if now.Before(updated) {
		return updated // Clock regression must not erase newer daily counts.
	}
	return now
}

func cloneAnalytics(d analyticsData, now time.Time, current map[string]bool) analyticsData {
	next := d
	first := analyticsDate(analyticsMidnight(now).AddDate(0, 0, 1-analyticsRetention))
	next.Daily = make(map[string]analyticsCounts, analyticsRetention)
	for day, c := range d.Daily {
		if day >= first {
			next.Daily[day] = c
		}
	}
	next.Articles = make(map[string]analyticsArticle, len(d.Articles))
	type historical struct{ id, last string }
	deleted := []historical{}
	for id, a := range d.Articles {
		days := make(map[string]int64, len(a.Daily))
		last := ""
		for day, n := range a.Daily {
			if day >= first {
				days[day] = n
			}
			if day > last {
				last = day
			}
		}
		next.Articles[id] = analyticsArticle{Views: a.Views, Daily: days}
		if !current[id] {
			deleted = append(deleted, historical{id, last})
		}
	}
	// Bound deleted-ID churn independently of the current content cap. Eviction
	// drops only that ID's breakdown, never site-wide all-time/daily totals.
	sort.Slice(deleted, func(i, j int) bool {
		if deleted[i].last != deleted[j].last {
			return deleted[i].last < deleted[j].last
		}
		return deleted[i].id < deleted[j].id
	})
	for i := 0; i < len(deleted)-analyticsHistoryLimit; i++ {
		delete(next.Articles, deleted[i].id)
	}
	return next
}

// The caller holds the content read lock through this transaction so a draft or
// deletion cannot race the published-article check. Lock order: content, stats.
func (s *AnalyticsStore) record(typ, id string, current map[string]bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.effectiveNow()
	next := cloneAnalytics(s.data, now, current)
	day := analyticsDate(now)
	counts := next.Daily[day]
	if typ == "pageview" {
		if !addAnalyticsCount(&next.Totals.PageViews, 1) || !addAnalyticsCount(&counts.PageViews, 1) {
			return errAnalyticsUnavailable
		}
	} else {
		a, ok := next.Articles[id]
		if !ok {
			if len(next.Articles) >= maxAnalyticsArticles {
				return errAnalyticsUnavailable
			}
			a.Daily = map[string]int64{}
		}
		n := a.Daily[day]
		if !addAnalyticsCount(&next.Totals.ArticleViews, 1) || !addAnalyticsCount(&counts.ArticleViews, 1) || !addAnalyticsCount(&a.Views, 1) || !addAnalyticsCount(&n, 1) {
			return errAnalyticsUnavailable
		}
		a.Daily[day] = n
		next.Articles[id] = a
	}
	next.Daily[day] = counts
	next.UpdatedAt = now.UTC().Format(time.RFC3339Nano)
	return s.commit(next)
}

type analyticsDailyReport struct {
	Date         string `json:"date"`
	PageViews    int64  `json:"pageViews"`
	ArticleViews int64  `json:"articleViews"`
}

type analyticsArticleReport struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	Views       int64  `json:"views"`
	PeriodViews int64  `json:"periodViews"`
	TodayViews  int64  `json:"todayViews"`
}

type analyticsReport struct {
	StartedAt string                   `json:"startedAt"`
	UpdatedAt string                   `json:"updatedAt"`
	Timezone  string                   `json:"timezone"`
	Days      int                      `json:"days"`
	Totals    analyticsCounts          `json:"totals"`
	Today     analyticsCounts          `json:"today"`
	Period    analyticsCounts          `json:"period"`
	Daily     []analyticsDailyReport   `json:"daily"`
	Articles  []analyticsArticleReport `json:"articles"`
}

func (s *AnalyticsStore) report(days int, current []Article) analyticsReport {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.effectiveNow()
	today := analyticsDate(now)
	first := analyticsMidnight(now).AddDate(0, 0, 1-days)
	out := analyticsReport{StartedAt: s.data.StartedAt, UpdatedAt: s.data.UpdatedAt, Timezone: analyticsTimezone, Days: days, Totals: s.data.Totals, Today: s.data.Daily[today], Daily: []analyticsDailyReport{}, Articles: []analyticsArticleReport{}}
	for i := 0; i < days; i++ {
		day := analyticsDate(first.AddDate(0, 0, i))
		c := s.data.Daily[day]
		out.Daily = append(out.Daily, analyticsDailyReport{Date: day, PageViews: c.PageViews, ArticleViews: c.ArticleViews})
		out.Period.PageViews += c.PageViews
		out.Period.ArticleViews += c.ArticleViews
	}
	seen := map[string]bool{}
	appendArticle := func(id, title, status string) {
		a := s.data.Articles[id]
		v := analyticsArticleReport{ID: id, Title: title, Status: status, Views: a.Views, TodayViews: a.Daily[today]}
		for _, day := range out.Daily {
			v.PeriodViews += a.Daily[day.Date]
		}
		out.Articles = append(out.Articles, v)
	}
	for _, a := range current {
		seen[a.ID] = true
		if a.Status == "published" {
			appendArticle(a.ID, a.Title, a.Status)
		} else if s.data.Articles[a.ID].Views > 0 {
			appendArticle(a.ID, "Unlisted article", a.Status)
		}
	}
	for id := range s.data.Articles {
		if !seen[id] {
			appendArticle(id, "Deleted article", "deleted")
		}
	}
	sort.Slice(out.Articles, func(i, j int) bool {
		a, b := out.Articles[i], out.Articles[j]
		if a.PeriodViews != b.PeriodViews {
			return a.PeriodViews > b.PeriodViews
		}
		if a.Views != b.Views {
			return a.Views > b.Views
		}
		return a.ID < b.ID
	})
	return out
}

// Fixed windows bound writes and memory even under rotating-address abuse. IPs
// expire after one minute (lazy pruning), never entering analyticsData or logs.
type analyticsWindow struct {
	start time.Time
	count int
}

type analyticsLimiter struct {
	mu     sync.Mutex
	ips    map[string]analyticsWindow
	minute analyticsWindow
	second analyticsWindow
	now    func() time.Time
}

func newAnalyticsLimiter() *analyticsLimiter {
	return &analyticsLimiter{ips: map[string]analyticsWindow{}, now: time.Now}
}
func (w analyticsWindow) active(now time.Time, span time.Duration) analyticsWindow {
	if now.Before(w.start) || now.Sub(w.start) >= span {
		return analyticsWindow{start: now}
	}
	return w
}
func (l *analyticsLimiter) allow(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.minute = l.minute.active(now, time.Minute)
	l.second = l.second.active(now, time.Second)
	// Prune on every attempt, including rejected requests from a stable address.
	for key, w := range l.ips {
		if now.Before(w.start) || now.Sub(w.start) >= time.Minute {
			delete(l.ips, key)
		}
	}
	mine, exists := l.ips[ip]
	mine = mine.active(now, time.Minute)
	if mine.count >= analyticsIPLimit || l.minute.count >= analyticsGlobalLimit || l.second.count >= analyticsBurstLimit || (!exists && len(l.ips) >= analyticsLimiterSize) {
		return false
	}
	mine.count++
	l.minute.count++
	l.second.count++
	l.ips[ip] = mine
	return true
}

func ignoreAnalytics(r *http.Request) bool {
	if strings.TrimSpace(r.Header.Get("DNT")) == "1" || strings.TrimSpace(r.Header.Get("Sec-GPC")) == "1" {
		return true
	}
	ua := strings.ToLower(r.UserAgent())
	for _, bot := range []string{"bot", "spider", "crawler", "slurp", "headless", "curl/", "wget/", "python-requests", "python-urllib", "go-http-client", "facebookexternalhit", "lighthouse", "pagespeed"} {
		if strings.Contains(ua, bot) {
			return true
		}
	}
	return false
}

func (app *App) analyticsEvent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !checkWrite(r, false) {
		apiError(w, 403, "invalid origin or CSRF header")
		return
	}
	if app.analytics == nil {
		apiError(w, 503, "analytics unavailable")
		return
	}
	if r.URL.RawQuery != "" {
		apiError(w, 400, "event query parameters are not supported")
		return
	}
	typ, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		apiError(w, 415, "Content-Type must be application/json")
		return
	}
	// RawMessage distinguishes omitted articleId from null or an empty string.
	var body struct {
		Type      string          `json:"type"`
		ArticleID json.RawMessage `json:"articleId"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAnalyticsBody)
	if err = strictJSON(r.Body, &body); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			apiError(w, 413, "event exceeds 1 KiB")
		} else {
			apiError(w, 400, "invalid JSON, duplicate key or unknown field")
		}
		return
	}
	id := ""
	if (body.Type != "pageview" && body.Type != "article") || (body.Type == "pageview" && len(body.ArticleID) != 0) || (body.Type == "article" && (json.Unmarshal(body.ArticleID, &id) != nil || !idPattern.MatchString(id))) {
		apiError(w, 400, "invalid event type or articleId")
		return
	}
	app.store.mu.RLock()
	defer app.store.mu.RUnlock()
	current := make(map[string]bool, len(app.store.content.Articles))
	published := false
	for _, a := range app.store.content.Articles {
		current[a.ID] = true
		if a.ID == id && a.Status == "published" {
			published = true
		}
	}
	if body.Type == "article" && !published {
		apiError(w, 404, "published article not found")
		return
	}
	if ignoreAnalytics(r) || (app.auth != nil && app.auth.authenticated(r)) {
		w.WriteHeader(204)
		return
	}
	ip := net.ParseIP(clientKey(r))
	key := "unknown"
	if ip != nil {
		key = ip.String()
	}
	if !app.analytics.limiter.allow(key) {
		w.Header().Set("Retry-After", "60")
		apiError(w, 429, "too many analytics events")
		return
	}
	if err = app.analytics.record(body.Type, id, current); err != nil {
		apiError(w, 503, "analytics could not be saved")
		return
	}
	w.WriteHeader(204)
}

func (app *App) adminStats(w http.ResponseWriter, r *http.Request) {
	days := 30
	q, err := url.ParseQuery(r.URL.RawQuery)
	valid := err == nil
	if r.URL.RawQuery != "" {
		for _, field := range strings.Split(r.URL.RawQuery, "&") {
			valid = valid && field != ""
		}
	}
	for key, values := range q {
		if key != "days" || len(values) != 1 {
			valid = false
			continue
		}
		switch values[0] {
		case "7":
			days = 7
		case "30":
			days = 30
		case "90":
			days = 90
		default:
			valid = false
		}
	}
	if !valid {
		apiError(w, 400, "days must be 7, 30 or 90 (default 30), with no other parameters")
		return
	}
	if app.analytics == nil {
		apiError(w, 503, "analytics unavailable")
		return
	}
	jsonResponse(w, 200, app.analytics.report(days, app.store.snapshot(false).Articles))
}
