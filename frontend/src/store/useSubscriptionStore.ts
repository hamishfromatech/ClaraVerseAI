import { create } from 'zustand';
import { subscriptionService } from '@/services/subscriptionService';
import type {
  Plan,
  Subscription,
  PlanChangePreview,
  SubscriptionTierType,
  UsageStats,
} from '@/types/subscription';
import { SubscriptionTier, SubscriptionStatus } from '@/types/subscription';

// Feature flag to disable subscription for local/self-hosted deployments
const DISABLE_SUBSCRIPTION = import.meta.env.VITE_DISABLE_SUBSCRIPTION === 'true';

// Limit exceeded data structure
export interface LimitExceededData {
  type: 'messages' | 'file_uploads' | 'image_generations';
  limit: number;
  used: number;
  resetAt: string;
  suggestedTier: string;
}

interface SubscriptionState {
  // Data
  subscription: Subscription | null;
  plans: Plan[];
  usageStats: UsageStats | null;
  limitExceeded: LimitExceededData | null;

  // Loading states
  isLoadingSubscription: boolean;
  isLoadingPlans: boolean;
  isLoadingUsage: boolean;
  isChangingPlan: boolean;

  // Error states
  subscriptionError: string | null;
  plansError: string | null;
  usageError: string | null;

  // Actions
  fetchSubscription: () => Promise<void>;
  fetchPlans: () => Promise<void>;
  fetchUsageStats: () => Promise<void>;
  refreshAll: () => Promise<void>;
  syncSubscription: () => Promise<void>;
  previewPlanChange: (planId: string) => Promise<PlanChangePreview | null>;
  createCheckout: (planId: string) => Promise<string | null>;
  changePlan: (planId: string) => Promise<boolean>;
  cancelSubscription: () => Promise<boolean>;
  reactivateSubscription: () => Promise<boolean>;
  getPortalURL: () => Promise<string | null>;
  setLimitExceeded: (data: LimitExceededData | null) => void;
  clearLimitExceeded: () => void;
  clearErrors: () => void;
  reset: () => void;
}

