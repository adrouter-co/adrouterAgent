import { spawnSync } from 'node:child_process';

const repository = 'adrouter/adrouterAgent';
const reviewer = 'HappyCool121';
const releaseTag = 'v0.1.0-beta.2';
const dryRun = process.argv.includes('--dry-run');
const unknown = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
if (unknown.length > 0) {
  throw new Error('Usage: node scripts/configure-github-repository.mjs [--dry-run]');
}

function gh(args, input) {
  if (dryRun) {
    process.stdout.write(`gh ${args.join(' ')}${input ? ' <json>' : ''}\n`);
    return '';
  }
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input: input === undefined ? undefined : `${JSON.stringify(input)}\n`,
  });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

function api(method, endpoint, body) {
  const args = ['api', '--method', method, endpoint];
  if (body !== undefined) args.push('--input', '-');
  return gh(args, body);
}

function optional(label, operation) {
  try {
    operation();
    process.stdout.write(`configured: ${label}\n`);
  } catch (error) {
    process.stderr.write(
      `manual check required: ${label}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

if (!dryRun) {
  gh(['auth', 'status']);
  api('GET', `repos/${repository}`);
}
const reviewerId = dryRun ? 0 : Number(JSON.parse(api('GET', `users/${reviewer}`)).id);
if (!dryRun && !Number.isSafeInteger(reviewerId)) throw new Error('Unable to resolve reviewer ID.');

for (const environment of ['adrouter-staging', 'macos-release', 'npm-publish']) {
  api('PUT', `repos/${repository}/environments/${environment}`, {
    wait_timer: 0,
    prevent_self_review: false,
    reviewers: [{ type: 'User', id: reviewerId }],
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  });
  if (!dryRun) {
    const policies = JSON.parse(
      api('GET', `repos/${repository}/environments/${environment}/deployment-branch-policies`)
    ).branch_policies;
    if (!policies.some((policy) => policy.name === releaseTag)) {
      api('POST', `repos/${repository}/environments/${environment}/deployment-branch-policies`, {
        name: releaseTag,
        type: 'tag',
      });
    }
  } else {
    api('POST', `repos/${repository}/environments/${environment}/deployment-branch-policies`, {
      name: releaseTag,
      type: 'tag',
    });
  }
  process.stdout.write(`configured: ${environment} protected environment\n`);
}

api('PATCH', `repos/${repository}`, {
  has_issues: true,
  has_discussions: true,
  delete_branch_on_merge: true,
  allow_update_branch: true,
  security_and_analysis: {
    secret_scanning: { status: 'enabled' },
    secret_scanning_push_protection: { status: 'enabled' },
  },
});
api('PUT', `repos/${repository}/vulnerability-alerts`);
api('PUT', `repos/${repository}/automated-security-fixes`);
optional('private vulnerability reporting', () =>
  api('PUT', `repos/${repository}/private-vulnerability-reporting`)
);
optional('CodeQL default setup', () =>
  api('PATCH', `repos/${repository}/code-scanning/default-setup`, {
    state: 'configured',
    languages: ['javascript-typescript'],
    query_suite: 'default',
  })
);

const adminBypass = [
  {
    actor_id: 5,
    actor_type: 'RepositoryRole',
    bypass_mode: 'always',
  },
];
const mainRuleset = {
  name: 'protected-main',
  target: 'branch',
  enforcement: 'active',
  bypass_actors: adminBypass,
  conditions: {
    ref_name: {
      include: ['refs/heads/main'],
      exclude: [],
    },
  },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    {
      type: 'pull_request',
      parameters: {
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: false,
        required_approving_review_count: 1,
        required_review_thread_resolution: true,
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        do_not_enforce_on_create: true,
        strict_required_status_checks_policy: true,
        required_status_checks: [{ context: 'validate' }],
      },
    },
  ],
};
const tagRuleset = {
  name: 'immutable-release-tags',
  target: 'tag',
  enforcement: 'active',
  bypass_actors: adminBypass,
  conditions: {
    ref_name: {
      include: ['refs/tags/v*'],
      exclude: [],
    },
  },
  rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
};

function upsertRuleset(desired) {
  if (dryRun) {
    api('POST', `repos/${repository}/rulesets`, desired);
    return;
  }
  const existing = JSON.parse(api('GET', `repos/${repository}/rulesets`)).find(
    (ruleset) => ruleset.name === desired.name
  );
  if (existing) api('PUT', `repos/${repository}/rulesets/${existing.id}`, desired);
  else api('POST', `repos/${repository}/rulesets`, desired);
}

optional('protected main ruleset', () => upsertRuleset(mainRuleset));
optional('immutable restricted release-tag ruleset', () => upsertRuleset(tagRuleset));

process.stdout.write(
  `Repository baseline configured for ${repository}. Add environment secrets separately; this script never reads credential values.\n`
);
