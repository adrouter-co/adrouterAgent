# Platform setup and staging authentication

AdRouter Agent supports macOS 12+ on Apple Silicon and Intel, Ubuntu Desktop
24.04 LTS x64, and Windows 11 x64. Install Node.js 22.19 or newer before using
the dependency-free npm launcher.

## Install the launcher

```bash
npm install --global @adrouter/agent@beta
adrouter-agent doctor --json
adrouter-agent install
adrouter-agent launch
```

The application is installed per user:

- macOS: `~/Applications/AdRouter Agent.app`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/adrouter-agent/app`
- Windows: `%LOCALAPPDATA%\Programs\AdRouter Agent`

macOS artifacts are ad-hoc signed but not notarized. Linux and Windows portable
beta artifacts are unsigned. The launcher downloads only canonical GitHub
release URLs and verifies the exact SHA-256 digest and archive layout before
activation.

## Ubuntu 24.04 prerequisites

Install the sandbox and desktop secret-store packages:

```bash
sudo apt-get update
sudo apt-get install bubblewrap socat ripgrep libsecret-1-0 gnome-keyring
```

Ubuntu 24.04 restricts unprivileged user namespaces through AppArmor. Keep that
protection enabled and add a profile only for Bubblewrap. Create
`/etc/apparmor.d/adrouter-agent-bwrap` with:

```text
abi <abi/4.0>,
include <tunables/global>

profile adrouter-agent-bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
```

Then load the profile:

```bash
sudo apparmor_parser -r /etc/apparmor.d/adrouter-agent-bwrap
```

Do not disable AppArmor or change the global
`kernel.apparmor_restrict_unprivileged_userns` setting. Log in to a normal GNOME
or KDE desktop session and unlock its keyring. The app refuses to persist a
token if Electron reports the weak Linux `basic_text` storage backend.

## Windows 11 prerequisite

Open PowerShell as your normal user and run this once:

```powershell
npx @anthropic-ai/sandbox-runtime@0.0.65 windows-install
```

The command requests one UAC approval and provisions the dedicated
`srt-sandbox` account plus its Windows Filtering Platform rules. It is
idempotent. AdRouter Agent never runs this command or elevates itself. Until it
has succeeded, file tools remain available but command and Git tools are not
offered. Tokens are encrypted with Windows DPAPI.

## Staging authentication

Fresh installations are prefilled with:

```text
https://api-staging.adrouter.co
```

The URL is public configuration; the bearer token is secret. Request a
revocable staging AdRouter bearer token from the staging service operator.
There is no token-issuance flow in this desktop repository. Do not use a
DeepSeek, OpenAI, npm, or GitHub credential as the AdRouter token.

In the app:

1. Leave the staging URL selected, or replace it with another HTTPS AdRouter
   origin.
2. Paste the issued AdRouter bearer token into **Access token**.
3. Select **Test connection**. A successful result verifies health,
   authentication, and model discovery.
4. Select **Save securely**.

The token is encrypted by Electron `safeStorage` and is not exposed to the
renderer, logs, release files, or event journal. `/health` is public and does
not validate the token; authenticated `/v1/profile` and `/v1/models` checks do.

For a protected operator canary, set only the token in the environment. The URL
defaults to staging and can be overridden explicitly for local development:

```bash
ADROUTER_API_KEY='issued_staging_token' npm run test:staging-canary
```

Local development may instead use `ADROUTER_API_URL=http://localhost:8787` and
the local backend's separate `ADROUTER_API_KEY`.
