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
  } = useWorkspace();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [pendingImport, setPendingImport] = useState<BackupValidationResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

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
      await importBackup(pendingImport.payload);
      setImportSuccess(
        `Restored ${pendingImport.summary?.workCyclesCount ?? 0} work cycles, ${
          pendingImport.summary?.sprintsCount ?? 0
        } sprints, and ${pendingImport.summary?.tasksCount ?? 0} tasks.`
      );
      setPendingImport(null);
    } catch (err) {
      setImportErrors([
        err instanceof Error ? err.message : 'Failed to import backup into IndexedDB.',
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
        title="Replace Existing Data?"
        subtitle="Backup validated successfully"
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
              {importing ? 'Importing…' : 'Replace All Data'}
            </button>
          </div>
        }
      >
        {pendingImport?.summary ? (
          <div className="space-y-4 text-sm text-slate-700">
            <p>
              Importing this backup will replace all current work cycles, sprints, tasks, and
              settings in your browser.
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
