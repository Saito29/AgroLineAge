# AgroLineAge — Livestock Family Tree

Static site, no build step. Folder layout (same as your project):

    index.html  sw.js  manifest.webmanifest
    src/js/config.js   src/js/app.js   src/css/style.css   src/icon.svg

Serve it over http(s) (e.g. `python3 -m http.server`) — Google sign-in and the offline service worker do not work from `file://`.

## Google sign-in
In Google Cloud Console → OAuth client (Web), add every URL you host the app from under **Authorized JavaScript origins**.
Scopes used: `drive.file` (only files this app creates), plus `openid email profile` to show who is signed in.
"Sign out" revokes the token and stops syncing; local data stays on the device.

## Offline / online
* The first visit caches the app and the Excel/PowerPoint libraries, so it opens with no internet.
* All data (and attachments) are saved on the device first. While offline, changes queue up and sync to Drive automatically when the connection returns.
* "Work offline" pauses syncing manually (e.g. on a weak connection).

## Excel format (export = import)
Sheets: **Organizations**, **Farmers**, **Livestock**, **Activities**. People and organizations are matched by *name*, not by ID.
Livestock columns: Tag, Species, Breed, Sex, Born, Status, Farmer Name, Organization, Parent Tag, Parent Organization (only if the parent tag exists in several organizations), Insured, Insurance Agency, Policy No., Coverage Start, Coverage End, Notes.
Attachments are not stored in Excel.

Edit the insurance agency choices in `src/js/config.js` (`INSURERS`).
