package services

import (
	"claraverse/internal/database"
	"claraverse/internal/models"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func setupTestDBForModels(t *testing.T) (*database.DB, func()) {
	t.Skip("SQLite tests are deprecated - please use DATABASE_URL with MySQL DSN")
	tmpFile := "test_model_service.db"
	db, err := database.New(tmpFile)
	if err != nil {
		t.Fatalf("Failed to create test database: %v", err)
	}

	if err := db.Initialize(); err != nil {
		t.Fatalf("Failed to initialize test database: %v", err)
	}

	cleanup := func() {
		db.Close()
		os.Remove(tmpFile)
	}

	return db, cleanup
}

func createTestProvider(t *testing.T, db *database.DB, name string) *models.Provider {
	providerService := NewProviderService(db)
	config := models.ProviderConfig{
		Name:    name,
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
		(id, provider_id, name, display_name, description, context_length,
		 supports_tools, supports_streaming, supports_vision, isVisible, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, model.ID, model.ProviderID, model.Name, model.DisplayName, model.Description,
		model.ContextLength, model.SupportsTools, model.SupportsStreaming,
		model.SupportsVision, model.IsVisible, time.Now())

	if err != nil {
		t.Fatalf("Failed to insert test model: %v", err)
	}
}

func TestNewModelService(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	service := NewModelService(db)
	if service == nil {
		t.Fatal("Expected non-nil model service")
	}
}

func TestModelService_GetAll(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	service := NewModelService(db)
	provider := createTestProvider(t, db, "Test Provider")

	// Create test models
	testModels := []models.Model{
		{
			ID:                "model-1",
			ProviderID:        provider.ID,
			Name:              "Model 1",
			IsVisible:         true,
			SupportsStreaming: true,
		},
		{
			ID:                "model-2",
			ProviderID:        provider.ID,
			Name:              "Model 2",
			IsVisible:         false,
			SupportsStreaming: true,
		},
		{
			ID:                "model-3",
			ProviderID:        provider.ID,
			Name:              "Model 3",
			IsVisible:         true,
			SupportsTools:     true,
		},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Get all models (including hidden)
	allModels, err := service.GetAll(false)
	if err != nil {
		t.Fatalf("Failed to get all models: %v", err)
	}

	if len(allModels) != 3 {
		t.Errorf("Expected 3 models, got %d", len(allModels))
	}

	// Get only visible models
	visibleModels, err := service.GetAll(true)
	if err != nil {
		t.Fatalf("Failed to get visible models: %v", err)
	}

	if len(visibleModels) != 2 {
		t.Errorf("Expected 2 visible models, got %d", len(visibleModels))
	}
}

func TestModelService_GetByProvider(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	service := NewModelService(db)
	provider1 := createTestProvider(t, db, "Provider 1")
	provider2 := createTestProvider(t, db, "Provider 2")

	// Create models for both providers
	testModels := []models.Model{
		{ID: "model-1", ProviderID: provider1.ID, Name: "Model 1", IsVisible: true},
		{ID: "model-2", ProviderID: provider1.ID, Name: "Model 2", IsVisible: true},
		{ID: "model-3", ProviderID: provider2.ID, Name: "Model 3", IsVisible: true},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Get models for provider 1
	provider1Models, err := service.GetByProvider(provider1.ID, false)
	if err != nil {
		t.Fatalf("Failed to get provider 1 models: %v", err)
	}

	if len(provider1Models) != 2 {
		t.Errorf("Expected 2 models for provider 1, got %d", len(provider1Models))
	}

	// Get models for provider 2
	provider2Models, err := service.GetByProvider(provider2.ID, false)
	if err != nil {
		t.Fatalf("Failed to get provider 2 models: %v", err)
	}

	if len(provider2Models) != 1 {
		t.Errorf("Expected 1 model for provider 2, got %d", len(provider2Models))
	}
}

func TestModelService_GetByProvider_VisibleOnly(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	service := NewModelService(db)
	provider := createTestProvider(t, db, "Test Provider")

	// Create test models with different visibility
	testModels := []models.Model{
		{ID: "model-1", ProviderID: provider.ID, Name: "Model 1", IsVisible: true},
		{ID: "model-2", ProviderID: provider.ID, Name: "Model 2", IsVisible: false},
		{ID: "model-3", ProviderID: provider.ID, Name: "Model 3", IsVisible: true},
	}

	for i := range testModels {
		insertTestModel(t, db, &testModels[i])
	}

	// Get only visible models
	visibleModels, err := service.GetByProvider(provider.ID, true)
	if err != nil {
		t.Fatalf("Failed to get visible models: %v", err)
	}

	if len(visibleModels) != 2 {
		t.Errorf("Expected 2 visible models, got %d", len(visibleModels))
	}
}

func TestModelService_FetchFromProvider(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	// Create mock server
	mockResponse := models.OpenAIModelsResponse{
		Object: "list",
		Data: []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		}{
			{ID: "gpt-4", Object: "model", Created: 1234567890, OwnedBy: "openai"},
			{ID: "gpt-3.5-turbo", Object: "model", Created: 1234567891, OwnedBy: "openai"},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request
		if r.URL.Path != "/models" {
			t.Errorf("Expected path /models, got %s", r.URL.Path)
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader != "Bearer test-key" {
			t.Errorf("Expected Authorization header 'Bearer test-key', got %s", authHeader)
		}

		// Return mock response
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	service := NewModelService(db)
	providerService := NewProviderService(db)

	// Create provider with mock server URL
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: server.URL,
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Fetch models from provider
	if err := service.FetchFromProvider(provider); err != nil {
		t.Fatalf("Failed to fetch models from provider: %v", err)
	}

	// Verify models were stored
	models, err := service.GetByProvider(provider.ID, false)
	if err != nil {
		t.Fatalf("Failed to get models: %v", err)
	}

	if len(models) != 2 {
		t.Errorf("Expected 2 models, got %d", len(models))
	}

	// Verify model data
	if models[0].ID != "gpt-3.5-turbo" && models[1].ID != "gpt-3.5-turbo" {
		t.Error("Expected to find gpt-3.5-turbo model")
	}

	if models[0].ID != "gpt-4" && models[1].ID != "gpt-4" {
		t.Error("Expected to find gpt-4 model")
	}
}

func TestModelService_FetchFromProvider_InvalidAuth(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	// Create mock server that returns 401
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid_api_key"}`))
	}))
	defer server.Close()

	service := NewModelService(db)
	providerService := NewProviderService(db)

	// Create provider with mock server URL
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: server.URL,
		APIKey:  "invalid-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Fetch should fail
	err = service.FetchFromProvider(provider)
	if err == nil {
		t.Error("Expected error for invalid API key, got nil")
	}
}

func TestModelService_FetchFromProvider_InvalidJSON(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	// Create mock server that returns invalid JSON
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{invalid json}`))
	}))
	defer server.Close()

	service := NewModelService(db)
	providerService := NewProviderService(db)

	// Create provider with mock server URL
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: server.URL,
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Fetch should fail
	err = service.FetchFromProvider(provider)
	if err == nil {
		t.Error("Expected error for invalid JSON, got nil")
	}
}

func TestModelService_FetchFromProvider_EmptyResponse(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	// Create mock server that returns empty models list
	mockResponse := models.OpenAIModelsResponse{
		Object: "list",
		Data:   []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		}{},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	service := NewModelService(db)
	providerService := NewProviderService(db)

	// Create provider with mock server URL
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: server.URL,
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Fetch should succeed but return no models
	if err := service.FetchFromProvider(provider); err != nil {
		t.Fatalf("Failed to fetch models: %v", err)
	}

	// Verify no models were stored
	models, err := service.GetByProvider(provider.ID, false)
	if err != nil {
		t.Fatalf("Failed to get models: %v", err)
	}

	if len(models) != 0 {
		t.Errorf("Expected 0 models, got %d", len(models))
	}
}

func TestModelService_FetchFromProvider_UpdateExisting(t *testing.T) {
	db, cleanup := setupTestDBForModels(t)
	defer cleanup()

	// Create mock server
	mockResponse := models.OpenAIModelsResponse{
		Object: "list",
		Data: []struct {
			ID      string `json:"id"`
			Object  string `json:"object"`
			Created int64  `json:"created"`
			OwnedBy string `json:"owned_by"`
		}{
			{ID: "gpt-4", Object: "model", Created: 1234567890, OwnedBy: "openai"},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	service := NewModelService(db)
	providerService := NewProviderService(db)

	// Create provider
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: server.URL,
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := providerService.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Insert existing model with different display name
	existingModel := models.Model{
		ID:          "gpt-4",
		ProviderID:  provider.ID,
		Name:        "gpt-4",
		DisplayName: "Old GPT-4",
		IsVisible:   true,
	}
	insertTestModel(t, db, &existingModel)

	// Fetch models - should update existing
	if err := service.FetchFromProvider(provider); err != nil {
		t.Fatalf("Failed to fetch models: %v", err)
	}

	// Verify model was updated (count should still be 1)
	models, err := service.GetByProvider(provider.ID, false)
	if err != nil {
		t.Fatalf("Failed to get models: %v", err)
	}

	if len(models) != 1 {
		t.Errorf("Expected 1 model, got %d", len(models))
	}

	if models[0].ID != "gpt-4" {
		t.Errorf("Expected model ID 'gpt-4', got %s", models[0].ID)
	}
}
