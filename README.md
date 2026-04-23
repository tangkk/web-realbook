# web-realbook

A static jazz realbook site with encrypted chart delivery for GitHub Pages.

## Live page

- GitHub Pages: https://tangkk.github.io/web-realbook/

## Current project structure

This repo is now centered on `docs/` as the single publishable site directory.

Key files:

- `docs/index.html` — main page UI
- `docs/secure-manifest.json` — encrypted chart manifest
- `docs/secure-extracts/*.bin` — encrypted PDF binaries
- `DEPLOY.md` — deployment / local preview notes

## What the page currently does

### 1. Encrypted chart access

Charts are no longer shipped as plain PDF files in the public site directory.

Current flow:

1. user opens the site
2. enters a passphrase
3. clicks a tune link
4. frontend fetches the encrypted `.bin` file
5. browser decrypts it locally
6. user can open or download the PDF

Implementation notes:

- AES-GCM encrypted binaries
- passphrase-based frontend decryption
- passphrase persistence uses `localStorage`
- only the last successfully decrypted passphrase is stored

### 2. Passphrase UX

Current passphrase behavior:

- passphrase input at the top of the page
- `Recover passphrase` button restores the saved passphrase from `localStorage`
- if no passphrase is entered, clicking a chart jumps focus back to the input box
- error messaging distinguishes between:
  - incorrect passphrase
  - environment/browser issues
- if someone needs the passphrase, they should contact me directly

### 3. Mobile-friendly open flow

On mobile, decrypted charts are not forced into a fragile automatic popup flow.

Current behavior after successful decryption:

- page shows explicit actions:
  - `Open PDF`
  - `Download PDF`

This is more stable on mobile browsers than immediately trying to open a blob in a new tab.

### 4. Search bar

The page includes a lightweight search bar.

Current behavior:

- starts matching only when input length is 2 characters or more
- matching is exact-ish / find-like rather than fuzzy
- results appear in a popup layer
- clicking a result:
  - closes the popup
  - fills the selected text back into the search input
  - continues into the normal decrypt/open flow
- clicking any chart link, whether from the popup or the main list, also backfills the search bar with that chart label

### 5. Visual style

Current style direction:

- black / white / gray only
- no blue links
- simple static index layout
- grouped alphabetically

## Local preview

Serve `docs/` directly:

```bash
cd /Users/tangkk/Documents/Projects/web-realbook/docs
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/
```

Do not use `file://` for normal testing.

## GitHub Pages

This project is intended to be hosted from:

- branch: `main`
- folder: `/docs`

Live URL:

- https://tangkk.github.io/web-realbook/

## Workflow note

Project rule from KT:

- when KT asks to change the index page, directly edit `docs/index.html`
- do not rebuild unrelated assets just to tweak page copy or UI
