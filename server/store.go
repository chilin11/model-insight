package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var errConflict = errors.New("article already exists or revision conflict")
var errNotFound = errors.New("article not found")
var errLimit = errors.New("article limit reached")

type Store struct {
	mu      sync.RWMutex
	content Content
	path    string
	write   func(string, []byte) error
}

func loadContent(path string) (Content, error) {
	var c Content
	f, err := os.Open(path)
	if err != nil {
		return c, err
	}
	defer f.Close()
	var document struct {
		Articles   *[]Article `json:"articles"`
		FeaturedID *string    `json:"featuredId"`
	}
	if err = strictJSON(f, &document); err != nil {
		return c, err
	}
	if document.Articles == nil || document.FeaturedID == nil {
		return c, errors.New("content requires articles and featuredId")
	}
	c = Content{Articles: *document.Articles, FeaturedID: *document.FeaturedID}
	err = validateContent(&c)
	return c, err
}
func newStore(dir, seed string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "content.json"), write: atomicWrite}
	// Never fall back to the seed on any error other than a genuinely missing store.
	_, err := os.Lstat(s.path)
	if errors.Is(err, os.ErrNotExist) {
		if _, backupErr := os.Lstat(s.path + ".bak"); !errors.Is(backupErr, os.ErrNotExist) {
			return nil, errors.New("content missing but backup exists; restore manually")
		}
		c, e := loadContent(seed)
		if e != nil {
			return nil, e
		}
		if e = s.commit(c); e != nil {
			return nil, e
		}
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(s.path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("content must be a regular file")
	}
	s.content, err = loadContent(s.path)
	if err != nil {
		return nil, err
	}
	return s, nil
}
func atomicWrite(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".content-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(b)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, path); err != nil {
		return err
	}
	// Rename is the commit point. Directory sync is best effort on filesystems
	// which do not implement it; returning an error here would misreport a commit.
	if d, e := os.Open(filepath.Dir(path)); e == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
func (s *Store) commit(c Content) error {
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if previous, e := os.ReadFile(s.path); e == nil {
		if e = s.write(s.path+".bak", previous); e != nil {
			return e
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if err = s.write(s.path, b); err != nil {
		return err
	}
	s.content = c
	return nil
}
func (s *Store) snapshot(public bool) Content {
	s.mu.RLock()
	defer s.mu.RUnlock()
	c := Content{Articles: []Article{}, FeaturedID: s.content.FeaturedID}
	featuredPublished := false
	for _, a := range s.content.Articles {
		if a.Status == "published" && a.ID == c.FeaturedID {
			featuredPublished = true
		}
		if !public || a.Status == "published" {
			c.Articles = append(c.Articles, a)
		}
	}
	if public && !featuredPublished {
		c.FeaturedID = ""
		if len(c.Articles) > 0 {
			c.FeaturedID = c.Articles[0].ID
		}
	}
	return c
}
func (s *Store) save(a Article, expected int, create bool) (Article, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := Content{FeaturedID: s.content.FeaturedID, Articles: append([]Article{}, s.content.Articles...)}
	index := -1
	for i, v := range c.Articles {
		if v.ID == a.ID {
			index = i
			break
		}
	}
	if create {
		if index >= 0 {
			return Article{}, errConflict
		}
		if len(c.Articles) >= maxArticles {
			return Article{}, errLimit
		}
		a.Revision = 1
		a.CreatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	} else {
		if index < 0 {
			return Article{}, errNotFound
		}
		old := c.Articles[index]
		if expected < 1 || expected != old.Revision {
			return Article{}, errConflict
		}
		a.Revision = old.Revision + 1
		a.CreatedAt = old.CreatedAt
	}
	a.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if a.Sections == nil {
		a.Sections = []Section{}
	}
	if a.Sources == nil {
		a.Sources = []Source{}
	}
	if create {
		c.Articles = append(c.Articles, a)
	} else {
		c.Articles[index] = a
	}
	if err := s.commit(c); err != nil {
		return Article{}, err
	}
	return a, nil
}
func (s *Store) feature(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.content.Articles {
		if a.ID == id && a.Status == "published" {
			c := s.content
			c.FeaturedID = id
			return s.commit(c)
		}
	}
	return errNotFound
}
