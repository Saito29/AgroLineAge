# Livestock Family Tree

Static web app (no server). Tracks livestock lineage (e.g. Pig 1 → its offspring) with the owning farmer on every animal,
an Organization view (Organization → Farmers → their animals' lineage), and saves to **your Google Drive**.

## 1. Google setup (one time)
1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **OAuth consent screen** → External → fill app name/email → add your Google account(s) under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application**.
   Under **Authorized JavaScript origins** add `https://YOUR-USERNAME.github.io` (and `http://localhost:8080` for local testing).
5. Copy the Client ID into `src/js/config.js`.

## 2. Deploy to GitHub Pages
1. Create a GitHub repo, upload the whole project (`index.html`, `src/`, `README.md`).
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://YOUR-USERNAME.github.io/REPO-NAME/` → **Sign in with Google**.

## How data is saved
- Scope used: `drive.file` (the app only sees files it created). Data lives in `livestock-tree.json` in your Drive and
  auto-saves ~1.5s after each change. A copy is also cached in the browser.
- Export menu: download `.xlsx`/`.pptx`, or save `.xlsx`, a native Google Sheet, or `.pptx` to Drive.
- Import: `.xlsx` with `Farmers` and `Animals` sheets (same layout as export). Validates IDs, owners, parents, cycles.

## Limits
- Sign-in lasts ~1 hour; after that the status bar asks you to sign in again (changes stay in the browser meanwhile).
- Last write wins if two people edit at once. Sharing a tree between users needs a backend.
- Files go to My Drive (or `FOLDER_ID`); there is no folder picker.
- Not tested against a live Google account — test sign-in/export after setup.
