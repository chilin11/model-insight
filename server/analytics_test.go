package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func analyticsFixture(t *testing.T) (*App, *time.Time) {
	t.Helper()
	app := fixture(t)
	s, err := newAnalyticsStore(filepath.Dir(app.store.path))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2030, 1, 1, 15, 59, 59, 0, time.UTC)
	s.now = func() time.Time { return now }
	s.limiter.now = s.now
	s.data.StartedAt = now.Format(time.RFC3339Nano)
	s.data.UpdatedAt = s.data.StartedAt
	if err = s.commit(s.data); err != nil {
		t.Fatal(err)
	}
	app.analytics = s
	return app, &now
}

func analyticsPost(app *App, raw string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "http://example.test/api/stats/event", strings.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "http://example.test")
	r.Header.Set("X-Requested-With", "model-insight")
	r.Header.Set("User-Agent", "Mozilla/5.0 test-browser")
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	return w
}

func readAnalyticsReport(t *testing.T, w *httptest.ResponseRecorder) analyticsReport {
	t.Helper()
	status(t, w, 200)
	var out analyticsReport
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func analyticsBytes(t *testing.T, path string) []byte {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func exactAnalyticsKeys(t *testing.T, object map[string]any, want ...string) {
	t.Helper()
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	sort.Strings(want)
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("JSON keys %v, want %v", keys, want)
	}
}

func TestAnalyticsAPIContractAndAuthentication(t *testing.T) {
	app, _ := analyticsFixture(t)
	status(t, request(app, "GET", "/api/admin/stats", nil, nil, "", "", ""), 401)
	status(t, request(app, "GET", "/api/admin/stats", nil, nil, "", "", apiSecret), 401)
	cookie := login(t, app)
	status(t, request(app, "GET", "/api/admin/stats", nil, cookie, "", "", apiSecret), 401)
	w := adminRequest(app, "GET", "/api/admin/stats", nil, cookie)
	r := readAnalyticsReport(t, w)
	if r.Days != 30 || len(r.Daily) != 30 || r.Timezone != "Asia/Shanghai" || r.Totals != (analyticsCounts{}) || len(r.Articles) != 1 || r.Articles[0].ID != "existing" || r.Articles[0].Views != 0 {
		t.Fatalf("bad initial report: %+v", r)
	}
	for _, day := range r.Daily {
		if day.PageViews != 0 || day.ArticleViews != 0 {
			t.Fatal("history was fabricated")
		}
	}
	var shape map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &shape); err != nil {
		t.Fatal(err)
	}
	exactAnalyticsKeys(t, shape, "startedAt", "updatedAt", "timezone", "days", "totals", "today", "period", "daily", "articles")
	for _, key := range []string{"totals", "today", "period"} {
		exactAnalyticsKeys(t, shape[key].(map[string]any), "pageViews", "articleViews")
	}
	exactAnalyticsKeys(t, shape["daily"].([]any)[0].(map[string]any), "date", "pageViews", "articleViews")
	exactAnalyticsKeys(t, shape["articles"].([]any)[0].(map[string]any), "id", "title", "status", "views", "periodViews", "todayViews")
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("admin report is cacheable")
	}
	for _, raw := range []string{`{"type":"pageview"}`, `{"type":"article","articleId":"existing"}`} {
		w = analyticsPost(app, raw, nil)
		status(t, w, 204)
		if w.Body.Len() != 0 || len(w.Result().Cookies()) != 0 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("event response must be empty, uncached, and set no identifiers")
		}
	}
	r = readAnalyticsReport(t, adminRequest(app, "GET", "/api/admin/stats?days=7", nil, cookie))
	if r.Totals != (analyticsCounts{PageViews: 1, ArticleViews: 1}) || r.Today != r.Totals || r.Period != r.Totals || r.Articles[0].Views != 1 || r.Articles[0].PeriodViews != 1 || r.Articles[0].TodayViews != 1 {
		t.Fatalf("counts are not independent events: %+v", r)
	}
	for _, method := range []string{"GET", "HEAD", "PUT", "OPTIONS"} {
		status(t, request(app, method, "/api/stats/event", nil, nil, "", "", ""), 405)
	}
	status(t, adminRequest(app, "POST", "/api/admin/stats", nil, cookie), 405)
}

