import { realpath } from 'node:fs/promises';
import { posix } from 'node:path';
import {
  inspectWorkspacePath,
  listBoundWorkspaceFiles,
  readBoundWorkspaceFile,
} from '../runtime/workspace-broker';
import {
  type GuidanceContent,
  GuidanceContentSchema,
  type GuidanceKind,
  type GuidanceSummary,
  GuidanceSummarySchema,
  type TrustedSkillIndex,
  TrustedSkillIndexSchema,
} from '../shared/contracts';
import { sha256 } from '../shared/security';
import type { AppDatabase } from './database';

const MAX_RESOURCES_PER_KIND = 32;
const MAX_RESOURCE_BYTES = 64 * 1024;
const MAX_AGGREGATE_BYTES = 256 * 1024;
const MAX_SCANNED_ENTRIES = 1_024;

interface DiscoveredGuidance extends GuidanceContent {
  bytes: number;
}

interface ParsedMarkdown {
  id?: string;
  name?: string;
  description?: string;
  title?: string;
  body: string;
}

const hasAsciiControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const parseScalar = (raw: string): string => {
  const value = raw.trim();
  if (!value || hasAsciiControlCharacter(value)) {
    throw new Error('Guidance frontmatter contains an empty or unsafe scalar.');
  }
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== 'string') throw new Error();
      return parsed;
    } catch {
      throw new Error('Guidance frontmatter contains malformed quoted text.');
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      throw new Error('Guidance frontmatter contains malformed quoted text.');
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[>|[{&*!@`]/.test(value)) {
    throw new Error('Guidance frontmatter supports only bounded scalar metadata.');
  }
  return value;
};

const parseMarkdown = (content: string, requireFrontmatter: boolean): ParsedMarkdown => {
  const lines = content.split(/\r?\n/);
  const metadata: Record<string, string> = {};
  let bodyStart = 0;
  if (lines[0] === '---') {
    const end = lines.slice(1, 34).indexOf('---');
    if (end < 0) throw new Error('Guidance frontmatter is not terminated within 32 lines.');
    const frontmatterEnd = end + 1;
    for (const line of lines.slice(1, frontmatterEnd)) {
      if (!line.trim()) continue;
      const match = /^([a-z][a-zA-Z]*):\s*(.+)$/.exec(line);
      if (!match?.[1] || match[2] === undefined) {
        throw new Error('Guidance frontmatter must contain one scalar field per line.');
      }
      const key = match[1];
      if (!['id', 'name', 'description', 'title'].includes(key) || metadata[key] !== undefined) {
        throw new Error('Guidance frontmatter contains an unknown or duplicate field.');
      }
      metadata[key] = parseScalar(match[2]);
    }
    bodyStart = frontmatterEnd + 1;
  } else if (requireFrontmatter) {
    throw new Error('Project skills require YAML frontmatter.');
  }
  const body = lines.slice(bodyStart).join('\n');
  if (body.trimStart().startsWith('#!')) {
    throw new Error('Guidance cannot contain an executable shebang.');
  }
  return { ...metadata, body };
};

const slug = (value: string): string =>
  value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

const firstHeading = (body: string): string | undefined =>
  body
    .split(/\r?\n/)
    .map((line) => /^#{1,3}\s+(.+)$/.exec(line)?.[1]?.trim())
    .find((value): value is string => Boolean(value));

const validateMetadata = (
  kind: GuidanceKind,
  parsed: ParsedMarkdown,
  fallbackId: string,
  fallbackName: string
): Pick<GuidanceContent, 'id' | 'name' | 'description'> => {
  const id = parsed.id ?? slug(fallbackId);
  const name = parsed.name ?? parsed.title ?? firstHeading(parsed.body) ?? fallbackName;
  const description = parsed.description ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    throw new Error(`Project ${kind} ID must use 1-64 lowercase letters, numbers, or hyphens.`);
  }
  if (!name.trim() || name.trim().length > 120 || hasAsciiControlCharacter(name)) {
    throw new Error(`Project ${kind} name must be 1-120 safe characters.`);
  }
  if (description.length > 500 || hasAsciiControlCharacter(description)) {
    throw new Error(`Project ${kind} description must be at most 500 safe characters.`);
  }
  if (kind === 'skill' && (!parsed.name || !parsed.description)) {
    throw new Error('Project skills require bounded name and description frontmatter.');
  }
  return { id, name: name.trim(), description: description.trim() };
};

export class GuidanceService {
  public constructor(private readonly database: AppDatabase) {}

  public async list(projectId: string): Promise<GuidanceSummary[]> {
    const project = this.database.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    const discovered = await this.discover(project.path);
    const current = new Map(
      discovered.map((resource) => [`${resource.kind}:${resource.id}`, resource])
    );
    const trusts = new Map(
      this.database
        .listGuidanceTrust(projectId)
        .map((trust) => [`${trust.kind}:${trust.id}`, trust])
    );
    const keys = new Set([...current.keys(), ...trusts.keys()]);
    return [...keys].sort().map((key) => {
      const resource = current.get(key);
      const trust = trusts.get(key);
      if (!resource && !trust) throw new Error('Guidance index is inconsistent.');
      const exact = Boolean(
        resource && trust && resource.digest === trust.digest && resource.path === trust.path
      );
      const source = resource ?? trust;
      if (!source) throw new Error('Guidance source is unavailable.');
      return GuidanceSummarySchema.parse({
        kind: source.kind,
        id: source.id,
        name: source.name,
        description: source.description,
        path: source.path,
        digest: resource?.digest ?? trust?.digest,
        bytes: resource?.bytes ?? trust?.bytes,
        present: Boolean(resource),
        trusted: Boolean(trust),
        active: exact,
        trustedDigest: trust?.digest ?? null,
        trustReason: !trust
          ? 'This exact project Markdown resource is not trusted.'
          : !resource
            ? 'The trusted source file was removed; its snapshot is inactive.'
            : exact
              ? null
              : 'The source path or digest changed and requires a new trust decision.',
      });
    });
  }

  public async trust(
    projectId: string,
    kind: GuidanceKind,
    id: string,
    path: string,
    digest: string
  ): Promise<GuidanceSummary> {
    const project = this.database.getProject(projectId);
    if (!project) throw new Error('Project not found.');
    const resource = (await this.discover(project.path)).find(
      (candidate) =>
        candidate.kind === kind &&
        candidate.id === id &&
        candidate.path === path &&
        candidate.digest === digest
    );
    if (!resource)
      throw new Error('Only the exact current project guidance digest can be trusted.');
    this.database.trustGuidance({ ...resource, projectId, bytes: resource.bytes });
    const summary = (await this.list(projectId)).find(
      (candidate) => candidate.kind === kind && candidate.id === id
    );
    if (!summary) throw new Error('Trusted project guidance could not be reloaded.');
    return summary;
  }

  public async revoke(projectId: string, kind: GuidanceKind, id: string): Promise<GuidanceSummary> {
    const before = (await this.list(projectId)).find(
      (candidate) => candidate.kind === kind && candidate.id === id
    );
    if (!before || !this.database.revokeGuidanceTrust(projectId, kind, id)) {
      throw new Error('Trusted project guidance not found.');
    }
    const after = (await this.list(projectId)).find(
      (candidate) => candidate.kind === kind && candidate.id === id
    );
    return (
      after ??
      GuidanceSummarySchema.parse({
        ...before,
        trusted: false,
        active: false,
        trustedDigest: null,
        trustReason: 'The trusted snapshot was revoked.',
      })
    );
  }

  public async readPrompt(projectId: string, id: string, digest: string): Promise<GuidanceContent> {
    const content = await this.readActive(projectId, 'prompt', id, digest);
    return GuidanceContentSchema.parse({
      ...content,
      content: parseMarkdown(content.content, false).body,
    });
  }

  public async readSkill(projectId: string, id: string, digest: string): Promise<GuidanceContent> {
    return this.readActive(projectId, 'skill', id, digest);
  }

  public async runtimeSkillIndex(projectId: string): Promise<TrustedSkillIndex[]> {
    return (await this.list(projectId))
      .filter((resource) => resource.kind === 'skill' && resource.active)
      .map((resource) =>
        TrustedSkillIndexSchema.parse({
          kind: 'skill',
          id: resource.id,
          name: resource.name,
          description: resource.description,
          path: resource.path,
          digest: resource.digest,
        })
      );
  }

  private async readActive(
    projectId: string,
    kind: GuidanceKind,
    id: string,
    expectedDigest: string
  ): Promise<GuidanceContent> {
    const summary = (await this.list(projectId)).find(
      (resource) => resource.kind === kind && resource.id === id
    );
    const trust = this.database.getGuidanceTrust(projectId, kind, id);
    if (
      !summary?.active ||
      summary.digest !== expectedDigest ||
      !trust ||
      trust.digest !== expectedDigest
    ) {
      throw new Error(
        'The trusted guidance changed or was revoked; review its exact digest again.'
      );
    }
    return GuidanceContentSchema.parse({
      kind: trust.kind,
      id: trust.id,
      name: trust.name,
      description: trust.description,
      path: trust.path,
      digest: trust.digest,
      content: trust.content,
    });
  }

  private async discover(workspacePath: string): Promise<DiscoveredGuidance[]> {
    const root = await realpath(workspacePath);
    const resources: DiscoveredGuidance[] = [];
    let scanned = 0;
    let aggregateBytes = 0;

    for (const [kind, relativeRoot] of [
      ['skill', '.adrouter/skills'],
      ['prompt', '.adrouter/prompts'],
    ] as const) {
      let inspected: ReturnType<typeof inspectWorkspacePath>;
      try {
        inspected = inspectWorkspacePath(root, relativeRoot);
      } catch {
        throw new Error('Project guidance directories must be regular, non-symlink directories.');
      }
      if (inspected.kind === 'missing') continue;
      if (inspected.kind !== 'directory') {
        throw new Error('Project guidance directories must be regular, non-symlink directories.');
      }
      const listing = listBoundWorkspaceFiles(root, relativeRoot, MAX_SCANNED_ENTRIES - scanned);
      scanned += listing.files.length;
      if (listing.rejected) {
        throw new Error('Project guidance rejects symlink and non-regular entries.');
      }
      if (listing.truncated || scanned > MAX_SCANNED_ENTRIES) {
        throw new Error(`Project guidance discovery is limited to ${MAX_SCANNED_ENTRIES} entries.`);
      }
      for (const relativePath of listing.files) {
        const filename = posix.basename(relativePath);
        const candidate =
          kind === 'skill'
            ? filename === 'SKILL.md'
            : posix.extname(filename).toLowerCase() === '.md';
        if (!candidate) continue;
        if (
          resources.filter((resource) => resource.kind === kind).length >= MAX_RESOURCES_PER_KIND
        ) {
          throw new Error(`Project ${kind}s are limited to ${MAX_RESOURCES_PER_KIND} resources.`);
        }
        let bytes: Buffer;
        try {
          bytes = readBoundWorkspaceFile(root, relativePath, MAX_RESOURCE_BYTES);
        } catch {
          throw new Error(
            `Project guidance ${relativePath} changed or traversed a symlink during review.`
          );
        }
        if (bytes.byteLength < 1) {
          throw new Error(`Project guidance ${relativePath} must be 1-64 KiB.`);
        }
        if (bytes.includes(0)) throw new Error(`Project guidance ${relativePath} is binary.`);
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          throw new Error(`Project guidance ${relativePath} is not valid UTF-8.`);
        }
        if (content.startsWith('#!')) {
          throw new Error(`Project guidance ${relativePath} cannot start with a shebang.`);
        }
        const parsed = parseMarkdown(content, kind === 'skill');
        const withinRoot = relativePath.slice(`${relativeRoot}/`.length);
        const skillDirectory = posix.dirname(withinRoot);
        const fallbackPath =
          kind === 'skill'
            ? skillDirectory === '.'
              ? 'skills'
              : skillDirectory
            : withinRoot.replace(/\.md$/i, '');
        const metadata = validateMetadata(
          kind,
          parsed,
          fallbackPath.replaceAll('/', '-'),
          kind === 'skill'
            ? posix.basename(skillDirectory === '.' ? relativeRoot : skillDirectory)
            : posix.basename(withinRoot, posix.extname(withinRoot))
        );
        aggregateBytes += bytes.byteLength;
        if (aggregateBytes > MAX_AGGREGATE_BYTES) {
          throw new Error('Aggregate project guidance is limited to 256 KiB.');
        }
        resources.push(
          GuidanceContentSchema.extend({ bytes: GuidanceSummarySchema.shape.bytes }).parse({
            kind,
            ...metadata,
            path: relativePath,
            digest: sha256(bytes),
            bytes: bytes.byteLength,
            content,
          })
        );
      }
    }

    const ids = new Set<string>();
    for (const resource of resources) {
      if (ids.has(resource.id)) throw new Error(`Duplicate project guidance ID ${resource.id}.`);
      ids.add(resource.id);
    }
    return resources.sort((left, right) =>
      `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
    );
  }
}
