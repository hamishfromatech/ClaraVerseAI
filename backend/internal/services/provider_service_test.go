package services

import (
	"claraverse/internal/database"
	"claraverse/internal/models"
	"os"
	"testing"
)

func setupTestDB(t *testing.T) (*database.DB, func()) {
	t.Skip("SQLite tests are deprecated - please use DATABASE_URL with MySQL DSN")
	tmpFile := "test_provider_service.db"
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

func TestNewProviderService(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)
	if service == nil {
		t.Fatal("Expected non-nil provider service")
	}
}

func TestProviderService_Create(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key-123",
		Enabled: true,
	}

	provider, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	if provider.Name != config.Name {
		t.Errorf("Expected name %s, got %s", config.Name, provider.Name)
	}

	if provider.BaseURL != config.BaseURL {
		t.Errorf("Expected base URL %s, got %s", config.BaseURL, provider.BaseURL)
	}

	if provider.APIKey != config.APIKey {
		t.Errorf("Expected API key %s, got %s", config.APIKey, provider.APIKey)
	}

	if !provider.Enabled {
		t.Error("Expected provider to be enabled")
	}
}

func TestProviderService_GetAll(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	// Create test providers
	configs := []models.ProviderConfig{
		{Name: "Provider A", BaseURL: "https://a.com", APIKey: "key-a", Enabled: true},
		{Name: "Provider B", BaseURL: "https://b.com", APIKey: "key-b", Enabled: true},
		{Name: "Provider C", BaseURL: "https://c.com", APIKey: "key-c", Enabled: false},
	}

	for _, config := range configs {
		if _, err := service.Create(config); err != nil {
			t.Fatalf("Failed to create provider: %v", err)
		}
	}

	providers, err := service.GetAll()
	if err != nil {
		t.Fatalf("Failed to get all providers: %v", err)
	}

	// Should only return enabled providers
	if len(providers) != 2 {
		t.Errorf("Expected 2 enabled providers, got %d", len(providers))
	}

	// Verify order (alphabetical)
	if providers[0].Name != "Provider A" {
		t.Errorf("Expected first provider to be 'Provider A', got %s", providers[0].Name)
	}
}

func TestProviderService_GetByID(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	created, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Get by ID
	provider, err := service.GetByID(created.ID)
	if err != nil {
		t.Fatalf("Failed to get provider by ID: %v", err)
	}

	if provider.ID != created.ID {
		t.Errorf("Expected ID %d, got %d", created.ID, provider.ID)
	}

	if provider.Name != config.Name {
		t.Errorf("Expected name %s, got %s", config.Name, provider.Name)
	}
}

func TestProviderService_GetByID_NotFound(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	_, err := service.GetByID(999)
	if err == nil {
		t.Error("Expected error for non-existent provider, got nil")
	}
}

func TestProviderService_GetByName(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	created, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Get by name
	provider, err := service.GetByName("Test Provider")
	if err != nil {
		t.Fatalf("Failed to get provider by name: %v", err)
	}

	if provider == nil {
		t.Fatal("Expected provider, got nil")
	}

	if provider.ID != created.ID {
		t.Errorf("Expected ID %d, got %d", created.ID, provider.ID)
	}
}

func TestProviderService_GetByName_NotFound(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	provider, err := service.GetByName("Non-existent Provider")
	if err != nil {
		t.Fatalf("Expected no error for non-existent provider, got: %v", err)
	}

	if provider != nil {
		t.Error("Expected nil provider for non-existent name")
	}
}

func TestProviderService_Update(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	created, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Update provider
	updateConfig := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.updated.com/v2",
		APIKey:  "updated-key",
		Enabled: false,
	}

	if err := service.Update(created.ID, updateConfig); err != nil {
		t.Fatalf("Failed to update provider: %v", err)
	}

	// Verify update
	updated, err := service.GetByID(created.ID)
	if err != nil {
		t.Fatalf("Failed to get updated provider: %v", err)
	}

	if updated.BaseURL != updateConfig.BaseURL {
		t.Errorf("Expected base URL %s, got %s", updateConfig.BaseURL, updated.BaseURL)
	}

	if updated.APIKey != updateConfig.APIKey {
		t.Errorf("Expected API key %s, got %s", updateConfig.APIKey, updated.APIKey)
	}

	if updated.Enabled != updateConfig.Enabled {
		t.Errorf("Expected enabled %v, got %v", updateConfig.Enabled, updated.Enabled)
	}
}

func TestProviderService_SyncFilters(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	created, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	filters := []models.FilterConfig{
		{Pattern: "gpt-4*", Action: "include", Priority: 10},
		{Pattern: "gpt-3.5*", Action: "include", Priority: 5},
		{Pattern: "*preview*", Action: "exclude", Priority: 1},
	}

	if err := service.SyncFilters(created.ID, filters); err != nil {
		t.Fatalf("Failed to sync filters: %v", err)
	}

	// Verify filters were inserted
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM provider_model_filters WHERE provider_id = ?", created.ID).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to count filters: %v", err)
	}

	if count != len(filters) {
		t.Errorf("Expected %d filters, got %d", len(filters), count)
	}
}

