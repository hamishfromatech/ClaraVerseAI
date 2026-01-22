import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthForm } from '@/components/auth';
import { useAuthStore } from '@/store/useAuthStore';
import { toast } from '@/store/useToastStore';
import './Onboarding.css';

export const Onboarding = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, isAdmin, sessionExpiredReason, clearSessionExpiredReason } =
    useAuthStore();
  const [defaultMode, setDefaultMode] = useState<'signin' | 'signup'>('signin');
  const [isLoading, setIsLoading] = useState(true);

  // Get redirect URL from query params
  const redirectUrl = searchParams.get('redirect') || '/';

  // Check if any users exist - if not, show signup first
  useEffect(() => {
    const checkUsersExist = async () => {
      try {
        const baseUrl = import.meta.env.VITE_API_BASE_URL || window.location.origin;
        const response = await fetch(`${baseUrl}/api/auth/status`);
        if (response.ok) {
          const data = await response.json();
          // If no users exist, show signup form
          if (!data.has_users) {
            setDefaultMode('signup');
          }
        }
      } catch (error) {
        console.error('Failed to check auth status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkUsersExist();
  }, []);

  useEffect(() => {
    // If session expired, show toast and clear the reason
    if (sessionExpiredReason) {
      toast.error(sessionExpiredReason, 'Session Expired');
      clearSessionExpiredReason();
    }
  }, [sessionExpiredReason, clearSessionExpiredReason]);

  useEffect(() => {
    // If user is already authenticated, redirect based on admin status
    if (isAuthenticated) {
      if (isAdmin) {
        navigate('/admin/dashboard');
      } else {
        navigate(redirectUrl);
      }
    }
  }, [isAuthenticated, isAdmin, navigate, redirectUrl]);

  // Show loading state while checking if users exist
  if (isLoading) {
    return (
      <div className="onboarding-container">
        <div className="onboarding-left">
          <div className="onboarding-image-container">
            <img src="/image-1.webp" alt="KaylahGPT" className="onboarding-image" />
          </div>
        </div>
        <div className="onboarding-auth" />
      </div>
    );
  }

  return (
    <div className="onboarding-container">
      {/* Left side: Single image (60%) */}
      <div className="onboarding-left">
        <div className="onboarding-image-container">
          <img src="/image-1.webp" alt="KaylahGPT" className="onboarding-image" />
        </div>
      </div>

      {/* Right side: Auth Form (40%) */}
      <div className="onboarding-auth">
        <AuthForm defaultMode={defaultMode} redirectUrl={redirectUrl} />
      </div>
    </div>
  );
};
