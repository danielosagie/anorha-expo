// Pure helpers extracted from GenerateDetailsScreen.tsx.

type VersionEntry = {
  id: string;
  jobId: string;
  createdAt: string;
  platforms: any;
  sources?: Array<{ url: string; usedForFields?: string[] }>;
  matchJobId?: string;
  source?: string;
};

type GroupedVersionEntry = VersionEntry & { versionCount?: number; allVersions?: Array<any> };

// Group version entries by their matchJobId, returning the latest version of
// each group as the primary (with a count + the full list under allVersions).
export const groupVersionsByMatchId = (versions: Array<VersionEntry>): Array<GroupedVersionEntry> => {
  if (!Array.isArray(versions)) return [];

  // Group by match job ID
  const grouped = versions.reduce((acc, version) => {
    const key = version.matchJobId || 'no-match-id';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(version);
    return acc;
  }, {} as Record<string, typeof versions>);

  // For each group, return the latest version as primary with version count
  const result = Object.entries(grouped).map(([matchJobId, versionGroup]) => {
    // Sort by creation date (newest first)
    const sortedVersions = versionGroup.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latestVersion = sortedVersions[0];

    return {
      ...latestVersion,
      versionCount: sortedVersions.length,
      allVersions: sortedVersions // Store all versions for access
    };
  });

  // Sort results by creation date (newest first)
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};
