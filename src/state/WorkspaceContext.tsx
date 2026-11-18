import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
  replaceWorkspaceFromBackup,
  saveTask,
  saveWorkCycle,
} from '../core/db';
import {
  applyMergeWithNext,
  createId,
  generateSprintsForCycle,
} from '../core/scheduling';
import { findCompletedStatus } from '../core/statuses';
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
  importBackup: (payload: BackupPayloadV1) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(() => createDefaultSettings());
  const [workCycles, setWorkCycles] = useState<WorkCycle[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

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
    return cycle;
  }, []);

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
    },
    [workCycles]
  );

  const deleteCycle = useCallback(async (cycleId: string) => {
    await deleteWorkCycleCascade(cycleId);
    setWorkCycles((prev) => prev.filter((c) => c.id !== cycleId));
    setSprints((prev) => prev.filter((s) => s.workCycleId !== cycleId));
    setTasks((prev) => prev.filter((t) => t.workCycleId !== cycleId));
  }, []);

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
    },
    [workCycles]
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
    },
    [sprints, tasks]
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
    return task;
  }, []);

  const updateTask = useCallback(async (updated: Task) => {
    const nextTask: Task = {
      ...updated,
      title: updated.title.trim(),
      updatedAt: new Date().toISOString(),
    };
    await saveTask(nextTask);
    setTasks((prev) => prev.map((t) => (t.id === nextTask.id ? nextTask : t)));
  }, []);

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
    },
    [tasks, workCycles, settings.defaultStatuses]
  );

  const deleteTaskAction = useCallback(async (taskId: string) => {
    await deleteTask(taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

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
    },
    [settings]
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
    },
    []
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

  const importBackup = useCallback(async (payload: BackupPayloadV1) => {
    const snapshot = await replaceWorkspaceFromBackup(payload);
    setSettings(snapshot.settings);
    setWorkCycles(snapshot.workCycles);
    setSprints(snapshot.sprints);
    setTasks(snapshot.tasks);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        loading,
        error,
        settings,
        workCycles,
        sprints,
        tasks,
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
