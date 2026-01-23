package handlers

import (
	"claraverse/internal/database"
	"claraverse/internal/models"
	"claraverse/internal/services"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func setupTestApp(t *testing.T) (*fiber.App, *database.DB, func()) {
	tmpFile := "test_handlers.db"
	db, err := database.New(tmpFile)
	if err != nil {
		t.Fatalf("Failed to create test database: %v", err)
	}

	if err := db.Initialize(); err != nil {
		t.Fatalf("Failed to initialize test database: %v", err)
	}

	app := fiber.New()

	cleanup := func() {
		db.Close()
		os.Remove(tmpFile)
	}

	return app, db, cleanup
}

func createTestProvider(t *testing.T, db *database.DB) *models.Provider {
	providerService := services.NewProviderService(db)
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create test provider: %v", err)
	}

	return provider
}

func insertTestModel(t *testing.T, db *database.DB, model *models.Model) {
	_, err := db.Exec(`
		INSERT OR REPLACE INTO models
		(id, provider_id, name, display_name, isVisible, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, model.ID, model.ProviderID, model.Name, model.DisplayName, model.IsVisible, time.Now())

	if err != nil {
		t.Fatalf("Failed to insert test model: %v", err)
	}
}

// TestHealthHandler tests the health check endpoint
func TestHealthHandler(t *testing.T) {
	app, _, cleanup := setupTestApp(t)
	defer cleanup()

	connManager := services.NewConnectionManager()
	handler := NewHealthHandler(connManager)

	app.Get("/health", handler.Handle)

	req := httptest.NewRequest("GET", "/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	if result["status"] != "healthy" {
		t.Errorf("Expected status 'healthy', got %v", result["status"])
	}

	if result["connections"] == nil {
		t.Error("Expected 'connections' field in response")
	}

	if result["timestamp"] == nil {
		t.Error("Expected 'timestamp' field in response")
	}
}

// TestModelHandler_List tests listing all models
func TestModelHandler_List(t *testing.T) {
	app, db, cleanup := setupTestApp(t)
	defer cleanup()

	modelService := services.NewModelService(db)
	handler := NewModelHandler(modelService)

	app.Get("/api/models", handler.List)

	// Create test provider and models
	provider := createTestProvider(t, db)
	testModels := []models.Model{
		{ID: "model-1", ProviderID: provider.ID, Name: "Model 1", IsVisible: true},
		{ID: "model-2", ProviderID: provider.ID, Name: "Model 2", IsVisible: true},
		{ID: "model-3", ProviderID: provider.ID, Name: "Model 3", IsVisible: false},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Test with default (visible only)
	req := httptest.NewRequest("GET", "/api/models", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	models, ok := result["models"].([]interface{})
	if !ok {
		t.Fatal("Expected 'models' to be an array")
	}

	// Should only return visible models
	if len(models) != 2 {
		t.Errorf("Expected 2 visible models, got %d", len(models))
	}

	count, ok := result["count"].(float64)
	if !ok {
		t.Fatal("Expected 'count' to be a number")
	}

	if int(count) != 2 {
		t.Errorf("Expected count 2, got %d", int(count))
	}
}

// TestModelHandler_List_AllModels tests listing all models including hidden
func TestModelHandler_List_AllModels(t *testing.T) {
	app, db, cleanup := setupTestApp(t)
	defer cleanup()

	modelService := services.NewModelService(db)
	handler := NewModelHandler(modelService)

	app.Get("/api/models", handler.List)

	// Create test provider and models
	provider := createTestProvider(t, db)
	testModels := []models.Model{
		{ID: "model-1", ProviderID: provider.ID, Name: "Model 1", IsVisible: true},
		{ID: "model-2", ProviderID: provider.ID, Name: "Model 2", IsVisible: false},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Test with visible_only=false
	req := httptest.NewRequest("GET", "/api/models?visible_only=false", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	models, ok := result["models"].([]interface{})
	if !ok {
		t.Fatal("Expected 'models' to be an array")
	}

	// Should return all models
	if len(models) != 2 {
		t.Errorf("Expected 2 models, got %d", len(models))
	}
}

// TestModelHandler_ListByProvider tests listing models for a specific provider
func TestModelHandler_ListByProvider(t *testing.T) {
	app, db, cleanup := setupTestApp(t)
	defer cleanup()

	modelService := services.NewModelService(db)
	handler := NewModelHandler(modelService)

	app.Get("/api/providers/:id/models", handler.ListByProvider)

	// Create test providers and models
	provider1 := createTestProvider(t, db)

	providerService := services.NewProviderService(db)
	provider2Config := models.ProviderConfig{
		Name:    "Provider 2",
		BaseURL: "https://api.provider2.com/v1",
		APIKey:  "test-key-2",
		Enabled: true,
	}
	provider2, _ := providerService.Create(provider2Config)

	testModels := []models.Model{
		{ID: "model-1", ProviderID: provider1.ID, Name: "Model 1", IsVisible: true},
		{ID: "model-2", ProviderID: provider1.ID, Name: "Model 2", IsVisible: true},
		{ID: "model-3", ProviderID: provider2.ID, Name: "Model 3", IsVisible: true},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Test provider 1 models
	req := httptest.NewRequest("GET", "/api/providers/1/models", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	models, ok := result["models"].([]interface{})
	if !ok {
		t.Fatal("Expected 'models' to be an array")
	}

	if len(models) != 2 {
		t.Errorf("Expected 2 models for provider 1, got %d", len(models))
	}
}

// TestModelHandler_ListByProvider_InvalidID tests with invalid provider ID
func TestModelHandler_ListByProvider_InvalidID(t *testing.T) {
	app, db, cleanup := setupTestApp(t)
	defer cleanup()

	modelService := services.NewModelService(db)
	handler := NewModelHandler(modelService)

	app.Get("/api/providers/:id/models", handler.ListByProvider)

	// Test with invalid ID
	req := httptest.NewRequest("GET", "/api/providers/invalid/models", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	if result["error"] == nil {
		t.Error("Expected error message in response")
	}
}

// TestProviderHandler_List tests listing all providers
func TestProviderHandler_List(t *testing.T) {
	app, db, cleanup := setupTestApp(t)
	defer cleanup()

	providerService := services.NewProviderService(db)
	handler := NewProviderHandler(providerService)

	app.Get("/api/providers", handler.List)

	// Create test providers
	configs := []models.ProviderConfig{
		{Name: "Provider A", BaseURL: "https://a.com", APIKey: "key-a", Enabled: true},
		{Name: "Provider B", BaseURL: "https://b.com", APIKey: "key-b", Enabled: true},
		{Name: "Provider C", BaseURL: "https://c.com", APIKey: "key-c", Enabled: false},
	}

	for _, config := range configs {
		providerService.Create(config)
	}

	req := httptest.NewRequest("GET", "/api/providers", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != fiber.StatusOK {
		t.Errorf("Expected status 200, got %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	providers, ok := result["providers"].([]interface{})
	if !ok {
		t.Fatal("Expected 'providers' to be an array")
	}

	// Should only return enabled providers
	if len(providers) != 2 {
		t.Errorf("Expected 2 enabled providers, got %d", len(providers))
	}
}

// TestHealthHandler_WithConnections tests health endpoint with active connections
func TestHealthHandler_WithConnections(t *testing.T) {
	app, _, cleanup := setupTestApp(t)
	defer cleanup()

	connManager := services.NewConnectionManager()
	handler := NewHealthHandler(connManager)

	app.Get("/health", handler.Handle)

	// Simulate adding connections (we can't easily test WebSocket connections here,
	// so we'll just verify the endpoint works)

	req := httptest.NewRequest("GET", "/health", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("Failed to send request: %v", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("Failed to read response: %v", err)
	}

	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatalf("Failed to parse JSON: %v", err)
	}

	connections, ok := result["connections"].(float64)
	if !ok {
		t.Fatal("Expected 'connections' to be a number")
	}

	// Should be 0 since we haven't added any
	if int(connections) != 0 {
		t.Errorf("Expected 0 connections, got %d", int(connections))
	}
}
