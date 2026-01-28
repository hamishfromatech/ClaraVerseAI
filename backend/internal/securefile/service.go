package securefile

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/patrickmn/go-cache"
)

// File represents a file stored with access code protection
type File struct {
	ID             string    `json:"id"`
	UserID         string    `json:"user_id"`
	Filename       string    `json:"filename"`
	MimeType       string    `json:"mime_type"`
	Size           int64     `json:"size"`
	FilePath       string    `json:"-"` // Not exposed in JSON
	AccessCodeHash string    `json:"-"` // SHA256 hash, not exposed
	CreatedAt      time.Time `json:"created_at"`
	ExpiresAt      time.Time `json:"expires_at"`
}

// Result is returned when creating a file
type Result struct {
	ID          string    `json:"id"`
	Filename    string    `json:"filename"`
	DownloadURL string    `json:"download_url"`
	AccessCode  string    `json:"access_code"` // Only returned once at creation
	Size        int64     `json:"size"`
	MimeType    string    `json:"mime_type"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// Service manages files with access code protection
type Service struct {
	cache      *cache.Cache
	storageDir string
	mu         sync.RWMutex
}

var (
	instance *Service
	once     sync.Once
)

// GetService returns the singleton secure file service
func GetService() *Service {
	once.Do(func() {
		instance = NewService("./secure_files")
	})
	return instance
}

// NewService creates a new secure file service
func NewService(storageDir string) *Service {
	// Create storage directory if it doesn't exist
	if err := os.MkdirAll(storageDir, 0700); err != nil {
		log.Printf("⚠️ [SECURE-FILE] Failed to create storage directory: %v", err)
	}

	// 30-day default expiration, cleanup every hour
	c := cache.New(30*24*time.Hour, 1*time.Hour)

	// Set eviction handler to delete files when they expire
	c.OnEvicted(func(key string, value interface{}) {
		if file, ok := value.(*File); ok {
			log.Printf("🗑️ [SECURE-FILE] Expiring file %s (%s)", file.ID, file.Filename)
			if file.FilePath != "" {
				if err := os.Remove(file.FilePath); err != nil && !os.IsNotExist(err) {
					log.Printf("⚠️ [SECURE-FILE] Failed to delete expired file: %v", err)
				}
			}
		}
	})

	svc := &Service{
		cache:      c,
		storageDir: storageDir,
	}

	// Run startup cleanup
	go svc.cleanupExpiredFiles()

	return svc
}

// generateAccessCode generates a cryptographically secure access code
func generateAccessCode() (string, error) {
	bytes := make([]byte, 16) // 16 bytes = 32 hex characters
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// hashAccessCode creates a SHA256 hash of the access code
func hashAccessCode(code string) string {
	hash := sha256.Sum256([]byte(code))
	return hex.EncodeToString(hash[:])
}

// CreateFile stores content as a secure file with access code
func (s *Service) CreateFile(userID string, content []byte, filename, mimeType string) (*Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Generate unique ID
	fileID := uuid.New().String()

	// Generate access code
	accessCode, err := generateAccessCode()
	if err != nil {
		return nil, fmt.Errorf("failed to generate access code: %w", err)
	}

	// Hash the access code for storage
	accessCodeHash := hashAccessCode(accessCode)

	// Determine file extension from filename or mime type
	ext := filepath.Ext(filename)
	if ext == "" {
		ext = getExtensionFromMimeType(mimeType)
	}

	// Create file path
	storedFilename := fmt.Sprintf("%s%s", fileID, ext)
	filePath := filepath.Join(s.storageDir, storedFilename)

	// Write file to disk
	if err := os.WriteFile(filePath, content, 0600); err != nil {
		return nil, fmt.Errorf("failed to write file: %w", err)
	}

	// Set expiration (30 days)
	now := time.Now()
	expiresAt := now.Add(30 * 24 * time.Hour)

	// Create secure file record
	secureFile := &File{
		ID:             fileID,
		UserID:         userID,
		Filename:       filename,
		MimeType:       mimeType,
		Size:           int64(len(content)),
		FilePath:       filePath,
		AccessCodeHash: accessCodeHash,
		CreatedAt:      now,
		ExpiresAt:      expiresAt,
	}

	// Store in cache
	s.cache.Set(fileID, secureFile, 30*24*time.Hour)

	log.Printf("✅ [SECURE-FILE] Created file %s (%s) for user %s, expires %s",
		fileID, filename, userID, expiresAt.Format(time.RFC3339))

	// Return relative URL - the frontend will prepend window.location.origin
	// This works in both development (via proxy) and production (same origin)
	downloadURL := fmt.Sprintf("/api/files/%s?code=%s", fileID, accessCode)

	return &Result{
		ID:          fileID,
		Filename:    filename,
		DownloadURL: downloadURL,
		AccessCode:  accessCode, // Only returned once
		Size:        int64(len(content)),
		MimeType:    mimeType,
		ExpiresAt:   expiresAt,
	}, nil
}

// GetFile retrieves a file if the access code is valid
func (s *Service) GetFile(fileID, accessCode string) (*File, []byte, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Get file from cache
	value, found := s.cache.Get(fileID)
	if !found {
		return nil, nil, fmt.Errorf("file not found or expired")
	}

	file, ok := value.(*File)
	if !ok {
		return nil, nil, fmt.Errorf("invalid file data")
	}

	// Verify access code
	providedHash := hashAccessCode(accessCode)
	if providedHash != file.AccessCodeHash {
		log.Printf("🚫 [SECURE-FILE] Invalid access code for file %s", fileID)
		return nil, nil, fmt.Errorf("invalid access code")
	}

	// Read file content
	content, err := os.ReadFile(file.FilePath)
	if err != nil {
		log.Printf("❌ [SECURE-FILE] Failed to read file %s: %v", fileID, err)
		return nil, nil, fmt.Errorf("failed to read file")
	}

	log.Printf("✅ [SECURE-FILE] File %s accessed successfully", fileID)
	return file, content, nil
}

// GetFileInfo returns file metadata without content (requires access code)
func (s *Service) GetFileInfo(fileID, accessCode string) (*File, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	value, found := s.cache.Get(fileID)
	if !found {
		return nil, fmt.Errorf("file not found or expired")
	}

	file, ok := value.(*File)
	if !ok {
		return nil, fmt.Errorf("invalid file data")
	}

	// Verify access code
	providedHash := hashAccessCode(accessCode)
	if providedHash != file.AccessCodeHash {
		return nil, fmt.Errorf("invalid access code")
	}

	return file, nil
}

// DeleteFile removes a file (requires ownership)
func (s *Service) DeleteFile(fileID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	value, found := s.cache.Get(fileID)
	if !found {
		return fmt.Errorf("file not found")
	}

	file, ok := value.(*File)
	if !ok {
		return fmt.Errorf("invalid file data")
	}

	// Verify ownership
	if file.UserID != userID {
		return fmt.Errorf("access denied")
	}

	// Delete from disk
	if file.FilePath != "" {
		if err := os.Remove(file.FilePath); err != nil && !os.IsNotExist(err) {
			log.Printf("⚠️ [SECURE-FILE] Failed to delete file from disk: %v", err)
		}
	}

	// Delete from cache
	s.cache.Delete(fileID)

	log.Printf("✅ [SECURE-FILE] Deleted file %s", fileID)
	return nil
}

// ListUserFiles returns all files for a user
func (s *Service) ListUserFiles(userID string) []*File {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var files []*File
	for _, item := range s.cache.Items() {
		if file, ok := item.Object.(*File); ok {
			if file.UserID == userID {
				files = append(files, file)
			}
		}
	}
	return files
}

// cleanupExpiredFiles removes files that have expired
func (s *Service) cleanupExpiredFiles() {
	// Scan storage directory for orphaned files
	entries, err := os.ReadDir(s.storageDir)
	if err != nil {
		log.Printf("⚠️ [SECURE-FILE] Failed to read storage directory: %v", err)
		return
	}

	now := time.Now()
	orphanedCount := 0

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		filePath := filepath.Join(s.storageDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Delete files older than 31 days (1 day buffer)
		if now.Sub(info.ModTime()) > 31*24*time.Hour {
			log.Printf("🗑️ [SECURE-FILE] Deleting orphaned/expired file: %s", entry.Name())
			if err := os.Remove(filePath); err != nil {
				log.Printf("⚠️ [SECURE-FILE] Failed to delete: %v", err)
			} else {
				orphanedCount++
			}
		}
	}

	if orphanedCount > 0 {
		log.Printf("✅ [SECURE-FILE] Cleaned up %d orphaned files", orphanedCount)
	}
}

// GetStats returns service statistics
func (s *Service) GetStats() map[string]interface{} {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := s.cache.Items()
	totalSize := int64(0)

	for _, item := range items {
		if file, ok := item.Object.(*File); ok {
			totalSize += file.Size
		}
	}

	return map[string]interface{}{
		"total_files": len(items),
		"total_size":  totalSize,
		"storage_dir": s.storageDir,
	}
}

// getExtensionFromMimeType returns a file extension for common mime types
func getExtensionFromMimeType(mimeType string) string {
	extensions := map[string]string{
		"application/pdf":          ".pdf",
		"application/json":         ".json",
		"text/plain":               ".txt",
		"text/csv":                 ".csv",
		"text/html":                ".html",
		"text/css":                 ".css",
		"text/javascript":          ".js",
		"application/xml":          ".xml",
		"text/xml":                 ".xml",
		"text/yaml":                ".yaml",
		"application/x-yaml":       ".yaml",
		"text/markdown":            ".md",
		"application/octet-stream": ".bin",
	}

	if ext, ok := extensions[mimeType]; ok {
		return ext
	}
	return ".bin"
}