// Default subscription for users without a subscription
const defaultFreeSubscription: Subscription = {
  id: '',
  user_id: '',
  tier: SubscriptionTier.FREE,
  status: SubscriptionStatus.ACTIVE,
  cancel_at_period_end: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Default unlimited subscription for local/self-hosted deployments
const defaultUnlimitedSubscription: Subscription = {
  id: 'local-hosted',
  user_id: 'local',
  tier: SubscriptionTier.PRO, // Pro tier with unlimited features
  status: SubscriptionStatus.ACTIVE,
  cancel_at_period_end: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  // Initial state
  subscription: null,
  plans: [],
  usageStats: null,
  limitExceeded: null,
  isLoadingSubscription: false,
  isLoadingPlans: false,
  isLoadingUsage: false,
  isChangingPlan: false,
  subscriptionError: null,
  plansError: null,
  usageError: null,

  // Fetch current subscription
  fetchSubscription: async () => {
    set({ isLoadingSubscription: true, subscriptionError: null });

    // If subscription is disabled, return unlimited subscription immediately
    if (DISABLE_SUBSCRIPTION) {
      set({
        subscription: defaultUnlimitedSubscription,
        isLoadingSubscription: false,
      });
      return;
    }

    try {
      const subscription = await subscriptionService.getCurrentSubscription();
      set({ subscription, isLoadingSubscription: false });
    } catch (error) {
      console.error('Failed to fetch subscription:', error);
      // Default to free tier on error
      set({
        subscription: defaultFreeSubscription,
        subscriptionError: error instanceof Error ? error.message : 'Failed to fetch subscription',
        isLoadingSubscription: false,
      });
    }
  },

  // Fetch available plans
  fetchPlans: async () => {
    set({ isLoadingPlans: true, plansError: null });
    try {
      const plans = await subscriptionService.getPlans();
      set({ plans, isLoadingPlans: false });
    } catch (error) {
      console.error('Failed to fetch plans:', error);
      set({
        plansError: error instanceof Error ? error.message : 'Failed to fetch plans',
        isLoadingPlans: false,
      });
    }
  },

  // Fetch current usage statistics
  fetchUsageStats: async () => {
    set({ isLoadingUsage: true, usageError: null });
    try {
      const usageStats = await subscriptionService.getUsageStats();
      set({ usageStats, isLoadingUsage: false });
    } catch (error) {
      console.error('Failed to fetch usage stats:', error);
      set({
        usageError: error instanceof Error ? error.message : 'Failed to fetch usage',
        isLoadingUsage: false,
      });
    }
  },

  // Refresh subscription and plans (usage disabled in OSS version)
  refreshAll: async () => {
    await Promise.all([get().fetchSubscription(), get().fetchPlans()]);
  },

  // Sync subscription from payment provider (useful after checkout)
  syncSubscription: async () => {
    set({ isLoadingSubscription: true });
    try {
      const subscription = await subscriptionService.syncSubscription();
      set({ subscription, isLoadingSubscription: false });
    } catch (error) {
      console.error('Failed to sync subscription:', error);
      set({ isLoadingSubscription: false });
    }
  },

  // Preview a plan change
  previewPlanChange: async (planId: string) => {
    try {
      return await subscriptionService.previewPlanChange(planId);
    } catch (error) {
      console.error('Failed to preview plan change:', error);
      return null;
    }
  },

  // Create checkout session and return URL
  createCheckout: async (planId: string) => {
    set({ isChangingPlan: true });
    try {
      const response = await subscriptionService.createCheckout(planId);
      set({ isChangingPlan: false });
      return response.checkout_url;
    } catch (error) {
      console.error('Failed to create checkout:', error);
      set({ isChangingPlan: false });
      return null;
    }
  },

  // Change plan (for downgrades or when upgrading existing paid subscription)
  changePlan: async (planId: string) => {
    set({ isChangingPlan: true });
    try {
      await subscriptionService.changePlan(planId);
      // Refresh subscription after change
      await get().fetchSubscription();
      set({ isChangingPlan: false });
      return true;
    } catch (error) {
      console.error('Failed to change plan:', error);
      set({ isChangingPlan: false });
      return false;
    }
  },

  // Cancel subscription
  cancelSubscription: async () => {
    set({ isChangingPlan: true });
    try {
      await subscriptionService.cancelSubscription();
      // Refresh subscription after cancel
      await get().fetchSubscription();
      set({ isChangingPlan: false });
      return true;
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
      set({ isChangingPlan: false });
      return false;
    }
  },

  // Reactivate cancelled subscription
  reactivateSubscription: async () => {
    set({ isChangingPlan: true });
    try {
      await subscriptionService.reactivateSubscription();
      // Refresh subscription after reactivation
      await get().fetchSubscription();
      set({ isChangingPlan: false });
      return true;
    } catch (error) {
      console.error('Failed to reactivate subscription:', error);
      set({ isChangingPlan: false });
      return false;
    }
  },

  // Get customer portal URL
  getPortalURL: async () => {
    try {
      return await subscriptionService.getPortalURL();
    } catch (error) {
      console.error('Failed to get portal URL:', error);
      return null;
    }
  },

  // Set limit exceeded state
  setLimitExceeded: (data: LimitExceededData | null) => {
    set({ limitExceeded: data });
  },

  // Clear limit exceeded state
  clearLimitExceeded: () => {
    set({ limitExceeded: null });
  },

  // Clear errors
  clearErrors: () => {
    set({ subscriptionError: null, plansError: null, usageError: null });
  },

  // Reset store
  reset: () => {
    set({
      subscription: null,
      plans: [],
      usageStats: null,
      limitExceeded: null,
      isLoadingSubscription: false,
      isLoadingPlans: false,
      isLoadingUsage: false,
      isChangingPlan: false,
      subscriptionError: null,
      plansError: null,
      usageError: null,
    });
  },
}));

// Selectors
export const selectCurrentTier = (state: SubscriptionState): SubscriptionTierType => {
  return state.subscription?.tier || SubscriptionTier.FREE;
};

export const selectIsFreeTier = (state: SubscriptionState): boolean => {
  return selectCurrentTier(state) === SubscriptionTier.FREE;
};

export const selectIsPaidTier = (state: SubscriptionState): boolean => {
  const tier = selectCurrentTier(state);
  return tier !== SubscriptionTier.FREE;
};

export const selectCanUpgrade = (state: SubscriptionState): boolean => {
  const tier = selectCurrentTier(state);
  return tier !== SubscriptionTier.ENTERPRISE;
};

export const selectCanDowngrade = (state: SubscriptionState): boolean => {
  const tier = selectCurrentTier(state);
  return tier !== SubscriptionTier.FREE;
};

export const selectIsCancelling = (state: SubscriptionState): boolean => {
  return state.subscription?.cancel_at_period_end === true;
};

export const selectPlanById = (state: SubscriptionState, planId: string): Plan | undefined => {
  return state.plans.find(p => p.id === planId);
};

export const selectCurrentPlan = (state: SubscriptionState): Plan | undefined => {
  const tier = selectCurrentTier(state);
  return state.plans.find(p => p.tier === tier);
};

export default useSubscriptionStore;
