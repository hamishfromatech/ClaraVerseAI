import { apiClient } from '@/lib/apiClient';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Tool interface matching backend ToolResponse
 */
export interface Tool {
  name: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  keywords: string[];
  source: string;
}

/**
 * Tool category interface
 */
export interface ToolCategory {
  name: string;
  count: number;
  tools: Tool[];
}

/**
 * Response from /api/tools endpoint
 */
export interface ListToolsResponse {
  categories: ToolCategory[];
  total: number;
}

/**
 * Tool recommendation interface
 */
export interface ToolRecommendation {
  name: string;
  display_name: string;
  description: string;
  icon: string;
  category: string;
  keywords: string[];
  source: string;
  score: number;
  reason: string;
}

/**
 * Request body for tool recommendations
 */
export interface RecommendToolsRequest {
  block_name: string;
  block_description: string;
  block_type: string;
}

/**
 * Response from /api/tools/recommend endpoint
 */
export interface RecommendToolsResponse {
  recommendations: ToolRecommendation[];
  count: number;
}

/**
 * Fetch all available tools grouped by category
 * Requires authentication
 */
export async function fetchTools(): Promise<ListToolsResponse> {
  try {
    const response = await apiClient.get(`${API_BASE_URL}/api/tools`, {
      requiresAuth: true,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tools: ${response.statusText}`);
    }

    const data: ListToolsResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching tools:', error);
    throw error;
  }
}

/**
 * Get tool recommendations based on block context
 * Requires authentication
 */
export async function getToolRecommendations(
  request: RecommendToolsRequest
): Promise<ToolRecommendation[]> {
  try {
    const response = await apiClient.post(`${API_BASE_URL}/api/tools/recommend`, {
      body: JSON.stringify(request),
      requiresAuth: true,
    });

    if (!response.ok) {
      throw new Error(`Failed to get tool recommendations: ${response.statusText}`);
    }

    const data: RecommendToolsResponse = await response.json();
    return data.recommendations || [];
  } catch (error) {
    console.error('Error getting tool recommendations:', error);
    throw error;
  }
}

/**
 * Get all tools from a specific category
 */
export function getToolsByCategory(categories: ToolCategory[], categoryName: string): Tool[] {
  const category = categories.find(cat => cat.name === categoryName);
  return category?.tools || [];
}

/**
 * Search tools by name or description
 */
export function searchTools(tools: Tool[], query: string): Tool[] {
  const lowerQuery = query.toLowerCase();
  return tools.filter(
    tool =>
      tool.display_name.toLowerCase().includes(lowerQuery) ||
      tool.description.toLowerCase().includes(lowerQuery) ||
      tool.keywords.some(keyword => keyword.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Group tools by category from a flat list
 */
export function groupToolsByCategory(tools: Tool[]): ToolCategory[] {
  const categoryMap = new Map<string, Tool[]>();

  for (const tool of tools) {
    const category = tool.category || 'other';
    if (!categoryMap.has(category)) {
      categoryMap.set(category, []);
    }
    categoryMap.get(category)!.push(tool);
  }

  return Array.from(categoryMap.entries()).map(([name, tools]) => ({
    name,
    count: tools.length,
    tools,
  }));
}

/**
 * Filter tools by source (builtin or mcp_local)
 */
export function filterToolsBySource(tools: Tool[], source: string): Tool[] {
  return tools.filter(tool => tool.source === source);
}
