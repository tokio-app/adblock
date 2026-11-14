---
name: verify
description: "Run the checks a change needs before it's done: Prettier, lint, typecheck, tests and the build, plus the real-list and Electron smoke runs when the parser, the engines or the Electron integration changed. Use when finishing a change, before a commit, or when asked to verify or check the work."
---

# Verify a change

## Changed files

!`git status --short`

## Checks

Run them from the repository root, the narrow ones first:

1. Tests: `yarn test <path>` for what you touched, then `yarn test`.
2. `yarn typecheck` and `yarn lint`. Fix lint warnings in code you touched.
3. Prettier: `yarn format:check` (CI runs it), and `yarn format` or `npx prettier --write <files>` to fix it.
4. `yarn build`: it must emit `dist/index.js`, `dist/index.d.ts` and `dist/preload.cjs`. When the public API changed, read `dist/index.d.ts` to check it exports what it should.
5. When the changed files call for them (all three need the network, so ask the user first):
   - `yarn lists` when files under `src/lists/` or `src/parser/` changed. It downloads the default lists into `lists/` (gitignored) and prints how many rules of each kind parse and every unsupported syntax with its count. A change must not add a new kind of unsupported line.
   - `yarn bench` when files under `src/network/`, `src/cosmetic/` or `src/psl/` changed. It needs `yarn lists` to have run. Compare its load time, heap and requests per second with the numbers in `.claude/rules/network.md`.
   - `yarn smoke` when files under `src/electron/`, `src/content/`, `src/scriptlets/` or `src/resources/` changed. It launches Electron against a real page and writes `reports/smoke.json`. Tests can't replace it: they never start Electron.
   - `npx fallow dead-code` after moving, renaming or deleting code.
   - `git ls-files --eol | grep w/crlf` after a script wrote files: the repo uses LF.

## Traps

- "Vitest failed to find the runner" in every suite means the shell's working directory has a lowercase drive letter (`c:\`). Run from `C:\…`; it isn't a real failure.
- Electron doesn't start as Electron while `ELECTRON_RUN_AS_NODE` is set (VS Code's terminals set it). `yarn smoke` clears it for the child process; when launching Electron by hand, use `env -u ELECTRON_RUN_AS_NODE`.
- Electron's console output doesn't reach Git Bash. Scripts that run inside Electron write their results to a file.

## Report

Say what ran and passed, show the output of what failed, and say what you skipped and why (`yarn lists`, `yarn bench` and `yarn smoke` included).
