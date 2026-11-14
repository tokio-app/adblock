---
name: add-dependency
description: "Add, upgrade or remove an npm package with the library's license checks and notices. Use before any yarn add or yarn upgrade, for every version bump (even a patch), and always before adding a runtime dependency."
argument-hint: "<package>[@version]"
---

# Add, upgrade or remove a dependency

The library is MIT and ships with no runtime dependency (see Licensing in `AGENTS.md`). Every package's license is checked before it goes in.

1. **A runtime dependency (`dependencies`) needs the user's OK** before anything else, even a small one. Say what it's for and why the code can't do without it.
2. Before installing, read its license: `npm view <package>@<version> license repository`. When it's missing or unusual, read the LICENSE in its repository. For an upgrade, compare it with the installed version's, `node -p "require('<package>/package.json').license"`: licenses change between versions.
3. Copyleft (GPL, AGPL, LGPL, MPL, EUPL, CC BY-SA) or no license at all: stop and ask the user. That includes dev dependencies and what they bring in: `vite` (Vitest's peer) stays on 7 because Vite 8 depends on `lightningcss` (MPL-2.0).
4. Never add another content blocker or a package built from one, at any version, as a dependency or a dev dependency: uBlock Origin, uBO Lite, `@ghostery/adblocker*`, AdGuard's `@adguard/*` (scriptlets, tsurlfilter, agtree), `adblock-rs` and the like. The library is a clean-room implementation, and their code in `node_modules` breaks the clean-room rule.
5. Install with Yarn 1, never by editing `yarn.lock` or with npm: `yarn add <package>@<version>` (`-D` for build and test tools), `yarn upgrade <package>@<version>` or `yarn remove <package>`.
6. Check what came with it: the packages `git diff yarn.lock` adds, and each one's license (`node -p "require('<name>/package.json').license"`), with the same rule as step 3. For a runtime dependency, its own dependencies ship to every user: list them for the user.
7. Update the notices:
   - A runtime dependency added, upgraded across a major or removed: a `## Runtime dependencies` section in `THIRD_PARTY_NOTICES.md`.
   - A dev dependency under a license other than MIT or Apache-2.0: mention it in the "Development tools" paragraph.
   - A new online service or list host the library talks to: `## Services` in `THIRD_PARTY_NOTICES.md`.
8. After a removal, `npx fallow dead-code` finds code that only the removed package used.
9. Verify: `yarn typecheck`, `yarn lint`, `yarn test` and `yarn build`.

## Done when

The license of the package and of what it brought in is known and allowed, a runtime dependency has the user's OK, the notices match, and the checks pass.
