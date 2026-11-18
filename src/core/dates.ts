import type { LocalDateString } from './types';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidLocalDate(value: unknown): value is LocalDateString {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return false;
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (
    dt.getFullYear() === y &&
    dt.getMonth() === m - 1 &&
    dt.getDate() === d
  );
}

export function formatDateToLocalString(date: Date): LocalDateString {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayLocal(): LocalDateString {
  return formatDateToLocalString(new Date());
}

export function parseLocalDate(dateStr: LocalDateString): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: LocalDateString, days: number): LocalDateString {
  const dt = parseLocalDate(dateStr);
  dt.setDate(dt.getDate() + days);
  return formatDateToLocalString(dt);
}

/**
 * Signed difference in calendar days: (toDate - fromDate).
 * Uses UTC midnight of the calendar Y/M/D components to avoid DST hour shifts.
 */
export function diffDays(fromDate: LocalDateString, toDate: LocalDateString): number {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const utcFrom = Date.UTC(fy, fm - 1, fd);
  const utcTo = Date.UTC(ty, tm - 1, td);
  return Math.round((utcTo - utcFrom) / 86_400_000);
}

/**
 * Inclusive number of calendar days between startDate and endDate.
 */
export function diffDaysInclusive(startDate: LocalDateString, endDate: LocalDateString): number {
  return diffDays(startDate, endDate) + 1;
}

export function formatDisplayDate(
  dateStr: LocalDateString,
  options?: { includeYear?: boolean }
): string {
  if (!isValidLocalDate(dateStr)) return dateStr;
  const dt = parseLocalDate(dateStr);
  const currentYear = new Date().getFullYear();
  const showYear = options?.includeYear ?? dt.getFullYear() !== currentYear;
  return dt.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });
}

export function formatDateRange(
  startDate: LocalDateString,
  endDate: LocalDateString
): string {
  if (!isValidLocalDate(startDate) || !isValidLocalDate(endDate)) {
    return `${startDate} – ${endDate}`;
  }
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  const currentYear = new Date().getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const showYear = !sameYear || start.getFullYear() !== currentYear;

  const startText = start.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(!sameYear ? { year: 'numeric' } : {}),
  });
  const endText = end.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(showYear ? { year: 'numeric' } : {}),
  });

  return `${startText} – ${endText}`;
}

export function msUntilNextLocalMidnight(): number {
  const now = new Date();
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    1,
    0
  );
  return Math.max(1000, nextMidnight.getTime() - now.getTime());
}
