import { shell } from 'electron';
import { resolveWorkspacePath } from '../runtime/workspace';
import {
  deleteBoundWorkspaceFile,
  inspectWorkspacePath,
  readBoundWorkspaceFile,
  replaceBoundWorkspaceFile,
} from '../runtime/workspace-broker';
import type { DiffFile } from '../shared/contracts';
import { sha256 } from '../shared/security';
import { effectiveTaskCapabilityPolicy } from '../shared/task-policy';
import type { AppDatabase } from './database';

const MAX_REVIEW_FILE_BYTES = 10 * 1024 * 1024;

export class ReviewService {
  public constructor(private readonly database: AppDatabase) {}

  public async getDiff(threadId: string, requestedPath?: string): Promise<DiffFile[]> {
    const thread = this.database.getThread(threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const project = this.database.getProject(thread.projectId);
    if (!project) {
      throw new Error('Project not found.');
    }

    const files: DiffFile[] = [];
    for (const baseline of this.database.listBaselines(threadId)) {
      if (requestedPath && baseline.path !== requestedPath) {
        continue;
      }
      const target = await resolveWorkspacePath(project.path, baseline.path, {
        allowMissing: true,
      });
      const inspected = inspectWorkspacePath(target.root, target.relative);
      if (inspected.kind === 'directory') {
        throw new Error('Review baselines accept only regular files.');
      }
      const currentBytes =
        inspected.kind === 'file'
          ? readBoundWorkspaceFile(target.root, target.relative, MAX_REVIEW_FILE_BYTES)
          : null;
      const original = baseline.original_bytes
        ? Buffer.from(baseline.original_bytes, 'base64').toString('utf8')
        : '';
      const current = currentBytes ? currentBytes.toString('utf8') : '';
      files.push({
        path: baseline.path,
        status: baseline.latest_status as DiffFile['status'],
        original,
        current,
        baselineHash: baseline.original_hash,
        latestAgentHash: baseline.latest_agent_hash,
        currentHash: currentBytes ? sha256(currentBytes) : null,
      });
    }
    return files;
  }

  public async revertFile(
    threadId: string,
    path: string
  ): Promise<{ reverted: string[]; conflicts: string[] }> {
    const thread = this.database.getThread(threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const project = this.database.getProject(thread.projectId);
    if (!project) {
      throw new Error('Project not found.');
    }
    const policy = effectiveTaskCapabilityPolicy(
      this.database.getTaskPolicySnapshot(thread.id).capabilityPolicy
    );
    if (policy.workspaceAccess !== 'workspace-write' || !policy.fileMutations) {
      throw new Error('File mutations are disabled by this task policy.');
    }
    const baseline = this.database
      .listBaselines(threadId)
      .find((candidate) => candidate.path === path);
    if (!baseline) {
      throw new Error('No agent baseline exists for this file.');
    }
    const target = await resolveWorkspacePath(project.path, path, { allowMissing: true });
    const inspected = inspectWorkspacePath(target.root, target.relative);
    if (inspected.kind === 'directory') {
      throw new Error('Review baselines accept only regular files.');
    }
    const current =
      inspected.kind === 'file'
        ? readBoundWorkspaceFile(target.root, target.relative, MAX_REVIEW_FILE_BYTES)
        : null;
    const currentHash = current ? sha256(current) : null;
    if (currentHash !== baseline.latest_agent_hash) {
      this.database.updateBaselineStatus(threadId, path, 'conflict', baseline.latest_agent_hash);
      return { reverted: [], conflicts: [path] };
    }

    if (baseline.original_bytes === null) {
      if (current) {
        deleteBoundWorkspaceFile(target.root, target.relative, current);
      }
    } else {
      replaceBoundWorkspaceFile(
        target.root,
        target.relative,
        current,
        Buffer.from(baseline.original_bytes, 'base64')
      );
    }
    this.database.updateBaselineStatus(threadId, path, 'reverted', baseline.original_hash);
    this.database.appendEvent(threadId, null, 'diff.change', { path, status: 'reverted' });
    return { reverted: [path], conflicts: [] };
  }

  public async revertAll(threadId: string): Promise<{ reverted: string[]; conflicts: string[] }> {
    const reverted: string[] = [];
    const conflicts: string[] = [];
    for (const baseline of this.database.listBaselines(threadId)) {
      const result = await this.revertFile(threadId, baseline.path);
      reverted.push(...result.reverted);
      conflicts.push(...result.conflicts);
    }
    return { reverted, conflicts };
  }

  public accept(threadId: string): void {
    this.database.appendEvent(threadId, null, 'diagnostic', {
      message: 'Agent changes marked as reviewed.',
    });
  }

  public async openFile(threadId: string, path: string): Promise<void> {
    const thread = this.database.getThread(threadId);
    if (!thread) {
      throw new Error('Thread not found.');
    }
    const project = this.database.getProject(thread.projectId);
    if (!project) {
      throw new Error('Project not found.');
    }
    const target = await resolveWorkspacePath(project.path, path);
    const error = await shell.openPath(target.absolute);
    if (error) {
      throw new Error(error);
    }
  }
}
