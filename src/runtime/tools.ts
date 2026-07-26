import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from '@earendil-works/pi-ai';
import type { ApprovalDecision, PermissionMode } from '../shared/contracts';
import { createId, now } from '../shared/security';
import { approvalAllowsCommand, classifyCommand } from './command-policy';
import type { SandboxedCommandRunner } from './command-runner';
import {
  type ApplyPatchInput,
  applyWorkspacePatch,
  listWorkspaceFiles,
  readWorkspaceTextFile,
  searchWorkspaceText,
} from './workspace';

export interface ToolApproval {
  id: string;
  kind: 'command' | 'file-delete' | 'file-mutation';
  argv: string[] | null;
  path: string | null;
  cwd: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
}

export interface DesktopToolOptions {
  workspaceRoot: string;
  permissionMode: PermissionMode;
  threadId: string;
  turnId: string;
  commandRunner: SandboxedCommandRunner;
  allowedCommands?: readonly string[][];
  commandsEnabled?: boolean;
  requestApproval: (request: ToolApproval, signal?: AbortSignal) => Promise<ApprovalDecision>;
  emit: (
    type: 'tool.activity' | 'tool.result' | 'command.output' | 'file.change' | 'diff.change',
    payload: Record<string, unknown>
  ) => void;
}

type CommandToolOptions = Omit<DesktopToolOptions, 'allowedCommands'> & {
  allowedCommands?: Set<string>;
};

const errorContent = (message: string): AgentToolResult<Record<string, unknown>> => ({
  content: [{ type: 'text', text: message }],
  details: { error: message },
});

const commandTool = (
  options: CommandToolOptions,
  name: 'run_command' | 'git_status' | 'git_diff'
): AgentTool => ({
  name,
  label:
    name === 'run_command'
      ? 'Run sandboxed command'
      : name === 'git_status'
        ? 'Inspect Git status'
        : 'Inspect Git diff',
  description:
    name === 'run_command'
      ? 'Run an argv array only after policy checks in the workspace sandbox.'
      : 'Inspect Git state via the same restricted command sandbox.',
  parameters:
    name === 'run_command'
      ? Type.Object({
          argv: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 900_000 })),
        })
      : Type.Object({}),
  executionMode: 'sequential',
  execute: async (toolCallId, params, signal, onUpdate) => {
    const argv =
      name === 'git_status'
        ? ['git', 'status', '--short', '--branch']
        : name === 'git_diff'
          ? ['git', 'diff', '--no-ext-diff']
          : (params as { argv: string[] }).argv;
    const timeoutMs =
      name === 'run_command' ? (params as { timeoutMs?: number }).timeoutMs : undefined;
    const assessment = classifyCommand(argv);
    if (assessment.disposition === 'deny') {
      return errorContent(assessment.reason);
    }

    if (name === 'run_command') {
      const approval: ToolApproval = {
        id: createId(),
        kind: 'command',
        argv,
        path: null,
        cwd: options.workspaceRoot,
        risk: assessment.risk,
        reason: assessment.reason,
      };
      const decision = await options.requestApproval(approval, signal);
      if (decision !== 'allow-once' || !approvalAllowsCommand(decision, argv, argv)) {
        return errorContent('The requested command was denied.');
      }
    }

    const startedAt = now();
    const result = await options.commandRunner.run({
      argv,
      cwd: options.workspaceRoot,
      workspaceWriteAllowed: options.permissionMode === 'workspace-write',
      timeoutMs,
      signal,
      onOutput: (output) => {
        options.emit('command.output', {
          toolCallId,
          name,
          argv,
          stream: output.stream,
          chunk: output.chunk,
        });
        onUpdate?.({
          content: [{ type: 'text', text: output.chunk }],
          details: { stream: output.stream },
        });
      },
    });
    const completedAt = now();
    const details = {
      recordKind: 'command-completion',
      argv,
      cwd: options.workspaceRoot,
      startedAt,
      completedAt,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      status: result.cancelled
        ? 'cancelled'
        : result.timedOut || result.exitCode !== 0
          ? 'failed'
          : 'completed',
      durationMs: result.durationMs,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(details) }],
      details,
    };
  },
});

