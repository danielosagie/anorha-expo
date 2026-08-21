import { getPlatform, getPlatformLabel } from '../config/platforms.ts';

export const computerNeedsCheckCopy = (
  platform?: string | null,
  onComputer: boolean = false,
): string => {
  const label = getPlatformLabel(platform);
  return `${label} needs a check${onComputer ? ' on your computer' : ''}`;
};

export const computerPostingSetupCopy = (platform?: string | null): string => {
  const label = getPlatform(platform)?.label;
  return label
    ? `Posting to ${label} happens through your own computer and ${label} account, so it stays safe. Set it up once and we’ll handle the rest.`
    : 'Some channels post through your own computer and account, so they stay safe. Set it up once and we’ll handle the rest.';
};

export const computerPostsViaCopy = (platform?: string | null): string =>
  `${getPlatformLabel(platform)} posts via your computer.`;
