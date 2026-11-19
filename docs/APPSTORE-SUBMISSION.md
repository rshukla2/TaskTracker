# Task Tracker — App Store Submission Package

> Ready-to-paste content + checklist for App Store Connect. Final distribution/upload is
> performed by you in Xcode (see "Final step"). Bundle id: `rshukla.tasktracker.app`.

## 1. App record (App Store Connect → My Apps → +)
- **Name:** Task Tracker
- **Bundle ID:** `rshukla.tasktracker.app` (must match the Xcode signing config)
- **Platform:** iOS
- **Primary Language:** English (US)
- **SKU:** `task-tracker-1` (any internal id)
- **Minimum iOS version:** 15.0 (matches `IPHONEOS_DEPLOYMENT_TARGET`)

## 2. App Information / listing (drafts — verify before pasting)
- **Subtitle (≤30):** `Plan cycles, sprints & tasks`
- **Primary Category:** Productivity
- **Description:**
  > Task Tracker is a private, offline-first personal planner organized around Work Cycles →
  > Sprints → Tasks. Plan your work in cycles, break them into sprints, and track tasks with
  > custom workflow statuses and progress. Everything is stored locally on your device — no
  > accounts, no cloud, no tracking. Export/import a versioned JSON backup to move your data
  > between devices.
- **Keywords (≤100 chars, comma-separated, no commas count as separators):**
  `planner,tasks,productivity,sprints,workflow,cycle,offline,organize,productivity,to-do`
  (dedupe — Apple de-dupes; keep unique, ≤100 chars total)
- **Support URL:** `https://rshukla2.github.io/TaskTracker/`
- **Privacy Policy URL:** `https://rshukla2.github.io/TaskTracker/privacy/` (confirmed live, HTTP 200)
- **Version:** 1.0  **Build:** 1

## 3. App Privacy (App Store Connect privacy section)
- **"Do you collect any data from this app?"** → **No, I am not collecting any data.**
  Justification: all data is stored locally in on-device storage; no analytics, ads, accounts,
  or third-party SDKs. (Matches the hosted privacy policy.)
- No ATT / `NSUserTrackingUsageDescription` needed — the app contains no tracking.

## 4. App Icon & screenshots
- App icon: 1024×1024 — present (`Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`). ✓
- Screenshots: **required, not in repo.** Provide at least 6.5" (or 6.7") iPhone shots + a
  12.9" iPad set (the app supports iPad). 1024×2208 / 1290×2796 (6.7") typical.

## 5. Content Rating
- Complete the questionnaire in App Store Connect. With no mature content, expect **4+**.

## 6. Pre-flight checks before you archive
- [ ] `npx cap sync` (re-syncs `rshukla.tasktracker.app` + latest web bundle into iOS)
- [ ] Xcode → Signing & Capabilities → your **Apple Developer Team** selected
- [ ] Confirm a `PrivacyInfo.xcprivacy` is present in the build after `cap sync`
      (Capacitor's Filesystem/Share plugins ship their own; if Xcode warns "Privacy Manifest
      Not Found," add `ios/App/PrivacyInfo.xcprivacy`)
- [ ] `rshukla.tasktracker.app` confirmed **free** in App Store Connect (create the record)
- [ ] Final step (you do this): **Product → Archive → Distribute App → App Store**, using
      `ios/App/ExportOptions.plist`

## 7. Final step — you perform the upload
1. Xcode: **Product → Archive** (Any iOS Device / arm64).
2. In the Organizer: select the archive → **Distribute App → App Store Distribution → Upload**.
3. Use `ios/App/ExportOptions.plist` (automatic signing, `upload` destination).
4. In App Store Connect, fill the listing above, screenshots, rating, and **Submit for Review**.