func TestProviderService_SyncFilters_Replace(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	created, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Add initial filters
	initialFilters := []models.FilterConfig{
		{Pattern: "gpt-4*", Action: "include", Priority: 10},
	}

	if err := service.SyncFilters(created.ID, initialFilters); err != nil {
		t.Fatalf("Failed to sync initial filters: %v", err)
	}

	// Update with new filters
	newFilters := []models.FilterConfig{
		{Pattern: "claude*", Action: "include", Priority: 15},
		{Pattern: "opus*", Action: "include", Priority: 20},
	}

	if err := service.SyncFilters(created.ID, newFilters); err != nil {
		t.Fatalf("Failed to sync new filters: %v", err)
	}

	// Verify only new filters exist
	var count int
	err = db.QueryRow("SELECT COUNT(*) FROM provider_model_filters WHERE provider_id = ?", created.ID).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to count filters: %v", err)
	}

	if count != len(newFilters) {
		t.Errorf("Expected %d filters, got %d", len(newFilters), count)
	}
}

func TestProviderService_ApplyFilters(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	// Create provider
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Create test models
	testModels := []models.Model{
		{ID: "gpt-4-turbo", ProviderID: provider.ID, Name: "gpt-4-turbo", IsVisible: false},
		{ID: "gpt-4-preview", ProviderID: provider.ID, Name: "gpt-4-preview", IsVisible: false},
		{ID: "gpt-3.5-turbo", ProviderID: provider.ID, Name: "gpt-3.5-turbo", IsVisible: false},
		{ID: "claude-3", ProviderID: provider.ID, Name: "claude-3", IsVisible: false},
	}

	for _, model := range testModels {
		_, err := db.Exec(`
			INSERT INTO models (id, provider_id, name, isVisible)
			VALUES (?, ?, ?, ?)
		`, model.ID, model.ProviderID, model.Name, model.IsVisible)
		if err != nil {
			t.Fatalf("Failed to create test model: %v", err)
		}
	}

	// Set up filters
	filters := []models.FilterConfig{
		{Pattern: "gpt-4*", Action: "include", Priority: 10},
		{Pattern: "*preview*", Action: "exclude", Priority: 5},
	}

	if err := service.SyncFilters(provider.ID, filters); err != nil {
		t.Fatalf("Failed to sync filters: %v", err)
	}

	// Apply filters
	if err := service.ApplyFilters(provider.ID); err != nil {
		t.Fatalf("Failed to apply filters: %v", err)
	}

	// Verify visibility
	// gpt-4-turbo should be visible (matches include, not excluded)
	// gpt-4-preview should be hidden (matches exclude)
	// gpt-3.5-turbo should be hidden (doesn't match any include)
	// claude-3 should be hidden (doesn't match any include)

	var visibleCount int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM models
		WHERE provider_id = ? AND isVisible = 1
	`, provider.ID).Scan(&visibleCount)
	if err != nil {
		t.Fatalf("Failed to count visible models: %v", err)
	}

	if visibleCount != 1 {
		t.Errorf("Expected 1 visible model, got %d", visibleCount)
	}

	// Check specific model
	var isVisible bool
	err = db.QueryRow(`
		SELECT isVisible FROM models WHERE id = ?
	`, "gpt-4-turbo").Scan(&isVisible)
	if err != nil {
		t.Fatalf("Failed to get model visibility: %v", err)
	}

	if !isVisible {
		t.Error("Expected gpt-4-turbo to be visible")
	}
}

func TestProviderService_ApplyFilters_NoFilters(t *testing.T) {
	db, cleanup := setupTestDB(t)
	defer cleanup()

	service := NewProviderService(db)

	// Create provider
	config := models.ProviderConfig{
		Name:    "Test Provider",
		BaseURL: "https://api.test.com/v1",
		APIKey:  "test-key",
		Enabled: true,
	}

	provider, err := service.Create(config)
	if err != nil {
		t.Fatalf("Failed to create provider: %v", err)
	}

	// Create test model
	_, err = db.Exec(`
		INSERT INTO models (id, provider_id, name, isVisible)
		VALUES (?, ?, ?, ?)
	`, "test-model", provider.ID, "test-model", false)
	if err != nil {
		t.Fatalf("Failed to create test model: %v", err)
	}

	// Apply filters (no filters configured)
	if err := service.ApplyFilters(provider.ID); err != nil {
		t.Fatalf("Failed to apply filters: %v", err)
	}

	// All models should be visible when no filters exist
	var isVisible bool
	err = db.QueryRow("SELECT isVisible FROM models WHERE id = ?", "test-model").Scan(&isVisible)
	if err != nil {
		t.Fatalf("Failed to get model visibility: %v", err)
	}

	if !isVisible {
		t.Error("Expected model to be visible when no filters configured")
	}
}
