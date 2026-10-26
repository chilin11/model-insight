package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func envDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	checkSeed := flag.String("check-seed", "", "validate a seed JSON file without starting the server")
	checkConfig := flag.Bool("check-config", false, "validate configuration/content without writing or listening")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments")
	}
	if *checkSeed != "" {
		if _, err := loadContent(*checkSeed); err != nil {
			log.Fatal("invalid seed content")
		}
		fmt.Println("seed valid")
		return
	}
	auth, err := newAuth(os.Getenv("ADMIN_TOKEN"), os.Getenv("API_TOKEN"))
	if err != nil {
		log.Fatal(err)
	}
	dir := envDefault("DATA_DIR", "data")
	seed := envDefault("SEED_FILE", "seed.json")
	web := envDefault("WEB_DIR", "dist")
	if *checkConfig {
		file := filepath.Join(dir, "content.json")
		info, statErr := os.Lstat(file)
		if errors.Is(statErr, os.ErrNotExist) {
			if _, backupErr := os.Lstat(file + ".bak"); !errors.Is(backupErr, os.ErrNotExist) {
				log.Fatal("content missing but backup exists; restore manually")
			}
			file = seed
		} else if statErr != nil || !info.Mode().IsRegular() {
			log.Fatal("content must be a readable regular file")
		}
		if _, err := loadContent(file); err != nil {
			log.Fatal("invalid content/seed; existing data has not been modified")
		}
		if err := validateCommentsFile(dir); err != nil {
			log.Fatal("invalid comments.json; existing data has not been modified")
		}
		if err := validateAnalyticsFile(dir); err != nil {
			log.Fatal("invalid analytics.json; existing data has not been modified")
		}
		fmt.Println("configuration valid")
		return
	}
	store, err := newStore(dir, seed)
	if err != nil {
		log.Fatal("content initialization failed; inspect DATA_DIR/content.json and SEED_FILE; nothing was overwritten")
	}
	comments, err := newCommentStore(dir)
	if err != nil {
		log.Fatal("comments initialization failed; inspect DATA_DIR/comments.json; nothing was overwritten")
	}
	// Analytics is optional: preserve damaged data, keep publishing available,
	// and explicitly report 503 rather than silently returning fabricated zeros.
	analytics, analyticsErr := newAnalyticsStore(dir)
	if analyticsErr != nil {
		log.Print("warning: analytics disabled; inspect DATA_DIR/analytics.json; existing analytics data was not replaced")
	}
	media := filepath.Join(dir, "media")
	if err = os.MkdirAll(media, 0700); err != nil {
		log.Fatal("unable to initialize media directory")
	}
	info, err := os.Lstat(media)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		log.Fatal("media directory must not be a symlink")
	}
	app := &App{store: store, auth: auth, comments: comments, analytics: analytics, limiter: newRateLimiter(), webDir: web, mediaDir: media}
	server := &http.Server{Addr: envDefault("LISTEN_ADDR", "127.0.0.1:8188"), Handler: app, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 * 1024}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stopped
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	log.Print("model-insight starting (no request bodies or credentials are logged)")
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("HTTP listener failed")
	}
}
