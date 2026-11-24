import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import React, { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, Upload } from 'lucide-react';
import { ModalSheet } from '../components/ModalSheet';
import { StatusEditor } from '../components/StatusEditor';
import { todayLocal } from '../core/dates';
import { validateBackupJson } from '../core/db';
import type { BackupValidationResult } from '../core/types';
import { useWorkspace } from '../state/WorkspaceContext';
import appIcon from '../assets/task-tracker-icon.png';
import { loadConfig } from '../core/syncConfig';
import { testConnection } from '../core/syncClient';

interface SettingsViewProps {
  onBack: () => void;
}

export function SettingsView({ onBack }: SettingsViewProps) {
  const {
    settings,
    workCycles,
    tasks,
    updateDefaultStatuses,
    exportBackupJson,
    importBackup,
    syncState,
    setSyncEnabled,
    disconnectAndDeleteCloud,
    runSync,
  } = useWorkspace();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<BackupValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  // Sync settings state
  const [syncUrl, setSyncUrl] = useState(loadConfig().url);
  const [syncKey, setSyncKey] = useState(loadConfig().key);
  const [syncTesting, setSyncTesting] = useState(false);
  const [confirmDeleteCloud, setConfirmDeleteCloud] = useState(false);
  const [syncTestResult, setSyncTestResult] = useState<'ok' | '401' | 'unreachable' | null>(null);

  // Tasks belonging to cycles that inherit app defaults
  const defaultScopeTasks = useMemo(() => {
    const inheritedCycleIds = new Set(
      workCycles.filter((c) => !c.useCustomStatuses).map((c) => c.id)
    );
    return tasks.filter((t) => inheritedCycleIds.has(t.workCycleId));
  }, [workCycles, tasks]);

  const handleExport = async () => {
    const json = exportBackupJson();
    const filename = `task-tracker-backup-${todayLocal()}.json`;

    if (Capacitor.isNativePlatform()) {
      try {
        const result = await Filesystem.writeFile({
          path: filename,
          data: json,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        await Share.share({
          title: 'Task Tracker Backup',
          url: result.uri,
          dialogTitle: 'Export Task Tracker Backup',
        });
      } catch (err) {
        setImportErrors([
          err instanceof Error ? err.message : 'Unable to export backup file.',
        ]);
      }
      return;
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImportErrors([]);
    setImportSuccess(null);

    try {
      const text = await file.text();
      const result = validateBackupJson(text);
      if (!result.valid || !result.payload) {
        setImportErrors(
          result.errors.length > 0
            ? result.errors
            : ['Backup file failed validation.']
        );
        return;
      }
      setPendingImport(result);
    } catch {
      setImportErrors(['Unable to read the selected file.']);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingImport?.payload) return;
    setImporting(true);
    try {
      const result = await importBackup(pendingImport.payload);
      const { workCycles: c, sprints: s, tasks: t } = result.added;
      setImportSuccess(
        c + s + t === 0
          ? 'Nothing new to add — every work cycle, sprint, and task in this backup already exists. Your app settings were updated.'
          : `Added ${c} new work cycle${c === 1 ? '' : 's'}, ${s} sprint${
              s === 1 ? '' : 's'
            }, and ${t} task${
              t === 1 ? '' : 's'
            }. Your existing data was kept.`
      );
      setPendingImport(null);
    } catch (err) {
      setImportErrors([
        err instanceof Error ? err.message : 'Failed to import backup into local storage.',
      ]);
      setPendingImport(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Home</span>
          </button>

          <span className="text-sm font-semibold text-slate-900 sm:text-base">Settings</span>

          <div className="w-16" aria-hidden="true" />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Default Workflow Statuses
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              All work cycles inherit this status list unless overridden in that cycle&apos;s
              settings. Completion uses the task checkbox and displays Done.
            </p>
          </div>

          <StatusEditor
            statuses={settings.defaultStatuses}
            scopeTasks={defaultScopeTasks}
            onCommit={updateDefaultStatuses}
          />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Data Backup & Transfer</h2>
            <p className="mt-1 text-sm text-slate-600">
              Export a versioned JSON backup of all work cycles, sprints, tasks, and settings
              to move data between devices.
            </p>
          </div>

          {importErrors.length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-900">
              <p className="font-semibold">Backup validation failed — existing data was kept:</p>
              <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-rose-800">
                {importErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {importSuccess ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-900">
              {importSuccess}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <Download className="h-4 w-4" />
              Export Data
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileSelected}
              className="hidden"
              aria-label="Choose JSON backup file"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" />
              Import Data
            </button>
          </div>
        </section>

        {/* Sync Section */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sync (optional)</h2>
            <p className="mt-1 text-sm text-slate-600">
              Off by default. Sends your data only to the server you enter.
            </p>
          </div>

          {/* Connection test result */}
          {syncTestResult && (
            <div
              className={`rounded-xl p-3.5 text-sm ${
                syncTestResult === 'ok'
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-900'
                  : syncTestResult === '401'
                  ? 'border border-rose-200 bg-rose-50 text-rose-900'
                  : 'border border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {syncTestResult === 'ok' && 'Connection successful!'}
              {syncTestResult === '401' && 'Authentication failed. Please check your sync key.'}
              {syncTestResult === 'unreachable' && 'Could not reach the server. Please check your URL.'}
            </div>
          )}

          {/* Server URL input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Server URL</label>
            <input
              type="url"
              value={syncUrl}
              onChange={(e) => {
                setSyncUrl(e.target.value);
                setSyncTestResult(null);
              }}
              placeholder="https://example.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          {/* Sync key input */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Sync Key</label>
            <input
              type="password"
              value={syncKey}
              onChange={(e) => {
                setSyncKey(e.target.value);
                setSyncTestResult(null);
              }}
              placeholder="Enter your sync key"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          {/* Test connection button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!syncUrl || !syncKey) {
                  setSyncTestResult('unreachable');
                  return;
                }
                setSyncTesting(true);
                try {
                  const result = await testConnection(syncUrl, syncKey);
                  setSyncTestResult(result);
                } catch {
                  setSyncTestResult('unreachable');
                } finally {
                  setSyncTesting(false);
                }
              }}
              disabled={!syncUrl || !syncKey || syncTesting}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {syncTesting ? 'Testing…' : 'Test connection'}
            </button>
          </div>

          {/* Toggle sync */}
          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-sm font-medium text-slate-900">Enable Sync</p>
              <p className="text-xs text-slate-500">
                {syncState.enabled ? 'Sync is active' : 'Sync is disabled'}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await setSyncEnabled(!syncState.enabled, syncUrl, syncKey);
              }}
              role="switch"
              aria-checked={syncState.enabled}
              aria-label="Enable sync"
              disabled={!syncState.enabled && (!syncUrl || !syncKey)}
              className={`relative inline-flex h-6 w-11 disabled:opacity-50 items-center rounded-full transition-colors ${
                syncState.enabled ? 'bg-slate-900' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  syncState.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Sync status */}
          <div className="pt-2">
            <p className="text-sm text-slate-600">
              {syncState.status === 'syncing' && 'Syncing…'}
              {syncState.status === 'error' && (
                <span className="text-rose-600">Error: {syncState.error}</span>
              )}
              {syncState.status === 'idle' && syncState.lastSyncedAt && (
                `Last synced: ${new Date(syncState.lastSyncedAt).toLocaleString()}`
              )}
              {syncState.status === 'off' && 'Sync is disabled'}
            </p>
          </div>

          {/* Sync now button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!syncState.enabled) {
                  return;
                }
                await runSync();
              }}
              disabled={!syncState.enabled || syncState.status === 'syncing'}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {syncState.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
          </div>

          {/* Delete cloud copy */}
          <div className="pt-2 border-t border-slate-200 mt-2">
            <button
              type="button"
              onClick={async () => {
                if (!confirmDeleteCloud) {
                  setConfirmDeleteCloud(true);
                  return;
                }
                setConfirmDeleteCloud(false);
                await disconnectAndDeleteCloud();
                setSyncTestResult(null);
              }}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              {confirmDeleteCloud ? 'Tap again to delete cloud copy' : 'Delete cloud copy'}
            </button>
            {confirmDeleteCloud && (
              <button
                type="button"
                onClick={() => setConfirmDeleteCloud(false)}
                className="ml-2 inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
            <p className="mt-1 text-xs text-slate-500">Deletes the server copy and turns sync off. Data on this device stays.</p>
          </div>
        </section>

        <section
          aria-labelledby="privacy-policy-title"
          className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-4"
        >
          <div className="flex items-center gap-3">
            <img
              src={appIcon}
              alt=""
              aria-hidden="true"
              className="h-12 w-12 rounded-xl"
            />
            <div>
              <h2 id="privacy-policy-title" className="text-lg font-semibold text-slate-900">
                Privacy Policy
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">Effective November 18, 2026</p>
            </div>
          </div>

          <div className="space-y-4 text-sm leading-6 text-slate-700">
            <p>
              Task Tracker is a private, offline-first personal planning app. We do not collect,
              transmit, sell, or share your personal information or app activity. The app has no
              user accounts, analytics, advertising, backend, or developer-operated server.
            </p>

            <div>
              <h3 className="font-semibold text-slate-900">Data stored on your device</h3>
              <p className="mt-1">
                Work cycles, sprints, tasks, workflow settings, and other content you enter are
                stored locally in the app&apos;s private storage on your device. We cannot access
                this information. Your device operating system may include app data in a device
                backup according to your own iCloud, Google, or device backup settings.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">Backups and sharing</h3>
              <p className="mt-1">
                If you choose Export Data, Task Tracker creates a JSON backup and opens your
                device&apos;s share sheet. The backup is sent only to the destination you select.
                Importing a backup reads the file you choose and stores its contents locally.
                Task Tracker does not receive a copy of exported or imported data.
              </p>
            </div>

            <div>
              <h3 className="font-semibold text-slate-900">Data deletion and changes</h3>
              <p className="mt-1">
                You can delete individual tasks or work cycles inside the app. Uninstalling Task
                Tracker removes its locally stored data, subject to any backups managed by your
                device or any backup files you exported. If this policy changes, the updated
                policy and effective date will be shown here.
              </p>
            </div>

            <p className="text-xs text-slate-500">
              For privacy questions, use the developer contact information shown on Task
              Tracker&apos;s App Store or Google Play listing.
            </p>

            {Capacitor.isNativePlatform() ? null : (
              <a
                href={`${import.meta.env.BASE_URL}privacy/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                <ExternalLink className="h-4 w-4" />
                View full privacy policy
              </a>
            )}
          </div>
        </section>
      </main>

      <ModalSheet
        open={Boolean(pendingImport)}
        onClose={() => setPendingImport(null)}
        title="Import Data?"
        subtitle="Adds new data, keeps your current data"
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPendingImport(null)}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={handleConfirmImport}
              className="min-h-[44px] rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {importing ? 'Importing…' : 'Import Data'}
            </button>
          </div>
        }
      >
        {pendingImport?.summary ? (
          <div className="space-y-4 text-sm text-slate-700">
            <p>
              This adds any new work cycles, sprints, and tasks from the backup. Your existing
              work cycles, sprints, and tasks are kept unchanged — only your app settings are
              updated to match the backup.
            </p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              In this backup
            </p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 tabular-nums">
              <div className="flex justify-between">
                <span className="text-slate-600">Work cycles</span>
                <span className="font-semibold text-slate-900">
                  {pendingImport.summary.workCyclesCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Sprints</span>
                <span className="font-semibold text-slate-900">
                  {pendingImport.summary.sprintsCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Tasks</span>
                <span className="font-semibold text-slate-900">
                  {pendingImport.summary.tasksCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Default statuses</span>
                <span className="font-semibold text-slate-900">
                  {pendingImport.summary.statusesCount}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </ModalSheet>
    </div>
  );
}
