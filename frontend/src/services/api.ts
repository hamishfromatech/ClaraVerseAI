import { useSubscriptionStore } from '@/store/useSubscriptionStore';
import { authClient } from '@/lib/auth';

// Use relative URL when not specified (works with nginx proxy in all-in-one container)
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Get JWT token from auth client (v2.0 local JWT)
function getAuthToken(): string | null {
  return authClient.getAccessToken();
}

// Create headers with optional Authorization
function createHeaders(includeAuth = true): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (includeAuth) {
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  return headers;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    // Handle 429 Too Many Requests - limit exceeded
    if (response.status === 429 && error.error_code) {
      // Extract limit type from error code
      const limitType = error.error_code.replace('_limit_exceeded', '') as
        | 'messages'
        | 'file_uploads'
        | 'image_generations';

      // Update subscription store with limit exceeded data
      if (error.limit !== undefined && error.used !== undefined) {
        useSubscriptionStore.getState().setLimitExceeded({
          type: limitType,
          limit: error.limit,
          used: error.used,
          resetAt: error.reset_at,
          suggestedTier: error.upgrade_to || 'pro',
        });
      }
    }

    throw new ApiError(error.message || error.error || 'An error occurred', response.status, error);
  }

  // Handle empty responses (204 No Content or empty body)
  const contentLength = response.headers.get('Content-Length');
  if (response.status === 204 || contentLength === '0') {
    return {} as T;
  }

  // Try to parse JSON, return empty object if body is empty
  const text = await response.text();
  if (!text || text.trim() === '') {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    // If JSON parsing fails, return empty object
    return {} as T;
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  let lastError: unknown;

  for (let i = 0; i <= retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include', // Always include cookies for refresh token
      });

      // Handle 401 Unauthorized - try to refresh token once
      if (response.status === 401 && i === 0) {
        try {
          console.log('🔄 Token expired, refreshing...');
          await authClient.refreshToken();

          // Retry request with new token
          const newHeaders = createHeaders((options as any).includeAuth ?? true);
          const retryResponse = await fetch(url, {
            ...options,
            headers: newHeaders,
            credentials: 'include',
          });

          if (retryResponse.ok || retryResponse.status !== 401) {
            return retryResponse;
          }
        } catch (refreshError) {
          console.error('❌ Token refresh failed:', refreshError);
          // Continue to return original 401 response
        }
      }

      // Retry on 502/503/504 (Bad Gateway, Service Unavailable, Gateway Timeout)
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        if (i < retries) {
          throw new Error(`Server error: ${response.status}`);
        }
        return response;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (i < retries) {
        const delay = RETRY_DELAY * Math.pow(2, i);
        console.log(`API request failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError;
}

export const api = {
  get: async <T>(endpoint: string, options?: { includeAuth?: boolean }): Promise<T> => {
    const response = await fetchWithRetry(`${API_BASE_URL}${endpoint}`, {
      headers: createHeaders(options?.includeAuth ?? true),
    });
    return handleResponse<T>(response);
  },

  post: async <T>(
    endpoint: string,
    data: unknown,
    options?: { includeAuth?: boolean }
  ): Promise<T> => {
    const response = await fetchWithRetry(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: createHeaders(options?.includeAuth ?? true),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  put: async <T>(
    endpoint: string,
    data: unknown,
    options?: { includeAuth?: boolean }
  ): Promise<T> => {
    const response = await fetchWithRetry(`${API_BASE_URL}${endpoint}`, {
      method: 'PUT',
      headers: createHeaders(options?.includeAuth ?? true),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  delete: async <T>(endpoint: string, options?: { includeAuth?: boolean }): Promise<T> => {
    const response = await fetchWithRetry(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: createHeaders(options?.includeAuth ?? true),
    });
    return handleResponse<T>(response);
  },

  deleteWithBody: async <T>(
    endpoint: string,
    data: unknown,
    options?: { includeAuth?: boolean }
  ): Promise<T> => {
    const response = await fetchWithRetry(`${API_BASE_URL}${endpoint}`, {
      method: 'DELETE',
      headers: createHeaders(options?.includeAuth ?? true),
      body: JSON.stringify(data),
    });
    return handleResponse<T>(response);
  },

  // Helper to set auth token manually (for Supabase or other auth providers)
  setAuthToken: (token: string) => {
    localStorage.setItem('auth_token', token);
  },

  // Helper to clear auth token
  clearAuthToken: () => {
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_token');
  },

  // Download file with authentication
  downloadFile: async (url: string, filename?: string): Promise<void> => {
    const token = getAuthToken();
    if (!token) {
      throw new ApiError('Authentication required to download files', 401);
    }

    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new ApiError(error.message || 'Download failed', response.status, error);
      }

      // Get filename from Content-Disposition header if not provided
      const contentDisposition = response.headers.get('Content-Disposition');
      let downloadFilename = filename;

      if (!downloadFilename && contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch) {
          downloadFilename = filenameMatch[1];
        }
      }

      // Download the file
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadFilename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Failed to download file', 500, error);
    }
  },
};

// User service methods
export const userService = {
  /**
   * Mark the welcome popup as seen for the current user
   */
  markWelcomePopupSeen: async (): Promise<void> => {
    await api.post('/api/user/welcome-popup-seen', {});
  },
};

// Additional API utilities
export const apiUtils = {
  // Download file with authentication
  downloadFile: async (url: string, filename?: string): Promise<void> => {
    const token = getAuthToken();
    if (!token) {
      throw new ApiError('Authentication required to download files', 401);
    }

    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new ApiError(error.message || 'Download failed', response.status, error);
      }

      // Get filename from Content-Disposition header if not provided
      const contentDisposition = response.headers.get('Content-Disposition');
      let downloadFilename = filename;

      if (!downloadFilename && contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
        if (filenameMatch) {
          downloadFilename = filenameMatch[1];
        }
      }

      // Download the file
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = downloadFilename || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError('Failed to download file', 500, error);
    }
  },
};
