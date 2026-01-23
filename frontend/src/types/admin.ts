// Admin-specific TypeScript type definitions

import type { Model } from './websocket';

// Admin Status
export interface AdminStatusResponse {
  is_admin: boolean;
  user_id: string;
  email: string;
}

// Overview Statistics
export interface OverviewStats {
  total_users: number;
  active_chats: number;
  total_messages: number;
  api_calls_today: number;
  active_providers: number;
  total_models: number;
  total_agents: number;
  agent_executions: number;
  agents_run_today: number;
}

// Provider Analytics
export interface ProviderAnalytics {
  provider_id: number;
  provider_name: string;
  total_requests: number;
  total_tokens: number;
  estimated_cost: number | null;
  active_models: string[];
  last_used_at: string | null;
}

// Model Analytics
export interface ModelAnalytics {
  model_id: string;
  model_name: string;
  provider_name: string;
  usage_count: number;
  agents_enabled: boolean;
  recommendation_tier: string | null;
}

// Chat Analytics
export interface ChatTimeSeriesData {
  date: string;
  chat_count: number;
  message_count: number;
  user_count: number;
  agent_count: number;
}

export interface ChatAnalytics {
  total_chats: number;
  active_chats: number;
  total_messages: number;
  avg_messages_per_chat: number;
  chats_created_today: number;
  messages_sent_today: number;
  time_series: ChatTimeSeriesData[];
}

// Agent Analytics
export interface AgentTimeSeriesData {
  date: string;
  agents_created: number;
  agents_deployed: number;
  agent_runs: number;
  schedules_created: number;
}

export interface AgentAnalytics {
  total_agents: number;
  deployed_agents: number;
  total_executions: number;
  active_schedules: number;
  executions_today: number;
  time_series: AgentTimeSeriesData[];
}

// Provider Management
export interface CreateProviderRequest {
  name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;

  // Special provider types
  audio_only?: boolean;
  image_only?: boolean;
  image_edit_only?: boolean;

  // Security and metadata
  secure?: boolean;
  default_model?: string;
  system_prompt?: string;
  favicon?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  base_url?: string;
  api_key?: string;
  enabled?: boolean;

  // Special provider types
  audio_only?: boolean;
  image_only?: boolean;
  image_edit_only?: boolean;

  // Security and metadata
  secure?: boolean;
  default_model?: string;
  system_prompt?: string;
  favicon?: string;
}

export interface ProviderUsageStats {
  requests_today: number;
  requests_total: number;
  last_used_at: string | null;
}

export interface AdminProviderView {
  id: string;
  name: string;
  base_url: string;
  enabled: boolean;
  selected_models: string[];
  usage_stats: ProviderUsageStats;
  model_count: number;
}

// Model Management
export interface CreateModelRequest {
  model_id: string;
  provider_id: number;
  name: string;
  display_name: string;
  description?: string;
  context_length?: number;
  supports_tools?: boolean;
  supports_streaming?: boolean;
  supports_vision?: boolean;
  isVisible?: boolean;
  system_prompt?: string;
}

export interface UpdateModelRequest {
  display_name?: string;
  description?: string;
  context_length?: number;
  supports_tools?: boolean;
  supports_streaming?: boolean;
  supports_vision?: boolean;
  isVisible?: boolean;
  system_prompt?: string;
  smart_tool_router?: boolean;
  free_tier?: boolean;
}

export interface AdminModelView extends Model {
  usage_count?: number;
  last_used_at?: string | null;
  benchmark_results?: BenchmarkResults;
  aliases?: ModelAliasView[];
}

// Model Testing
export interface ConnectionTestResult {
  model_id: string;
  passed: boolean;
  latency_ms: number;
  error?: string;
}

export interface CapabilityTestResult {
  model_id: string;
  supports_tools: boolean;
  supports_vision: boolean;
  supports_streaming: boolean;
  tool_test_passed: boolean;
  vision_test_passed: boolean;
  streaming_test_passed: boolean;
  tested_at: string;
}

export interface StructuredOutputBenchmark {
  compliance_percentage: number;
  average_speed_ms: number;
  quality_level: 'excellent' | 'good' | 'fair' | 'poor';
  tests_passed: number;
  tests_failed: number;
}

export interface PerformanceBenchmark {
  tokens_per_second: number;
  avg_latency_ms: number;
  tested_at: string;
}

export interface BenchmarkResults {
  connection_test?: ConnectionTestResult;
  capability_test?: CapabilityTestResult;
  structured_output?: StructuredOutputBenchmark;
  performance?: PerformanceBenchmark;
  last_tested?: string;
}

