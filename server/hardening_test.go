package main

import (
	"bytes"
	"errors"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMultipartLimitsIncludingChunkedEpilogue(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	for _, chunked := range []bool{false, true} {
		var b bytes.Buffer
		mw := multipart.NewWriter(&b)
		part, _ := mw.CreateFormFile("file", "small.png")
		png.Encode(part, image.NewRGBA(image.Rect(0, 0, 1, 1)))
		mw.Close()
		b.Write(make([]byte, maxMedia+64*1024))
		r := httptest.NewRequest("POST", "http://example.test/api/admin/media", &b)
		r.Header.Set("Content-Type", mw.FormDataContentType())
		r.Header.Set("Origin", "http://example.test")
		r.Header.Set("X-Requested-With", "model-insight")
		r.AddCookie(c)
		if chunked {
			r.ContentLength = -1
			r.TransferEncoding = []string{"chunked"}
		}
		w := httptest.NewRecorder()
		app.ServeHTTP(w, r)
		status(t, w, 413)
	}
	files, e := os.ReadDir(app.mediaDir)
	if e != nil || len(files) != 0 {
		t.Fatal("oversized upload created files", e)
	}
}
func TestJPEGGIFAndMediaAuthorization(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	for _, format := range []string{"jpeg", "gif"} {
		var b bytes.Buffer
		mw := multipart.NewWriter(&b)
		part, _ := mw.CreateFormFile("file", "wrong-extension.svg")
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		if format == "jpeg" {
			jpeg.Encode(part, img, nil)
		} else {
			gif.Encode(part, img, nil)
		}
		mw.Close()
		for _, authenticated := range []bool{false, true} {
			r := httptest.NewRequest("POST", "http://example.test/api/admin/media", bytes.NewReader(b.Bytes()))
			r.Header.Set("Content-Type", mw.FormDataContentType())
			r.Header.Set("Origin", "http://example.test")
			r.Header.Set("X-Requested-With", "model-insight")
			if authenticated {
				r.AddCookie(c)
			}
			w := httptest.NewRecorder()
			app.ServeHTTP(w, r)
			want := 401
			if authenticated {
				want = 201
			}
			status(t, w, want)
		}
	}
}
func TestBackupWriteFailureViaHTTP(t *testing.T) {
	app := fixture(t)
	c := login(t, app)
	before, _ := os.ReadFile(app.store.path)
	app.store.write = func(string, []byte) error { return errors.New("permission denied") }
	w := adminRequest(app, "POST", "/api/admin/articles", map[string]any{"article": Article{ID: "not-saved", Status: "draft"}}, c)
	status(t, w, 500)
	after, _ := os.ReadFile(app.store.path)
	if !bytes.Equal(before, after) || len(app.store.snapshot(false).Articles) != 2 {
		t.Fatal("backup failure changed memory/disk")
	}
	if strings.Contains(w.Body.String(), "permission denied") {
		t.Fatal("internal storage error leaked")
	}
}
func TestStrictStorePartialDocumentsAndKeys(t *testing.T) {
	for _, data := range []string{`{"articles":[]}`, `{"featuredId":""}`, `{"articles":[],"featuredId":null}`, `{"articles":[],"Articles":[],"featuredId":""}`, `{"articles":[],"featuredId":"missing"}`} {
		dir := t.TempDir()
		p := filepath.Join(dir, "content.json")
		os.WriteFile(p, []byte(data), 0600)
		if _, e := newStore(dir, "no-seed"); e == nil {
			t.Fatal("partial/ambiguous store accepted", data)
		}
		actual, _ := os.ReadFile(p)
		if string(actual) != data {
			t.Fatal("invalid store overwritten")
		}
	}
}
func TestSourceAndImageURLBoundaries(t *testing.T) {
	for _, u := range []string{"http://example.com/source", "https://example.com/source?q=1#note"} {
		a := published("valid")
		a.Sources[0].URL = u
		if e := validateArticle(a); e != nil {
			t.Fatal(e)
		}
	}
	for _, u := range []string{"https://cdn.example.com/a.jpg", "/media/legacy-safe_name.jpeg"} {
		a := published("valid")
		a.Image = &Image{URL: u}
		if e := validateArticle(a); e != nil {
			t.Fatal(e)
		}
	}
	for _, u := range []string{"//example.com/source", "ftp://example.com/source", "https://user@example.com/source", "data:image/png;base64,YQ==", "https://example.com/a b"} {
		if safeURL(u, false) {
			t.Fatal("unsafe source accepted", u)
		}
	}
	for _, u := range []string{"/media/../x.png", "/media/a.svg", "/media/a.png?x=1", "https://user@example.com/a.png", "http://example.com/a.png"} {
		if safeURL(u, true) {
			t.Fatal("unsafe image accepted", u)
		}
	}
	for _, id := range []string{"a", strings.Repeat("a", 80)} {
		a := Article{ID: id, Status: "draft"}
		if e := validateArticle(a); e != nil {
			t.Fatal(e)
		}
	}
	for _, id := range []string{"-a", "UPPER", "a_b", strings.Repeat("a", 81)} {
		a := Article{ID: id, Status: "draft"}
		if e := validateArticle(a); e == nil {
			t.Fatal("invalid id accepted")
		}
	}
}
