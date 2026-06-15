import { useEffect, useState } from 'react';

// Night window shared by the home hero and the tab bar so they re-skin together.
export const isNightNow = (date: Date = new Date()): boolean => {
  const h = date.getHours();
  return h >= 22 || h < 5;
};

export function useIsNight(): boolean {
  const [night, setNight] = useState(() => isNightNow());
  useEffect(() => {
    const id = setInterval(() => setNight(isNightNow()), 60_000);
    return () => clearInterval(id);
  }, []);
  return night;
}
