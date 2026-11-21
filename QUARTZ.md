# Quartz 5 (repo root) + docs/ hub

This repository root **is** the [Quartz 5](https://quartz.jzhao.xyz) project (v5 branch of `jackyzha0/quartz`), so the **Quartz Syncer** Obsidian plugin recognizes it out of the box. The static hub (terminal landing, games, tools, books) lives in `docs/` and is deployed together with the blog as one GitHub Pages site.

Served layout: `…/RobertMeissner/` = hub, `…/RobertMeissner/blog/` = Quartz site (baseUrl `robertmeissner.github.io/RobertMeissner/blog`).

## Quartz Syncer setup (Obsidian)

1. Install **Quartz Syncer** from the community plugin browser, enable it.
2. Settings → Quartz Syncer → **Git**: Provider `GitHub`, Remote URL `https://github.com/RobertMeissner/RobertMeissner.git`, Branch `main`, Username `RobertMeissner`, Access Token = fine-grained PAT with **Contents: read+write** on this repo only.
3. **Quartz → Content folder**: leave at the default `content` (repo root now is the Quartz project).
4. **Git → Vault root folder**: the vault folder that holds your posts (or vault root + mark notes).
5. Mark notes publishable: frontmatter `publish: true` (checkbox), or command `Quartz Syncer: add publication flag`, or enable **Include all notes by default** for a dedicated folder. Check with `quartz-syncer:status`.
6. `quartz-syncer:test` → green check, then `quartz-syncer:publish`. Pushes to `main` → `pages.yml` rebuilds and redeploys automatically.

Notes: Quartz v5 lowercases/hyphenates URLs; `draft: true` keeps notes unpublished; wikilinks need their target notes published too; media is copied automatically. RSS: `…/RobertMeissner/blog/index.xml`.

## Repo-side setup (one-time)

Settings → Pages → Build and deployment → Source → **GitHub Actions** (not "Deploy from a branch"). `.github/workflows/pages.yml` then owns publishing: `npm ci` + `npx quartz plugin install` + `npx quartz build --output site/blog` at the repo root, plus `docs/` copied next to it, uploaded as one Pages artifact.

## Local preview

```sh
npm ci
npx quartz plugin install
npx quartz build --serve   # http://localhost:8080
```

## Games tooling (docs/)

The hub's games are TypeScript sources in `docs/src/`, built with esbuild:

```sh
cd docs
npm ci
npm run typecheck
npm run build:games   # writes docs/js/*.js artifacts (committed; CI enforces freshness)
```

## Upgrading Quartz

```sh
git remote add upstream https://github.com/jackyzha0/quartz.git   # once
npx quartz upgrade
```
