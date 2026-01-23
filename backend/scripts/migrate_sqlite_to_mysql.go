package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	_ "modernc.org/sqlite"
)

type MigrationStats struct {
	Providers      int
	Models         int
	Aliases        int
	Filters        int
	Capabilities   int
	RefreshLogs    int
	RecommendedModels int
	MCPConnections int
	MCPTools       int
	MCPAuditLogs   int
	Errors         []string
}

func main() {
	// Read configuration from environment
	sqlitePath := getEnv("SQLITE_PATH", "./model_capabilities.db")
	mysqlDSN := getEnv("MYSQL_DSN", "")

	if mysqlDSN == "" {
		log.Fatal("❌ MYSQL_DSN environment variable required\n   Format: user:pass@tcp(host:port)/dbname")
	}

	log.Println("🔄 Starting SQLite → MySQL migration...")
	log.Printf("   SQLite: %s", sqlitePath)
	log.Printf("   MySQL:  %s\n", maskDSN(mysqlDSN))

	// Open databases
	sqliteDB, err := sql.Open("sqlite", sqlitePath)
	if err != nil {
		log.Fatalf("❌ Failed to open SQLite: %v", err)
	}
	defer sqliteDB.Close()

	mysqlDB, err := sql.Open("mysql", mysqlDSN+"?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci")
	if err != nil {
		log.Fatalf("❌ Failed to open MySQL: %v", err)
	}
	defer mysqlDB.Close()

	// Test connections
	if err := sqliteDB.Ping(); err != nil {
		log.Fatalf("❌ SQLite connection failed: %v", err)
	}
	if err := mysqlDB.Ping(); err != nil {
		log.Fatalf("❌ MySQL connection failed: %v", err)
	}

	log.Println("✅ Database connections established\n")

	// Run migration
	stats := &MigrationStats{}

	// Start transaction for atomicity
	tx, err := mysqlDB.Begin()
	if err != nil {
		log.Fatalf("❌ Failed to start transaction: %v", err)
	}
	defer tx.Rollback() // Rollback if we don't commit

	// Migrate in order (respect foreign keys)
	steps := []struct {
		name string
		fn   func(*sql.DB, *sql.Tx, *MigrationStats) error
	}{
		{"providers", migrateProviders},
		{"models", migrateModels},
		{"model_aliases", migrateAliases},
		{"provider_model_filters", migrateFilters},
		{"model_capabilities", migrateCapabilities},
		{"model_refresh_log", migrateRefreshLogs},
		{"recommended_models", migrateRecommendedModels},
		{"mcp_connections", migrateMCPConnections},
		{"mcp_tools", migrateMCPTools},
		{"mcp_audit_log", migrateMCPAuditLog},
	}

	for _, step := range steps {
		log.Printf("📦 Migrating %s...", step.name)
		if err := step.fn(sqliteDB, tx, stats); err != nil {
			log.Printf("❌ %s migration failed: %v\n", step.name, err)
			log.Println("⚠️  Transaction will be rolled back")
			return
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		log.Fatalf("❌ Failed to commit transaction: %v", err)
	}

	// Print summary
	printSummary(stats)
}

func migrateProviders(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT id, name, base_url, COALESCE(api_key, ''), enabled,
		       COALESCE(audio_only, 0), COALESCE(system_prompt, ''),
		       COALESCE(favicon, '')
		FROM providers
		ORDER BY id
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  Table doesn't exist in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO providers (id, name, base_url, api_key, enabled, audio_only,
		                       system_prompt, favicon)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			id, name, baseURL, apiKey, systemPrompt, favicon string
			enabled, audioOnly                                bool
		)

		if err := rows.Scan(&id, &name, &baseURL, &apiKey, &enabled, &audioOnly,
			&systemPrompt, &favicon); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("provider scan: %v", err))
			continue
		}

		_, err := stmt.Exec(id, name, baseURL, apiKey, enabled, audioOnly,
			systemPrompt, favicon)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("provider insert %s: %v", name, err))
			continue
		}
		stats.Providers++
	}

	log.Printf("   ✅ Migrated %d providers\n", stats.Providers)
	return nil
}

