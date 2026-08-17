package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	maxFileSize = 50 << 20
	manifestKey = "data/quizzes.json"
)

var errNotFound = errors.New("object not found")

type quiz struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	Topic      string `json:"topic"`
	File       string `json:"file"`
	FileURL    string `json:"fileUrl"`
	PreviewURL string `json:"previewUrl,omitempty"`
	Quizmaster string `json:"quizmaster"`
	Year       string `json:"year"`
	Handle     string `json:"handle,omitempty"`
	UploadedAt string `json:"uploadedAt"`
	SHA256     string `json:"sha256,omitempty"`
}

// r2Store keeps the R2 credential inside the Worker binding. The Go API owns
// validation and quiz lifecycle; the Worker never exposes this bridge publicly.
type r2Store struct {
	baseURL, key string
	client       *http.Client
}

func (s *r2Store) objectURL(key string) string {
	return strings.TrimRight(s.baseURL, "/") + "/_quizzine-storage/" + url.PathEscape(key)
}
func (s *r2Store) get(ctx context.Context, key string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL(key), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Quizzine-Storage-Key", s.key)
	response, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, errNotFound
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("r2 read %q: %s", key, response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, maxFileSize+1))
}
func (s *r2Store) put(ctx context.Context, key string, body []byte, contentType, cacheControl string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(key), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-Quizzine-Storage-Key", s.key)
	req.Header.Set("X-R2-Content-Type", contentType)
	req.Header.Set("X-R2-Cache-Control", cacheControl)
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		return fmt.Errorf("r2 write %q: %s", key, response.Status)
	}
	return nil
}

type app struct {
	root, token string
	store       *r2Store
	mu          sync.Mutex
}

func main() {
	root := valueOr(os.Getenv("QUIZZINE_ROOT"), ".")
	port := valueOr(os.Getenv("PORT"), "8081")
	storageURL, storageKey := os.Getenv("QUIZZINE_STORAGE_URL"), os.Getenv("QUIZZINE_STORAGE_KEY")
	if storageURL == "" || storageKey == "" {
		log.Fatal("QUIZZINE_STORAGE_URL and QUIZZINE_STORAGE_KEY are required")
	}
	a := &app{root: root, token: os.Getenv("QUIZZINE_UPLOAD_TOKEN"), store: &r2Store{baseURL: storageURL, key: storageKey, client: &http.Client{Timeout: 90 * time.Second}}}
	if err := a.migrateLegacy(context.Background()); err != nil {
		log.Fatalf("R2 storage is unavailable; refusing to start: %v", err)
	}
	http.HandleFunc("/api/quizzes", a.quizzes)
	go func() {
		if err := a.backfillPreviews(context.Background()); err != nil {
			log.Printf("quiz preview backfill incomplete: %v", err)
		}
	}()
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
		quizzes, err := a.read(r.Context())
		if err != nil {
			a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not load quiz metadata."})
			return
		}
		a.respond(w, http.StatusOK, map[string]any{"quizzes": quizzes})
	case http.MethodPost:
		a.upload(w, r)
	default:
		a.respond(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
	}
}
func (a *app) upload(w http.ResponseWriter, r *http.Request) {
	if a.token != "" && r.Header.Get("X-Upload-Token") != a.token {
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
	deck, err := io.ReadAll(io.LimitReader(file, maxFileSize+1))
	if err != nil {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "Could not read the presentation."})
		return
	}
	if len(deck) > maxFileSize {
		a.respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "Files must be 50 MB or smaller."})
		return
	}
	if extension == ".pptx" && !bytes.HasPrefix(deck, []byte("PK\x03\x04")) {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "The PPTX file is not a valid Office presentation."})
		return
	}
	if extension == ".ppt" && len(deck) >= 8 && !bytes.Equal(deck[:8], []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}) {
		a.respond(w, http.StatusBadRequest, map[string]string{"error": "The PPT file is not a valid PowerPoint presentation."})
		return
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(deck))
	stored := slug(strings.TrimSuffix(filepath.Base(header.Filename), extension)) + "-" + randomID() + extension
	contentType := "application/vnd.ms-powerpoint"
	if extension == ".pptx" {
		contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	}
	preview, err := renderPDF(r.Context(), deck, stored)
	if err != nil {
		log.Printf("presentation render failed: %v", err)
		a.respond(w, http.StatusUnprocessableEntity, map[string]string{"error": "Could not render this presentation for slide preview. Please try another PPT or PPTX file."})
		return
	}
	previewFile := strings.TrimSuffix(stored, extension) + ".pdf"
	q := quiz{ID: randomID(), Title: title, Topic: valueOr(r.FormValue("topic"), "Mixed bag"), File: stored, FileURL: "/uploads/" + stored, PreviewURL: "/previews/" + previewFile, Quizmaster: quizmaster, Year: year, Handle: strings.TrimSpace(r.FormValue("handle")), UploadedAt: time.Now().UTC().Format(time.RFC3339), SHA256: hash}
	a.mu.Lock()
	defer a.mu.Unlock()
	quizzes, err := a.read(r.Context())
	if err != nil {
		log.Printf("r2 metadata read failed: %v", err)
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not load quiz metadata."})
		return
	}
	for i, existing := range quizzes {
		if existing.SHA256 == hash {
			a.respond(w, http.StatusConflict, map[string]quiz{"quiz": existing})
			return
		}
		if sameQuiz(existing, q) {
			q.ID = existing.ID
			quizzes = append(quizzes[:i], quizzes[i+1:]...)
			break
		}
	}
	if err := a.store.put(r.Context(), "uploads/"+stored, deck, contentType, "public, max-age=31536000, immutable"); err != nil {
		log.Printf("r2 deck write failed: %v", err)
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not store the presentation."})
		return
	}
	if err := a.store.put(r.Context(), "previews/"+previewFile, preview, "application/pdf", "public, max-age=31536000, immutable"); err != nil {
		log.Printf("r2 preview write failed: %v", err)
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not store the presentation preview."})
		return
	}
	quizzes = append([]quiz{q}, quizzes...)
	err = a.write(r.Context(), quizzes)
	if err != nil {
		log.Printf("r2 metadata write failed: %v", err)
		a.respond(w, http.StatusInternalServerError, map[string]string{"error": "Could not save quiz metadata."})
		return
	}
	a.respond(w, http.StatusCreated, map[string]quiz{"quiz": q})
}
func (a *app) read(ctx context.Context) ([]quiz, error) {
	data, err := a.store.get(ctx, manifestKey)
	if errors.Is(err, errNotFound) {
		return []quiz{}, nil
	}
	if err != nil {
		return nil, err
	}
	var quizzes []quiz
	if err := json.Unmarshal(data, &quizzes); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}
	return quizzes, nil
}
func (a *app) write(ctx context.Context, quizzes []quiz) error {
	data, err := json.MarshalIndent(quizzes, "", "  ")
	if err != nil {
		return err
	}
	return a.store.put(ctx, manifestKey, append(data, '\n'), "application/json; charset=utf-8", "no-store")
}

