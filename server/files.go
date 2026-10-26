package main

import (
	"bytes"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const maxMedia = 5 * 1024 * 1024

var hashedAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$`)

// Resolve the trusted root (current may be a deployment symlink), but never
// follow symlinks inside the served tree and never list directories.
func openRegular(root, relative string) (*os.File, error) {
	if relative == "" || strings.HasPrefix(relative, "/") {
		return nil, os.ErrNotExist
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(relative, "/")
	p := root
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || strings.HasPrefix(part, ".") {
			return nil, os.ErrNotExist
		}
		p = filepath.Join(p, part)
		st, e := os.Lstat(p)
		if e != nil {
			return nil, e
		}
		if st.Mode()&os.ModeSymlink != 0 {
			return nil, os.ErrNotExist
		}
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		_ = f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}
func serveRegular(w http.ResponseWriter, r *http.Request, root, relative string) {
	f, err := openRegular(root, relative)
	if err != nil {
		apiError(w, 404, "not found")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		apiError(w, 404, "not found")
		return
	}
	http.ServeContent(w, r, relative, st.ModTime(), f)
}
func (app *App) serveWeb(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		app.serveSEOPage(w, r, nil, false)
		return
	}
	if r.URL.Path == "/index.html" {
		location := "/"
		if r.URL.RawQuery != "" {
			location += "?" + r.URL.RawQuery
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.Redirect(w, r, location, http.StatusMovedPermanently)
		return
	}
	relative := strings.TrimPrefix(r.URL.Path, "/")
	if r.URL.Path == "/admin" {
		relative = "index.html"
	}
	if strings.HasSuffix(relative, ".html") {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	} else if strings.HasPrefix(relative, "assets/") && hashedAsset.MatchString(filepath.Base(relative)) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	serveRegular(w, r, app.webDir, relative)
}
func (app *App) serveMedia(w http.ResponseWriter, r *http.Request) {
	if !mediaPattern.MatchString(r.URL.Path) {
		apiError(w, 404, "not found")
		return
	}
	switch filepath.Ext(r.URL.Path) {
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	case ".gif":
		w.Header().Set("Content-Type", "image/gif")
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	serveRegular(w, r, app.mediaDir, strings.TrimPrefix(r.URL.Path, "/media/"))
}
func (app *App) uploadMedia(w http.ResponseWriter, r *http.Request) {
	const multipartLimit = maxMedia + 64*1024
	if r.ContentLength > multipartLimit {
		apiError(w, 413, "multipart request too large")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, multipartLimit)
	reader, err := r.MultipartReader()
	if err != nil {
		apiError(w, 400, "expected multipart file")
		return
	}
	part, err := reader.NextPart()
	if err != nil || part.FormName() != "file" || part.FileName() == "" {
		apiError(w, 400, "expected one file field")
		return
	}
	b, err := io.ReadAll(io.LimitReader(part, maxMedia+1))
	if err != nil || len(b) > maxMedia {
		apiError(w, 413, "image exceeds 5 MiB")
		return
	}
	if _, err = reader.NextPart(); err != io.EOF {
		apiError(w, 400, "expected exactly one file")
		return
	}
	// Multipart stops at the final boundary. Consume any epilogue too, so
	// chunked requests cannot bypass the total byte limit with trailing data.
	if _, err = io.Copy(io.Discard, r.Body); err != nil {
		apiError(w, 413, "multipart request too large")
		return
	}
	sniff := http.DetectContentType(b)
	if !oneOf(sniff, "image/png", "image/jpeg", "image/gif") {
		apiError(w, 415, "only PNG, JPEG and GIF are supported")
		return
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || int64(cfg.Width)*int64(cfg.Height) > 12_000_000 {
		apiError(w, 400, "invalid image or image exceeds 12 megapixels")
		return
	}
	if _, actual, err := image.Decode(bytes.NewReader(b)); err != nil || actual != format {
		apiError(w, 400, "invalid image data")
		return
	}
	ext := map[string]string{"png": "png", "jpeg": "jpg", "gif": "gif"}[format]
	if ext == "" {
		apiError(w, 415, "unsupported image")
		return
	}
	id, err := randomID(16)
	if err != nil {
		apiError(w, 500, "unable to store image")
		return
	}
	name := id + "." + ext
	f, err := os.OpenFile(filepath.Join(app.mediaDir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		apiError(w, 500, "unable to store image")
		return
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		_ = os.Remove(filepath.Join(app.mediaDir, name))
		apiError(w, 500, "unable to store image")
		return
	}
	jsonResponse(w, 201, map[string]string{"url": "/media/" + name, "alt": ""})
}
