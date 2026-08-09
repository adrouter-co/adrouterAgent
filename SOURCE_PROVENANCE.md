# Source provenance

This public repository was created as a history-free export of the tracked
files in the private review source. The original export baseline was:

- source repository: sibling `adrouterAgent` development repository
- source commit: `0335159465b445b7be4b35f75af7dbc040133a1a`
- export date: 2026-07-26
- export method: `git archive` addressed directly to the commit object

The export did not copy `.git`, untracked files, environment files,
dependencies, build output, caches, databases, logs, or local application
state. Subsequent public-beta changes are reviewed in this repository and the
current product code, icons, and entitlements are recorded in
`provenance/source-files.sha256`. Run:

```bash
npm run check:public
```

`scripts/verify-source-parity.mjs` verifies those files byte-for-byte.
`src/main/ipc.ts` remains outside the parity set because its About/version IPC
response reports public release metadata and platform sandbox diagnostics.
Other changes outside the parity set are public-release packaging,
documentation, dependency-resolution, and automation work. Version metadata is
intentionally set to npm/GitHub version
`0.1.0-beta.15`, macOS short version `0.1.0`, and macOS build version `10015`.

The original source Git history is deliberately not imported. This record and
the checksum inventory provide the public review boundary without disclosing
unrelated development history.
