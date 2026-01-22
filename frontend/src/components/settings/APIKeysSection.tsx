import { useState, useEffect } from 'react';
import {
  Key,
  KeyRound,
  Plus,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { Modal, Button } from '@/components/design-system';
import {
  listAPIKeys,
  createAPIKey,
  revokeAPIKey,
  AVAILABLE_SCOPES,
  maskKeyPrefix,
  copyToClipboard,
  type APIKey,
  type CreateAPIKeyRequest,
  type CreateAPIKeyResponse,
} from '@/services/apiKeyService';
import { useIsMobile } from '@/hooks';

interface APIKeysSectionProps {
  className?: string;
}

export function APIKeysSection({ className }: APIKeysSectionProps) {
  const isMobile = useIsMobile();
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<CreateAPIKeyResponse | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Form state
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyDescription, setNewKeyDescription] = useState('');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['execute:*']);
  const [expiresIn, setExpiresIn] = useState<number | undefined>(undefined);

  // Load keys on mount
  useEffect(() => {
    loadKeys();
  }, []);

  const loadKeys = async () => {
    setIsLoading(true);
    try {
      const data = await listAPIKeys();
      setKeys(data);
    } catch (err) {
      console.error('Failed to load API keys:', err);
      setError('Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newKeyName.trim()) {
      setError('Key name is required');
      return;
    }
    if (selectedScopes.length === 0) {
      setError('Select at least one scope');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const data: CreateAPIKeyRequest = {
        name: newKeyName.trim(),
        description: newKeyDescription.trim(),
        scopes: selectedScopes,
        expiresIn: expiresIn,
      };

      const result = await createAPIKey(data);
      setNewKeyResult(result);

      // Reset form
      setNewKeyName('');
      setNewKeyDescription('');
      setSelectedScopes(['execute:*']);
      setExpiresIn(undefined);
      setShowCreateForm(false);

      // Reload keys list
      await loadKeys();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create API key';
      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) {
      return;
    }

    setRevokingId(keyId);
    try {
      await revokeAPIKey(keyId);
      await loadKeys();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to revoke API key';
      setError(errorMessage);
    } finally {
      setRevokingId(null);
    }
  };

  const handleCopyKey = async (keyText: string, keyId?: string) => {
    const success = await copyToClipboard(keyText);
    if (success) {
      if (keyId) {
        setCopiedKeyId(keyId);
        setTimeout(() => setCopiedKeyId(null), 2000);
      } else {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 2000);
      }
    }
  };

  const handleCopyKeyPrefix = async (keyId: string, keyPrefix: string) => {
    // For the masked version, we copy the masked prefix
    await handleCopyKey(keyPrefix, keyId);
  };

  const handleScopeToggle = (scope: string) => {
    setSelectedScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  };

  const closeNewKeyModal = () => {
    setNewKeyResult(null);
    setCopiedKey(false);
  };

  const getKeyIcon = (keyName: string) => {
    const name = keyName.toLowerCase();
    if (name.includes('production') || name.includes('prod')) {
      return { icon: Key, color: 'text-blue-400', bgColor: 'bg-blue-500/10' };
    } else if (name.includes('staging') || name.includes('stage') || name.includes('test')) {
      return { icon: Key, color: 'text-purple-400', bgColor: 'bg-purple-500/10' };
    } else if (name.includes('cli') || name.includes('terminal') || name.includes('command')) {
      return { icon: Terminal, color: 'text-orange-400', bgColor: 'bg-orange-500/10' };
    }
    return { icon: Key, color: 'text-gray-400', bgColor: 'bg-gray-500/10' };
  };

  const formatLastUsedStatus = (lastUsedAt: string | null) => {
    if (!lastUsedAt) {
      return {
        text: 'Never',
        className:
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700',
      };
    }

    const lastUsed = new Date(lastUsedAt);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 24) {
      return {
        text: `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`,
        className:
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20',
        hasDot: true,
      };
    } else if (diffInHours < 48) {
      return {
        text: 'Yesterday',
        className:
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700',
      };
    } else {
      return {
        text: lastUsed.toLocaleDateString(),
        className:
          'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700',
      };
    }
  };

  const activeKeys = keys.filter(k => !k.isRevoked);
  const revokedKeys = keys.filter(k => k.isRevoked);

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white">
            API Keys
          </h1>
          <p className="text-[0.9375rem] font-normal text-[var(--color-text-tertiary)] leading-relaxed">
            Manage your secret keys for authentication and integration.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center justify-center gap-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-medium text-sm px-5 py-2.5 rounded-[0.5rem] transition-colors shadow-lg shadow-[var(--color-accent)]/20"
          >
            <Plus size={20} />
            <span>Create New Secret Key</span>
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 rounded-[0.5rem] bg-red-500/10 border border-red-500/20 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="bg-[var(--color-charcoal)] rounded-[0.5rem] border border-[var(--color-border)] shadow-sm mb-8 overflow-hidden min-h-[350px] flex flex-col">
        {/* Table Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex justify-between items-center bg-[var(--color-charcoal)]">
          <h3 className="text-base font-semibold text-white">Active Keys</h3>
          <div className="flex gap-2">
            <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20 font-medium">
              {activeKeys.length} Active
            </span>
          </div>
        </div>

        {/* Table Body - flex-1 to take remaining space */}
        <div className="flex-1">
          {/* Loading State */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-[var(--color-text-tertiary)]" />
            </div>
          ) : (
            <>
              {activeKeys.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-center">
                  <div className="bg-[var(--color-accent)]/20 w-16 h-16 rounded-[0.5rem] flex items-center justify-center text-[var(--color-accent)] mb-4">
                    <Key size={32} />
                  </div>
                  <p className="text-[var(--color-text-tertiary)] text-base">No API keys yet.</p>
                  <p className="text-[var(--color-text-tertiary)] text-sm mt-1">Create one to get started.</p>
                </div>
              ) : isMobile ? (
                /* Mobile Card Layout */
                <div className="api-keys-mobile-list p-4 space-y-3">
                  {activeKeys.map(key => {
                    const { icon: Icon, color, bgColor } = getKeyIcon(key.name);
                    const lastUsedStatus = formatLastUsedStatus(key.lastUsedAt || null);

                    return (
                      <div key={key.id} className="api-keys-mobile-card">
                        <div className="api-keys-mobile-card-header">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 ${bgColor} rounded-[0.5rem] ${color}`}>
                              <Icon size={18} />
                            </div>
                            <span className="api-keys-mobile-card-name">{key.name}</span>
                          </div>
                          {lastUsedStatus.hasDot ? (
                            <span className={lastUsedStatus.className}>
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]"></span>
                              {lastUsedStatus.text}
                            </span>
                          ) : (
                            <span className={lastUsedStatus.className}>{lastUsedStatus.text}</span>
                          )}
                        </div>
                        <div className="api-keys-mobile-card-key">
                          {maskKeyPrefix(key.keyPrefix)}
                        </div>
                        <div className="api-keys-mobile-card-meta">
                          <span>
                            Created:{' '}
                            {new Date(key.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <div className="api-keys-mobile-card-actions">
                          <button
                            onClick={() => handleRevoke(key.id)}
                            disabled={revokingId === key.id}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors text-sm font-medium"
                          >
                            {revokingId === key.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : null}
                            Revoke Key
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Desktop Table Layout */
                <div className="overflow-x-auto api-keys-table">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]/30">
                        <th className="px-6 py-3 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                          Name
                        </th>
                        <th className="px-6 py-3 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                          Secret Key
                        </th>
                        <th className="px-6 py-3 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                          Created
                        </th>
                        <th className="px-6 py-3 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                          Last Used
                        </th>
                        <th className="px-6 py-3 text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeKeys.map(key => {
                        const { icon: Icon, color, bgColor } = getKeyIcon(key.name);
                        const lastUsedStatus = formatLastUsedStatus(key.lastUsedAt || null);
                        const isCopied = copiedKeyId === key.id;

                        return (
                          <tr
                            key={key.id}
                            className="hover:bg-[var(--color-surface-hover)] transition-colors group border-b border-[var(--color-border)]"
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className={`p-2 ${bgColor} rounded-[0.5rem] ${color}`}>
                                  <Icon size={20} />
                                </div>
                                <span className="text-sm font-medium text-white">{key.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">
                              <span className="text-[var(--color-text-tertiary)]">{maskKeyPrefix(key.keyPrefix)}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-tertiary)]">
                              {new Date(key.createdAt).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {lastUsedStatus.hasDot && (
                                <span className={lastUsedStatus.className}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]"></span>
                                  {lastUsedStatus.text}
                                </span>
                              )}
                              {!lastUsedStatus.hasDot && (
                                <span className={lastUsedStatus.className}>
                                  {lastUsedStatus.text}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <button
                                onClick={() => handleRevoke(key.id)}
                                disabled={revokingId === key.id}
                                className="text-[var(--color-text-tertiary)] hover:text-red-400 font-medium text-sm transition-colors flex items-center justify-end gap-1 ml-auto"
                              >
                                {revokingId === key.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : null}
                                Revoke
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        {/* Table Footer - now will always be at bottom */}
        <div className="px-6 py-3 border-t border-[var(--color-border)] flex items-center justify-between bg-[var(--color-charcoal)]">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            Showing {activeKeys.length} of {activeKeys.length} keys
          </span>
        </div>
      </div>

      {/* Revoked Keys (collapsed section) */}
      {revokedKeys.length > 0 && (
        <details className="mt-6">
          <summary className="text-sm text-[var(--color-text-tertiary)] cursor-pointer hover:text-[var(--color-text-primary)]">
            {revokedKeys.length} revoked key{revokedKeys.length !== 1 ? 's' : ''}
          </summary>
          <div className="mt-3 space-y-2 opacity-60">
            {revokedKeys.map(key => (
              <div
                key={key.id}
                className="p-3 rounded-[0.5rem] bg-[var(--color-charcoal)] border border-[var(--color-border)]"
              >
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-[var(--color-text-tertiary)]" />
                  <span className="text-sm text-[var(--color-text-tertiary)] line-through">{key.name}</span>
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-400">
                    Revoked
                  </span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* How to use section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-bold text-white px-1">How to use your API Key</h2>
        <div className="bg-[var(--color-charcoal)] rounded-[0.5rem] border border-[var(--color-border)] shadow-sm p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-[var(--color-accent)]/10 w-12 h-12 rounded-[0.5rem] flex items-center justify-center text-[var(--color-accent)] shrink-0 border border-[var(--color-accent)]/20">
                  <Terminal size={24} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--color-surface-hover)] px-2 py-1 rounded border border-[var(--color-border)]">
                  Step 1
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Create Agent</h3>
                <p className="text-[var(--color-text-tertiary)] text-sm leading-relaxed">
                  Navigate to the Agents section to create an agent for your specific workflow.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-blue-500/10 w-12 h-12 rounded-[0.5rem] flex items-center justify-center text-blue-400 shrink-0 border border-blue-500/20">
                  <Zap size={24} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--color-surface-hover)] px-2 py-1 rounded border border-[var(--color-border)]">
                  Step 2
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Deploy Agent</h3>
                <p className="text-[var(--color-text-tertiary)] text-sm leading-relaxed">
                  Deploy the created agent to make it accessible and ready for requests.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="bg-orange-500/10 w-12 h-12 rounded-[0.5rem] flex items-center justify-center text-orange-400 shrink-0 border border-orange-500/20">
                  <Key size={24} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] bg-[var(--color-surface-hover)] px-2 py-1 rounded border border-[var(--color-border)]">
                  Step 3
                </span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white mb-2">Access Documentation</h3>
                <p className="text-[var(--color-text-tertiary)] text-sm leading-relaxed">
                  Access the API documentation for that deployed agent, where you will find the
                  necessary{' '}
                  <code className="bg-[var(--color-surface-hover)] border border-[var(--color-border)] px-1.5 py-0.5 rounded text-xs font-mono text-white">
                    curl
                  </code>{' '}
                  code to utilize your API key.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-[var(--color-border)] flex justify-end">
            <a
              href="/agents"
              className="text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] text-sm font-medium flex items-center gap-2 transition-colors group"
            >
              <span>Go to Agents</span>
              <ChevronRight
                size={16}
                className="group-hover:translate-x-0.5 transition-transform"
              />
            </a>
          </div>
        </div>
      </div>

      {/* Create Key Modal */}
      <Modal
        isOpen={showCreateForm}
        onClose={() => setShowCreateForm(false)}
        title={
          <span className="flex items-center gap-2">
            <KeyRound size={20} className="text-[var(--color-accent)]" />
            Create API Key
          </span>
        }
        size="md"
        footer={
          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowCreateForm(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={isCreating || !newKeyName.trim() || selectedScopes.length === 0}
            >
              {isCreating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Key size={16} />
                  Create Key
                </>
              )}
            </Button>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Name */}
          <div className="credential-form-field">
            <label className="field-label">
              Key Name <span className="required-mark">*</span>
            </label>
            <input
              type="text"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              placeholder="e.g. My Production Key"
              className="field-input"
            />
          </div>

          {/* Description */}
          <div className="credential-form-field">
            <label className="field-label">Description</label>
            <textarea
              value={newKeyDescription}
              onChange={e => setNewKeyDescription(e.target.value)}
              placeholder="Optional description of this key's usage..."
              rows={3}
              className="field-textarea"
            />
          </div>

          {/* Permissions */}
          <div className="credential-form-field">
            <label className="field-label">Permissions</label>
            <p className="field-hint">Select at least one permission scope.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              {AVAILABLE_SCOPES.map(scope => (
                <label
                  key={scope.value}
                  className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] cursor-pointer hover:border-[var(--color-accent)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.value)}
                    onChange={() => handleScopeToggle(scope.value)}
                    className="mt-0.5 w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-bg-primary)] accent-[var(--color-accent)]"
                  />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {scope.label}
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)]">
                      {scope.description}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Expiration */}
          <div className="credential-form-field">
            <label className="field-label">Expiration (Optional)</label>
            <div className="relative">
              <select
                value={expiresIn || ''}
                onChange={e => setExpiresIn(e.target.value ? parseInt(e.target.value) : undefined)}
                className="field-select"
              >
                <option value="">Never expires</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">6 months</option>
                <option value="365">1 year</option>
              </select>
            </div>
          </div>
        </div>
      </Modal>

      {/* New Key Result Modal - IMPORTANT: Show full key only once */}
      <Modal
        isOpen={!!newKeyResult}
        onClose={closeNewKeyModal}
        title={
          <span className="flex items-center gap-2">
            <Check size={20} className="text-green-500" />
            API Key Created
          </span>
        }
        size="md"
        footer={
          <div className="flex items-center justify-end">
            <Button variant="primary" onClick={closeNewKeyModal}>
              I've Saved This Key
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Warning Notice */}
          <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-[var(--color-text-secondary)]">
                <strong className="text-[var(--color-text-primary)]">Important:</strong> Copy this
                key now. You won't be able to see it again!
              </div>
            </div>
          </div>

          {/* API Key Display */}
          <div className="credential-form-field">
            <label className="field-label">API Key</label>
            <div className="flex items-center gap-2">
              <code className="flex-1 p-4 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm font-mono text-[var(--color-text-primary)] break-all">
                {newKeyResult?.key}
              </code>
              <button
                onClick={() => newKeyResult && handleCopyKey(newKeyResult.key)}
                className="p-2.5 rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] transition-colors"
                title={copiedKey ? 'Copied!' : 'Copy to clipboard'}
              >
                {copiedKey ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