func TestAnalyticsInvalidEventsAndCSRF(t *testing.T) {
	app, _ := analyticsFixture(t)
	before := analyticsBytes(t, app.analytics.path)
	for _, bad := range []struct{ origin, csrf string }{
		{"", "model-insight"}, {"null", "model-insight"}, {"http://evil.test", "model-insight"},
		{"http://example.test/", "model-insight"}, {"http://user@example.test", "model-insight"},
		{"http://example.test:80", "model-insight"}, {"http://example.test", ""}, {"http://example.test", "other"},
	} {
		status(t, analyticsPost(app, `{"type":"pageview"}`, func(r *http.Request) {
			r.Header.Set("Origin", bad.origin)
			r.Header.Set("X-Requested-With", bad.csrf)
		}), 403)
	}
	for _, raw := range []string{
		``, `null`, `[]`, `{}`, `{"type":null}`, `{"type":"other"}`, `{"type":1}`,
		`{"type":"article"}`, `{"type":"article","articleId":null}`, `{"type":"article","articleId":""}`,
		`{"type":"article","articleId":1}`, `{"type":"article","articleId":{}}`,
		`{"type":"article","articleId":"../existing"}`, `{"type":"article","articleId":"UPPER"}`,
		`{"type":"article","articleId":"` + strings.Repeat("a", 81) + `"}`,
		`{"type":"pageview","articleId":"existing"}`, `{"type":"pageview","articleId":""}`, `{"type":"pageview","articleId":null}`,
		`{"type":"pageview","ip":"private"}`, `{"type":"pageview","type":"article"}`,
		`{"type":"pageview","TYPE":"pageview"}`, `{"type":"article","articleId":"existing","articleId":"existing"}`,
		`{"type":"pageview"} {}`, `{"type":"pageview"} garbage`,
	} {
		t.Run(raw, func(t *testing.T) { status(t, analyticsPost(app, raw, nil), 400) })
	}
	status(t, analyticsPost(app, `{"type":"pageview"}`+strings.Repeat(" ", maxAnalyticsBody), nil), 413)
	status(t, analyticsPost(app, `{"type":"pageview"}`, func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") }), 415)
	status(t, analyticsPost(app, `{"type":"pageview"}`, func(r *http.Request) { r.URL.RawQuery = "x=1" }), 400)
	for _, id := range []string{"unknown", "secret-draft"} {
		status(t, analyticsPost(app, `{"type":"article","articleId":"`+id+`"}`, nil), 404)
	}
	if !bytes.Equal(before, analyticsBytes(t, app.analytics.path)) {
		t.Fatal("rejected requests changed analytics")
	}
	cookie := login(t, app)
	for _, query := range []string{"days=0", "days=1", "days=31", "days=", "days", "days=07", "days=+7", "days=30.0", "days=-7", "days=7&days=7", "days=7&x=1", "x=1", "Days=7", "days=7;30", "days=%zz", "days=7&", "&"} {
		status(t, adminRequest(app, "GET", "/api/admin/stats?"+query, nil, cookie), 400)
	}
	for _, days := range []int{7, 30, 90} {
		r := readAnalyticsReport(t, adminRequest(app, "GET", fmt.Sprintf("/api/admin/stats?days=%d", days), nil, cookie))
		if r.Days != days || len(r.Daily) != days {
			t.Fatalf("wrong window: %+v", r)
		}
	}
}

func TestAnalyticsPrivacyExclusionsAndDataIsolation(t *testing.T) {
	app, _ := analyticsFixture(t)
	cookie := login(t, app)
	before := analyticsBytes(t, app.analytics.path)
	writeCount := 0
	app.analytics.write = func(path string, b []byte) error { writeCount++; return atomicWrite(path, b) }
	for _, headers := range []map[string]string{
		{"DNT": "1"}, {"Sec-GPC": "1"}, {"User-Agent": "Googlebot/2.1"}, {"User-Agent": "bingBOT"},
		{"User-Agent": "Some Spider"}, {"User-Agent": "Crawler"}, {"User-Agent": "curl/8.0"},
		{"User-Agent": "Wget/1.0"}, {"User-Agent": "HeadlessChrome"}, {"User-Agent": "python-requests/2"},
		{"User-Agent": "Go-http-client/1.1"}, {"User-Agent": "facebookexternalhit/1.1"},
	} {
		for _, raw := range []string{`{"type":"pageview"}`, `{"type":"article","articleId":"existing"}`} {
			status(t, analyticsPost(app, raw, func(r *http.Request) {
				for key, value := range headers {
					r.Header.Set(key, value)
				}
			}), 204)
		}
	}
	status(t, analyticsPost(app, `{"type":"pageview"}`, func(r *http.Request) { r.AddCookie(cookie) }), 204)
	status(t, analyticsPost(app, `{"type":"article","articleId":"existing"}`, func(r *http.Request) { r.AddCookie(cookie) }), 204)
	if writeCount != 0 || len(app.analytics.limiter.ips) != 0 || !bytes.Equal(before, analyticsBytes(t, app.analytics.path)) {
		t.Fatal("excluded visits were stored or used limiter capacity")
	}
	writeJSON(t, app.comments.path, map[string]any{"comments": []any{}})
	media := filepath.Join(app.mediaDir, "private.bin")
	if err := os.WriteFile(media, []byte("unchanged media"), 0600); err != nil {
		t.Fatal(err)
	}
	siblings := map[string][]byte{}
	for _, path := range []string{app.store.path, app.comments.path, media} {
		siblings[path] = analyticsBytes(t, path)
	}
	status(t, analyticsPost(app, `{"type":"article","articleId":"existing"}`, func(r *http.Request) {
		r.RemoteAddr = "203.0.113.45:54321"
		r.Header.Set("User-Agent", "Mozilla/5.0 PRIVATE-UA-MARKER")
		r.Header.Set("Referer", "https://example.test/PRIVATE-REFERRER")
		r.Header.Set("CF-Connecting-IP", "198.51.100.25") // Untrusted nonlocal peer.
		r.Header.Set("DNT", "0")
		r.Header.Set("Sec-GPC", "0")
		r.AddCookie(&http.Cookie{Name: cookieName, Value: "INVALID-PRIVATE-COOKIE"})
	}), 204)
	b := analyticsBytes(t, app.analytics.path)
	for _, private := range []string{"203.0.113", "198.51.100", "PRIVATE", "Title", "userAgent", "referrer", "cookie", "visitor"} {
		if bytes.Contains(b, []byte(private)) {
			t.Fatalf("stored request metadata %q: %s", private, b)
		}
	}
	if _, ok := app.analytics.limiter.ips["203.0.113.45"]; !ok {
		t.Fatal("trusted a spoofed proxy address")
	}
	for path, before := range siblings {
		if !bytes.Equal(before, analyticsBytes(t, path)) {
			t.Fatalf("analytics touched %s", path)
		}
	}
	// An expired admin session is a reader again, not a permanent identifier.
	app.auth.now = func() time.Time { return time.Now().Add(sessionLife + time.Hour) }
	status(t, analyticsPost(app, `{"type":"pageview"}`, func(r *http.Request) { r.AddCookie(cookie) }), 204)
	if app.analytics.data.Totals != (analyticsCounts{PageViews: 1, ArticleViews: 1}) {
		t.Fatal("invalid/expired sessions were excluded")
	}
}

func TestAnalyticsTimezoneRolloverRetentionAndRestart(t *testing.T) {
	app, now := analyticsFixture(t)
	s := app.analytics
	current := map[string]bool{"existing": true}
	start := s.data.StartedAt
	if err := s.record("pageview", "", current); err != nil {
		t.Fatal(err)
	}
	if err := s.record("article", "existing", current); err != nil {
		t.Fatal(err)
	}
	*now = now.Add(time.Second) // 16:00 UTC is midnight in Shanghai.
	if err := s.record("article", "existing", current); err != nil {
		t.Fatal(err)
	}
	r := s.report(7, []Article{published("existing"), published("zero")})
	if r.Today != (analyticsCounts{ArticleViews: 1}) || r.Period != (analyticsCounts{PageViews: 1, ArticleViews: 2}) || r.Daily[5].Date != "2030-01-01" || r.Daily[6].Date != "2030-01-02" || r.Daily[5].ArticleViews != 1 || r.Daily[6].ArticleViews != 1 || r.Articles[0].TodayViews != 1 || r.Articles[1].Views != 0 {
		t.Fatalf("wrong timezone rollover: %+v", r)
	}
	base := *now
	for day := 1; day < 100; day++ {
		*now = base.AddDate(0, 0, day)
		if err := s.record("pageview", "", current); err != nil {
			t.Fatal(err)
		}
		if err := s.record("article", "existing", current); err != nil {
			t.Fatal(err)
		}
	}
	if len(s.data.Daily) != 90 || len(s.data.Articles["existing"].Daily) != 90 || s.data.Totals != (analyticsCounts{PageViews: 100, ArticleViews: 101}) {
		t.Fatalf("unbounded or lost totals: %+v", s.data.Totals)
	}
	for _, days := range []int{7, 30, 90} {
		r = s.report(days, []Article{published("existing")})
		if r.Period != (analyticsCounts{PageViews: int64(days), ArticleViews: int64(days)}) || r.Articles[0].PeriodViews != int64(days) || r.Articles[0].Views != 101 || len(r.Daily) != days {
			t.Fatalf("bad %d-day window: %+v", days, r)
		}
		for i := 1; i < len(r.Daily); i++ {
			if r.Daily[i-1].Date >= r.Daily[i].Date {
				t.Fatal("daily must be ascending")
			}
		}
	}
	before := s.report(90, []Article{published("existing")})
	reloaded, err := newAnalyticsStore(filepath.Dir(s.path))
	if err != nil {
		t.Fatal(err)
	}
	reloaded.now = s.now
	if got := reloaded.report(90, []Article{published("existing")}); !reflect.DeepEqual(before, got) || got.StartedAt != start {
		t.Fatal("restart lost confirmed counters or deployment start")
	}
	// Reads after inactivity zero-fill without writing or advancing updatedAt.
	b := analyticsBytes(t, s.path)
	*now = now.AddDate(0, 0, 100)
	r = reloaded.report(90, []Article{published("existing")})
	if r.Today != (analyticsCounts{}) || r.Period != (analyticsCounts{}) || r.Totals != before.Totals || r.UpdatedAt != before.UpdatedAt || !bytes.Equal(b, analyticsBytes(t, s.path)) {
		t.Fatal("idle reports fabricated data or wrote to disk")
	}
	// Clock regression is clamped to the last successful event.
	*now = base
	r = reloaded.report(7, []Article{published("existing")})
	if r.Daily[6].Date != before.Daily[89].Date {
		t.Fatal("clock regression hid newer data")
	}
}

func TestAnalyticsHistoricalArticlesBoundedAndAnonymous(t *testing.T) {
	app, _ := analyticsFixture(t)
	s := app.analytics
	if err := s.record("article", "existing", map[string]bool{"existing": true}); err != nil {
		t.Fatal(err)
	}
	r := s.report(30, []Article{{ID: "existing", Title: "PRIVATE-DRAFT-TITLE", Status: "draft"}, published("zero")})
	if len(r.Articles) != 2 || r.Articles[0].Title != "Unlisted article" || r.Articles[0].Status != "draft" {
		t.Fatalf("unlisted article title leaked: %+v", r.Articles)
	}
	r = s.report(30, []Article{published("zero")})
	if r.Articles[0].Title != "Deleted article" || r.Articles[0].Status != "deleted" || r.Articles[0].Views != 1 {
		t.Fatalf("deleted article mishandled: %+v", r.Articles)
	}
	// Simulate years of deleted-ID churn without thousands of fsyncs.
	day := analyticsDate(s.now())
	for i := 0; i < analyticsHistoryLimit+20; i++ {
		s.data.Articles[fmt.Sprintf("deleted-%04d", i)] = analyticsArticle{Views: 1, Daily: map[string]int64{day: 1}}
	}
	s.data.Totals.ArticleViews = int64(len(s.data.Articles))
	s.data.Daily[day] = analyticsCounts{ArticleViews: s.data.Totals.ArticleViews}
	if err := s.record("pageview", "", map[string]bool{"existing": true}); err != nil {
		t.Fatal(err)
	}
	if len(s.data.Articles) != analyticsHistoryLimit+1 || s.data.Articles["existing"].Views != 1 || s.data.Totals.ArticleViews != analyticsHistoryLimit+21 {
		t.Fatal("deleted records unbounded or all-time totals lost")
	}
	if err := validateAnalyticsFile(filepath.Dir(s.path)); err != nil {
		t.Fatalf("eviction made invalid stats: %v", err)
	}
}

func TestAnalyticsPersistenceFailureDoesNotAdvanceConfirmedCounters(t *testing.T) {
	app, now := analyticsFixture(t)
	s := app.analytics
	status(t, analyticsPost(app, `{"type":"article","articleId":"existing"}`, nil), 204)
	beforeDisk := analyticsBytes(t, s.path)
	before, _ := json.Marshal(s.data)
	s.write = func(string, []byte) error { return errors.New("injected write failure") }
	for _, typ := range []string{"pageview", "article"} {
		raw := `{"type":"pageview"}`
		if typ == "article" {
			raw = `{"type":"article","articleId":"existing"}`
		}
		status(t, analyticsPost(app, raw, nil), 503)
		after, _ := json.Marshal(s.data)
		if !bytes.Equal(before, after) || !bytes.Equal(beforeDisk, analyticsBytes(t, s.path)) {
			t.Fatal("failed write mutated confirmed totals/daily/article maps")
		}
	}
	*now = now.AddDate(0, 0, 100)
	status(t, analyticsPost(app, `{"type":"pageview"}`, nil), 503)
	after, _ := json.Marshal(s.data)
	if !bytes.Equal(before, after) {
		t.Fatal("failed rollover pruned confirmed counters")
	}
	r := readAnalyticsReport(t, adminRequest(app, "GET", "/api/admin/stats", nil, login(t, app)))
	if r.Totals.ArticleViews != 1 || r.Totals.PageViews != 0 {
		t.Fatal("GET presented unconfirmed counters")
	}
	s.write = atomicWrite
	status(t, analyticsPost(app, `{"type":"pageview"}`, nil), 204)
	reloaded, err := newAnalyticsStore(filepath.Dir(s.path))
	if err != nil || reloaded.data.Totals != (analyticsCounts{PageViews: 1, ArticleViews: 1}) {
		t.Fatalf("recovery/restart lost counters: %v", err)
	}
}

func TestAnalyticsCorruptionPreservedAndDisabled(t *testing.T) {
	app, _ := analyticsFixture(t)
	valid := string(analyticsBytes(t, app.analytics.path))
	for _, bad := range []string{
		`{`, `{}`, `null`, `[]`, `{"version":1}`,
		strings.Replace(valid, `"version":1`, `"version":2`, 1),
		strings.Replace(valid, `"version":1`, `"version":1,"version":1`, 1),
		strings.Replace(valid, `"pageViews":0`, `"pageViews":-1`, 1),
		strings.Replace(valid, `"articleViews":0`, `"articleViews":9007199254740992`, 1),
		strings.Replace(valid, `"pageViews":0,`, ``, 1),
		strings.Replace(valid, `"daily":{}`, `"daily":null`, 1),
		strings.Replace(valid, `"articles":{}`, `"articles":null`, 1),
		strings.Replace(valid, `"daily":{}`, `"daily":{"2030-02-30":{"pageViews":1,"articleViews":0}}`, 1),
		strings.Replace(valid, `"daily":{}`, `"daily":{"2029-12-31":{"pageViews":0,"articleViews":0}}`, 1),
		strings.Replace(valid, `"daily":{}`, `"daily":{"2030-01-01":{"pageViews":1,"articleViews":0}}`, 1),
		strings.Replace(valid, `"articles":{}`, `"articles":{"x":{"views":1,"daily":{}}}`, 1),
		strings.Replace(valid, `"articles":{}`, `"articles":{"x":{"views":0}}`, 1),
		strings.Replace(valid, `"articles":{}`, `"articles":{"x":null}`, 1),
		strings.Replace(valid, `"timezone":"Asia/Shanghai"`, `"timezone":"UTC"`, 1),
		strings.Replace(valid, `"version":1`, `"version":1,"future":true`, 1),
	} {
		dir := t.TempDir()
		path := filepath.Join(dir, "analytics.json")
		if err := os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if err := validateAnalyticsFile(dir); err == nil {
			t.Fatalf("check-config accepted corrupt file: %s", bad)
		}
		s, err := newAnalyticsStore(dir)
		if err == nil || s != nil {
			t.Fatalf("corrupt file silently replaced: %s", bad)
		}
		if !bytes.Equal([]byte(bad), analyticsBytes(t, path)) {
			t.Fatal("corrupt file overwritten")
		}
	}
	app.analytics = nil // The startup fallback and old App fixtures.
	cookie := login(t, app)
	status(t, adminRequest(app, "GET", "/api/admin/stats", nil, cookie), 503)
	status(t, analyticsPost(app, `{"type":"pageview"}`, nil), 503)
	status(t, request(app, "GET", "/api/articles", nil, nil, "", "", ""), 200)
	status(t, request(app, "GET", "/healthz", nil, nil, "", "", ""), 200)
	status(t, adminRequest(app, "GET", "/api/admin/articles", nil, cookie), 200)
	missing := t.TempDir()
	if err := validateAnalyticsFile(missing); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(missing, "analytics.json")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("check-config initialized missing data")
	}
	s, err := newAnalyticsStore(missing)
	if err != nil || s.data.Totals != (analyticsCounts{}) || s.data.StartedAt == "" {
		t.Fatalf("fresh deployment not initialized: %v", err)
	}
	info, err := os.Stat(s.path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("analytics file permissions: %v %v", info, err)
	}
}

func TestAnalyticsDiskBoundsSymlinksAndOverflow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "analytics.json")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = f.Truncate(maxAnalyticsFile + 1); err != nil {
		t.Fatal(err)
	}
	if err = f.Close(); err != nil {
		t.Fatal(err)
	}
	if validateAnalyticsFile(dir) == nil {
		t.Fatal("oversized file accepted")
	}
	if _, err = newAnalyticsStore(dir); err == nil {
		t.Fatal("oversized file initialized")
	}
	info, _ := os.Stat(path)
	if info.Size() != maxAnalyticsFile+1 {
		t.Fatal("oversized file was overwritten")
	}
	target := filepath.Join(t.TempDir(), "original.json")
	if err = os.WriteFile(target, []byte("private original"), 0600); err != nil {
		t.Fatal(err)
	}
	linkDir := t.TempDir()
	if err = os.Symlink(target, filepath.Join(linkDir, "analytics.json")); err != nil {
		t.Fatal(err)
	}
	if validateAnalyticsFile(linkDir) == nil {
		t.Fatal("symlink accepted")
	}
	if _, err = newAnalyticsStore(linkDir); err == nil || string(analyticsBytes(t, target)) != "private original" {
		t.Fatal("symlink target modified")
	}
	app, _ := analyticsFixture(t)
	s := app.analytics
	s.data.Totals.PageViews = maxAnalyticsCount
	if err = s.commit(s.data); err != nil {
		t.Fatal(err)
	}
	before := analyticsBytes(t, s.path)
	status(t, analyticsPost(app, `{"type":"pageview"}`, nil), 503)
	if !bytes.Equal(before, analyticsBytes(t, s.path)) || s.data.Totals.PageViews != maxAnalyticsCount {
		t.Fatal("overflow advanced counters")
	}
	candidate := s.data
	candidate.StartedAt = strings.Repeat("x", maxAnalyticsFile)
	writes := 0
	s.write = func(string, []byte) error { writes++; return nil }
	if err = s.commit(candidate); err == nil || writes != 0 || s.data.StartedAt == candidate.StartedAt {
		t.Fatal("oversized save was committed")
	}
}

