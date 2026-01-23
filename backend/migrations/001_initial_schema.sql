-- ClaraVerse MySQL Schema Migration
-- Date: 2026-01-17
-- Purpose: Initial schema for provider/model management

-- Drop tables if they exist (for clean re-runs)
DROP TABLE IF EXISTS mcp_audit_log;
DROP TABLE IF EXISTS mcp_tools;
DROP TABLE IF EXISTS mcp_connections;
DROP TABLE IF EXISTS model_refresh_log;
DROP TABLE IF EXISTS model_capabilities;
DROP TABLE IF EXISTS provider_model_filters;
DROP TABLE IF EXISTS model_aliases;
DROP TABLE IF EXISTS recommended_models;
DROP TABLE IF EXISTS models;
DROP TABLE IF EXISTS providers;

-- =============================================================================
-- PROVIDERS TABLE
-- Stores AI API providers (OpenAI, Anthropic, custom providers, etc.)
-- =============================================================================
CREATE TABLE providers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE COMMENT 'Provider name (unique identifier)',
    base_url VARCHAR(512) NOT NULL COMMENT 'API endpoint URL',
    api_key TEXT COMMENT 'API authentication key (encrypted)',
    enabled BOOLEAN DEFAULT TRUE COMMENT 'Is provider active',
    audio_only BOOLEAN DEFAULT FALSE COMMENT 'Audio-only provider (e.g., Groq)',
    image_only BOOLEAN DEFAULT FALSE COMMENT 'Image generation only',
    image_edit_only BOOLEAN DEFAULT FALSE COMMENT 'Image editing only',
    secure BOOLEAN DEFAULT FALSE COMMENT 'Privacy-focused provider (no data storage)',
    default_model VARCHAR(255) COMMENT 'Default model for this provider',
    system_prompt TEXT COMMENT 'Provider-level system prompt',
    favicon VARCHAR(512) COMMENT 'Provider icon URL',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_enabled (enabled),
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='AI API providers';

