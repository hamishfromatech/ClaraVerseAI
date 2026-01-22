import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  Plus,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  Circle,
  ExternalLink,
  Trash2,
  Edit,
  RefreshCw,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import { Button, SearchInput } from '@/components/design-system';
import { useCredentialsStore } from '@/store/useCredentialsStore';
import type { Credential, Integration } from '@/types/credential';
import { formatLastUsed, getTestStatusDisplay } from '@/services/credentialService';
import { CredentialFormModal } from '@/components/credentials/CredentialFormModal';
import { IntegrationIcon } from '@/components/credentials/IntegrationIcon';
import './Credentials.css';

export const Credentials = () => {
  // URL params for required integrations
  const [searchParams, setSearchParams] = useSearchParams();

  // Store
  const {
    credentials,
    integrations,
    isLoading,
    isTesting,
    error,
    fetchIntegrations,
    fetchCredentials,
    deleteCredential,
    testCredential,
    clearError,
  } = useCredentialsStore();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCredential, setEditingCredential] = useState<Credential | null>(null);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Parse required integrations from URL
  const requiredIntegrationTypes = useMemo(() => {
    const required = searchParams.get('required');
    if (!required) return [];
    return required.split(',').filter(Boolean);
  }, [searchParams]);

  // Get required integrations with their details
  const requiredIntegrations = useMemo(() => {
    if (requiredIntegrationTypes.length === 0) return [];
    return integrations
      .flatMap(cat => cat.integrations)
      .filter(int => requiredIntegrationTypes.includes(int.id));
  }, [integrations, requiredIntegrationTypes]);

  // Clear required params when user adds credentials for all required integrations
  const clearRequiredParams = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // Fetch data on mount
  useEffect(() => {
    fetchIntegrations();
    fetchCredentials();
  }, [fetchIntegrations, fetchCredentials]);

  // Filter credentials by search query and category
  const filteredCredentials = credentials.filter(cred => {
    const matchesSearch =
      !searchQuery ||
      cred.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cred.integrationType.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      !selectedCategory ||
      integrations
        .find(cat => cat.id === selectedCategory)
        ?.integrations.some(int => int.id === cred.integrationType);

    return matchesSearch && matchesCategory;
  });

  // Get integration details for a credential
  const getIntegrationForCredential = useCallback(
    (integrationType: string): Integration | undefined => {
      for (const category of integrations) {
        const integration = category.integrations.find(i => i.id === integrationType);
        if (integration) return integration;
      }
      return undefined;
    },
    [integrations]
  );

  // Handle add credential
  const handleAddCredential = (integration: Integration) => {
    setSelectedIntegration(integration);
    setEditingCredential(null);
    setIsAddModalOpen(true);
  };

  // Handle edit credential
  const handleEditCredential = (credential: Credential) => {
    const integration = getIntegrationForCredential(credential.integrationType);
    if (integration) {
      setSelectedIntegration(integration);
      setEditingCredential(credential);
      setIsAddModalOpen(true);
    }
  };

  // Handle delete credential
  const handleDeleteCredential = async (id: string) => {
    const success = await deleteCredential(id);
    if (success) {
      setDeleteConfirmId(null);
    }
  };

  // Handle test credential
  const handleTestCredential = async (id: string) => {
    await testCredential(id);
  };

  // Close modal
  const handleCloseModal = () => {
    setIsAddModalOpen(false);
    setEditingCredential(null);
    setSelectedIntegration(null);
  };

  // Get credentials count for an integration
  const getCredentialsCount = (integrationType: string): number => {
    return credentials.filter(c => c.integrationType === integrationType).length;
  };

  // Render test status badge
  const renderTestStatus = (credential: Credential) => {
    const status = getTestStatusDisplay(credential.metadata.testStatus);
    const Icon =
      credential.metadata.testStatus === 'success'
        ? CheckCircle
        : credential.metadata.testStatus === 'failed'
          ? XCircle
          : Circle;

    return (
      <span className={`flex items-center gap-1.5 text-xs ${status.color}`}>
        <Icon size={12} />
        {status.label}
      </span>
    );
  };

  return (
    <div className="credentials-page h-full flex flex-col bg-[var(--color-bg-primary)]">
      {/* Header */}
      <header className="credentials-header px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-4">
          <Link
            to="/agents"
            className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <ChevronLeft size={20} className="text-[var(--color-text-secondary)]" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
              <KeyRound size={24} className="text-[var(--color-accent)]" />
              Credentials
            </h1>
            <p className="text-sm text-[var(--color-text-tertiary)] mt-0.5">
              Securely manage API keys and webhooks for your integrations
            </p>
          </div>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
          <button onClick={clearError} className="text-red-400 hover:text-red-300">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar - Integration Categories */}
        <aside className="w-64 border-r border-[var(--color-border)] overflow-y-auto">
          <div className="p-4">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedCategory === null
                  ? 'bg-[var(--color-accent)] text-black'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              All Integrations
            </button>
          </div>

          {integrations.map(category => (
            <div key={category.id} className="px-4 pb-4">
              <button
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === category.id
                    ? 'bg-[var(--color-accent)] text-black'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {category.name}
              </button>
            </div>
          ))}
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* Search Bar */}
          <div className="mb-6 max-w-md">
            <SearchInput
              placeholder="Search credentials or integrations..."
              value={searchQuery}
              onChange={setSearchQuery}
              onClear={() => setSearchQuery('')}
            />
          </div>

          {/* Loading State */}
          {isLoading && credentials.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={32} className="animate-spin text-[var(--color-accent)]" />
            </div>
          ) : (
            <>
              {/* Required Integrations Section - shown when navigated from workflow setup */}
              {requiredIntegrations.length > 0 && (
                <section className="mb-8">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-amber-500/20">
                        <AlertCircle size={20} className="text-amber-400" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                          Required for Your Workflow
                        </h2>
                        <p className="text-sm text-[var(--color-text-tertiary)]">
                          Add credentials for these integrations to run your workflow
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={clearRequiredParams}
                      className="text-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors"
                    >
                      Clear filter
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {requiredIntegrations.map(integration => {
                      const count = getCredentialsCount(integration.id);
                      const hasCredential = count > 0;
                      return (
                        <div
                          key={integration.id}
                          className={`integration-card bg-[var(--color-bg-secondary)] rounded-xl p-4 border-2 transition-colors cursor-pointer ${
                            hasCredential
                              ? 'border-green-500/50 bg-green-500/5'
                              : 'border-amber-500/50 bg-amber-500/5 hover:border-amber-400'
                          }`}
                          onClick={() => handleAddCredential(integration)}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-12 h-12 rounded-lg bg-[var(--color-bg-primary)] flex items-center justify-center">
                              <IntegrationIcon
                                integrationId={integration.id}
                                size={28}
                                forceColor="white"
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <h3 className="font-medium text-[var(--color-text-primary)]">
                                  {integration.name}
                                </h3>
                                {hasCredential ? (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-green-500/20 text-green-400 flex items-center gap-1">
                                    <CheckCircle size={12} />
                                    Configured
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/20 text-amber-400">
                                    Required
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-[var(--color-text-tertiary)] mt-1 line-clamp-2">
                                {integration.description}
                              </p>
                              {!hasCredential && (
                                <div className="flex items-center gap-2 mt-3">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-amber-400 hover:text-amber-300"
                                  >
                                    <Plus size={14} />
                                    <span className="ml-1">Add Credential</span>
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Configured Credentials */}
              {filteredCredentials.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    Your Credentials ({filteredCredentials.length})
                  </h2>
                  <div className="grid gap-4">
                    {filteredCredentials.map(credential => {
                      const integration = getIntegrationForCredential(credential.integrationType);
                      return (
                        <div
                          key={credential.id}
                          className="credential-card bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-primary)] flex items-center justify-center">
                                <IntegrationIcon
                                  integrationId={credential.integrationType}
                                  size={24}
                                  forceColor="white"
                                />
                              </div>
                              <div>
                                <h3 className="font-medium text-[var(--color-text-primary)]">
                                  {credential.name}
                                </h3>
                                <p className="text-sm text-[var(--color-text-tertiary)]">
                                  {integration?.name || credential.integrationType}
                                </p>
                                <div className="flex items-center gap-4 mt-2">
                                  {renderTestStatus(credential)}
                                  <span className="text-xs text-[var(--color-text-tertiary)]">
                                    {formatLastUsed(credential.metadata.lastUsedAt)}
                                  </span>
                                  <span className="text-xs text-[var(--color-text-tertiary)] font-mono">
                                    {credential.metadata.maskedPreview}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleTestCredential(credential.id)}
                                disabled={isTesting === credential.id}
                              >
                                {isTesting === credential.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={14} />
                                )}
                                <span className="ml-1">Test</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditCredential(credential)}
                              >
                                <Edit size={14} />
                              </Button>
                              {deleteConfirmId === credential.id ? (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDeleteCredential(credential.id)}
                                    className="text-red-400 hover:text-red-300"
                                  >
                                    Confirm
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setDeleteConfirmId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteConfirmId(credential.id)}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Available Integrations - Show all non-comingSoon integrations first */}
              {(() => {
                // Gather all available (non-comingSoon) integrations from all categories
                const availableIntegrations = integrations
                  .flatMap(cat => cat.integrations)
                  .filter(int => !int.comingSoon)
                  .filter(
                    int =>
                      !searchQuery ||
                      int.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      int.id.toLowerCase().includes(searchQuery.toLowerCase())
                  );

                if (availableIntegrations.length > 0 && !selectedCategory) {
                  return (
                    <section className="mb-8">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                        Available Integrations
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {availableIntegrations.map(integration => {
                          const count = getCredentialsCount(integration.id);
                          return (
                            <div
                              key={integration.id}
                              className="integration-card bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-border)] hover:border-[var(--color-accent)]/50 transition-colors cursor-pointer"
                              onClick={() => handleAddCredential(integration)}
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-12 h-12 rounded-lg bg-[var(--color-bg-primary)] flex items-center justify-center">
                                  <IntegrationIcon
                                    integrationId={integration.id}
                                    size={28}
                                    forceColor="white"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <h3 className="font-medium text-[var(--color-text-primary)]">
                                      {integration.name}
                                    </h3>
                                    {count > 0 && (
                                      <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                                        {count} configured
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm text-[var(--color-text-tertiary)] mt-1 line-clamp-2">
                                    {integration.description}
                                  </p>
                                  <div className="flex items-center gap-2 mt-3">
                                    <Button variant="ghost" size="sm" className="text-xs">
                                      <Plus size={14} />
                                      <span className="ml-1">Add</span>
                                    </Button>
                                    {integration.docsUrl && (
                                      <a
                                        href={integration.docsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] flex items-center gap-1"
                                        onClick={e => e.stopPropagation()}
                                      >
                                        <ExternalLink size={12} />
                                        Docs
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                }
                return null;
              })()}

              {/* Coming Soon - Show by category */}
              {integrations
                .filter(cat => !selectedCategory || cat.id === selectedCategory)
                .map(category => {
                  // Filter to only comingSoon integrations (or all if viewing specific category)
                  const categoryIntegrations = category.integrations
                    .filter(int => (selectedCategory ? true : int.comingSoon))
                    .filter(
                      int =>
                        !searchQuery ||
                        int.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        int.id.toLowerCase().includes(searchQuery.toLowerCase())
                    );

                  if (categoryIntegrations.length === 0) return null;

                  return (
                    <section key={category.id} className="mb-8">
                      <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                        {selectedCategory ? category.name : `${category.name} - Coming Soon`}
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {categoryIntegrations.map(integration => {
                          const count = getCredentialsCount(integration.id);
                          const isComingSoon = integration.comingSoon;
                          return (
                            <div
                              key={integration.id}
                              className={`integration-card bg-[var(--color-bg-secondary)] rounded-xl p-4 border border-[var(--color-border)] transition-colors ${
                                isComingSoon
                                  ? 'opacity-60 cursor-not-allowed'
                                  : 'hover:border-[var(--color-accent)]/50 cursor-pointer'
                              }`}
                              onClick={() => !isComingSoon && handleAddCredential(integration)}
                            >
                              <div className="flex items-start gap-3">
                                <div className="w-12 h-12 rounded-lg bg-[var(--color-bg-primary)] flex items-center justify-center">
                                  <IntegrationIcon
                                    integrationId={integration.id}
                                    size={28}
                                    forceColor="white"
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between">
                                    <h3 className="font-medium text-[var(--color-text-primary)]">
                                      {integration.name}
                                    </h3>
                                    {isComingSoon ? (
                                      <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                                        Coming Soon
                                      </span>
                                    ) : count > 0 ? (
                                      <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--color-accent)]/20 text-[var(--color-accent)]">
                                        {count} configured
                                      </span>
                                    ) : null}
                                  </div>
                                  <p className="text-sm text-[var(--color-text-tertiary)] mt-1 line-clamp-2">
                                    {integration.description}
                                  </p>
                                  {!isComingSoon && (
                                    <div className="flex items-center gap-2 mt-3">
                                      <Button variant="ghost" size="sm" className="text-xs">
                                        <Plus size={14} />
                                        <span className="ml-1">Add</span>
                                      </Button>
                                      {integration.docsUrl && (
                                        <a
                                          href={integration.docsUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] flex items-center gap-1"
                                          onClick={e => e.stopPropagation()}
                                        >
                                          <ExternalLink size={12} />
                                          Docs
                                        </a>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}

              {/* Empty State */}
              {filteredCredentials.length === 0 && !isLoading && searchQuery && (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Search size={48} className="text-[var(--color-text-tertiary)] mb-4" />
                  <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
                    No results found
                  </h3>
                  <p className="text-sm text-[var(--color-text-tertiary)] mt-1">
                    Try a different search term
                  </p>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Add/Edit Credential Modal */}
      {isAddModalOpen && selectedIntegration && (
        <CredentialFormModal
          integration={selectedIntegration}
          credential={editingCredential}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default Credentials;
