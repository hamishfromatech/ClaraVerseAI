import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  SettingsLayout,
  AIConfigSection,
  APIKeysSection,
  BillingSection,
  UsageSection,
  CredentialsSection,
  PrivacySection,
  AccountSection,
  PrivacyPolicySidebar,
} from '@/components/settings';
import type { SettingsTab } from '@/components/settings/SettingsLayout';
import './Settings.css';

export const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');
  const [saveIndicatorVisible, setSaveIndicatorVisible] = useState(false);

  // Auto-checkout state from URL params (for billing tab)
  const [autoCheckoutPlan, setAutoCheckoutPlan] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<boolean>(false);

  // Handle URL query params for tab and auto-checkout
  useEffect(() => {
    const tab = searchParams.get('tab');
    const plan = searchParams.get('plan');
    const checkout = searchParams.get('checkout');

    // Redirect billing and usage tabs to ai (hidden in OSS version)
    if (tab === 'billing' || tab === 'usage') {
      searchParams.set('tab', 'ai');
      setSearchParams(searchParams, { replace: true });
      setActiveTab('ai');
    } else if (tab && ['ai', 'api-keys', 'credentials', 'privacy', 'account'].includes(tab)) {
      setActiveTab(tab as SettingsTab);
    }

    if (plan) {
      setAutoCheckoutPlan(plan);
      // Clear the plan param from URL after reading
      searchParams.delete('plan');
      setSearchParams(searchParams, { replace: true });
    }

    // Handle checkout success - user returning from payment
    if (checkout === 'success') {
      setCheckoutSuccess(true);
      // Clear the checkout param from URL after reading
      searchParams.delete('checkout');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Show save indicator
  const showSaveIndicator = useCallback(() => {
    setSaveIndicatorVisible(true);
    setTimeout(() => setSaveIndicatorVisible(false), 2000);
  }, []);

  // Handle tab change - update URL
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    searchParams.set('tab', tab);
    setSearchParams(searchParams, { replace: true });
  };

  const handleAutoCheckoutHandled = () => {
    setAutoCheckoutPlan(null);
  };

  const handleCheckoutSuccessHandled = () => {
    setCheckoutSuccess(false);
  };

  return (
    <SettingsLayout
      activeTab={activeTab}
      onTabChange={handleTabChange}
      showSaveIndicator={saveIndicatorVisible}
    >
      {/* AI Configuration Tab */}
      {activeTab === 'ai' && <AIConfigSection onSave={showSaveIndicator} />}

      {/* API Keys Tab */}
      {activeTab === 'api-keys' && (
        <section className="settings-section">
          <APIKeysSection />
        </section>
      )}

      {/* Credentials/Integrations Tab */}
      {activeTab === 'credentials' && (
        <section className="settings-section">
          <h2 className="settings-section-title">Integration Credentials</h2>
          <p className="settings-section-description">
            Securely manage API keys and webhooks for external integrations like Discord, Slack,
            GitHub, and more.
          </p>
          <CredentialsSection />
        </section>
      )}

      {/* Billing Tab */}
      {activeTab === 'billing' && (
        <section className="settings-section billing-section-wrapper">
          <BillingSection
            autoCheckoutPlan={autoCheckoutPlan}
            onAutoCheckoutHandled={handleAutoCheckoutHandled}
            checkoutSuccess={checkoutSuccess}
            onCheckoutSuccessHandled={handleCheckoutSuccessHandled}
          />
        </section>
      )}

      {/* Usage Tab */}
      {activeTab === 'usage' && (
        <section className="settings-section">
          <UsageSection />
        </section>
      )}

      {/* Privacy Tab */}
      {activeTab === 'privacy' && (
        <div className="privacy-tab-layout">
          <PrivacySection onSave={showSaveIndicator} />
          {/* Privacy Policy Sidebar - Desktop Only */}
          <PrivacyPolicySidebar />
        </div>
      )}

      {/* Account Tab */}
      {activeTab === 'account' && <AccountSection onSave={showSaveIndicator} />}
    </SettingsLayout>
  );
};