// Alias Management
export interface CreateAliasRequest {
  alias_name: string;
  model_id: string;
  provider_id: number;
  display_name: string;
  description?: string;
  supports_vision?: boolean;
  agents_enabled?: boolean;
  smart_tool_router?: boolean;
  free_tier?: boolean;
  structured_output_support?: string;
  structured_output_compliance?: number;
  structured_output_warning?: string;
  structured_output_speed_ms?: number;
  structured_output_badge?: string;
  memory_extractor?: boolean;
  memory_selector?: boolean;
}

export interface UpdateAliasRequest {
  display_name?: string;
  description?: string;
  supports_vision?: boolean;
  agents_enabled?: boolean;
  smart_tool_router?: boolean;
  free_tier?: boolean;
  structured_output_support?: string;
  structured_output_compliance?: number;
  structured_output_warning?: string;
  structured_output_speed_ms?: number;
  structured_output_badge?: string;
  memory_extractor?: boolean;
  memory_selector?: boolean;
}

export interface ModelAliasView {
  id: number;
  alias_name: string;
  model_id: string;
  provider_id: number;
  display_name: string;
  description?: string;
  supports_vision?: boolean;
  agents_enabled?: boolean;
  smart_tool_router?: boolean;
  free_tier?: boolean;
  structured_output_support?: string;
  structured_output_compliance?: number;
  structured_output_warning?: string;
  structured_output_speed_ms?: number;
  structured_output_badge?: string;
  memory_extractor?: boolean;
  memory_selector?: boolean;
  created_at: string;
  updated_at: string;
}

// Bulk Operations
export interface BulkUpdateAgentsRequest {
  model_ids: string[];
  enabled: boolean;
}

export interface BulkUpdateVisibilityRequest {
  model_ids: string[];
  visible: boolean;
}

export interface BulkUpdateTierRequest {
  model_ids: string[];
  tier: 'top' | 'medium' | 'fastest' | 'new';
}

// Global Tier Management
export interface TierAssignment {
  model_id: string;
  provider_id: number;
  display_name: string;
  tier: string;
}

// Model Filters
export interface ModelFilters {
  provider?: number;
  capability?: 'tools' | 'vision' | 'streaming';
  tier?: 'top' | 'medium' | 'fastest' | 'new';
  test_status?: 'passed' | 'failed' | 'untested';
  visibility?: 'all' | 'visible' | 'hidden';
  search?: string;
}

// Providers.json structure
export interface ModelAlias {
  actual_model: string;
  display_name: string;
  description?: string;
  supports_vision?: boolean;
  agents?: boolean;
  smart_tool_router?: boolean;
  free_tier?: boolean;
  structured_output_support?: 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';
  structured_output_compliance?: number;
  structured_output_warning?: string;
  structured_output_speed_ms?: number;
  structured_output_badge?: string;
  memory_extractor?: boolean;
  memory_selector?: boolean;
}

export interface RecommendedModels {
  top?: string;
  medium?: string;
  fastest?: string;
  new?: string;
}

export interface FilterConfig {
  pattern: string;
  action: 'include' | 'exclude';
  priority: number;
}

export interface ProviderConfig {
  id?: number; // Database ID (returned from backend)
  name: string;
  base_url: string;
  api_key: string;
  enabled: boolean;
  secure?: boolean;
  audio_only?: boolean;
  image_only?: boolean;
  image_edit_only?: boolean;
  default_model?: string;
  favicon?: string;
  system_prompt?: string;
  filters?: FilterConfig[];
  model_aliases?: Record<string, ModelAlias>;
  recommended_models?: RecommendedModels;
}

export interface ProvidersConfig {
  providers: ProviderConfig[];
}

// User Management (GDPR-Compliant)
export interface UserListItem {
  user_id: string; // Anonymized ID
  email_hash?: string; // Hashed for privacy
  email_domain?: string; // Only domain shown (e.g., @gmail.com)
  tier: string;
  created_at: string;
  last_active?: string;
  total_chats: number;
  total_messages: number;
  total_agent_runs: number;
  has_overrides: boolean;
}

export interface UserListResponse {
  users: UserListItem[];
  total_count: number;
  page: number;
  page_size: number;
  gdpr_notice: string; // GDPR compliance notice
}

export interface UserActivityMetrics {
  date: string;
  active_users: number;
  new_signups: number;
  returning_users: number;
}

export interface GDPRDataPolicy {
  data_collected: string[];
  data_retention_days: number;
  purpose: string;
  legal_basis: string;
  user_rights: string[];
}
