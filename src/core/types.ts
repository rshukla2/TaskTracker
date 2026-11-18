export type LocalDateString = string; // YYYY-MM-DD in local calendar time

export enum EffortLevel {
  Low = 'Low',
  Medium = 'Medium',
  High = 'High',
}

export interface WorkflowStatus {
  id: string;
  name: string;
}

export interface AppSettings {
  id: 'app_settings';
  defaultStatuses: WorkflowStatus[];
  completedStatusMigrated?: boolean;
  updatedAt: string;
}

export interface WorkCycle {
  id: string;
  name: string;
  description: string;
  endGoal: string;
  startDate: LocalDateString;
  endDate: LocalDateString;
  sprintLengthDays: number;
  useCustomStatuses: boolean;
  customStatuses: WorkflowStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  workCycleId: string;
  name: string;
  endGoal: string;
  startDate: LocalDateString;
  endDate: LocalDateString;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  workCycleId: string;
  sprintId: string;
  title: string;
  description: string;
  deadline: LocalDateString | null;
  estimatedHours: number | null;
  effort: EffortLevel | null;
  statusId: string | null;
  previousStatusId?: string | null;
  blockerReason?: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WorkCycleTimeSection = 'active' | 'upcoming' | 'past';

export interface ProgressSummary {
  completed: number;
  total: number;
  percentage: number;
  isComplete: boolean;
}

export interface BackupPayloadV1 {
  app: 'task-tracker';
  schemaVersion: 1;
  exportedAt: string;
  data: {
    settings: AppSettings;
    workCycles: WorkCycle[];
    sprints: Sprint[];
    tasks: Task[];
  };
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  payload?: BackupPayloadV1;
  summary?: {
    workCyclesCount: number;
    sprintsCount: number;
    tasksCount: number;
    statusesCount: number;
    exportedAt: string;
  };
}
