export type BackendPacingMode = 'conservative' | 'balanced' | 'aggressive';

const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfLocalDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const addCalendarDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const calendarDaysBetween = (from: Date, to: Date): number =>
  Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / DAY_MS);

/**
 * The backend still requires its legacy pacing field. Deadlines within 7 days
 * are aggressive, 8 to 30 days are balanced, and 31 days or more are conservative.
 */
export function deriveCampaignPacing(sellByDate: Date, fromDate: Date = new Date()): BackendPacingMode {
  const daysLeft = calendarDaysBetween(fromDate, sellByDate);
  if (daysLeft <= 7) return 'aggressive';
  if (daysLeft <= 30) return 'balanced';
  return 'conservative';
}

export function describeCampaignDuration(days: number): string {
  if (days < -1) return `Ended ${Math.abs(days)} days ago`;
  if (days === -1) return 'Ended yesterday';
  if (days === 0) return 'Run today';
  if (days === 1) return 'Run for 1 day';
  if (days < 14) return `Run for ${days} days`;

  if (days < 56) {
    const weeks = Math.max(2, Math.round(days / 7));
    return `Run for ${weeks} weeks`;
  }

  const months = Math.max(2, Math.round(days / 30.4375));
  return `Run for ${months} months`;
}

export function campaignSellByDate(createdAt: string | Date | undefined, timeframeDays: number): Date {
  const parsed = createdAt instanceof Date ? createdAt : new Date(createdAt || '');
  const start = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return addCalendarDays(startOfLocalDay(start), Math.max(0, timeframeDays || 0));
}

export function formatSellByDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}