func migrateModels(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT id, provider_id, name, COALESCE(display_name, ''),
		       COALESCE(description, ''), COALESCE(context_length, 0),
		       COALESCE(supports_tools, 0), COALESCE(supports_streaming, 0),
		       COALESCE(supports_vision, 0), COALESCE(isVisible, 1),
		       COALESCE(system_prompt, ''), fetched_at
		FROM models
		ORDER BY id
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  Table doesn't exist in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO models (id, provider_id, name, display_name, description, context_length,
		                    supports_tools, supports_streaming, supports_vision,
		                    isVisible, system_prompt, fetched_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			id, name, displayName, description, systemPrompt string
			providerID, contextLength                        int
			supportsTools, supportsStreaming, supportsVision, isVisible bool
			fetchedAt                                                   string
		)

		if err := rows.Scan(&id, &providerID, &name, &displayName, &description, &contextLength,
			&supportsTools, &supportsStreaming, &supportsVision,
			&isVisible, &systemPrompt, &fetchedAt); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("model scan: %v", err))
			continue
		}

		_, err := stmt.Exec(id, providerID, name, displayName, description, contextLength,
			supportsTools, supportsStreaming, supportsVision,
			isVisible, systemPrompt, fetchedAt)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("model insert %s: %v", id, err))
			continue
		}
		stats.Models++
	}

	log.Printf("   ✅ Migrated %d models\n", stats.Models)
	return nil
}

func migrateAliases(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT alias_name, model_id, provider_id, display_name,
		       COALESCE(description, ''), supports_vision, agents_enabled,
		       COALESCE(structured_output_support, ''), structured_output_compliance,
		       COALESCE(structured_output_warning, ''), structured_output_speed_ms,
		       COALESCE(structured_output_badge, ''), memory_extractor, memory_selector
		FROM model_aliases
		ORDER BY alias_name
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  Table doesn't exist in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO model_aliases (alias_name, model_id, provider_id, display_name, description,
		                           supports_vision, agents_enabled, structured_output_support,
		                           structured_output_compliance, structured_output_warning,
		                           structured_output_speed_ms, structured_output_badge,
		                           memory_extractor, memory_selector)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			aliasName, modelID, displayName, description       string
			structuredOutputSupport, structuredOutputWarning   string
			structuredOutputBadge                              string
			providerID, structuredOutputCompliance             sql.NullInt64
			structuredOutputSpeedMs                            sql.NullInt64
			supportsVision, agentsEnabled                      sql.NullBool
			memoryExtractor, memorySelector                    sql.NullBool
		)

		if err := rows.Scan(&aliasName, &modelID, &providerID, &displayName, &description,
			&supportsVision, &agentsEnabled, &structuredOutputSupport, &structuredOutputCompliance,
			&structuredOutputWarning, &structuredOutputSpeedMs, &structuredOutputBadge,
			&memoryExtractor, &memorySelector); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("alias scan: %v", err))
			continue
		}

		_, err := stmt.Exec(aliasName, modelID, providerID, displayName, description,
			nullBoolToPtr(supportsVision), nullBoolToPtr(agentsEnabled),
			nullString(structuredOutputSupport), nullIntToPtr(structuredOutputCompliance),
			nullString(structuredOutputWarning), nullIntToPtr(structuredOutputSpeedMs),
			nullString(structuredOutputBadge), nullBoolToPtr(memoryExtractor),
			nullBoolToPtr(memorySelector))
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("alias insert %s: %v", aliasName, err))
			continue
		}
		stats.Aliases++
	}

	log.Printf("   ✅ Migrated %d aliases\n", stats.Aliases)
	return nil
}

func migrateFilters(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT provider_id, model_pattern, action, COALESCE(priority, 0)
		FROM provider_model_filters
		ORDER BY provider_id, priority DESC
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
			log.Println("   ⚠️  Table doesn't exist or has different schema in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO provider_model_filters (provider_id, model_pattern, action, priority)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			providerID, priority int
			modelPattern, action string
		)

		if err := rows.Scan(&providerID, &modelPattern, &action, &priority); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("filter scan: %v", err))
			continue
		}

		_, err := stmt.Exec(providerID, modelPattern, action, priority)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("filter insert: %v", err))
			continue
		}
		stats.Filters++
	}

	log.Printf("   ✅ Migrated %d filters\n", stats.Filters)
	return nil
}