func TestAnalyticsLimiterAndHTTPWriteLimit(t *testing.T) {
	now := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	l := newAnalyticsLimiter()
	l.now = func() time.Time { return now }
	for i := 0; i < analyticsIPLimit; i++ {
		if i > 0 && i%analyticsBurstLimit == 0 {
			now = now.Add(time.Second)
		}
		if !l.allow("one") {
			t.Fatalf("per-IP limit too early at %d", i)
		}
	}
	now = now.Add(time.Second)
	if l.allow("one") || !l.allow("two") {
		t.Fatal("per-IP limit did not isolate clients")
	}
	now = now.Add(time.Minute)
	if !l.allow("one") || len(l.ips) != 1 {
		t.Fatal("expired addresses were retained")
	}
	l = newAnalyticsLimiter()
	l.now = func() time.Time { return now }
	for i := 0; i < analyticsGlobalLimit; i++ {
		if i > 0 && i%analyticsBurstLimit == 0 {
			now = now.Add(time.Second)
		}
		if !l.allow(fmt.Sprint(i)) {
			t.Fatalf("global limit too early at %d", i)
		}
	}
	now = now.Add(time.Second)
	for i := 0; i < 5000; i++ {
		if l.allow(fmt.Sprint(analyticsGlobalLimit + i)) {
			t.Fatal("global limit bypassed")
		}
	}
	if len(l.ips) != analyticsGlobalLimit {
		t.Fatal("rejected new addresses grew map")
	}
	l = newAnalyticsLimiter()
	l.now = func() time.Time { return now }
	for i := 0; i < analyticsLimiterSize; i++ {
		l.ips[fmt.Sprint(i)] = analyticsWindow{start: now}
	}
	if l.allow("new") || len(l.ips) != analyticsLimiterSize || !l.allow("0") {
		t.Fatal("map cap failed or existing clients blocked")
	}
	now = now.Add(time.Minute)
	if !l.allow("new") || len(l.ips) != 1 {
		t.Fatal("map did not reclaim expired slots")
	}
	app, _ := analyticsFixture(t)
	for i := 0; i < analyticsBurstLimit; i++ {
		status(t, analyticsPost(app, `{"type":"pageview"}`, nil), 204)
	}
	w := analyticsPost(app, `{"type":"pageview"}`, nil)
	status(t, w, 429)
	if w.Header().Get("Retry-After") == "" || app.analytics.data.Totals.PageViews != analyticsBurstLimit {
		t.Fatal("limiter advanced counters or omitted retry hint")
	}
}