-- =============================================================================
-- MODELS TABLE
-- Stores LLM models available from providers
-- =============================================================================
CREATE TABLE models (
    id VARCHAR(512) PRIMARY KEY COMMENT 'Unique model identifier',
    provider_id INT NOT NULL COMMENT 'Foreign key to providers',
    name VARCHAR(255) NOT NULL COMMENT 'Model name (API identifier)',
    display_name VARCHAR(255) COMMENT 'UI display name',
    description TEXT COMMENT 'Model description',
    context_length INT COMMENT 'Token context window size',
    supports_tools BOOLEAN DEFAULT FALSE COMMENT 'Function calling support',
    supports_streaming BOOLEAN DEFAULT FALSE COMMENT 'SSE streaming support',
    supports_vision BOOLEAN DEFAULT FALSE COMMENT 'Image/vision support',
    smart_tool_router BOOLEAN DEFAULT FALSE COMMENT 'Can predict tool usage for context optimization',
    agents_enabled BOOLEAN DEFAULT FALSE COMMENT 'Available in agent builder',
    isVisible BOOLEAN DEFAULT TRUE COMMENT 'Show in UI',
    system_prompt TEXT COMMENT 'Model-specific system prompt',
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When fetched from provider API',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id),
    INDEX idx_visible (isVisible),
    INDEX idx_agents (agents_enabled),
    INDEX idx_tool_router (smart_tool_router),
    INDEX idx_capabilities (supports_tools, supports_vision, supports_streaming)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='LLM models from providers';

-- =============================================================================
-- MODEL_ALIASES TABLE
-- Maps frontend display names to actual model names
-- =============================================================================
CREATE TABLE model_aliases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    alias_name VARCHAR(255) NOT NULL COMMENT 'Frontend display name',
    model_id VARCHAR(512) NOT NULL COMMENT 'Actual model ID (foreign key)',
    provider_id INT NOT NULL COMMENT 'Provider ID (foreign key)',
    display_name VARCHAR(255) NOT NULL COMMENT 'UI display name',
    description TEXT COMMENT 'Model description',
    supports_vision BOOLEAN COMMENT 'Vision support override',
    agents_enabled BOOLEAN DEFAULT FALSE COMMENT 'Available in agent builder',
    smart_tool_router BOOLEAN DEFAULT FALSE COMMENT 'Can be used as tool predictor',
    free_tier BOOLEAN DEFAULT FALSE COMMENT 'Available on free tier',
    structured_output_support ENUM('excellent', 'good', 'fair', 'poor', 'unknown') COMMENT 'Structured output quality',
    structured_output_compliance INT COMMENT '0-100 percentage compliance',
    structured_output_warning TEXT COMMENT 'Warning message for structured output',
    structured_output_speed_ms INT COMMENT 'Average latency for structured outputs',
    structured_output_badge VARCHAR(50) COMMENT 'UI badge (e.g., "FASTEST")',
    memory_extractor BOOLEAN DEFAULT FALSE COMMENT 'Can extract memories from conversations',
    memory_selector BOOLEAN DEFAULT FALSE COMMENT 'Can select relevant memories',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_alias_provider (alias_name, provider_id),
    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_alias (alias_name),
    INDEX idx_agents (agents_enabled),
    INDEX idx_memory (memory_extractor, memory_selector)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Frontend model name mappings';

-- =============================================================================
-- PROVIDER_MODEL_FILTERS TABLE
-- Include/exclude patterns for model visibility
-- =============================================================================
CREATE TABLE provider_model_filters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL COMMENT 'Provider ID (foreign key)',
    model_pattern VARCHAR(255) NOT NULL COMMENT 'Regex/glob pattern (e.g., "gpt-4*")',
    action ENUM('include', 'exclude') NOT NULL COMMENT 'Filter action',
    priority INT DEFAULT 0 COMMENT 'Processing priority (higher = processed first)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_provider (provider_id),
    INDEX idx_priority (priority DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Model visibility filters';

-- =============================================================================
-- MODEL_CAPABILITIES TABLE
-- Test results and benchmark data for models
-- =============================================================================
CREATE TABLE model_capabilities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_id VARCHAR(512) NOT NULL COMMENT 'Model ID (foreign key)',
    provider_id INT NOT NULL COMMENT 'Provider ID (foreign key)',
    connection_test_passed BOOLEAN COMMENT 'Connection test result',
    connection_test_latency_ms INT COMMENT 'Connection latency in milliseconds',
    connection_test_error TEXT COMMENT 'Connection test error message',
    capability_test_passed BOOLEAN COMMENT 'Capability test result',
    tools_test_passed BOOLEAN COMMENT 'Function calling test',
    vision_test_passed BOOLEAN COMMENT 'Vision/image test',
    streaming_test_passed BOOLEAN COMMENT 'Streaming test',
    structured_output_compliance INT COMMENT '0-100 structured output compliance',
    structured_output_speed_ms INT COMMENT 'Structured output latency',
    structured_output_quality ENUM('excellent', 'good', 'fair', 'poor') COMMENT 'Output quality rating',
    benchmark_tokens_per_second FLOAT COMMENT 'Benchmark throughput',
    benchmark_avg_latency_ms INT COMMENT 'Average benchmark latency',
    benchmark_date TIMESTAMP COMMENT 'When benchmark was run',
    tested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    UNIQUE KEY unique_model_capability (model_id),
    INDEX idx_quality (structured_output_quality),
    INDEX idx_performance (benchmark_tokens_per_second)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Model test results and benchmarks';

-- =============================================================================
-- MODEL_REFRESH_LOG TABLE
-- Audit trail for model fetch operations
-- =============================================================================
CREATE TABLE model_refresh_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL COMMENT 'Provider ID (foreign key)',
    models_fetched INT NOT NULL COMMENT 'Number of models fetched',
    success BOOLEAN DEFAULT TRUE COMMENT 'Was fetch successful',
    error_message TEXT COMMENT 'Error message if failed',
    refreshed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_provider_date (provider_id, refreshed_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Model fetch audit trail';

-- =============================================================================
-- RECOMMENDED_MODELS TABLE
-- Tier-based model recommendations per provider
-- =============================================================================
CREATE TABLE recommended_models (
    id INT AUTO_INCREMENT PRIMARY KEY,
    provider_id INT NOT NULL COMMENT 'Provider ID (foreign key)',
    tier ENUM('top', 'medium', 'fastest', 'new') NOT NULL COMMENT 'Recommendation tier',
    model_alias VARCHAR(255) NOT NULL COMMENT 'Model alias name',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_provider_tier (provider_id, tier),
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
    INDEX idx_tier (tier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Recommended models by tier';

-- =============================================================================
-- MCP (Model Context Protocol) TABLES (Optional)
-- Only used if MCP integration is enabled
-- =============================================================================

CREATE TABLE mcp_connections (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL COMMENT 'Supabase user ID',
    client_id VARCHAR(255) NOT NULL COMMENT 'MCP client identifier',
    connection_name VARCHAR(255) COMMENT 'Friendly connection name',
    is_active BOOLEAN DEFAULT TRUE COMMENT 'Is connection currently active',
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    disconnected_at TIMESTAMP NULL COMMENT 'When connection was closed',

    INDEX idx_user (user_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='MCP client connections';

CREATE TABLE mcp_tools (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL COMMENT 'Supabase user ID',
    connection_id INT NOT NULL COMMENT 'MCP connection ID (foreign key)',
    tool_name VARCHAR(255) NOT NULL COMMENT 'Tool name',
    tool_definition JSON NOT NULL COMMENT 'Tool schema definition',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE CASCADE,
    INDEX idx_user (user_id),
    INDEX idx_connection (connection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='MCP tool definitions cache';

CREATE TABLE mcp_audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL COMMENT 'Supabase user ID',
    tool_name VARCHAR(255) NOT NULL COMMENT 'Tool that was executed',
    conversation_id VARCHAR(255) COMMENT 'Associated conversation ID',
    success BOOLEAN NOT NULL COMMENT 'Was execution successful',
    error_message TEXT COMMENT 'Error message if failed',
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_user_date (user_id, executed_at DESC),
    INDEX idx_tool (tool_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='MCP tool execution audit log';

-- =============================================================================
-- SCHEMA VERSION TRACKING
-- =============================================================================
CREATE TABLE schema_version (
    version INT PRIMARY KEY COMMENT 'Schema version number',
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT 'When migration was applied',
    description VARCHAR(255) COMMENT 'Migration description'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Schema version tracking';

-- Insert initial version
INSERT INTO schema_version (version, description) VALUES
    (1, 'Initial schema - providers, models, aliases, capabilities');
