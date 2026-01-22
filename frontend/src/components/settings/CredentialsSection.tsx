import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Trash2,
  Edit,
  RefreshCw,
  AlertCircle,
  ChevronDown,
} from 'lucide-react';
import { Button, SearchInput } from '@/components/design-system';
import { useCredentialsStore } from '@/store/useCredentialsStore';
import { useIsMobile } from '@/hooks';
import type { Credential, Integration } from '@/types/credential';
import { formatLastUsed } from '@/services/credentialService';
import { CredentialFormModal } from '@/components/credentials/CredentialFormModal';
import { IntegrationIcon } from '@/components/credentials/IntegrationIcon';
import '@/pages/Credentials.css';

export const CredentialsSection = () => {
  // Mobile detection
  const isMobile = useIsMobile();

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
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

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
      selectedCategory === 'your-integrations' ||
      integrations
        .find(cat => cat.id === selectedCategory)
        ?.integrations.some(int => int.id === cred.integrationType);

    // For "your-integrations" category, show all configured credentials
    if (selectedCategory === 'your-integrations') {
      return matchesSearch;
    }

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

  return (
    <div className="credentials-section h-full flex flex-col bg-[var(--color-bg-primary)]">
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
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
        {/* Mobile Category Selector */}
        {isMobile && (
          <div className="credentials-mobile-category-selector p-4 border-b border-[var(--color-border)]">
            <div className="relative">
              <button
                onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                className="credentials-mobile-category-btn"
              >
                <span>
                  {selectedCategory === null
                    ? 'All Integrations'
                    : selectedCategory === 'your-integrations'
                      ? `Your Integrations (${credentials.length})`
                      : integrations.find(cat => cat.id === selectedCategory)?.name ||
                        'Select Category'}
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${isCategoryDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {isCategoryDropdownOpen && (
                <>
                  {/* Backdrop overlay */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsCategoryDropdownOpen(false)}
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                    <button
                      onClick={() => {
                        setSelectedCategory(null);
                        setIsCategoryDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                        selectedCategory === null
                          ? 'bg-[var(--color-accent)] text-black'
                          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                    >
                      All Integrations
                    </button>
                    {credentials.length > 0 && (
                      <button
                        onClick={() => {
                          setSelectedCategory('your-integrations');
                          setIsCategoryDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                          selectedCategory === 'your-integrations'
                            ? 'bg-[var(--color-accent)] text-black'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        Your Integrations ({credentials.length})
                      </button>
                    )}
                    {integrations.map(category => (
                      <button
                        key={category.id}
                        onClick={() => {
                          setSelectedCategory(category.id);
                          setIsCategoryDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 text-sm transition-colors ${
                          selectedCategory === category.id
                            ? 'bg-[var(--color-accent)] text-black'
                            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                        }`}
                      >
                        {category.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Sidebar - Integration Categories (Desktop Only) */}
        {!isMobile && (
          <aside className="w-64 border-r border-[var(--color-border)] overflow-y-auto credentials-sidebar">
            <div className="p-4 space-y-2">
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

              {/* Your Integrations Tab - Only show if there are integrations with credentials */}
              {credentials.length > 0 && (
                <button
                  onClick={() => setSelectedCategory('your-integrations')}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedCategory === 'your-integrations'
                      ? 'bg-[var(--color-accent)] text-black'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                  }`}
                >
                  Your Integrations ({credentials.length})
                </button>
              )}
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
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 credentials-main">
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
              {/* Configured Credentials */}
              {filteredCredentials.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    Your Credentials ({filteredCredentials.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {filteredCredentials.map(credential => {
                      const integration = getIntegrationForCredential(credential.integrationType);
                      return (
                        <div
                          key={credential.id}
                          className="group bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl p-5 shadow-sm hover:shadow-md hover:border-[var(--color-accent)]/50 transition-all duration-300 relative flex flex-col justify-between h-full"
                        >
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-[var(--color-bg-primary)] flex items-center justify-center text-[var(--color-text-secondary)]">
                                <IntegrationIcon
                                  integrationId={credential.integrationType}
                                  size={24}
                                  forceColor="currentColor"
                                />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-[var(--color-text-primary)] leading-tight">
                                  {credential.name}
                                </h3>
                                <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                                  {integration?.name || credential.integrationType}
                                </p>
                              </div>
                            </div>
                            {(() => {
                              if (credential.metadata.testStatus === 'success') {
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                    Active
                                  </span>
                                );
                              } else if (credential.metadata.testStatus === 'failed') {
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                    <AlertCircle size={14} />
                                    Error
                                  </span>
                                );
                              } else {
                                return (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--color-border)] text-[var(--color-text-tertiary)] border border-[var(--color-border)]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-text-tertiary)]"></span>
                                    Not tested
                                  </span>
                                );
                              }
                            })()}
                          </div>

                          <div className="space-y-3 mb-4">
                            <div className="bg-[var(--color-bg-primary)] rounded-lg p-2.5 border border-dashed border-[var(--color-border)]">
                              <p className="text-[10px] uppercase tracking-wider font-bold text-[var(--color-text-tertiary)] mb-1">
                                API Key
                              </p>
                              <div
                                className="font-mono text-xs text-[var(--color-text-secondary)] truncate select-all"
                                title={credential.metadata.maskedPreview}
                              >
                                {credential.metadata.maskedPreview}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-3 border-t border-[var(--color-border)] mt-auto">
                            <div className="text-xs text-[var(--color-text-tertiary)]">
                              {credential.metadata.lastUsedAt
                                ? `Last used ${formatLastUsed(credential.metadata.lastUsedAt)}`
                                : 'Never used'}
                            </div>
                            <div className="flex items-center gap-1">
                              {credential.metadata.testStatus === 'failed' ? (
                                <button
                                  onClick={() => handleTestCredential(credential.id)}
                                  disabled={isTesting === credential.id}
                                  className="p-1.5 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-all"
                                  title="Retry Connection"
                                >
                                  {isTesting === credential.id ? (
                                    <Loader2 size={18} className="animate-spin" />
                                  ) : (
                                    <RefreshCw size={18} />
                                  )}
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleTestCredential(credential.id)}
                                  disabled={isTesting === credential.id}
                                  className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all"
                                  title="Test Connection"
                                >
                                  {isTesting === credential.id ? (
                                    <Loader2 size={18} className="animate-spin" />
                                  ) : (
                                    <RefreshCw size={18} />
                                  )}
                                </button>
                              )}
                              <button
                                onClick={() => handleEditCredential(credential)}
                                className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-all"
                                title="Edit"
                              >
                                <Edit size={18} />
                              </button>
                              {deleteConfirmId === credential.id ? (
                                <>
                                  <button
                                    onClick={() => handleDeleteCredential(credential.id)}
                                    className="p-1.5 rounded-md text-green-400 hover:text-green-300 hover:bg-green-500/10 transition-all"
                                    title="Confirm Delete"
                                  >
                                    <CheckCircle size={18} />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-primary)] transition-all"
                                    title="Cancel"
                                  >
                                    <XCircle size={18} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirmId(credential.id)}
                                  className="p-1.5 rounded-md text-[var(--color-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                                  title="Delete"
                                >
                                  <Trash2 size={18} />
                                </button>
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

                if (
                  availableIntegrations.length > 0 &&
                  !selectedCategory &&
                  selectedCategory !== 'your-integrations'
                ) {
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
                                  <div className="flex items-center justify-between mt-3">
                                    {integration.docsUrl && (
                                      <a
                                        href={integration.docsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-xs text-[var(--color-text-tertiary)] hover:text-white flex items-center gap-1 px-4 py-2 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] active:bg-[var(--color-accent-hover)] transition-all duration-200"
                                        onClick={e => e.stopPropagation()}
                                        style={{ marginTop: 'var(--space-4)' }}
                                      >
                                        <ExternalLink size={14} />
                                        Docs
                                      </a>
                                    )}
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)] active:bg-[var(--color-accent)]/20 active:scale-95 transition-all duration-150"
                                    >
                                      <Plus size={14} />
                                      <span className="ml-1">Add</span>
                                    </Button>
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
                .filter(
                  cat =>
                    (!selectedCategory || cat.id === selectedCategory) &&
                    selectedCategory !== 'your-integrations'
                )
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
                                    <div className="flex items-center justify-between mt-3">
                                      {integration.docsUrl && (
                                        <a
                                          href={integration.docsUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-xs text-[var(--color-text-tertiary)] hover:text-white flex items-center gap-1 px-4 py-2 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent)] active:bg-[var(--color-accent-hover)] transition-all duration-200"
                                          onClick={e => e.stopPropagation()}
                                          style={{ marginTop: 'var(--space-4)' }}
                                        >
                                          <ExternalLink size={14} />
                                          Docs
                                        </a>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-xs hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)] active:bg-[var(--color-accent)]/20 active:scale-95 transition-all duration-150"
                                      >
                                        <Plus size={14} />
                                        <span className="ml-1">Add</span>
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
