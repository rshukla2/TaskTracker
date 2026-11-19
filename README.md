# Task Tracker

A personal planner organized around **Work Cycles → Sprints → Tasks**, built with React, TypeScript, Vite, and local IndexedDB persistence. Runs completely offline in your browser with zero accounts, backends, or API keys.

## Mac Setup & Local Development

1. **Prerequisites**: Install Node.js 20+ (e.g., via Homebrew `brew install node` or [nodejs.org](https://nodejs.org)).
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Start the local development server**:
   ```bash
   npm run dev
   ```
4. **Open in your browser**:
   - Localhost URL: **http://localhost:3000/**
   - On your iPhone on the same Wi-Fi network, you can open your Mac's local IP on port `3000` (e.g., `http://<your-mac-local-ip>:3000/`).

## Building the Static Site

To type-check and build the production static bundle into `dist/`:

```bash
npm run lint
npm run build
```

You can preview the production static build locally with:

```bash
npm run preview
```

## Architecture

Core planning logic is decoupled from the React UI under `src/core/` so it can be reused if packaged for mobile:

- `src/core/types.ts` — WorkCycle, Sprint, Task, Settings, and Backup models
- `src/core/dates.ts` — Local calendar date (`YYYY-MM-DD`) arithmetic without timezone drift
- `src/core/scheduling.ts` — Sprint generation, overlap validation, cascading date shifts, and sprint merging
- `src/core/progress.ts` — Equal-weight progress calculation, overdue detection, and task/cycle ordering
- `src/core/statuses.ts` — Default/custom workflow status resolution and task replacement helpers
- `src/core/db.ts` — IndexedDB persistence and versioned JSON backup export/import validation

## Future GitHub Pages Hosting

The app is configured for subpath-safe static hosting (`base: './'` in `vite.config.ts` and hash-based routes `#/...`):

1. Build the static site: `npm run build`
2. Publish the `dist/` folder to GitHub Pages (for example, using GitHub Actions `actions/deploy-pages` or pushing `dist/` to a `gh-pages` branch).
3. Access the app at `https://<username>.github.io/<repo-name>/`.

## Transferring Data via JSON Backup

Because IndexedDB storage is scoped to each origin (`http://localhost:3000` vs `https://<username>.github.io/...` or another device), move your data manually with the built-in backup tools:

1. Open **Settings** from the Home screen.
2. Click **Export Data** to download a versioned backup file (`task-tracker-backup-YYYY-MM-DD.json`).
3. On the target site or device, open **Settings** and click **Import Data**.
4. Select your `.json` backup file. The app validates the entire backup schema and relationships before asking you to confirm replacing existing data.

## Mobile App Store & Google Play Packaging (Capacitor)

This project is already wrapped with **Capacitor 8** (`capacitor.config.ts`, `ios/`, and `android/`) and automatically uses native on-device storage (`Directory.Data` via `@capacitor/filesystem`) plus the native Share Sheet (`@capacitor/share`) for JSON backups when running as an iOS or Android app.

### 1. Before Publishing: Verify Your Bundle ID & Icons

1. The permanent app identifier is `rshukla.tasktracker.app`. Confirm that it is available in App Store Connect and Google Play Console before creating the store records.
2. Run `npm run cap:sync` after changing `capacitor.config.ts` or any web code in `src/`.
3. The branded icon is displayed from `src/assets/task-tracker-icon.png`; full-size platform assets live in the iOS asset catalog and Android `mipmap-*` directories.

### 2. Local iOS Testing & App Store Submission (Mac + Xcode)

1. Install **Xcode** from the Mac App Store.
2. Build and open the Xcode project:
   ```bash
   npm install
   npm run cap:ios
   ```
3. In Xcode:
   - Select the **App** target → **Signing & Capabilities** → choose your Apple Developer Team and verify the Bundle Identifier matches `capacitor.config.ts`.
   - Pick an iPhone Simulator or your physical iPhone and click **Run** to test locally.
   - To submit to TestFlight / App Store: select **Any iOS Device (arm64)**, choose **Product → Archive**, and upload via **Distribute App**.

### 3. Android Testing & Google Play Submission (Android Studio)

1. Install **Android Studio** and an Android SDK.
2. Build and open the Android project:
   ```bash
   npm run cap:android
   ```
3. In Android Studio:
   - Run on an Emulator or physical Android device to test locally.
   - To publish to Google Play: choose **Build → Generate Signed Bundle / APK → Android App Bundle (`.aab`)**, sign with your upload keystore, and upload to Google Play Console.