func migrateCapabilities(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	// Note: SQLite model_capabilities table may have different schema
	// Skip if table doesn't exist or has incompatible columns
	rows, err := sqlite.Query(`
		SELECT model_id, provider_id
		FROM model_capabilities
		ORDER BY model_id
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
			log.Println("   ⚠️  Table doesn't exist or has different schema in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO model_capabilities (model_id, provider_id)
		VALUES (?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			modelID    string
			providerID int
		)

		if err := rows.Scan(&modelID, &providerID); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("capability scan: %v", err))
			continue
		}

		_, err := stmt.Exec(modelID, providerID)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("capability insert %s: %v", modelID, err))
			continue
		}
		stats.Capabilities++
	}

	log.Printf("   ✅ Migrated %d capabilities\n", stats.Capabilities)
	return nil
}

func migrateRefreshLogs(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT provider_id, models_fetched, refreshed_at
		FROM model_refresh_log
		ORDER BY refreshed_at DESC
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  Table doesn't exist in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO model_refresh_log (provider_id, models_fetched, refreshed_at)
		VALUES (?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			providerID, modelsFetched int
			refreshedAt               string
		)

		if err := rows.Scan(&providerID, &modelsFetched, &refreshedAt); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("refresh log scan: %v", err))
			continue
		}

		_, err := stmt.Exec(providerID, modelsFetched, refreshedAt)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("refresh log insert: %v", err))
			continue
		}
		stats.RefreshLogs++
	}

	log.Printf("   ✅ Migrated %d refresh logs\n", stats.RefreshLogs)
	return nil
}

func migrateRecommendedModels(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	// This table might not exist in SQLite, skip if missing
	rows, err := sqlite.Query(`
		SELECT provider_id, tier, model_alias, created_at, updated_at
		FROM recommended_models
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  Table doesn't exist in SQLite, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO recommended_models (provider_id, tier, model_alias, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			providerID                    int
			tier, modelAlias              string
			createdAt, updatedAt          string
		)

		if err := rows.Scan(&providerID, &tier, &modelAlias, &createdAt, &updatedAt); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("recommended model scan: %v", err))
			continue
		}

		_, err := stmt.Exec(providerID, tier, modelAlias, createdAt, updatedAt)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("recommended model insert: %v", err))
			continue
		}
		stats.RecommendedModels++
	}

	if stats.RecommendedModels > 0 {
		log.Printf("   ✅ Migrated %d recommended models\n", stats.RecommendedModels)
	}
	return nil
}

func migrateMCPConnections(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT user_id, client_id, is_active, connected_at
		FROM mcp_connections
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			log.Println("   ⚠️  MCP tables don't exist, skipping")
			return nil
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO mcp_connections (user_id, client_id, is_active, connected_at)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			userID, clientID string
			isActive         bool
			connectedAt      string
		)

		if err := rows.Scan(&userID, &clientID, &isActive, &connectedAt); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp connection scan: %v", err))
			continue
		}

		_, err := stmt.Exec(userID, clientID, isActive, connectedAt)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp connection insert: %v", err))
			continue
		}
		stats.MCPConnections++
	}

	if stats.MCPConnections > 0 {
		log.Printf("   ✅ Migrated %d MCP connections\n", stats.MCPConnections)
	}
	return nil
}

func migrateMCPTools(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT user_id, connection_id, tool_name, tool_definition
		FROM mcp_tools
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") || strings.Contains(err.Error(), "no such column") {
			return nil // Already logged in connections or schema mismatch
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO mcp_tools (user_id, connection_id, tool_name, tool_definition)
		VALUES (?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			userID, toolName, toolDefinition string
			connectionID                     int
		)

		if err := rows.Scan(&userID, &connectionID, &toolName, &toolDefinition); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp tool scan: %v", err))
			continue
		}

		_, err := stmt.Exec(userID, connectionID, toolName, toolDefinition)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp tool insert: %v", err))
			continue
		}
		stats.MCPTools++
	}

	if stats.MCPTools > 0 {
		log.Printf("   ✅ Migrated %d MCP tools\n", stats.MCPTools)
	}
	return nil
}

