const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_LATITUDE = 37;
const FALLBACK_SUNRISE_HOUR = 7;
const FALLBACK_SUNSET_HOUR = 19;
const OFFICIAL_ZENITH_DEGREES = 90.833;

export type SunClock = () => Date;
export type UtcOffsetProvider = (date: Date) => number;

export type LocalDay = {
  year: number;
  month: number;
  day: number;
};

export type SolarHours = {
  sunriseHour: number;
  sunsetHour: number;
};

export type SolarHoursCalculator = (
  day: LocalDay,
  utcOffsetMinutes: number,
  latitude: number,
) => SolarHours;

export type SunThemeState = {
  nowMs: number;
  localHour: number;
  isDark: boolean;
  sunriseAt: number;
  sunsetAt: number;
  nextBoundaryAt: number;
  source: 'solar' | 'fallback';
};

type ReadSunThemeOptions = {
  clock?: SunClock;
  offsetProvider?: UtcOffsetProvider;
  latitude?: number;
  solarCalculator?: SolarHoursCalculator;
};

type BoundaryTimerOptions = ReadSunThemeOptions & {
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const systemClock: SunClock = () => new Date();
const deviceOffsetProvider: UtcOffsetProvider = (date) => -date.getTimezoneOffset();

const degreesToRadians = (degrees: number): number => degrees * Math.PI / 180;
const radiansToDegrees = (radians: number): number => radians * 180 / Math.PI;
const normalizeDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;
const normalizeHours = (hours: number): number => ((hours % 24) + 24) % 24;

const localDayAt = (timeMs: number, utcOffsetMinutes: number): LocalDay => {
  const shifted = new Date(timeMs + utcOffsetMinutes * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
};

const nextLocalDay = (day: LocalDay): LocalDay => {
  const next = new Date(Date.UTC(day.year, day.month, day.day) + DAY_MS);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth(),
    day: next.getUTCDate(),
  };
};

const localHourAt = (timeMs: number, utcOffsetMinutes: number): number =>
  new Date(timeMs + utcOffsetMinutes * MINUTE_MS).getUTCHours();

const localDayOfYear = (day: LocalDay): number =>
  Math.floor((Date.UTC(day.year, day.month, day.day) - Date.UTC(day.year, 0, 0)) / DAY_MS);

const timestampAtLocalHour = (
  day: LocalDay,
  hour: number,
  utcOffsetMinutes: number,
): number => Math.round(
  Date.UTC(day.year, day.month, day.day) + hour * HOUR_MS - utcOffsetMinutes * MINUTE_MS,
);

const noaaSolarHour = (
  day: LocalDay,
  utcOffsetMinutes: number,
  latitude: number,
  sunrise: boolean,
): number => {
  const longitude = utcOffsetMinutes / 60 * 15;
  const longitudeHour = longitude / 15;
  const approximateTime = localDayOfYear(day) + ((sunrise ? 6 : 18) - longitudeHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
    1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
    0.020 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
    282.634,
  );

  let rightAscension = normalizeDegrees(
    radiansToDegrees(Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude)))),
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(degreesToRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(degreesToRadians(OFFICIAL_ZENITH_DEGREES)) -
    sinDeclination * Math.sin(degreesToRadians(latitude))
  ) / (cosDeclination * Math.cos(degreesToRadians(latitude)));

  if (!Number.isFinite(cosHourAngle) || cosHourAngle < -1 || cosHourAngle > 1) {
    return NaN;
  }

  const hourAngleDegrees = sunrise
    ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
    : radiansToDegrees(Math.acos(cosHourAngle));
  const localMeanTime =
    hourAngleDegrees / 15 + rightAscension - 0.06571 * approximateTime - 6.622;
  const utcHour = normalizeHours(localMeanTime - longitudeHour);
  return normalizeHours(utcHour + utcOffsetMinutes / 60);
};

export const calculateNoaaSolarHours: SolarHoursCalculator = (
  day,
  utcOffsetMinutes,
  latitude,
) => ({
  sunriseHour: noaaSolarHour(day, utcOffsetMinutes, latitude, true),
  sunsetHour: noaaSolarHour(day, utcOffsetMinutes, latitude, false),
});

const validOffset = (utcOffsetMinutes: number): boolean =>
  Number.isFinite(utcOffsetMinutes) && Math.abs(utcOffsetMinutes) <= 14 * 60;

const validSolarHour = (hour: number): boolean =>
  Number.isFinite(hour) && hour >= 0 && hour < 24;

const safeFallbackOffset = (now: Date, utcOffsetMinutes: number): number => {
  if (validOffset(utcOffsetMinutes)) return utcOffsetMinutes;
  const deviceOffset = -now.getTimezoneOffset();
  return validOffset(deviceOffset) ? deviceOffset : 0;
};

