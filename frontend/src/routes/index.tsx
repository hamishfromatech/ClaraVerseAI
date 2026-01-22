import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  Navigate,
  useSearchParams,
} from 'react-router-dom';
import { useEffect } from 'react';
import {
  Dashboard,
  Onboarding,
  Chat,
  LumaUI,
  Notebooks,
  Agents,
  Community,
  Settings,
  DesignSystem,
  Credentials,
  PrivacyPolicy,
  Home,
} from '@/pages';
import { ResetPassword } from '@/pages/ResetPassword';
import { ProtectedRoute, AdminRoute } from '@/components/auth';
import { AdminLayout } from '@/components/admin';
import {
  Dashboard as AdminDashboard,
  ProviderManagement,
  Analytics,
  ModelManagement,
  UserManagement,
} from '@/pages/admin';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAuthStore } from '@/store/useAuthStore';
import { useSubscriptionStore } from '@/store/useSubscriptionStore';

// Pricing redirect component - redirects to Settings > Billing with optional plan param
const PricingRedirect = () => {
  const [searchParams] = useSearchParams();
  const plan = searchParams.get('plan');
  const redirectPath = plan ? `/settings?tab=billing&plan=${plan}` : '/settings?tab=billing';
  return <Navigate to={redirectPath} replace />;
};

const router = createBrowserRouter([
  {
    // Root route wrapper with ErrorBoundary for all routes
    element: <Outlet />,
    errorElement: (
      <ErrorBoundary>
        <div />
      </ErrorBoundary>
    ),
    children: [
      {
        path: '/',
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },
      {
        path: '/home',
        element: <Home />,
      },
      {
        path: '/signin',
        element: <Onboarding />,
      },
      {
        path: '/reset-password',
        element: <ResetPassword />,
      },
      {
        path: '/privacy',
        element: <PrivacyPolicy />,
      },
      {
        path: '/pricing',
        element: (
          <ProtectedRoute>
            <PricingRedirect />
          </ProtectedRoute>
        ),
      },
      {
        path: '/chat',
        element: (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        ),
      },
      {
        path: '/chat/:chatId',
        element: (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        ),
      },
      {
        path: '/artifacts',
        element: (
          <ProtectedRoute>
            <Chat />
          </ProtectedRoute>
        ),
      },
      {
        path: '/luma',
        element: (
          <ProtectedRoute>
            <LumaUI />
          </ProtectedRoute>
        ),
      },
      {
        path: '/notebooks',
        element: (
          <ProtectedRoute>
            <Notebooks />
          </ProtectedRoute>
        ),
      },
      {
        path: '/agents',
        element: (
          <ProtectedRoute>
            <Agents />
          </ProtectedRoute>
        ),
      },
      {
        path: '/agents/builder/:agentId',
        element: (
          <ProtectedRoute>
            <Agents />
          </ProtectedRoute>
        ),
      },
      {
        path: '/agents/deployed/:agentId',
        element: (
          <ProtectedRoute>
            <Agents />
          </ProtectedRoute>
        ),
      },
      {
        path: '/community',
        element: (
          <ProtectedRoute>
            <Community />
          </ProtectedRoute>
        ),
      },
      {
        path: '/settings',
        element: (
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        ),
      },
      {
        path: '/design-system',
        element: (
          <ProtectedRoute>
            <DesignSystem />
          </ProtectedRoute>
        ),
      },
      {
        path: '/credentials',
        element: (
          <ProtectedRoute>
            <Credentials />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin',
        element: (
          <AdminRoute>
            <AdminLayout>
              <Outlet />
            </AdminLayout>
          </AdminRoute>
        ),
        children: [
          { path: 'dashboard', element: <AdminDashboard /> },
          { path: 'providers', element: <ProviderManagement /> },
          { path: 'analytics', element: <Analytics /> },
          { path: 'models', element: <ModelManagement /> },
          { path: 'users', element: <UserManagement /> },
          { path: '', element: <Navigate to="dashboard" replace /> },
        ],
      },
    ],
  },
]);

export const AppRouter = () => {
  const { initialize, isAuthenticated } = useAuthStore();
  const { fetchSubscription } = useSubscriptionStore();

  // Initialize auth on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Fetch subscription when user becomes authenticated
  // This triggers user sync in backend and applies promo tier if eligible
  useEffect(() => {
    if (isAuthenticated) {
      fetchSubscription();
    }
  }, [isAuthenticated, fetchSubscription]);

  // Note: Admin redirect happens on login (AuthForm.tsx), not on dashboard load
  // This allows admins to access regular dashboard if they navigate there manually

  return <RouterProvider router={router} />;
};
