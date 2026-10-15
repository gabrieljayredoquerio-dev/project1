# AllowanceSaver

AllowanceSaver is a browser-only weekly allowance and expense tracker. It can be published as a static site with GitHub Pages; it has no server or database.

## Run locally

Open `login.html` in a browser, or serve this folder with a local static web server. The service worker and install/offline behavior require a secure context such as `localhost` or HTTPS; they do not run from a `file://` URL.

## Publish with GitHub Pages

1. Push the project to a GitHub repository.
2. In **Settings → Pages**, select **GitHub Actions** as the build and deployment source.
3. Push to the `main` branch. The workflow in `.github/workflows/pages.yml` deploys the static files.
4. Open the Pages URL, create a local account, and add the site to the device if the browser offers installation.

The app uses relative URLs and is designed to work from a project Pages URL as well as a custom domain.

## Data and security limits

- Accounts, passwords, budgets, expenses, and history live in that browser's `localStorage`. They do not sync across devices or browsers.
- This is not production authentication. A browser user can inspect or change local storage, including passwords and saved account roles. New self-registered accounts are ordinary user accounts; any admin role is only local and is not an access-control boundary. Use only a unique password and non-sensitive test data.
- Password reset, centralized account deletion, server-side authorization, and server backups are not available. Deleting an account removes its local data from the current browser only.
- Export a JSON backup before switching browsers or clearing site data. Backups include the profile name/email and budget history, but not the password; protect them.
- GitHub Pages serves the static app; it does not provide an app database or backend API. No GitHub secrets or database credentials are required.
- Offline access is available after the service worker has cached the app on a successful online visit. Clearing site data also clears locally saved accounts and budgets.

See [privacy.html](./privacy.html) and [terms.html](./terms.html) for user-facing notices. These pages are explanatory and are not production legal policies.

## Smoke-test checklist

- Create a local account, log in, and verify a new registration cannot choose an admin role.
- Set an allowance, log an expense, edit/delete it, and confirm the totals update.
- Export a CSV and a JSON backup; restore the JSON backup to the same local account.
- Confirm a backup for another email is rejected and deleting the account removes its local profile and budget.
- Load the site once online, then test the cached pages offline in the same browser.
- Check the layout on a narrow mobile viewport and keyboard navigation for forms and controls.

## Project files

- `index.html`, `login.html`, `styles.css`, `app.js`, and `auth.js`: app UI and browser-local behavior
- `manifest.webmanifest`, app icons, and `sw.js`: install metadata and offline static asset caching
- `.github/workflows/pages.yml`: GitHub Pages deployment