func TestAnalyticsConcurrentWritesReportsAndLimiter(t *testing.T) {
	app, _ := analyticsFixture(t)
	s := app.analytics
	current := map[string]bool{"existing": true}
	var wg sync.WaitGroup
	for i := 0; i < 80; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			typ, id := "pageview", ""
			if i%2 == 0 {
				typ, id = "article", "existing"
			}
			if err := s.record(typ, id, current); err != nil {
				t.Errorf("concurrent save: %v", err)
			}
			_ = s.report(30, []Article{published("existing")})
		}(i)
	}
	wg.Wait()
	reloaded, err := newAnalyticsStore(filepath.Dir(s.path))
	if err != nil || reloaded.data.Totals != (analyticsCounts{PageViews: 40, ArticleViews: 40}) || reloaded.data.Articles["existing"].Views != 40 {
		t.Fatalf("lost concurrent commits: %v", err)
	}
	var admitted atomic.Int64
	for i := 0; i < 80; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := analyticsPost(app, `{"type":"pageview"}`, nil)
			switch w.Code {
			case 204:
				admitted.Add(1)
			case 429:
			default:
				t.Errorf("concurrent endpoint: %d %s", w.Code, w.Body.String())
			}
		}()
	}
	wg.Wait()
	if admitted.Load() != analyticsBurstLimit || s.data.Totals.PageViews != 40+analyticsBurstLimit {
		t.Fatalf("limiter race: %d admitted, %d confirmed", admitted.Load(), s.data.Totals.PageViews)
	}
}