func migrateMCPAuditLog(sqlite *sql.DB, mysql *sql.Tx, stats *MigrationStats) error {
	rows, err := sqlite.Query(`
		SELECT user_id, tool_name, COALESCE(conversation_id, ''), success,
		       COALESCE(error_message, ''), executed_at
		FROM mcp_audit_log
	`)
	if err != nil {
		if strings.Contains(err.Error(), "no such table") {
			return nil // Already logged in connections
		}
		return fmt.Errorf("query failed: %w", err)
	}
	defer rows.Close()

	stmt, err := mysql.Prepare(`
		INSERT INTO mcp_audit_log (user_id, tool_name, conversation_id, success, error_message, executed_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return fmt.Errorf("prepare failed: %w", err)
	}
	defer stmt.Close()

	for rows.Next() {
		var (
			userID, toolName, conversationID, errorMessage string
			success                                         bool
			executedAt                                      string
		)

		if err := rows.Scan(&userID, &toolName, &conversationID, &success, &errorMessage, &executedAt); err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp audit log scan: %v", err))
			continue
		}

		_, err := stmt.Exec(userID, toolName, nullString(conversationID), success, nullString(errorMessage), executedAt)
		if err != nil {
			stats.Errors = append(stats.Errors, fmt.Sprintf("mcp audit log insert: %v", err))
			continue
		}
		stats.MCPAuditLogs++
	}

	if stats.MCPAuditLogs > 0 {
		log.Printf("   ✅ Migrated %d MCP audit logs\n", stats.MCPAuditLogs)
	}
	return nil
}

func printSummary(stats *MigrationStats) {
	log.Println("\n" + strings.Repeat("=", 60))
	log.Println("✅ MIGRATION COMPLETE")
	log.Println(strings.Repeat("=", 60))
	log.Printf("📊 Providers:         %d migrated\n", stats.Providers)
	log.Printf("📊 Models:            %d migrated\n", stats.Models)
	log.Printf("📊 Aliases:           %d migrated\n", stats.Aliases)
	log.Printf("📊 Filters:           %d migrated\n", stats.Filters)
	log.Printf("📊 Capabilities:      %d migrated\n", stats.Capabilities)
	log.Printf("📊 Refresh Logs:      %d migrated\n", stats.RefreshLogs)
	if stats.RecommendedModels > 0 {
		log.Printf("📊 Recommended Models: %d migrated\n", stats.RecommendedModels)
	}
	if stats.MCPConnections > 0 {
		log.Printf("📊 MCP Connections:   %d migrated\n", stats.MCPConnections)
		log.Printf("📊 MCP Tools:         %d migrated\n", stats.MCPTools)
		log.Printf("📊 MCP Audit Logs:    %d migrated\n", stats.MCPAuditLogs)
	}

	if len(stats.Errors) > 0 {
		log.Printf("\n⚠️  %d errors occurred:\n", len(stats.Errors))
		for i, err := range stats.Errors {
			if i < 10 { // Show first 10
				log.Printf("   %d. %s\n", i+1, err)
			}
		}
		if len(stats.Errors) > 10 {
			log.Printf("   ... and %d more\n", len(stats.Errors)-10)
		}
	} else {
		log.Println("\n✅ No errors - perfect migration!")
	}
	log.Println(strings.Repeat("=", 60))
}

// Helper functions
func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func maskDSN(dsn string) string {
	// Mask password in DSN for logging
	// user:pass@tcp(host:port)/dbname → user:***@tcp(host:port)/dbname
	parts := strings.Split(dsn, "@")
	if len(parts) < 2 {
		return dsn
	}
	userPass := strings.Split(parts[0], ":")
	if len(userPass) < 2 {
		return dsn
	}
	return userPass[0] + ":***@" + parts[1]
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func nullBoolToPtr(nb sql.NullBool) interface{} {
	if !nb.Valid {
		return nil
	}
	return nb.Bool
}

func nullIntToPtr(ni sql.NullInt64) interface{} {
	if !ni.Valid {
		return nil
	}
	return ni.Int64
}
