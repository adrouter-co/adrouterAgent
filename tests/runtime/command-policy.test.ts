import { describe, expect, it } from 'vitest';
import { approvalAllowsCommand, classifyCommand } from '@/runtime/command-policy';
import { buildSandboxConfig, sanitizedEnvironment, shellQuote } from '@/runtime/sandbox';

describe('command policy', () => {
  it('allows conservative inspection and test commands', () => {
    expect(classifyCommand(['git', 'status', '--short']).disposition).toBe('allow');
    expect(classifyCommand(['npm', 'test']).disposition).toBe('allow');
    expect(classifyCommand(['rg', 'username', 'src']).disposition).toBe('allow');
  });

  it('denies network, package installation, shell syntax, and destructive Git', () => {
    expect(classifyCommand(['curl', 'https://example.com']).disposition).toBe('deny');
    expect(classifyCommand(['npm', 'install']).disposition).toBe('deny');
    expect(classifyCommand(['git', 'reset', '--hard']).disposition).toBe('deny');
    expect(classifyCommand(['echo', 'hello | cat']).disposition).toBe('deny');
    expect(classifyCommand(['cat', '../.env']).disposition).toBe('deny');
    expect(classifyCommand(['cat', '/etc/passwd']).disposition).toBe('deny');
    expect(classifyCommand(['git', 'show', 'HEAD:.env.production']).disposition).toBe('deny');
  });

  it('requires exact argv approval for unknown commands', () => {
    expect(classifyCommand(['custom-tool', 'run']).disposition).toBe('approval');
    expect(
      approvalAllowsCommand('allow-thread', ['custom-tool', 'run'], ['custom-tool', 'run'])
    ).toBe(true);
    expect(
      approvalAllowsCommand('allow-thread', ['custom-tool', 'run'], ['custom-tool', 'other'])
    ).toBe(false);
  });

  it('builds a network-denied sandbox configuration and strips credentials', () => {
    const config = buildSandboxConfig('/tmp/workspace', '/tmp/adrouter-home');
    const environment = sanitizedEnvironment('/tmp/adrouter-home');

    expect(config.network.deniedDomains).toContain('*');
    expect(config.network.allowedDomains).toEqual([]);
    expect(config.filesystem.allowWrite).toEqual(['/tmp/workspace', '/tmp/adrouter-home']);
    expect(config.filesystem.denyRead).toContain('/');
    expect(
      buildSandboxConfig('/tmp/workspace', '/tmp/adrouter-home', false).filesystem.allowWrite
    ).toEqual(['/tmp/adrouter-home']);
    expect(environment.HOME).toBe('/tmp/adrouter-home');
    expect(shellQuote(['npm', 'test', "it's-safe"])).toContain("'it'\\''s-safe'");
  });
});
