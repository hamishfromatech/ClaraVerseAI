/**
 * Local JWT Authentication Client
 * Replaces Supabase with local authentication
 */

interface User {
  id: string;
  email: string;
  email_verified: boolean;
  role?: string;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
  expires_in: number;
}

class AuthClient {
  private accessToken: string | null = null;
  private user: User | null = null;
  private refreshTokenTimeout: NodeJS.Timeout | null = null;

  constructor() {
    // Load access token from localStorage on initialization
    this.accessToken = localStorage.getItem('access_token');
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        this.user = JSON.parse(userStr);
      } catch (e) {
        console.error('Failed to parse stored user:', e);
        this.clearSession();
      }
    }

    // Set up automatic token refresh if we have a token
    if (this.accessToken) {
      this.setupTokenRefresh();
    }
  }

  /**
   * Register a new user
   */
  async signUp(email: string, password: string): Promise<User> {
    const baseUrl = window.location.origin;
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      credentials: 'include', // Include cookies for refresh token
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registration failed');
    }

    const data: AuthResponse = await response.json();
    this.handleAuthSuccess(data);
    return data.user;
  }

  /**
   * Sign in an existing user
   */
  async signIn(email: string, password: string): Promise<User> {
    const baseUrl = window.location.origin;
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
      credentials: 'include', // Include cookies for refresh token
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data: AuthResponse = await response.json();
    this.handleAuthSuccess(data);
    return data.user;
  }

  /**
   * Sign out the current user
   */
  async signOut(): Promise<void> {
    try {
      const baseUrl = window.location.origin;
      await fetch(`${baseUrl}/api/auth/logout`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
    } catch (error) {
      console.error('Logout request failed:', error);
      // Continue with local cleanup even if request fails
    }

    this.clearSession();
  }

  /**
   * Refresh the access token
   */
  async refreshToken(): Promise<string> {
    const baseUrl = window.location.origin;
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include', // Refresh token is in httpOnly cookie
    });

    if (!response.ok) {
      // Refresh failed - session expired
      this.clearSession();
      throw new Error('Session expired. Please log in again.');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    localStorage.setItem('access_token', data.access_token);

    // Set up next refresh
    this.setupTokenRefresh();

    return data.access_token;
  }

  /**
   * Get the current user
   */
  getUser(): User | null {
    return this.user;
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.accessToken !== null && this.user !== null;
  }

  /**
   * Get authentication headers for API requests
   */
  getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  /**
   * Fetch with automatic authentication
   */
  async authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
    // Add auth headers
    const headers = {
      ...this.getAuthHeaders(),
      ...(options.headers || {}),
    };

    let response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    // If 401, try to refresh token once
    if (response.status === 401 && this.accessToken) {
      try {
        await this.refreshToken();

        // Retry request with new token
        response = await fetch(url, {
          ...options,
          headers: {
            ...this.getAuthHeaders(),
            ...(options.headers || {}),
          },
          credentials: 'include',
        });
      } catch (error) {
        // Refresh failed, clear session
        this.clearSession();
        throw new Error('Session expired. Please log in again.');
      }
    }

    return response;
  }

  /**
   * Handle successful authentication
   */
  private handleAuthSuccess(data: AuthResponse): void {
    this.accessToken = data.access_token;
    this.user = data.user;

    // Store in localStorage
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('user', JSON.stringify(data.user));

    // Refresh token is stored as httpOnly cookie by backend
    // Set up automatic token refresh
    this.setupTokenRefresh();

    console.log('✅ Authentication successful:', data.user.email);
  }

  /**
   * Clear session data
   */
  private clearSession(): void {
    this.accessToken = null;
    this.user = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');

    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
      this.refreshTokenTimeout = null;
    }

    console.log('🔓 Session cleared');
  }

  /**
   * Set up automatic token refresh
   * Refresh 1 minute before expiry (15 min token - refresh at 14 min)
   */
  private setupTokenRefresh(): void {
    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
    }

    // Refresh after 14 minutes (token expires in 15 minutes)
    const refreshInterval = 14 * 60 * 1000; // 14 minutes in milliseconds

    this.refreshTokenTimeout = setTimeout(async () => {
      try {
        await this.refreshToken();
        console.log('🔄 Access token refreshed automatically');
      } catch (error) {
        console.error('❌ Failed to refresh token:', error);
        this.clearSession();
      }
    }, refreshInterval);
  }
}

// Export singleton instance
export const authClient = new AuthClient();

// Export for backwards compatibility with Supabase client
export const auth = {
  signUp: (email: string, password: string) => authClient.signUp(email, password),
  signInWithPassword: ({ email, password }: { email: string; password: string }) =>
    authClient.signIn(email, password).then(user => ({ data: { user }, error: null })),
  signOut: () => authClient.signOut().then(() => ({ error: null })),
  getUser: () => Promise.resolve({ data: { user: authClient.getUser() }, error: null }),
};

export default authClient;
