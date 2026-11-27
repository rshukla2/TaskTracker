import {
  addDays,
  diffDays,
  diffDaysInclusive,
  formatDisplayDate,
  isValidLocalDate,
} from './dates';
import type { LocalDateString, Sprint, Task, WorkCycle } from './types';

export type DurationUnit = 'days' | 'weeks';

export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function calculateCycleEndDate(
  startDate: LocalDateString,
  durationValue: number,
  unit: DurationUnit
): LocalDateString {
  const safeVal = Math.max(1, Math.floor(durationValue));
  const totalDays = unit === 'weeks' ? safeVal * 7 : safeVal;
  return addDays(startDate, totalDays - 1);
}

export function generateSprintsForCycle(
  workCycleId: string,
  startDate: LocalDateString,
  endDate: LocalDateString,
  sprintLengthDays: number,
  nowIso = new Date().toISOString()
): Sprint[] {
  if (!isValidLocalDate(startDate) || !isValidLocalDate(endDate) || startDate > endDate) {
    return [];
  }
  const safeLength = Math.max(1, Math.floor(sprintLengthDays));
  const sprints: Sprint[] = [];
  let cursor = startDate;
  let index = 1;

  while (cursor <= endDate) {
    const candidateEnd = addDays(cursor, safeLength - 1);
    const sprintEnd = candidateEnd <= endDate ? candidateEnd : endDate;
    sprints.push({
      id: createId(),
      workCycleId,
      name: `Sprint ${index}`,
      endGoal: '',
      startDate: cursor,
      endDate: sprintEnd,
      order: index - 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    cursor = addDays(sprintEnd, 1);
    index += 1;
  }

  return sprints;
}

export interface SprintDateDiff {
  sprintId: string;
  name: string;
  oldStartDate: LocalDateString;
  oldEndDate: LocalDateString;
  newStartDate: LocalDateString;
  newEndDate: LocalDateString;
  isTarget: boolean;
  datesChanged: boolean;
}

export interface SprintEditValidationError {
  message: string;
  conflictingSprintId?: string;
  conflictingSprintName?: string;
  conflictingSprintEndDate?: LocalDateString;
  minAllowedStartDate?: LocalDateString;
}

export interface SprintEditPreview {
  valid: boolean;
  error?: SprintEditValidationError;
  deltaDays: number;
  editedSprintId: string;
  newName: string;
  newEndGoal: string;
  affectedSprints: SprintDateDiff[];
  updatedSprints: Sprint[];
  proposedCycleStartDate: LocalDateString | null;
  proposedCycleEndDate: LocalDateString | null;
  outsideDeadlineTaskCount: number;
}

export function previewSprintEdit(
  cycle: WorkCycle,
  cycleSprints: ReadonlyArray<Sprint>,
  cycleTasks: ReadonlyArray<Task>,
  sprintId: string,
  edits: {
    name: string;
    endGoal: string;
    startDate: LocalDateString;
    endDate: LocalDateString;
  }
): SprintEditPreview {
  const sorted = [...cycleSprints].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((s) => s.id === sprintId);

  const emptyFailure = (error: SprintEditValidationError): SprintEditPreview => ({
    valid: false,
    error,
    deltaDays: 0,
    editedSprintId: sprintId,
    newName: edits.name,
    newEndGoal: edits.endGoal,
    affectedSprints: [],
    updatedSprints: sorted,
    proposedCycleStartDate: null,
    proposedCycleEndDate: null,
    outsideDeadlineTaskCount: 0,
  });

  if (idx === -1) {
    return emptyFailure({ message: 'Sprint not found.' });
  }

  if (!edits.name.trim()) {
    return emptyFailure({ message: 'Sprint name cannot be empty.' });
  }

  if (!isValidLocalDate(edits.startDate) || !isValidLocalDate(edits.endDate)) {
    return emptyFailure({ message: 'Enter valid start and end dates.' });
  }

  if (edits.endDate < edits.startDate) {
    return emptyFailure({
      message: 'End date must be on or after the start date.',
    });
  }

  if (idx > 0) {
    const prev = sorted[idx - 1];
    const minAllowedStartDate = addDays(prev.endDate, 1);
    if (edits.startDate < minAllowedStartDate) {
      return emptyFailure({
        message: `Overlaps with ${prev.name} (ends ${formatDisplayDate(prev.endDate, { includeYear: true })}). Set this sprint's start date to ${formatDisplayDate(minAllowedStartDate, { includeYear: true })} or later, or shorten ${prev.name}.`,
        conflictingSprintId: prev.id,
        conflictingSprintName: prev.name,
        conflictingSprintEndDate: prev.endDate,
        minAllowedStartDate,
      });
    }
  }

  const target = sorted[idx];
  const deltaDays = diffDays(target.endDate, edits.endDate);
  const nowIso = new Date().toISOString();

  const updatedSprints: Sprint[] = sorted.map((s, i) => {
    if (i < idx) {
      return s;
    }
    if (i === idx) {
      return {
        ...s,
        name: edits.name.trim(),
        endGoal: edits.endGoal.trim(),
        startDate: edits.startDate,
        endDate: edits.endDate,
        updatedAt: nowIso,
      };
    }
    return {
      ...s,
      startDate: addDays(s.startDate, deltaDays),
      endDate: addDays(s.endDate, deltaDays),
      updatedAt: nowIso,
    };
  });

  const affectedSprints: SprintDateDiff[] = updatedSprints
    .map((updated, i) => {
      const original = sorted[i];
      const datesChanged =
        original.startDate !== updated.startDate || original.endDate !== updated.endDate;
      return {
        sprintId: updated.id,
        name: updated.name,
        oldStartDate: original.startDate,
        oldEndDate: original.endDate,
        newStartDate: updated.startDate,
        newEndDate: updated.endDate,
        isTarget: i === idx,
        datesChanged,
      };
    })
    .filter((d) => d.isTarget || d.datesChanged);

  const lastUpdated = updatedSprints[updatedSprints.length - 1];
  const firstUpdated = updatedSprints[0];

  // The cycle always spans exactly its sprints: it grows or shrinks with them.
  const proposedCycleEndDate =
    lastUpdated && lastUpdated.endDate !== cycle.endDate ? lastUpdated.endDate : null;
  const proposedCycleStartDate =
    firstUpdated && firstUpdated.startDate !== cycle.startDate ? firstUpdated.startDate : null;

  // Count tasks whose preserved deadlines would fall outside their sprint's new bounds
  const updatedById = new Map(updatedSprints.map((s) => [s.id, s]));
  let outsideDeadlineTaskCount = 0;
  for (const task of cycleTasks) {
    if (!task.deadline) continue;
    const sprint = updatedById.get(task.sprintId);
    if (!sprint) continue;
    if (task.deadline < sprint.startDate || task.deadline > sprint.endDate) {
      outsideDeadlineTaskCount += 1;
    }
  }

  return {
    valid: true,
    deltaDays,
    editedSprintId: sprintId,
    newName: edits.name.trim(),
    newEndGoal: edits.endGoal.trim(),
    affectedSprints,
    updatedSprints,
    proposedCycleStartDate,
    proposedCycleEndDate,
    outsideDeadlineTaskCount,
  };
}

export interface MergeSprintPreview {
  valid: boolean;
  error?: string;
  firstSprint: Sprint;
  secondSprint: Sprint;
  resultingStartDate: LocalDateString;
  resultingEndDate: LocalDateString;
  resultingDurationDays: number;
  defaultName: string;
  defaultEndGoal: string;
  movedTaskCount: number;
  totalTaskCountAfterMerge: number;
}

export function previewMergeWithNext(
  cycleSprints: ReadonlyArray<Sprint>,
  cycleTasks: ReadonlyArray<Task>,
  firstSprintId: string
): MergeSprintPreview | null {
  const sorted = [...cycleSprints].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((s) => s.id === firstSprintId);
  if (idx === -1 || idx >= sorted.length - 1) {
    return null;
  }
  const firstSprint = sorted[idx];
  const secondSprint = sorted[idx + 1];

  const firstTasks = cycleTasks.filter((t) => t.sprintId === firstSprint.id);
  const secondTasks = cycleTasks.filter((t) => t.sprintId === secondSprint.id);

  let defaultEndGoal = firstSprint.endGoal.trim();
  if (!defaultEndGoal) {
    defaultEndGoal = secondSprint.endGoal.trim();
  } else if (
    secondSprint.endGoal.trim() &&
    secondSprint.endGoal.trim() !== defaultEndGoal
  ) {
    defaultEndGoal = `${defaultEndGoal}\n${secondSprint.endGoal.trim()}`;
  }

  return {
    valid: true,
    firstSprint,
    secondSprint,
    resultingStartDate: firstSprint.startDate,
    resultingEndDate: secondSprint.endDate,
    resultingDurationDays: diffDaysInclusive(firstSprint.startDate, secondSprint.endDate),
    defaultName: firstSprint.name,
    defaultEndGoal,
    movedTaskCount: secondTasks.length,
    totalTaskCountAfterMerge: firstTasks.length + secondTasks.length,
  };
}

export function applyMergeWithNext(
  cycleSprints: ReadonlyArray<Sprint>,
  cycleTasks: ReadonlyArray<Task>,
  firstSprintId: string,
  mergedName: string,
  mergedGoal: string
): {
  keptSprints: Sprint[];
  deletedSprintId: string;
  updatedTasks: Task[];
} {
  const sorted = [...cycleSprints].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((s) => s.id === firstSprintId);
  if (idx === -1 || idx >= sorted.length - 1) {
    throw new Error('Cannot merge: next sprint does not exist.');
  }

  const first = sorted[idx];
  const second = sorted[idx + 1];
  const nowIso = new Date().toISOString();

  const mergedSprint: Sprint = {
    ...first,
    name: mergedName.trim() || first.name,
    endGoal: mergedGoal.trim(),
    startDate: first.startDate,
    endDate: second.endDate,
    updatedAt: nowIso,
  };

  const keptSprints: Sprint[] = [];
  let order = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === idx) {
      keptSprints.push({ ...mergedSprint, order });
      order += 1;
    } else if (i === idx + 1) {
      continue;
    } else {
      keptSprints.push({ ...sorted[i], order });
      order += 1;
    }
  }

  const updatedTasks = cycleTasks
    .filter((t) => t.sprintId === second.id)
    .map((t) => ({
      ...t,
      sprintId: first.id,
      updatedAt: nowIso,
    }));

  return {
    keptSprints,
    deletedSprintId: second.id,
    updatedTasks,
  };
}
