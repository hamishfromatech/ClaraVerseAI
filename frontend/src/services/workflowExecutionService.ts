/**
 * Workflow Execution Service
 *
 * Connects to the /ws/workflow WebSocket endpoint to execute workflows
 * and stream execution updates back to the frontend.
 */

import { useAgentBuilderStore } from '@/store/useAgentBuilderStore';
import { useAuthStore } from '@/store/useAuthStore';
import type { BlockExecutionStatus, ExecutionAPIResponse } from '@/types/agent';

// WebSocket message types
interface ExecuteWorkflowMessage {
  type: 'execute_workflow';
  agent_id: string;
  input?: Record<string, unknown>;
  enable_block_checker?: boolean;
}

interface ServerMessage {
  type:
    | 'connected'
    | 'execution_started'
    | 'execution_update'
    | 'execution_complete'
    | 'error'
    | 'agent_metadata';
  execution_id?: string;
  block_id?: string;
  status?: string;
  output?: Record<string, unknown>;
  final_output?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
  // Agent metadata fields (for agent_metadata type)
  agent_id?: string;
  name?: string;
  description?: string;
  // Standardized API response (new format)
  api_response?: ExecutionAPIResponse;
}

class WorkflowExecutionService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 30; // Increased from 3
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000; // Cap delay at 30 seconds

  /**
   * Get the WebSocket URL with authentication token
   */
  private getWebSocketUrl(): string {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    // Use window.location.host to connect to the same host as the frontend
    // This works for both development and production
    // The VITE_API_BASE_URL is only used for API calls, not WebSocket
    const wsHost = window.location.host;

    // Get auth token
    const token = useAuthStore.getState().accessToken;
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

    return `${wsProtocol}//${wsHost}/ws/workflow${tokenParam}`;
  }

  /**
   * Connect to the workflow WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const url = this.getWebSocketUrl();
      console.log('🔌 [WORKFLOW-WS] Connecting to:', url.replace(/token=[^&]+/, 'token=***'));

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('✅ [WORKFLOW-WS] Connected');
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = event => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('❌ [WORKFLOW-WS] Failed to parse message:', error);
        }
      };

      this.ws.onerror = error => {
        console.error('❌ [WORKFLOW-WS] Error:', error);
        reject(error);
      };

      this.ws.onclose = event => {
        console.log('🔌 [WORKFLOW-WS] Disconnected:', event.code, event.reason);
        this.ws = null;

        // Attempt reconnect if execution is in progress
        const { executionStatus } = useAgentBuilderStore.getState();
        if (executionStatus === 'running' && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
          );
          console.log(
            `🔄 [WORKFLOW-WS] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`
          );
          setTimeout(() => this.connect(), delay);
        }
      };
    });
  }

  /**
   * Handle incoming messages from the WebSocket
   */
  private handleMessage(message: ServerMessage): void {
    const store = useAgentBuilderStore.getState();

    switch (message.type) {
      case 'connected':
        console.log('🔌 [WORKFLOW-WS] Server acknowledged connection');
        break;

      case 'execution_started':
        console.log('🚀 [WORKFLOW-WS] Execution started:', message.execution_id);
        if (message.execution_id) {
          store.startExecution(message.execution_id);
        }
        break;

      case 'execution_update':
        console.log(
          '📊 [WORKFLOW-WS] Block update:',
          message.block_id,
          message.status,
          'inputs:',
          message.inputs ? Object.keys(message.inputs).length : 0,
          'keys'
        );
        if (message.block_id && message.status) {
          store.updateBlockExecution(message.block_id, {
            status: message.status as BlockExecutionStatus,
            inputs: message.inputs || {},
            outputs: message.output || {},
            error: message.error,
            ...(message.status === 'running' && { startedAt: new Date() }),
            ...(message.status === 'completed' ||
            message.status === 'failed' ||
            message.status === 'skipped'
              ? { completedAt: new Date() }
              : {}),
          });

          // Cache output for completed blocks
          if (message.status === 'completed' && message.output) {
            store.cacheBlockOutput(message.block_id, message.output);
          }
        }
        break;

      case 'execution_complete':
        console.log('🏁 [WORKFLOW-WS] Execution complete:', message.status);

        // Log the new API response if available
        if (message.api_response) {
          console.log('📦 [WORKFLOW-WS] API Response:', {
            status: message.api_response.status,
            result_length: message.api_response.result?.length || 0,
            artifacts: message.api_response.artifacts?.length || 0,
            files: message.api_response.files?.length || 0,
          });
        }

        store.completeExecution(
          message.status as 'completed' | 'failed' | 'partial_failure' | 'pending' | 'running',
          message.api_response
        );

        // Log duration
        if (message.duration_ms) {
          console.log(`⏱️ [WORKFLOW-WS] Duration: ${message.duration_ms}ms`);
        }
        break;

      case 'error':
        console.error('❌ [WORKFLOW-WS] Error:', message.error);
        store.completeExecution('failed');
        break;

      case 'agent_metadata':
        // Real-time agent name/description update via WebSocket
        console.log('📝 [WORKFLOW-WS] Agent metadata update:', message.agent_id, message.name);
        if (message.agent_id && (message.name || message.description)) {
          const updates: { name?: string; description?: string } = {};
          if (message.name) updates.name = message.name;
          if (message.description) updates.description = message.description;
          store.updateAgent(message.agent_id, updates);
        }
        break;

      default:
        console.warn('⚠️ [WORKFLOW-WS] Unknown message type:', message.type);
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(agentId: string, input?: Record<string, unknown>): Promise<void> {
    // Ensure connected
    await this.connect();

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    // Get debug mode from store
    const { debugMode } = useAgentBuilderStore.getState();

    // Clear previous execution state
    useAgentBuilderStore.getState().clearExecution();

    // Send execute message
    const message: ExecuteWorkflowMessage = {
      type: 'execute_workflow',
      agent_id: agentId,
      input,
      enable_block_checker: debugMode,
    };

    console.log(
      '📤 [WORKFLOW-WS] Sending execute request for agent:',
      agentId,
      debugMode ? '(debug mode ON)' : ''
    );
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Disconnect from the WebSocket
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Singleton instance
export const workflowExecutionService = new WorkflowExecutionService();
