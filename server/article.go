package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const maxArticles = 5000
const maxBody = 150 * 1024
const maxRequest = 2 * 1024 * 1024

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)
var mediaPattern = regexp.MustCompile(`^/media/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.(png|jpg|jpeg|gif)$`)

type Source struct {
	Label string `json:"label"`
	URL   string `json:"url"`
	Kind  string `json:"kind"`
}
type Table struct {
	Caption string     `json:"caption"`
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
	Note    string     `json:"note"`
}
type ChartRow struct {
	Label string  `json:"label"`
	Value float64 `json:"value"`
}
type Chart struct {
	Title string     `json:"title"`
	Unit  string     `json:"unit"`
	Max   float64    `json:"max"`
	Rows  []ChartRow `json:"rows"`
	Note  string     `json:"note"`
}
type Section struct {
	Heading       string `json:"heading"`
	Text          string `json:"text"`
	SourceNumbers []int  `json:"sourceNumbers,omitempty"`
	Table         *Table `json:"table,omitempty"`
	Chart         *Chart `json:"chart,omitempty"`
}
type Image struct {
	URL     string `json:"url"`
	Alt     string `json:"alt"`
	Caption string `json:"caption,omitempty"`
}
type Article struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Model       string    `json:"model"`
	Tone        string    `json:"tone"`
	Category    string    `json:"category"`
	Time        float64   `json:"time"`
	Label       string    `json:"label"`
	Status      string    `json:"status"`
	PublishedAt string    `json:"publishedAt,omitempty"`
	VerifiedAt  string    `json:"verifiedAt,omitempty"`
	EventNote   string    `json:"eventNote,omitempty"`
	Takeaway    string    `json:"takeaway"`
	Highlight   string    `json:"highlight,omitempty"`
	Sections    []Section `json:"sections"`
	Quote       string    `json:"quote"`
	Sources     []Source  `json:"sources"`
	Body        string    `json:"body,omitempty"`
	Image       *Image    `json:"image,omitempty"`
	// CommentsClosed hides the reader comment form; approved comments remain visible.
	CommentsClosed bool   `json:"commentsClosed,omitempty"`
	Revision       int    `json:"revision"`
	CreatedAt      string `json:"createdAt,omitempty"`
	UpdatedAt      string `json:"updatedAt,omitempty"`
}
type Content struct {
	Articles   []Article `json:"articles"`
	FeaturedID string    `json:"featuredId"`
}

// Unknown fields and duplicate keys are errors, including in nested objects: no
// successful write can silently strip data from a newer schema.
func strictJSON(r io.Reader, dst any) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	d := json.NewDecoder(bytes.NewReader(b))
	if err = uniqueJSON(d); err != nil {
		return err
	}
	if _, err = d.Token(); err != io.EOF {
		return errors.New("expected one JSON value")
	}
	d = json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	return d.Decode(dst)
}
func uniqueJSON(d *json.Decoder) error {
	t, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	switch delim {
	case '{':
		keys := map[string]bool{}
		for d.More() {
			k, err := d.Token()
			if err != nil {
				return err
			}
			key, ok := k.(string)
			key = strings.ToLower(key) // encoding/json also matches struct field names case-insensitively.
			if !ok || keys[key] {
				return errors.New("duplicate JSON key")
			}
			keys[key] = true
			if err = uniqueJSON(d); err != nil {
				return err
			}
		}
	case '[':
		for d.More() {
			if err := uniqueJSON(d); err != nil {
				return err
			}
		}
	default:
		return errors.New("invalid JSON")
	}
	_, err = d.Token()
	return err
}
func validDate(s string) bool {
	if _, err := time.Parse("2006-01-02", s); err == nil {
		return true
	}
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}
func safeURL(s string, image bool) bool {
	if image && mediaPattern.MatchString(s) {
		return true
	}
	u, err := url.Parse(s)
	if err != nil || u.User != nil || u.Hostname() == "" || u.Opaque != "" || strings.ContainsAny(s, "\r\n\t ") {
		return false
	}
	return u.Scheme == "https" || (!image && u.Scheme == "http")
}
func oneOf(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}
func validateArticle(a Article) error {
	if !idPattern.MatchString(a.ID) {
		return errors.New("invalid article id")
	}
	if !oneOf(a.Status, "draft", "published") {
		return errors.New("status must be draft or published")
	}
	if !oneOf(a.Category, "模型动态", "评测解读", "社区声音", "深度观点") && !(a.Status == "draft" && a.Category == "") {
		return errors.New("invalid category")
	}
	if !oneOf(a.Model, "Kimi", "OpenAI", "Claude", "DeepSeek", "Qwen", "跨模型") && !(a.Status == "draft" && a.Model == "") {
		return errors.New("invalid model")
	}
	if len(a.Body) > maxBody {
		return errors.New("body exceeds 150 KiB")
	}
	if a.Time < 0 || a.Revision < 0 {
		return errors.New("negative time or revision")
	}
	for _, s := range a.Sources {
		if !safeURL(s.URL, false) || !oneOf(s.Kind, "official", "benchmark", "community") || strings.TrimSpace(s.Label) == "" {
			return errors.New("invalid source")
		}
	}
	if a.Image != nil && !safeURL(a.Image.URL, true) {
		return errors.New("invalid image URL")
	}
	for _, date := range []string{a.PublishedAt, a.VerifiedAt, a.CreatedAt, a.UpdatedAt} {
		if date != "" && !validDate(date) {
			return errors.New("dates must be YYYY-MM-DD or RFC3339")
		}
	}
	for _, s := range a.Sections {
		for _, n := range s.SourceNumbers {
			if n < 1 || n > len(a.Sources) {
				return errors.New("section source number out of range")
			}
		}
		if s.Table != nil {
			for _, row := range s.Table.Rows {
				if len(row) != len(s.Table.Columns) {
					return errors.New("table row does not match columns")
				}
			}
		}
		if s.Chart != nil && s.Chart.Max <= 0 {
			return errors.New("chart max must be positive")
		}
	}
	if a.Status == "published" {
		hasSections := false
		for _, s := range a.Sections {
			if strings.TrimSpace(s.Text) != "" || s.Table != nil || s.Chart != nil {
				hasSections = true
			}
		}
		if strings.TrimSpace(a.Title) == "" || strings.TrimSpace(a.Description) == "" || (strings.TrimSpace(a.Body) == "" && !hasSections) || len(a.Sources) == 0 || !validDate(a.PublishedAt) || !validDate(a.VerifiedAt) {
			return errors.New("published article requires title, description, body or sections, a source, publishedAt and verifiedAt")
		}
	}
	return nil
}
func validateContent(c *Content) error {
	if c.Articles == nil {
		return errors.New("articles must be an array")
	}
	if len(c.Articles) > maxArticles {
		return errors.New("article limit exceeded")
	}
	seen := map[string]bool{}
	for i := range c.Articles {
		a := &c.Articles[i]
		if err := validateArticle(*a); err != nil {
			return fmt.Errorf("article %d: %w", i, err)
		}
		if seen[a.ID] {
			return errors.New("duplicate article id")
		}
		seen[a.ID] = true
		if a.Revision == 0 {
			a.Revision = 1
		} // Existing seed/content without revisions is upgraded in memory.
		if a.Sections == nil {
			a.Sections = []Section{}
		}
		if a.Sources == nil {
			a.Sources = []Source{}
		}
	}
	if c.FeaturedID != "" && !seen[c.FeaturedID] {
		return errors.New("featuredId refers to missing article")
	}
	return nil
}