const fallbackThemeState = (now: Date, utcOffsetMinutes: number): SunThemeState => {
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const offset = safeFallbackOffset(now, utcOffsetMinutes);
  const today = localDayAt(nowMs, offset);
  const tomorrow = nextLocalDay(today);
  const sunriseAt = timestampAtLocalHour(today, FALLBACK_SUNRISE_HOUR, offset);
  const sunsetAt = timestampAtLocalHour(today, FALLBACK_SUNSET_HOUR, offset);
  const isDark = nowMs < sunriseAt || nowMs >= sunsetAt;
  const nextBoundaryAt = nowMs < sunriseAt
    ? sunriseAt
    : nowMs < sunsetAt
      ? sunsetAt
      : timestampAtLocalHour(tomorrow, FALLBACK_SUNRISE_HOUR, offset);

  return {
    nowMs,
    localHour: localHourAt(nowMs, offset),
    isDark,
    sunriseAt,
    sunsetAt,
    nextBoundaryAt,
    source: 'fallback',
  };
};

export function getSunThemeState(
  now: Date,
  utcOffsetMinutes: number,
  options: Pick<ReadSunThemeOptions, 'latitude' | 'solarCalculator'> = {},
): SunThemeState {
  if (!Number.isFinite(now.getTime()) || !validOffset(utcOffsetMinutes)) {
    return fallbackThemeState(now, utcOffsetMinutes);
  }

  const latitude = options.latitude ?? DEFAULT_LATITUDE;
  const solarCalculator = options.solarCalculator ?? calculateNoaaSolarHours;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return fallbackThemeState(now, utcOffsetMinutes);
  }

  try {
    const nowMs = now.getTime();
    const today = localDayAt(nowMs, utcOffsetMinutes);
    const tomorrow = nextLocalDay(today);
    const todayHours = solarCalculator(today, utcOffsetMinutes, latitude);
    const tomorrowHours = solarCalculator(tomorrow, utcOffsetMinutes, latitude);
    if (
      !validSolarHour(todayHours.sunriseHour) ||
      !validSolarHour(todayHours.sunsetHour) ||
      !validSolarHour(tomorrowHours.sunriseHour)
    ) {
      return fallbackThemeState(now, utcOffsetMinutes);
    }

    const sunriseAt = timestampAtLocalHour(today, todayHours.sunriseHour, utcOffsetMinutes);
    const sunsetAt = timestampAtLocalHour(today, todayHours.sunsetHour, utcOffsetMinutes);
    const tomorrowSunriseAt = timestampAtLocalHour(
      tomorrow,
      tomorrowHours.sunriseHour,
      utcOffsetMinutes,
    );
    if (
      !Number.isFinite(sunriseAt) ||
      !Number.isFinite(sunsetAt) ||
      !Number.isFinite(tomorrowSunriseAt) ||
      sunriseAt >= sunsetAt ||
      tomorrowSunriseAt <= sunsetAt
    ) {
      return fallbackThemeState(now, utcOffsetMinutes);
    }

    const isDark = nowMs < sunriseAt || nowMs >= sunsetAt;
    const nextBoundaryAt = nowMs < sunriseAt
      ? sunriseAt
      : nowMs < sunsetAt
        ? sunsetAt
        : tomorrowSunriseAt;

    return {
      nowMs,
      localHour: localHourAt(nowMs, utcOffsetMinutes),
      isDark,
      sunriseAt,
      sunsetAt,
      nextBoundaryAt,
      source: 'solar',
    };
  } catch {
    return fallbackThemeState(now, utcOffsetMinutes);
  }
}

export function readSunThemeState(options: ReadSunThemeOptions = {}): SunThemeState {
  let now: Date;
  try {
    now = options.clock?.() ?? systemClock();
  } catch {
    now = systemClock();
  }

  let utcOffsetMinutes = NaN;
  try {
    utcOffsetMinutes = (options.offsetProvider ?? deviceOffsetProvider)(now);
  } catch {
    utcOffsetMinutes = NaN;
  }

  return getSunThemeState(now, utcOffsetMinutes, options);
}

export function scheduleNextSunBoundary(
  onBoundary: () => void,
  options: BoundaryTimerOptions = {},
): () => void {
  try {
    const state = readSunThemeState(options);
    const delayMs = Math.max(1, state.nextBoundaryAt - state.nowMs);
    if (!Number.isFinite(delayMs)) return () => undefined;

    const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    const clearTimer = options.clearTimer ?? ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
    const handle = setTimer(() => {
      try {
        onBoundary();
      } catch {
        // Theme scheduling is fail-open.
      }
    }, delayMs);

    return () => {
      try {
        clearTimer(handle);
      } catch {
        // Theme scheduling is fail-open.
      }
    };
  } catch {
    return () => undefined;
  }
}
