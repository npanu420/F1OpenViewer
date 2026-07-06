# Security Policy

This is a small hobby project, so keep expectations proportional, but if you find something that could put a user's F1 TV account, tokens, or machine at risk, we'd rather hear about it privately first.

## Reporting a vulnerability

Preferred: use GitHub's **[Report a vulnerability](../../security/advisories/new)** button (Security tab → Advisories). It's private between you and the maintainer, no email needed.

Alternative: DM **@Ovetto on Discord**.

Please don't open a public issue for security problems, everything else (bugs, features) is totally fine as a normal issue.

## What counts

Things like: a way to leak another user's F1 TV token/session, remote code execution through the app, the license proxy or local IPC being reachable/abusable from outside the app, or anything that bypasses the app's own auth in a way that isn't just "you're using your own valid F1 TV login" (that part is by design, see the README's disclaimer).

## Supported versions

Only the latest release gets fixes. There's no long-term support branch for a project this size, please update before reporting if you're on an older version.
