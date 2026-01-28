import { api } from './api';
import type {
  AdminStatusResponse,
  OverviewStats,
  ProviderAnalytics,
  ModelAnalytics,
  ChatAnalytics,
  AgentAnalytics,
  AdminProviderView,
  CreateProviderRequest,
  UpdateProviderRequest,
  AdminModelView,
  CreateModelRequest,
  UpdateModelRequest,
  ProvidersConfig,
  ConnectionTestResult,
  CapabilityTestResult,
  BenchmarkResults,
  CreateAliasRequest,
  UpdateAliasRequest,
  ModelAliasView,
  BulkUpdateAgentsRequest,
  BulkUpdateTierRequest,
  TierAssignment,
  UserListResponse,
  GDPRDataPolicy,
} from '@/types/admin';
import type { Model } from '@/types/websocket';

export const adminService = {
  // Admin Status
  getAdminStatus(): Promise<AdminStatusResponse> {
    return api.get<AdminStatusResponse>('/api/admin/me');
  },

  // Analytics
  getOverviewStats(): Promise<OverviewStats> {
    return api.get<OverviewStats>('/api/admin/analytics/overview');
  },

  getProviderAnalytics(): Promise<ProviderAnalytics[]> {
    return api.get<ProviderAnalytics[]>('/api/admin/analytics/providers');
  },

  getModelAnalytics(): Promise<ModelAnalytics[]> {
    return api.get<ModelAnalytics[]>('/api/admin/analytics/models');
  },

  getChatAnalytics(): Promise<ChatAnalytics> {
    return api.get<ChatAnalytics>('/api/admin/analytics/chats');
  },

  getAgentAnalytics(): Promise<AgentAnalytics> {
    return api.get<AgentAnalytics>('/api/admin/analytics/agents');
  },

  migrateChatSessionTimestamps(): Promise<{ success: boolean; message: string; sessions_updated: number }> {
    return api.post('/api/admin/analytics/migrate-timestamps', {});
  },

  // Provider Management
  getProviders(): Promise<ProvidersConfig> {
    return api.get<ProvidersConfig>('/api/admin/providers');
  },

  addProvider(data: CreateProviderRequest): Promise<AdminProviderView> {
    return api.post<AdminProviderView>('/api/admin/providers', data);
  },

  updateProvider(id: string, data: UpdateProviderRequest): Promise<AdminProviderView> {
    return api.put<AdminProviderView>(`/api/admin/providers/${id}`, data);
  },

  deleteProvider(id: string): Promise<void> {
    return api.delete(`/api/admin/providers/${id}`);
  },

  toggleProvider(id: string, enabled: boolean): Promise<void> {
    return api.put(`/api/admin/providers/${id}/toggle`, { enabled });
  },

  // Model Management - CRUD
  getModels(): Promise<AdminModelView[]> {
    return api.get<AdminModelView[]>('/api/admin/models');
  },

  createModel(data: CreateModelRequest): Promise<Model> {
    return api.post<Model>('/api/admin/models', data);
  },

  updateModel(modelId: string, data: UpdateModelRequest): Promise<Model> {
    return api.put<Model>(`/api/admin/models/${encodeURIComponent(modelId)}`, data);
  },

  deleteModel(modelId: string): Promise<void> {
    return api.delete(`/api/admin/models/${encodeURIComponent(modelId)}`);
  },

  // Model Fetching
  fetchModelsFromProvider(
    providerId: number
  ): Promise<{ success: boolean; models_fetched: number; message: string }> {
    return api.post(`/api/admin/providers/${providerId}/fetch`, {});
  },

  syncProviderToJSON(
    providerId: number
  ): Promise<{ success: boolean; message: string }> {
    return api.post(`/api/admin/providers/${providerId}/sync`, {});
  },


  // Model Testing
  testModelConnection(modelId: string): Promise<{
    success: boolean;
    passed: boolean;
    latency_ms: number;
    error?: string;
    message: string;
  }> {
    return api.post(`/api/admin/models/${encodeURIComponent(modelId)}/test/connection`, {});
  },

  testModelCapability(modelId: string): Promise<CapabilityTestResult> {
    return api.post<CapabilityTestResult>(
      `/api/admin/models/${encodeURIComponent(modelId)}/test/capability`,
      {}
    );
  },

  runModelBenchmark(modelId: string): Promise<BenchmarkResults> {
    return api.post<BenchmarkResults>(`/api/admin/models/${encodeURIComponent(modelId)}/benchmark`, {});
  },

  getModelTestResults(modelId: string): Promise<BenchmarkResults> {
    return api.get<BenchmarkResults>(`/api/admin/models/${encodeURIComponent(modelId)}/test-results`);
  },

  // Alias Management
  getModelAliases(modelId: string): Promise<ModelAliasView[]> {
    return api.get<ModelAliasView[]>(`/api/admin/models/${encodeURIComponent(modelId)}/aliases`);
  },

  createModelAlias(
    modelId: string,
    data: Omit<CreateAliasRequest, 'model_id'>
  ): Promise<{ success: boolean; message: string }> {
    return api.post(`/api/admin/models/${encodeURIComponent(modelId)}/aliases`, data);
  },

  updateModelAlias(
    modelId: string,
    aliasName: string,
    data: UpdateAliasRequest
  ): Promise<ModelAliasView> {
    return api.put<ModelAliasView>(`/api/admin/models/${encodeURIComponent(modelId)}/aliases/${encodeURIComponent(aliasName)}`, data);
  },

  deleteModelAlias(
    modelId: string,
    aliasName: string,
    providerId: number
  ): Promise<{ success: boolean; message: string }> {
    return api.delete(`/api/admin/models/${encodeURIComponent(modelId)}/aliases/${encodeURIComponent(aliasName)}?provider_id=${providerId}`);
  },

  importAliasesFromJSON(): Promise<{ success: boolean; message: string }> {
    return api.post('/api/admin/models/import-aliases', {});
  },

  // Bulk Operations
  bulkUpdateAgentsEnabled(data: BulkUpdateAgentsRequest): Promise<{ message: string }> {
    return api.put('/api/admin/models/bulk/agents-enabled', data);
  },

  bulkUpdateVisibility(data: BulkUpdateVisibilityRequest): Promise<{ message: string }> {
    return api.put('/api/admin/models/bulk/visibility', data);
  },

  bulkUpdateTier(data: BulkUpdateTierRequest): Promise<{ message: string }> {
    return api.put('/api/admin/models/bulk/tier', data);
  },

  // Global Tier Management
  getTiers(): Promise<Record<string, TierAssignment>> {
    return api.get<{ tiers: Record<string, TierAssignment> }>('/api/admin/tiers').then(res => res.tiers);
  },

  setModelTier(modelId: string, providerId: number, tier: string): Promise<{ message: string }> {
    return api.post(`/api/admin/models/${encodeURIComponent(modelId)}/tier`, {
      provider_id: providerId,
      tier
    });
  },

  clearModelTier(tier: string): Promise<{ message: string }> {
    return api.delete(`/api/admin/tiers/${encodeURIComponent(tier)}`);
  },

  // User Management (GDPR-Compliant)
  getUsers(params?: {
    page?: number;
    page_size?: number;
    tier?: string;
    search?: string;
  }): Promise<UserListResponse> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', params.page.toString());
    if (params?.page_size) queryParams.set('page_size', params.page_size.toString());
    if (params?.tier) queryParams.set('tier', params.tier);
    if (params?.search) queryParams.set('search', params.search);

    const query = queryParams.toString();
    return api.get<UserListResponse>(`/api/admin/users${query ? `?${query}` : ''}`);
  },

  getGDPRPolicy(): Promise<GDPRDataPolicy> {
    return api.get<GDPRDataPolicy>('/api/admin/gdpr-policy');
  },
};
