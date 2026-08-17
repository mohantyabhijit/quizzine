package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const maxFileSize = 50 << 20

type quiz struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Topic      string `json:"topic"`
	File       string `json:"file"`
	FileURL    string `json:"fileUrl"`
	Quizmaster string `json:"quizmaster"`
	Year       string `json:"year"`
	Handle     string `json:"handle,omitempty"`
	UploadedAt string `json:"uploadedAt"`
}

type app struct {
	root  string
	token string
	mu    sync.Mutex
}

func main() {
	root := os.Getenv("QUIZZINE_ROOT")
	if root == "" {
		root = "."
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}
	a := &app{root: root, token: os.Getenv("QUIZZINE_UPLOAD_TOKEN")}
	if err := os.MkdirAll(filepath.Join(root, "data"), 0700); err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "public", "uploads"), 0755); err != nil {
		log.Fatal(err)
	}
	http.HandleFunc("/api/quizzes", a.quizzes)
	log.Printf("Quizzine API listening on :%s", port)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, nil))
}

func (a *app) quizzes(w http.ResponseWriter, r *http.Request) {
	if origin := r.Header.Get("Origin"); origin == "https://quizzine.org" || origin == "https://www.quizzine.org" || origin == "https://origin.quizzine.org" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Upload-Token")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	switch r.Method {
	case http.MethodGet:
		a.respond(w, http.StatusOK, map[string]any{"quizzes": a.read()})
	case http.MethodPost:
		a.upload(w, r)
	default:
		a.respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}

func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	if a.token == "" || r.Header.Get("X-Upload-Token") != a.token {
		a.respond(w, http.StatusUnauthorized, map[string]string{"error": "A valid administrator upload token is required."})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize+16<<10)
	if err := r.ParseMultipartForm(maxFileSize + 16<<10); err != nil {
		a.respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Files must be 50 MB or smaller."})
		return
	}
	title, quizmaster, year := strings.TrimSpace(r.FormValue("title")), strings.TrimSpace(r.FormValue("quizmaster")), strings.TrimSpace(r.FormValue("year"))
	if title == "" || quizmaster == "" || !regexp.MustCompile(`^\d{4}$`).MatchString(year) {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "Title, quizmaster, and a four-digit year are required."})
		return
	}
	file, header, err := r.FormFile("deck")
	if err != nil {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "Send a PPT or PPTX presentation."})
		return
	}
	defer file.Close()
	extension := strings.ToLower(filepath.Ext(header.Filename))
	if extension != ".ppt" && extension != ".pptx" {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "Only PPT and PPTX files are supported."})
		return
	}
	stored := slug(filepath.Base(strings.TrimSuffix(header.Filename, extension))) + "-" + randomID() + extension
	destination, err := os.Create(filepath.Join(a.root, "public", "uploads", stored))
	if err != nil {
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not store the presentation."})
		return
	}
	defer destination.Close()
	if _, err = io.Copy(destination, io.LimitReader(file, maxFileSize+1)); err != nil {
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not store the presentation."})
		return
	}
	if info, _ := destination.Stat(); info.Size() > maxFileSize {
		os.Remove(destination.Name())
		a.respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Files must be 50 MB or smaller."})
		return
	}
	q := quiz{ID: randomID(), Title: title, Topic: valueOr(r.FormValue("topic"), "Mixed bag"), File: stored, FileURL: "/uploads/" + stored, Quizmaster: quizmaster, Year: year, Handle: strings.TrimSpace(r.FormValue("handle")), UploadedAt: time.Now().UTC().Format(time.RFC3339)}
	a.mu.Lock()
	quizzes := append([]quiz{q}, a.read()...)
	err = a.write(quizzes)
	a.mu.Unlock()
	if err != nil {
		os.Remove(destination.Name())
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not save quiz metadata."})
		return
	}
	a.respond(w, http.StatusCreated, map[string]quiz{"quiz": q})
}

func (a *app) path() string { return filepath.Join(a.root, "data", "quizzes.json") }
func (a *app) read() []quiz {
	data, err := os.ReadFile(a.path())
	if errors.Is(err, os.ErrNotExist) {
		return []quiz{}
	}
	var quizzes []quiz
	if err == nil {
		_ = json.Unmarshal(data, &quizzes)
	}
	return quizzes
}
func (a *app) write(quizzes []quiz) error {
	data, err := json.MarshalIndent(quizzes, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.path(), append(data, '\n'), 0600)
}
func (a *app) respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func valueOr(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}
func randomID() string {
	bytes := make([]byte, 8)
	_, _ = rand.Read(bytes)
	return hex.EncodeToString(bytes)
}
func slug(value string) string {
	value = strings.ToLower(value)
	value = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}