// migrateLegacy copies the previous VPS-backed manifest and decks exactly once.
func (a *app) migrateLegacy(ctx context.Context) error {
	if _, err := a.store.get(ctx, manifestKey); err == nil {
		return nil
	} else if !errors.Is(err, errNotFound) {
		return err
	}
	data, err := os.ReadFile(filepath.Join(a.root, "data", "quizzes.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var quizzes []quiz
	if err := json.Unmarshal(data, &quizzes); err != nil || len(quizzes) == 0 {
		return err
	}
	for i := range quizzes {
		q := &quizzes[i]
		deck, err := os.ReadFile(filepath.Join(a.root, "public", "uploads", filepath.Base(q.File)))
		if err != nil {
			return fmt.Errorf("read legacy %q: %w", q.File, err)
		}
		q.SHA256 = fmt.Sprintf("%x", sha256.Sum256(deck))
		extension := strings.ToLower(filepath.Ext(q.File))
		contentType := "application/vnd.ms-powerpoint"
		if extension == ".pptx" {
			contentType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
		}
		if err := a.store.put(ctx, "uploads/"+filepath.Base(q.File), deck, contentType, "public, max-age=31536000, immutable"); err != nil {
			return err
		}
	}
	return a.write(ctx, quizzes)
}

// backfillPreviews gives existing uploaded presentations the same PDF.js viewer
// experience as the original, pre-rendered library.
func (a *app) backfillPreviews(ctx context.Context) error {
	quizzes, err := a.read(ctx)
	if err != nil {
		return err
	}
	var failures []string
	for i := range quizzes {
		q := &quizzes[i]
		if q.PreviewURL != "" {
			continue
		}
		deck, err := a.store.get(ctx, "uploads/"+filepath.Base(q.File))
		if err != nil {
			log.Printf("preview backfill skipped %q: read failed: %v", q.File, err)
			failures = append(failures, q.File)
			continue
		}
		preview, err := renderPDF(ctx, deck, q.File)
		if err != nil {
			log.Printf("preview backfill skipped %q: render failed: %v", q.File, err)
			failures = append(failures, q.File)
			continue
		}
		previewFile := strings.TrimSuffix(filepath.Base(q.File), filepath.Ext(q.File)) + ".pdf"
		if err := a.store.put(ctx, "previews/"+previewFile, preview, "application/pdf", "public, max-age=31536000, immutable"); err != nil {
			log.Printf("preview backfill skipped %q: storage failed: %v", q.File, err)
			failures = append(failures, q.File)
			continue
		}
		q.PreviewURL = "/previews/" + previewFile
		if err := a.write(ctx, quizzes); err != nil {
			return err
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("could not backfill previews for: %s", strings.Join(failures, ", "))
	}
	return nil
}

func renderPDF(parent context.Context, deck []byte, filename string) ([]byte, error) {
	soffice, err := exec.LookPath("soffice")
	if err != nil {
		return nil, errors.New("LibreOffice is not installed")
	}
	dir, err := os.MkdirTemp("", "quizzine-render-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, filepath.Base(filename))
	if err := os.WriteFile(input, deck, 0600); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(parent, 60*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, soffice, "--headless", "--convert-to", "pdf", "--outdir", dir, input).CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("LibreOffice conversion: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	pdf, err := os.ReadFile(filepath.Join(dir, strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))+".pdf"))
	if err != nil || len(pdf) == 0 {
		return nil, fmt.Errorf("LibreOffice did not produce a PDF: %w", err)
	}
	return pdf, nil
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
func sameQuiz(left, right quiz) bool {
	return normalized(left.Title) == normalized(right.Title) && normalized(left.Quizmaster) == normalized(right.Quizmaster) && left.Year == right.Year
}
func normalized(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), " ")
}
