# Blog (Quartz 5, vendored)

This folder is a full [Quartz 5](https://quartz.jzhao.xyz) project (the `v5` branch of `jackyzha0/quartz`), vendored so it can live inside this profile repository. The built site is deployed under `/blog/` of the GitHub Pages site, next to the static hub in `docs/` (Talos-style index, homeworld intro, JWT tool).

## Writing and publishing (Obsidian → this repo)

Use the **Quartz Syncer** Obsidian plugin (targets Quartz v5):

1. Install "Quartz Syncer" from the Obsidian community plugin browser.
2. Settings → Quartz Syncer → Git: Remote URL `https://github.com/RobertMeissner/RobertMeissner.git`, Branch `main`, Provider GitHub, Username `RobertMeissner`, Access Token = a fine-grained PAT with read/write on "Contents" for this repo.
3. Quartz settings → **Content folder**: `blog/content`. Git settings → **Vault root folder**: the vault folder that holds your blog posts (or mark individual notes with the `quartz-syncer:mark` command).
4. Write in Obsidian, then run `quartz-syncer:publish` (or enable the auto-publish timer). The plugin commits and pushes the markdown into `blog/content/` on `main`.
5. `.github/workflows/pages.yml` then rebuilds Quartz and redeploys Pages automatically.

Front matter: `draft: true` keeps a note unpublished; `title`, `date`, `tags` are supported. Note that Quartz v5 lowercases and hyphenates generated URLs — which matches the old WordPress permalink style.

## One-time repo setup

In this repo: **Settings → Pages → Build and deployment → Source → GitHub Actions** (instead of "Deploy from a branch"). The `pages.yml` workflow then owns publishing: the uploaded artifact is `docs/` (hub) plus the Quartz build output under `/blog/`.

RSS feed is emitted as `index.xml` → served at `https://robertmeissner.github.io/RobertMeissner/blog/index.xml`. Point `.github/workflows/blog-post-workflow.yml` at it once the WordPress blog is retired.

## Local preview

```sh
cd blog
npm ci
npx quartz plugin install
npx quartz build --serve   # http://localhost:8080
```

## Upgrading Quartz

Re-copy the upstream `v5` branch over this folder, keeping `content/` and `quartz.config.yaml`:

```sh
git clone --depth=1 --branch v5 https://github.com/jackyzha0/quartz.git /tmp/quartz-upstream
rsync -a --exclude=.git --exclude=docs --exclude=.github --exclude=content --exclude=quartz.config.yaml /tmp/quartz-upstream/ blog/
```