export const createDesktopTools = (options: DesktopToolOptions): AgentTool[] => {
  const allowedCommands = new Set(
    (options.allowedCommands ?? []).map((argv) => JSON.stringify(argv))
  );
  const withAllowed: CommandToolOptions = { ...options, allowedCommands };

  const listFiles: AgentTool = {
    name: 'list_files',
    label: 'List workspace files',
    description: 'List non-binary, non-protected files beneath a workspace directory.',
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async (_toolCallId, params) => {
      try {
        const files = await listWorkspaceFiles(
          options.workspaceRoot,
          (params as { path?: string }).path ?? '.'
        );
        const result = { files, truncated: files.length >= 5_000 };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const readFile: AgentTool = {
    name: 'read_file',
    label: 'Read workspace file',
    description: 'Read a safe text file and return its content with a hash.',
    parameters: Type.Object({ path: Type.String({ minLength: 1 }) }),
    execute: async (_toolCallId, params) => {
      try {
        const file = await readWorkspaceTextFile(
          options.workspaceRoot,
          (params as { path: string }).path
        );
        const result = {
          path: file.path.relative,
          hash: file.hash,
          size: file.size,
          content: file.content,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const searchText: AgentTool = {
    name: 'search_text',
    label: 'Search workspace text',
    description: 'Search safe workspace text files for a literal string.',
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      path: Type.Optional(Type.String()),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const input = params as { query: string; path?: string };
        const matches = await searchWorkspaceText(
          options.workspaceRoot,
          input.query,
          input.path ?? '.'
        );
        const result = { matches, truncated: matches.length >= 200 };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const applyPatch: AgentTool = {
    name: 'apply_patch',
    label: 'Apply workspace patch',
    description:
      'Request one-time approval, then atomically apply exact text replacements guarded by the file hash.',
    parameters: Type.Object({
      path: Type.String({ minLength: 1 }),
      expectedBeforeHash: Type.Union([Type.String(), Type.Null()]),
      replacements: Type.Optional(
        Type.Array(
          Type.Object({ original: Type.String({ minLength: 1 }), replacement: Type.String() })
        )
      ),
      createContent: Type.Optional(Type.String()),
      deleteFile: Type.Optional(Type.Boolean()),
    }),
    executionMode: 'sequential',
    execute: async (_toolCallId, params, signal) => {
      if (options.permissionMode !== 'workspace-write') {
        return errorContent('This project is read-only; file mutations are not permitted.');
      }
      const input = params as ApplyPatchInput;
      try {
        const preview = JSON.stringify({
          operation: input.deleteFile
            ? 'delete'
            : input.createContent !== undefined
              ? 'create'
              : 'modify',
          path: input.path,
          replacements: input.replacements?.slice(0, 20),
          createContent: input.createContent?.slice(0, 4_000),
        }).slice(0, 8_000);
        const approval: ToolApproval = {
          id: createId(),
          kind: input.deleteFile ? 'file-delete' : 'file-mutation',
          argv: null,
          path: input.path,
          cwd: options.workspaceRoot,
          risk: input.deleteFile ? 'high' : 'medium',
          reason: `Review this exact workspace mutation before it runs: ${preview}`,
        };
        const decision = await options.requestApproval(approval, signal);
        if (decision !== 'allow-once') {
          return errorContent('The requested file mutation was denied.');
        }
        const result = await applyWorkspacePatch(options.workspaceRoot, input, {
          deletionApproved: input.deleteFile === true,
        });
        options.emit('file.change', {
          path: result.path,
          status:
            result.after === null ? 'deleted' : result.before === null ? 'created' : 'modified',
          beforeBase64:
            result.before === null ? null : Buffer.from(result.before, 'utf8').toString('base64'),
          afterBase64:
            result.after === null ? null : Buffer.from(result.after, 'utf8').toString('base64'),
          beforeHash: result.beforeHash,
          afterHash: result.afterHash,
        });
        options.emit('diff.change', { path: result.path, afterHash: result.afterHash });
        const details = {
          path: result.path,
          beforeHash: result.beforeHash,
          afterHash: result.afterHash,
        };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      } catch (error) {
        return errorContent(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const fileTools = [listFiles, readFile, searchText, applyPatch];
  return options.commandsEnabled === false
    ? fileTools
    : [
        ...fileTools,
        commandTool(withAllowed, 'run_command'),
        commandTool(withAllowed, 'git_status'),
        commandTool(withAllowed, 'git_diff'),
      ];
};
