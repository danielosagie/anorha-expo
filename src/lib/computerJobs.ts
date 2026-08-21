import { platformRequiresComputer, resolvePlatformKey } from '../config/platforms.ts';

export interface ComputerJobLike {
  platform?: string | null;
}

/** True when a browser job belongs to any registry platform written by computer. */
export function isComputerJob(job: ComputerJobLike): boolean {
  return platformRequiresComputer(resolvePlatformKey(job.platform) ?? job.platform);
}

/** Match a backend job spelling to one canonical computer-written platform. */
export function computerJobMatchesPlatform(
  job: ComputerJobLike,
  platform?: string | null,
): boolean {
  if (!platform) return isComputerJob(job);
  return resolvePlatformKey(job.platform) === resolvePlatformKey(platform);
}
