# sssync-native

## Simulator testing (local macOS only)

This repo is wired so a **local** Claude Code on macOS (with Xcode + iOS
Simulator) can visually drive the app — tap, type, screenshot, verify. A
cloud/Linux Claude session cannot drive the simulator; it does code + PRs only.

### One-time setup (run once on the Mac, in this repo)

```bash
npm install
bunx add-skill EvanBacon/serve-sim   # installs the serve-sim Agent Skill
```

(`bunx` ships with Bun. Equivalent: run `/plugin marketplace add
EvanBacon/serve-sim` inside Claude Code, then enable the serve-sim plugin.)

### Running a sim test

1. Start Metro/Expo: `npx expo start` (or your usual dev command).
2. In a second terminal, start the simulator bridge: `npm run sim`
   (alias for `serve-sim`; also exposed via `.claude/launch.json` on port 3200,
   and through Metro at `http://localhost:8081/.sim`).
3. Ask local Claude to test a flow (e.g. "open the app and test onboarding").
   It uses the serve-sim skill to screenshot/tap/drive the running Simulator.

### Notes

- serve-sim is a third-party Agent Skill (`EvanBacon/serve-sim`). It is **not**
  vendored into this repo and is intentionally not auto-installed via project
  settings — installation is the one-time `bunx add-skill` step above, on the
  machine Claude runs on.
- Keep Metro and `npm run sim` running for the duration of a test session.
