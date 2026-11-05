# Security Policy

This is a small hobby project, so keep expectations proportional, but if you find something that could put a user's F1 TV account, tokens, or machine at risk, we'd rather hear about it privately first.

## Reporting a vulnerability

Preferred: use GitHub's **[Report a vulnerability](../../security/advisories/new)** button (Security tab → Advisories). It's private between you and the maintainer, no email needed.

Alternative: DM **@Ovetto on Discord**.

Please don't open a public issue for security problems, everything else (bugs, features) is totally fine as a normal issue.

## What counts

Things like: a way to leak another user's F1 TV token/session, remote code execution through the app, the license proxy or local IPC being reachable/abusable from outside the app, or anything that bypasses the app's own auth in a way that isn't just "you're using your own valid F1 TV login" (that part is by design, see the README's disclaimer).

## Where your credentials live

- The F1 TV token and the F1 cookies are stored in the app's user-data folder, encrypted with the OS keystore (Electron `safeStorage`). If the OS cannot encrypt, they fall back to plain text.
- They are never written to logs or to localStorage and never sent to the UI (renderer) process: the main process attaches them to the F1 requests itself. The license proxy holds per-stream tokens in memory only.
- The UI can only talk to the main process from the app's own pages (IPC sender check), and pages get no permissions beyond fullscreen, the Widevine key system and clipboard write.
- The local license proxy listens on `127.0.0.1` and rejects requests without the per-launch secret.

## Supported versions

Only the latest release gets fixes. There's no long-term support branch for a project this size, please update before reporting if you're on an older version.
