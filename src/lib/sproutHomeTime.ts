export type HomeClock = () => Date;

const systemClock: HomeClock = () => new Date();

export function homeHour(clock: HomeClock = systemClock): number {
  return clock().getHours();
}

export function greetingForHour(hour: number): string {
  if (hour >= 22 || hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function greetingForClock(clock: HomeClock = systemClock): string {
  return greetingForHour(homeHour(clock));
}

export function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 5;
}

export function reportTitleForHour(hour: number): string {
  if (hour < 12) return 'Morning Report';
  if (hour < 17) return 'Midday Report';
  return 'Evening Report';
}
