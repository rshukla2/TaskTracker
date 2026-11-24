import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  buildBackupPayload,
  commitCycleStatusAndTaskUpdates,
  commitSettingsAndTaskUpdates,
  commitSprintEdit,
  commitSprintMerge,
  createDefaultSettings,
  createWorkCycleWithSprints,
  deleteTask,
  deleteWorkCycleCascade,
  loadWorkspace,
  mergeWorkspaceFromBackup,
  saveTask,
  saveWorkCycle,
} from '../core/db';
import type { MergeBackupResult } from '../core/db';
import {
  applyMergeWithNext,
  createId,
  generateSprintsForCycle,
} from '../core/scheduling';
import { findCompletedStatus } from '../core/statuses';
import { clearShadow, loadConfig, saveConfig } from '../core/syncConfig';
import { deleteCloudCopy, syncNow } from '../core/syncClient';
import type {
  AppSettings,
  BackupPayloadV1,
  EffortLevel,
  LocalDateString,
  Sprint,
  Task,
  WorkCycle,
  WorkflowStatus,
} from '../core/types';

export interface CreateWorkCycleInput {
  name: string;
  description: string;
  endGoal: string;
  startDate: LocalDateString;
  endDate: LocalDateString;
  sprintLengthDays: number;
}

export interface CreateTaskInput {
  workCycleId: string;
  sprintId: string;
  title: string;
  description?: string;
  deadline?: LocalDateString | null;
  estimatedHours?: number | null;
  effort?: EffortLevel | null;
  statusId?: string | null;
  blockerReason?: string;
}

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  settings: AppSettings;
  workCycles: WorkCycle[];
  sprints: Sprint[];
  tasks: Task[];
  syncState: {
    enabled: boolean;
    status: 'idle' | 'syncing' | 'error' | 'off';
    lastSyncedAt: string | null;
    error: string | null;
  };
  runSync: () => Promise<void>;
  setSyncEnabled: (enabled: boolean, url: string, key: string) => Promise<void>;
  disconnectAndDeleteCloud: () => Promise<void>;
  createCycle: (input: CreateWorkCycleInput) => Promise<WorkCycle>;
  updateCycleDetails: (
    cycleId: string,
    updates: Partial<Pick<WorkCycle, 'name' | 'description' | 'endGoal'>>
  ) => Promise<void>;
  deleteCycle: (cycleId: string) => Promise<void>;
  commitSprintEditAction: (
    updatedSprints: Sprint[],
    proposedCycleStartDate: LocalDateString | null,
    proposedCycleEndDate: LocalDateString | null,
    cycleId: string
  ) => Promise<void>;
  commitSprintMergeAction: (
    cycleId: string,
    firstSprintId: string,
    mergedName: string,
    mergedGoal: string
  ) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  updateTask: (updated: Task) => Promise<void>;
  toggleTaskCompletion: (taskId: string, taskOverride?: Task) => Promise<void>;
  deleteTaskAction: (taskId: string) => Promise<void>;
  updateDefaultStatuses: (
    defaultStatuses: WorkflowStatus[],
    updatedTasks?: Task[]
  ) => Promise<void>;
  updateCycleStatusConfig: (
    updatedCycle: WorkCycle,
    updatedTasks?: Task[]
  ) => Promise<void>;
  exportBackupJson: () => string;
  importBackup: (payload: BackupPayloadV1) => Promise<MergeBackupResult>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());
  const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  // Sync state
  const [syncEnabled, setSyncEnabledState] = useState<boolean>(loadConfig().enabled);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error' | 'off'>('off');
  const [syncLastSyncedAt, setSyncLastSyncedAt] = useState<string | null>(loadConfig().lastSyncedAt);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Track last local write time for debouncing
  const lastLocalWriteRef = useRef<number>(0);
  const syncDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncDebounceTriggerRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial data
  useEffect(() => {
    let active = true;
    loadWorkspace()
      .then((snapshot) => {
        if (!active) return;
        setSettings(snapshot.settings);
        setWorkCycles(snapshot.workCycles);
        setSprints(snapshot.sprints);
        setTasks(snapshot.tasks);
        setLoading(false);

        // Sync on initial load if enabled
        const config = loadConfig();
        if (config.enabled) {
          runSyncInternal();
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load local workspace.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Handle sync triggers
  useEffect(() => {
    const config = loadConfig();

    if (!config.enabled) {
      setSyncStatus('off');
      return;
    }

    // Visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runSyncInternal();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Interval handler for periodic sync (every 60 seconds)
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        runSyncInternal();
      }
    }, 60000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, []);

  // Debounced sync trigger for local writes
  const triggerDebouncedSync = useCallback(() => {
    lastLocalWriteRef.current = Date.now();

    if (syncDebounceTriggerRef.current) {
      clearTimeout(syncDebounceTriggerRef.current);
    }

    syncDebounceTriggerRef.current = setTimeout(() => {
      const config = loadConfig();
      if (config.enabled && Date.now() - lastLocalWriteRef.current >= 3000) {
        runSyncInternal();
      }
    }, 3000); // 3 second debounce
  }, []);

  // Sync all local write actions with sync trigger
  const createCycle = useCallback(async (input: CreateWorkCycleInput) => {
    const nowIso = new Date().toISOString();
    const cycleId = createId();
    const cycle: WorkCycle = {
      id: cycleId,
      name: input.name.trim(),
      description: input.description.trim(),
      endGoal: input.endGoal.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      sprintLengthDays: Math.max(1, Math.floor(input.sprintLengthDays)),
      useCustomStatuses: false,
      customStatuses: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    const generatedSprints = generateSprintsForCycle(
      cycleId,
      cycle.startDate,
      cycle.endDate,
      cycle.sprintLengthDays,
      nowIso
    );

    await createWorkCycleWithSprints(cycle, generatedSprints);
    setWorkCycles((prev) => [...prev, cycle]);
    setSprints((prev) => [...prev, ...generatedSprints]);
    triggerDebouncedSync();
    return cycle;
  }, [triggerDebouncedSync]);

  const updateCycleDetails = useCallback(
    async (
      cycleId: string,
      updates: Partial<Pick<WorkCycle, 'name' | 'description' | 'endGoal'>>
    ) => {
      const existing = workCycles.find((c) => c.id === cycleId);
      if (!existing) return;
      const updated: WorkCycle = {
        ...existing,
        ...updates,
        name: updates.name !== undefined ? updates.name.trim() : existing.name,
        description:
          updates.description !== undefined ? updates.description.trim() : existing.description,
        endGoal: updates.endGoal !== undefined ? updates.endGoal.trim() : existing.endGoal,
        updatedAt: new Date().toISOString(),
      };
      await saveWorkCycle(updated);
      setWorkCycles((prev) => prev.map((c) => (c.id === cycleId ? updated : c)));
      triggerDebouncedSync();
    },
    [workCycles, triggerDebouncedSync]
  );

  const deleteCycle = useCallback(async (cycleId: string) => {
    await deleteWorkCycleCascade(cycleId);
    setWorkCycles((prev) => prev.filter((c) => c.id !== cycleId));
    setSprints((prev) => prev.filter((s) => s.workCycleId !== cycleId));
    setTasks((prev) => prev.filter((t) => t.workCycleId !== cycleId));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const commitSprintEditAction = useCallback(
    async (
      updatedSprints: Sprint[],
      proposedCycleStartDate: LocalDateString | null,
      proposedCycleEndDate: LocalDateString | null,
      cycleId: string
    ) => {
      const cycle = workCycles.find((c) => c.id === cycleId);
      let updatedCycle: WorkCycle | undefined;

      if (cycle && (proposedCycleStartDate || proposedCycleEndDate)) {
        updatedCycle = {
          ...cycle,
          startDate: proposedCycleStartDate ?? cycle.startDate,
          endDate: proposedCycleEndDate ?? cycle.endDate,
          updatedAt: new Date().toISOString(),
        };
      }

      await commitSprintEdit(updatedSprints, updatedCycle);

      const updatedMap = new Map(updatedSprints.map((s) => [s.id, s]));
      setSprints((prev) => prev.map((s) => updatedMap.get(s.id) ?? s));
      if (updatedCycle) {
        setWorkCycles((prev) =>
          prev.map((c) => (c.id === updatedCycle!.id ? updatedCycle! : c))
        );
      }
      triggerDebouncedSync();
    },
    [workCycles, triggerDebouncedSync]
  );

  const commitSprintMergeAction = useCallback(
    async (
      cycleId: string,
      firstSprintId: string,
      mergedName: string,
      mergedGoal: string
    ) => {
      const cycleSprints = sprints.filter((s) => s.workCycleId === cycleId);
      const cycleTasks = tasks.filter((t) => t.workCycleId === cycleId);

      const { keptSprints, deletedSprintId, updatedTasks } = applyMergeWithNext(
        cycleSprints,
        cycleTasks,
        firstSprintId,
        mergedName,
        mergedGoal
      );

      await commitSprintMerge(keptSprints, deletedSprintId, updatedTasks);

      const keptMap = new Map(keptSprints.map((s) => [s.id, s]));
      setSprints((prev) =>
        prev
          .filter((s) => s.id !== deletedSprintId)
          .map((s) => keptMap.get(s.id) ?? s)
      );

      const updatedTaskMap = new Map(updatedTasks.map((t) => [t.id, t]));
      setTasks((prev) => prev.map((t) => updatedTaskMap.get(t.id) ?? t));
      triggerDebouncedSync();
    },
    [sprints, tasks, triggerDebouncedSync]
  );

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const nowIso = new Date().toISOString();
    const task: Task = {
      id: createId(),
      workCycleId: input.workCycleId,
      sprintId: input.sprintId,
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      deadline: input.deadline ?? null,
      estimatedHours: input.estimatedHours ?? null,
      effort: input.effort ?? null,
      statusId: input.statusId ?? null,
      previousStatusId: null,
      blockerReason: (input.blockerReason ?? '').trim(),
      completed: false,
      completedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await saveTask(task);
    setTasks((prev) => [...prev, task]);
    triggerDebouncedSync();
    return task;
  }, [triggerDebouncedSync]);

  const updateTask = useCallback(async (updated: Task) => {
    const nextTask: Task = {
      ...updated,
      title: updated.title.trim(),
      updatedAt: new Date().toISOString(),
    };
    await saveTask(nextTask);
    setTasks((prev) => prev.map((t) => (t.id === nextTask.id ? nextTask : t)));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const toggleTaskCompletion = useCallback(
    async (taskId: string, taskOverride?: Task) => {
      const existing = taskOverride ?? tasks.find((t) => t.id === taskId);
      if (!existing) return;
      const cycle = workCycles.find((c) => c.id === existing.workCycleId);
      const usesDefaults = cycle ? !cycle.useCustomStatuses : true;
      const completedStatus = usesDefaults
        ? findCompletedStatus(settings.defaultStatuses)
        : null;

      const nowIso = new Date().toISOString();
      const nextCompleted = !existing.completed;

      let nextStatusId = existing.statusId;
      let nextPreviousStatusId = existing.previousStatusId ?? null;

      if (usesDefaults && completedStatus) {
        if (nextCompleted) {
          if (existing.statusId !== completedStatus.id) {
            nextPreviousStatusId = existing.statusId;
          }
          nextStatusId = completedStatus.id;
        } else {
          if (existing.statusId === completedStatus.id) {
            nextStatusId = existing.previousStatusId ?? null;
          }
          nextPreviousStatusId = null;
        }
      }

      const nextTask: Task = {
        ...existing,
        statusId: nextStatusId,
        previousStatusId: nextPreviousStatusId,
        completed: nextCompleted,
        completedAt: nextCompleted ? nowIso : null,
        updatedAt: nowIso,
      };
      await saveTask(nextTask);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? nextTask : t)));
      triggerDebouncedSync();
    },
    [tasks, workCycles, settings.defaultStatuses, triggerDebouncedSync]
  );

  const deleteTaskAction = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    triggerDebouncedSync();
  }, [triggerDebouncedSync]);

  const updateDefaultStatuses = useCallback(
    async (defaultStatuses: WorkflowStatus[], updatedTasks: Task[] = []) => {
      const nextSettings: AppSettings = {
        ...settings,
        defaultStatuses,
        updatedAt: new Date().toISOString(),
      };
      await commitSettingsAndTaskUpdates(nextSettings, updatedTasks);
      setSettings(nextSettings);
      if (updatedTasks.length > 0) {
        const updatedMap = new Map(updatedTasks.map((t) => [t.id, t]));
        setTasks((prev) => prev.map((t) => updatedMap.get(t.id) ?? t));
      }
      triggerDebouncedSync();
    },
    [settings, triggerDebouncedSync]
  );

  const updateCycleStatusConfig = useCallback(
    async (updatedCycle: WorkCycle, updatedTasks: Task[] = []) => {
      const nextCycle: WorkCycle = {
        ...updatedCycle,
        updatedAt: new Date().toISOString(),
      };
      await commitCycleStatusAndTaskUpdates(nextCycle, updatedTasks);
      setWorkCycles((prev) => prev.map((c) => (c.id === nextCycle.id ? nextCycle : c)));
      if (updatedTasks.length > 0) {
        const updatedMap = new Map(updatedTasks.map((t) => [t.id, t]));
        setTasks((prev) => prev.map((t) => updatedMap.get(t.id) ?? t));
      }
      triggerDebouncedSync();
    },
    [triggerDebouncedSync]
  );

  const exportBackupJson = useCallback(() => {
    const payload = buildBackupPayload({
      settings,
      workCycles,
      sprints,
      tasks,
    });
    return JSON.stringify(payload, null, 2);
  }, [settings, workCycles, sprints, tasks]);

  const importBackup = useCallback(
    async (payload: BackupPayloadV1): Promise<MergeBackupResult> => {
      const result = await mergeWorkspaceFromBackup(payload);
      setSettings(result.snapshot.settings);
      setWorkCycles(result.snapshot.workCycles);
      setSprints(result.snapshot.sprints);
      setTasks(result.snapshot.tasks);
      return result;
    },
    []
  );

  // Sync function that handles the actual sync logic
  const runSyncInternal = useCallback(async () => {
    const config = loadConfig();
    if (!config.enabled) {
      setSyncStatus('off');
      return;
    }

    setSyncStatus('syncing');
    setSyncError(null);

    try {
      const result = await syncNow();

      setSyncStatus('idle');
      setSyncLastSyncedAt(new Date().toISOString());
      setSyncError(null);

      // Reload state if local data changed
      if (result.changedLocal) {
        const snapshot = await loadWorkspace();
        setSettings(snapshot.settings);
        setWorkCycles(snapshot.workCycles);
        setSprints(snapshot.sprints);
        setTasks(snapshot.tasks);
      }
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err instanceof Error ? err.message : 'Sync failed');
    }
  }, []);

  const setSyncEnabled = useCallback(
    async (enabled: boolean, url: string, key: string) => {
      const prev = loadConfig();
      const cleanUrl = url.trim().replace(/\/+$/, '');
      const cleanKey = key.trim();
      if (prev.url !== cleanUrl || prev.key !== cleanKey) {
        // Different server or key: start fresh so everything is compared again.
        clearShadow();
        saveConfig({ lastSeq: 0, lastSyncedAt: null });
      }
      saveConfig({ enabled, url: cleanUrl, key: cleanKey });
      setSyncEnabledState(enabled);
      if (enabled) {
        await runSyncInternal();
      } else {
        setSyncStatus('off');
        setSyncError(null);
      }
    },
    [runSyncInternal]
  );

  const disconnectAndDeleteCloud = useCallback(async () => {
    await deleteCloudCopy();
    setSyncEnabledState(false);
    setSyncStatus('off');
    setSyncError(null);
    setSyncLastSyncedAt(null);
  }, []);

  // Public runSync function (exposed to consumers)
  const runSync = useCallback(() => {
    return runSyncInternal();
  }, [runSyncInternal]);

  return (
    <WorkspaceContext.Provider
      value={{
        loading,
        error,
        settings,
        workCycles,
        sprints,
        tasks,
        syncState: {
          enabled: syncEnabled,
          status: syncStatus,
          lastSyncedAt: syncLastSyncedAt,
          error: syncError,
        },
        runSync,
        setSyncEnabled,
        disconnectAndDeleteCloud,
        createCycle,
        updateCycleDetails,
        deleteCycle,
        commitSprintEditAction,
        commitSprintMergeAction,
        createTask,
        updateTask,
        toggleTaskCompletion,
        deleteTaskAction,
        updateDefaultStatuses,
        updateCycleStatusConfig,
        exportBackupJson,
        importBackup,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  }
  return ctx;
}
