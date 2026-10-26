package main

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const cookieName = "model_insight_session"
const sessionLife = 8 * time.Hour

type Auth struct {
	mu       sync.Mutex
	admin    [32]byte
	api      [32]byte
	sessions map[[32]byte]time.Time
	failures map[string][]time.Time
	now      func() time.Time
}

func strongSecret(s string, n int) bool {
	chars := map[rune]bool{}
	for _, c := range s {
		if c <= 32 || c == 127 {
			return false
		}
		chars[c] = true
	}
	return len(s) >= n && len(chars) >= 8
}
func newAuth(admin, api string) (*Auth, error) {
	if !strongSecret(admin, 24) || !strongSecret(api, 32) || admin == api {
		return nil, errors.New("ADMIN_TOKEN and API_TOKEN must be distinct strong secrets (24/32+ characters, no whitespace, 8+ distinct characters)")
	}
	return &Auth{admin: sha256.Sum256([]byte(admin)), api: sha256.Sum256([]byte(api)), sessions: map[[32]byte]time.Time{}, failures: map[string][]time.Time{}, now: time.Now}, nil
}
func equalSecret(s string, expected [32]byte) bool {
	actual := sha256.Sum256([]byte(s))
	return subtle.ConstantTimeCompare(actual[:], expected[:]) == 1
}
func randomID(n int) (string, error) {
	b := make([]byte, n)
	_, err := rand.Read(b)
	return hex.EncodeToString(b), err
}
func (a *Auth) prune() {
	now := a.now()
	for key, until := range a.sessions {
		if !now.Before(until) {
			delete(a.sessions, key)
		}
	}
	for ip, attempts := range a.failures {
		first := 0
		for first < len(attempts) && !attempts[first].After(now.Add(-15*time.Minute)) {
			first++
		}
		if first == len(attempts) {
			delete(a.failures, ip)
		} else {
			a.failures[ip] = attempts[first:]
		}
	}
}
func (a *Auth) authenticated(r *http.Request) bool {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prune()
	until, ok := a.sessions[sha256.Sum256([]byte(cookie.Value))]
	return ok && a.now().Before(until)
}
func (a *Auth) bearer(r *http.Request) bool {
	h := r.Header.Get("Authorization")
	return strings.HasPrefix(h, "Bearer ") && equalSecret(strings.TrimPrefix(h, "Bearer "), a.api)
}

// HTTPS origins are allowed behind a local TLS-terminating tunnel; never trust
// X-Forwarded-Host/Proto or X-Forwarded-For supplied by arbitrary clients.
func checkWrite(r *http.Request, login bool) bool {
	if r.Header.Get("X-Requested-With") != "model-insight" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return login
	}
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.User == nil && u.Host != "" && strings.EqualFold(u.Host, r.Host) && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.Opaque == ""
}
func cookieSecure(r *http.Request) bool {
	return r.TLS != nil || strings.HasPrefix(r.Header.Get("Origin"), "https://")
}
func (a *Auth) login(w http.ResponseWriter, r *http.Request) {
	if !checkWrite(r, true) {
		apiError(w, 403, "invalid origin or CSRF header")
		return
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	var body struct {
		Token string `json:"token"`
	}
	if !decodeRequest(w, r, &body) {
		return
	}
	// Do not hold the auth mutex while reading an untrusted request body.
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prune()
	if len(a.failures[ip]) >= 10 || len(a.failures) >= 10000 {
		w.Header().Set("Retry-After", "900")
		apiError(w, 429, "too many login attempts")
		return
	}
	if !equalSecret(body.Token, a.admin) {
		a.failures[ip] = append(a.failures[ip], a.now())
		apiError(w, 401, "invalid credentials")
		return
	}
	if len(a.sessions) >= 10000 {
		apiError(w, 503, "session limit reached")
		return
	}
	token, err := randomID(32)
	if err != nil {
		apiError(w, 500, "unable to create session")
		return
	}
	// Successful logins do not clear recent failures: distributed guessing cannot
	// reset the limit using a separately known valid session.
	a.sessions[sha256.Sum256([]byte(token))] = a.now().Add(sessionLife)
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: cookieSecure(r), SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLife.Seconds()), Expires: a.now().Add(sessionLife)})
	jsonResponse(w, 200, map[string]bool{"authenticated": true})
}
func (a *Auth) logout(w http.ResponseWriter, r *http.Request) {
	if !checkWrite(r, false) {
		apiError(w, 403, "invalid origin or CSRF header")
		return
	}
	if c, err := r.Cookie(cookieName); err == nil {
		a.mu.Lock()
		delete(a.sessions, sha256.Sum256([]byte(c.Value)))
		a.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: cookieSecure(r), SameSite: http.SameSiteStrictMode, MaxAge: -1})
	jsonResponse(w, 200, map[string]bool{"authenticated": false})
}
