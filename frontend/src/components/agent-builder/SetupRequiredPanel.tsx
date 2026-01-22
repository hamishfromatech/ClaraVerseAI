/**
 * SetupRequiredPanel Component
 *
 * Shows a panel listing all incomplete blocks that need attention before
 * the workflow can be executed. Displays missing credentials and configuration.
 * Uses frosted glass design with minimal borders.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  X,
  Key,
  Settings,
  ChevronRight,
  ExternalLink,
  CheckCircle,
  FileText,
  Upload,
  Braces,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowValidationResult, BlockValidationIssue } from '@/utils/blockValidation';
import { getMissingIntegrationsSummary } from '@/utils/blockValidation';

interface SetupRequiredPanelProps {
  validation: WorkflowValidationResult;
  isOpen: boolean;
  onClose: () => void;
  onSelectBlock: (blockId: string) => void;
  onOpenCredentials: (integrationTypes: string[]) => void;
}

// Get icon for issue type
function getIssueIcon(issue: BlockValidationIssue) {
  switch (issue.type) {
    case 'missing_credential':
      return Key;
    case 'missing_config':
      return Settings;
    case 'missing_input':
      return issue.message.includes('File')
        ? Upload
        : issue.message.includes('JSON')
          ? Braces
          : FileText;
    default:
      return AlertTriangle;
  }
}

export function SetupRequiredPanel({
  validation,
  isOpen,
  onClose,
  onSelectBlock,
  onOpenCredentials,
}: SetupRequiredPanelProps) {
  const [expandedSection, setExpandedSection] = useState<'credentials' | 'config' | null>(
    'credentials'
  );

  const missingCredentialIssues = validation.issues.filter(i => i.type === 'missing_credential');
  const otherIssues = validation.issues.filter(i => i.type !== 'missing_credential');
  const missingSummary = getMissingIntegrationsSummary(validation);
  const allMissingIntegrationTypes = Array.from(validation.missingCredentials.keys());

  const hasCredentialIssues = missingCredentialIssues.length > 0;
  const hasConfigIssues = otherIssues.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - frosted blur */}
          <motion.div
            className="fixed inset-0 bg-black/60 z-[200] backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel - frosted glass */}
          <motion.div
            className="fixed right-0 top-0 h-full w-full max-w-md bg-black/40 backdrop-blur-xl z-[201] shadow-2xl overflow-hidden flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 bg-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20">
                  <AlertTriangle size={20} className="text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Setup Required</h2>
                  <p className="text-sm text-white/50">Complete these items to run your workflow</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Quick Summary */}
              <div className="p-4 rounded-2xl bg-amber-500/10 backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={18} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-300">
                      {validation.issues.length} issue{validation.issues.length !== 1 ? 's' : ''}{' '}
                      found
                    </p>
                    <p className="text-xs text-amber-300/60 mt-1">
                      {hasCredentialIssues &&
                        `${missingSummary.length} integration${missingSummary.length !== 1 ? 's' : ''} need credentials. `}
                      {hasConfigIssues &&
                        `${otherIssues.length} block${otherIssues.length !== 1 ? 's' : ''} need configuration.`}
                    </p>
                  </div>
                </div>
              </div>

              {/* Missing Credentials Section */}
              {hasCredentialIssues && (
                <div className="space-y-3">
                  <button
                    onClick={() =>
                      setExpandedSection(expandedSection === 'credentials' ? null : 'credentials')
                    }
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Key size={18} className="text-red-400" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-white">Missing Credentials</p>
                        <p className="text-xs text-white/40">
                          {missingSummary.length} integration
                          {missingSummary.length !== 1 ? 's' : ''} need API keys
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      size={18}
                      className={cn(
                        'text-white/30 transition-transform',
                        expandedSection === 'credentials' && 'rotate-90'
                      )}
                    />
                  </button>

                  <AnimatePresence>
                    {expandedSection === 'credentials' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pl-3">
                          {missingSummary.map(integration => (
                            <div
                              key={integration.type}
                              className="flex items-center justify-between p-3 rounded-xl bg-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center">
                                  <Key size={14} className="text-red-400" />
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-white">
                                    {integration.name}
                                  </p>
                                  <p className="text-xs text-white/40">
                                    Used by {integration.blockCount} block
                                    {integration.blockCount !== 1 ? 's' : ''}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => onOpenCredentials([integration.type])}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)]/20 hover:bg-[var(--color-accent)]/30 text-[var(--color-accent)] text-xs font-medium transition-colors"
                              >
                                Add
                                <ExternalLink size={12} />
                              </button>
                            </div>
                          ))}

                          {/* Add All Credentials Button */}
                          <button
                            onClick={() => onOpenCredentials(allMissingIntegrationTypes)}
                            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-white/5 hover:bg-[var(--color-accent)] text-black/40 hover:text-[var(--color-accent)] transition-colors"
                          >
                            <Key size={16} />
                            <span className="text-sm font-medium">Open Credentials Manager</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Other Configuration Issues */}
              {hasConfigIssues && (
                <div className="space-y-3">
                  <button
                    onClick={() =>
                      setExpandedSection(expandedSection === 'config' ? null : 'config')
                    }
                    className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Settings size={18} className="text-amber-400" />
                      <div className="text-left">
                        <p className="text-sm font-medium text-white">Block Configuration</p>
                        <p className="text-xs text-white/40">
                          {otherIssues.length} item{otherIssues.length !== 1 ? 's' : ''} need
                          attention
                        </p>
                      </div>
                    </div>
                    <ChevronRight
                      size={18}
                      className={cn(
                        'text-white/30 transition-transform',
                        expandedSection === 'config' && 'rotate-90'
                      )}
                    />
                  </button>

                  <AnimatePresence>
                    {expandedSection === 'config' && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-2 pl-3">
                          {otherIssues.map((issue, index) => {
                            const IssueIcon = getIssueIcon(issue);
                            return (
                              <button
                                key={`${issue.blockId}-${index}`}
                                onClick={() => {
                                  onSelectBlock(issue.blockId);
                                  onClose();
                                }}
                                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left"
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={cn(
                                      'w-9 h-9 rounded-xl flex items-center justify-center',
                                      issue.severity === 'error'
                                        ? 'bg-red-500/15'
                                        : 'bg-amber-500/15'
                                    )}
                                  >
                                    <IssueIcon
                                      size={14}
                                      className={
                                        issue.severity === 'error'
                                          ? 'text-red-400'
                                          : 'text-amber-400'
                                      }
                                    />
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-white">
                                      {issue.blockName}
                                    </p>
                                    <p className="text-xs text-white/40">{issue.message}</p>
                                  </div>
                                </div>
                                <ChevronRight size={16} className="text-white/30" />
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* All Good State */}
              {validation.isValid && validation.issues.length === 0 && (
                <div className="p-6 rounded-2xl bg-green-500/10 text-center">
                  <CheckCircle size={40} className="text-green-400 mx-auto mb-3" />
                  <p className="text-lg font-medium text-green-300">Ready to Run!</p>
                  <p className="text-sm text-green-300/60 mt-1">
                    All blocks are properly configured
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-white/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 hover:text-white transition-colors text-sm font-medium"
                >
                  Close
                </button>
                {hasCredentialIssues && (
                  <button
                    onClick={() => onOpenCredentials(allMissingIntegrationTypes)}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--color-accent)] text-black transition-colors text-sm font-medium"
                  >
                    <Key size={16} />
                    Add Credentials
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
