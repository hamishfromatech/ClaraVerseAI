import { useState, useEffect } from 'react';
import { adminService } from '@/services/adminService';
import type { UserListItem, GDPRDataPolicy } from '@/types/admin';
import {
  Users,
  Shield,
  TrendingUp,
  Activity,
  Clock,
  AlertCircle,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';

export const UserManagement = () => {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gdprNotice, setGdprNotice] = useState<string>('');
  const [gdprPolicy, setGdprPolicy] = useState<GDPRDataPolicy | null>(null);
  const [showGDPRInfo, setShowGDPRInfo] = useState(false);

  // Filters
  const [tierFilter, setTierFilter] = useState<string>('');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');

  useEffect(() => {
    loadUsers();
    loadGDPRPolicy();
  }, [page, tierFilter, searchFilter]);

  const loadUsers = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await adminService.getUsers({
        page,
        page_size: pageSize,
        tier: tierFilter || undefined,
        search: searchFilter || undefined,
      });

      setUsers(response.users);
      setTotalCount(response.total_count);
      setGdprNotice(response.gdpr_notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const loadGDPRPolicy = async () => {
    try {
      const policy = await adminService.getGDPRPolicy();
      setGdprPolicy(policy);
    } catch (err) {
      console.error('Failed to load GDPR policy:', err);
    }
  };

  const handleSearch = () => {
    setSearchFilter(searchInput);
    setPage(1);
  };

  const handleRefresh = () => {
    loadUsers();
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  // Calculate aggregate metrics
  const totalChats = users.reduce((sum, u) => sum + u.total_chats, 0);
  const totalMessages = users.reduce((sum, u) => sum + u.total_messages, 0);
  const totalAgentRuns = users.reduce((sum, u) => sum + u.total_agent_runs, 0);
  const avgChatsPerUser = users.length > 0 ? (totalChats / users.length).toFixed(1) : '0';
  const avgMessagesPerUser = users.length > 0 ? (totalMessages / users.length).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      {/* Header with GDPR Badge */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-[var(--color-text-primary)]">
              User Management
            </h1>
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg cursor-pointer hover:bg-green-500/20 transition-colors"
              onClick={() => setShowGDPRInfo(!showGDPRInfo)}
            >
              <Shield size={16} className="text-green-500" />
              <span className="text-xs font-semibold text-green-500">GDPR Compliant</span>
            </div>
          </div>
          <p className="text-[var(--color-text-secondary)] mt-2">
            Performance metrics and user analytics
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          <span className="text-sm font-medium text-[var(--color-text-primary)]">Refresh</span>
        </button>
      </div>

      {/* GDPR Information Panel */}
      {showGDPRInfo && gdprPolicy && (
        <div
          className="bg-green-500/5 border border-green-500/20 rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-start gap-3">
            <Shield size={24} className="text-green-500 mt-1" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                GDPR Data Privacy Policy
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    Data Collected:
                  </p>
                  <ul className="text-xs text-[var(--color-text-tertiary)] space-y-1">
                    {gdprPolicy.data_collected.map((item, idx) => (
                      <li key={idx}>• {item}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">
                    User Rights (GDPR):
                  </p>
                  <ul className="text-xs text-[var(--color-text-tertiary)] space-y-1">
                    {gdprPolicy.user_rights.map((right, idx) => (
                      <li key={idx}>• {right}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-[var(--color-surface)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Purpose</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {gdprPolicy.purpose}
                  </p>
                </div>
                <div className="bg-[var(--color-surface)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Legal Basis</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {gdprPolicy.legal_basis}
                  </p>
                </div>
                <div className="bg-[var(--color-surface)] rounded-lg p-3">
                  <p className="text-xs text-[var(--color-text-tertiary)] mb-1">Retention</p>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {gdprPolicy.data_retention_days} days
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GDPR Notice Banner */}
      {gdprNotice && (
        <div
          className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-start gap-3">
            <Info size={20} className="text-blue-500 mt-0.5" />
            <p className="text-sm text-[var(--color-text-secondary)]">{gdprNotice}</p>
          </div>
        </div>
      )}

      {/* Performance Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total Users */}
        <div
          className="bg-[var(--color-surface)] rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <Users size={24} className="text-[var(--color-accent)]" />
          </div>
          <div>
            <p className="text-sm text-[var(--color-text-tertiary)]">Total Users</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1">
              {totalCount.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
              Showing {users.length} on page
            </p>
          </div>
        </div>

        {/* Aggregate Chats */}
        <div
          className="bg-[var(--color-surface)] rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <Activity size={24} className="text-[var(--color-success)]" />
          </div>
          <div>
            <p className="text-sm text-[var(--color-text-tertiary)]">Total Chats</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1">
              {totalChats.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
              {avgChatsPerUser} avg/user
            </p>
          </div>
        </div>

        {/* Aggregate Messages */}
        <div
          className="bg-[var(--color-surface)] rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <TrendingUp size={24} className="text-[var(--color-info)]" />
          </div>
          <div>
            <p className="text-sm text-[var(--color-text-tertiary)]">Total Messages</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1">
              {totalMessages.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
              {avgMessagesPerUser} avg/user
            </p>
          </div>
        </div>

        {/* Agent Runs */}
        <div
          className="bg-[var(--color-surface)] rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <Activity size={24} className="text-[var(--color-warning)]" />
          </div>
          <div>
            <p className="text-sm text-[var(--color-text-tertiary)]">Agent Runs</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1">
              {totalAgentRuns.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">Across all users</p>
          </div>
        </div>

        {/* Active Users (Last 24h) */}
        <div
          className="bg-[var(--color-surface)] rounded-lg p-6"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-center justify-between mb-4">
            <Clock size={24} className="text-[var(--color-success)]" />
          </div>
          <div>
            <p className="text-sm text-[var(--color-text-tertiary)]">Active (24h)</p>
            <p className="text-3xl font-bold text-[var(--color-text-primary)] mt-1">
              {
                users.filter(u => {
                  if (!u.last_active) return false;
                  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
                  return new Date(u.last_active) > dayAgo;
                }).length
              }
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)] mt-2">Users online recently</p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div
        className="bg-[var(--color-surface)] rounded-lg p-4"
        style={{ backdropFilter: 'blur(20px)' }}
      >
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
              />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search by domain..."
                className="w-full pl-10 pr-4 py-2 bg-[var(--color-background)] border border-[var(--color-surface-hover)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-[var(--color-accent)] text-black rounded-lg transition-colors"
            >
              Search
            </button>
          </div>

          {/* Tier Filter */}
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-[var(--color-text-tertiary)]" />
            <select
              value={tierFilter}
              onChange={e => {
                setTierFilter(e.target.value);
                setPage(1);
              }}
              className="px-4 py-2 bg-[var(--color-background)] border border-[var(--color-surface-hover)] rounded-lg text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">All Tiers</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="max">Max</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
        </div>
      </div>

      {/* User List Table */}
      {error ? (
        <div
          className="bg-[var(--color-error-light)] rounded-lg p-4"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <div className="flex items-start gap-3">
            <AlertCircle size={20} className="text-[var(--color-error)] mt-0.5" />
            <p className="text-[var(--color-error)]">{error}</p>
          </div>
        </div>
      ) : isLoading ? (
        <div
          className="bg-[var(--color-surface)] rounded-lg p-12 text-center"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <RefreshCw size={32} className="animate-spin mx-auto text-[var(--color-accent)] mb-4" />
          <p className="text-[var(--color-text-secondary)]">Loading user analytics...</p>
        </div>
      ) : users.length === 0 ? (
        <div
          className="bg-[var(--color-surface)] rounded-lg p-12 text-center"
          style={{ backdropFilter: 'blur(20px)' }}
        >
          <Users size={48} className="mx-auto text-[var(--color-text-tertiary)] mb-4" />
          <p className="text-[var(--color-text-secondary)]">No users found</p>
        </div>
      ) : (
        <>
          <div
            className="bg-[var(--color-surface)] rounded-lg overflow-hidden"
            style={{ backdropFilter: 'blur(20px)' }}
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--color-background)]">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      User ID (Anonymized)
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Domain
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Tier
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Chats
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Messages
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Agents
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Last Active
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-surface-hover)]">
                  {users.map((user, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-[var(--color-surface-hover)] transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-[var(--color-text-secondary)]">
                            {user.user_id}
                          </span>
                          {user.has_overrides && (
                            <span className="px-2 py-0.5 bg-[var(--color-warning-light)] text-[var(--color-warning)] text-xs rounded">
                              Override
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-[var(--color-text-secondary)]">
                          {user.email_domain || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded ${
                            user.tier === 'enterprise'
                              ? 'bg-purple-500/10 text-purple-500'
                              : user.tier === 'max'
                                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                                : user.tier === 'pro'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : 'bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]'
                          }`}
                        >
                          {user.tier}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                        {user.total_chats.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                        {user.total_messages.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-primary)]">
                        {user.total_agent_runs.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-secondary)]">
                        {user.last_active
                          ? new Date(user.last_active).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--color-text-secondary)]">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[var(--color-text-secondary)]">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalCount)} of{' '}
                {totalCount} users
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backdropFilter: 'blur(20px)' }}
                >
                  <ChevronLeft size={18} />
                </button>

                <span className="px-4 py-2 text-sm text-[var(--color-text-primary)]">
                  Page {page} of {totalPages}
                </span>

                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-2 bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backdropFilter: 'blur(20px)' }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
