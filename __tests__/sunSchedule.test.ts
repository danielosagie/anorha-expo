import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSunThemeState,
  scheduleNextSunBoundary,
  type SolarHoursCalculator,
} from '../src/lib/sunSchedule.ts';

const EASTERN_DAYLIGHT_OFFSET_MINUTES = -4 * 60;
const SUMMER_NOON = new Date(Date.UTC(2026, 5, 21, 16));

test('sunrise flips the sun theme from dark to light', () => {
  const schedule = getSunThemeState(SUMMER_NOON, EASTERN_DAYLIGHT_OFFSET_MINUTES);

  assert.equal(schedule.source, 'solar');
  assert.equal(
    getSunThemeState(
      new Date(schedule.sunriseAt - 1),
      EASTERN_DAYLIGHT_OFFSET_MINUTES,
    ).isDark,
    true,
  );
  assert.equal(
    getSunThemeState(
      new Date(schedule.sunriseAt),
      EASTERN_DAYLIGHT_OFFSET_MINUTES,
    ).isDark,
    false,
  );
});

test('sunset flips the sun theme from light to dark', () => {
  const schedule = getSunThemeState(SUMMER_NOON, EASTERN_DAYLIGHT_OFFSET_MINUTES);

  assert.equal(
    getSunThemeState(
      new Date(schedule.sunsetAt - 1),
      EASTERN_DAYLIGHT_OFFSET_MINUTES,
    ).isDark,
    false,
  );
  assert.equal(
    getSunThemeState(
      new Date(schedule.sunsetAt),
      EASTERN_DAYLIGHT_OFFSET_MINUTES,
    ).isDark,
    true,
  );
});

test('boundary timer fires at the computed sun boundary', () => {
  let current = SUMMER_NOON;
  const expected = getSunThemeState(current, EASTERN_DAYLIGHT_OFFSET_MINUTES);
  let scheduledDelay = -1;
  let scheduledCallback: (() => void) | null = null;
  let firedAt = -1;
  let cleared = false;

  const cancel = scheduleNextSunBoundary(
    () => {
      firedAt = current.getTime();
    },
    {
      clock: () => current,
      offsetProvider: () => EASTERN_DAYLIGHT_OFFSET_MINUTES,
      setTimer: (callback, delayMs) => {
        scheduledCallback = callback;
        scheduledDelay = delayMs;
        return 'sun-boundary';
      },
      clearTimer: (handle) => {
        assert.equal(handle, 'sun-boundary');
        cleared = true;
      },
    },
  );

  assert.equal(scheduledDelay, expected.nextBoundaryAt - current.getTime());
  current = new Date(expected.nextBoundaryAt);
  assert.ok(scheduledCallback);
  scheduledCallback();
  assert.equal(firedAt, expected.nextBoundaryAt);
  cancel();
  assert.equal(cleared, true);
});

test('error and non-finite solar results use the light 07:00 to 19:00 fallback', () => {
  const nonFiniteCalculator: SolarHoursCalculator = () => ({
    sunriseHour: NaN,
    sunsetHour: Infinity,
  });
  const throwingCalculator: SolarHoursCalculator = () => {
    throw new Error('solar calculation failed');
  };
  const midday = new Date(Date.UTC(2026, 0, 15, 12));
  const evening = new Date(Date.UTC(2026, 0, 15, 19));

  const middayState = getSunThemeState(midday, 0, { solarCalculator: nonFiniteCalculator });
  const eveningState = getSunThemeState(evening, 0, { solarCalculator: nonFiniteCalculator });
  const errorState = getSunThemeState(midday, 0, { solarCalculator: throwingCalculator });

  assert.equal(middayState.source, 'fallback');
  assert.equal(middayState.isDark, false);
  assert.equal(middayState.sunriseAt, Date.UTC(2026, 0, 15, 7));
  assert.equal(middayState.sunsetAt, Date.UTC(2026, 0, 15, 19));
  assert.equal(eveningState.isDark, true);
  assert.equal(errorState.source, 'fallback');
  assert.equal(errorState.isDark, false);
});
