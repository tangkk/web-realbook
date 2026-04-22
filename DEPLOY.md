# DEPLOY.md

## Goal

This repo is prepared so that **only the deployable website directory** is tracked and pushed:

- `docs/`
- `.gitignore`
- `DEPLOY.md`

`docs/` is both the working directory and the GitHub Pages publishing directory.

## Publish flow

1. Edit files directly inside `docs/`
2. Commit
3. Push
4. In GitHub repo settings, enable Pages from:
   - Branch: `main`
   - Folder: `/docs`

## Git commands

```bash
cd /Users/tangkk/Documents/Projects/web-realbook
git status
git add .gitignore DEPLOY.md docs
git commit -m "Prepare deployable site"
# you push manually
```

## Notes

- `docs/index.html` is the live index page.
- `docs/secure-extracts/` contains encrypted PDF binaries.
- `docs/secure-manifest.json` is the encrypted file manifest.
- If KT asks to change the index page, directly edit `docs/index.html`.
