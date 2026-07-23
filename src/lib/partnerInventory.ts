export type PartnerInventoryOrigin = {
  id: string;
  name: string;
  initials: string;
  logoUrl?: string;
  orgId?: string;
  poolIds: string[];
  partnershipIds: string[];
  productCount?: number;
  partnership: any;
};

const firstString = (...values: unknown[]): string | undefined =>
  values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();

const candidateStrings = (...values: unknown[]): string[] =>
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

export const partnerInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'PA';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
};

const partnerNameOf = (partnership: any): string =>
  firstString(
    partnership?.partnerOrgName,
    partnership?.targetOrgName,
    partnership?.sourceOrgName,
    partnership?.partnerEmail,
  ) || 'Partner';

const partnerOrgIdOf = (partnership: any, currentOrgId?: string): string | undefined => {
  const explicit = firstString(partnership?.partnerOrgId);
  if (explicit) return explicit;

  const sourceOrgId = firstString(partnership?.sourceOrgId, partnership?.SourceOrgId);
  const targetOrgId = firstString(partnership?.targetOrgId, partnership?.TargetOrgId);
  if (sourceOrgId && sourceOrgId !== currentOrgId) return sourceOrgId;
  if (targetOrgId && targetOrgId !== currentOrgId) return targetOrgId;
  return partnership?.direction === 'received' ? sourceOrgId : targetOrgId;
};

const logoUrlOf = (record: any): string | undefined =>
  firstString(
    record?.partnerLogoUrl,
    record?.partnerOrgLogoUrl,
    record?.logoUrl,
    record?.LogoUrl,
    record?.logo,
  );

const poolIdsOf = (record: any): string[] =>
  candidateStrings(
    record?.poolId,
    record?.PoolId,
    record?.sourcePoolId,
    record?.SourcePoolId,
    record?.targetPoolId,
    record?.TargetPoolId,
    record?.assignedPoolIds,
  );

const partnershipIdsOf = (record: any): string[] =>
  candidateStrings(
    record?.id,
    record?.partnershipId,
    record?.PartnershipId,
    record?.inviteId,
    record?.InviteId,
    record?.crossOrgInviteId,
    record?.CrossOrgInviteId,
  );

/**
 * Normalizes the already-consumed partnerships and pools payloads into one
 * partner per business. Pool matching is deliberately tolerant because older
 * server responses used pool names while newer ones include ids.
 */
export const buildPartnerInventoryOrigins = (
  partnerships: any[],
  pools: any[],
  currentOrgId?: string,
): PartnerInventoryOrigin[] => {
  const byPartner = new Map<string, PartnerInventoryOrigin>();

  for (const partnership of partnerships || []) {
    if (partnership?.status === 'terminated') continue;

    const name = partnerNameOf(partnership);
    const orgId = partnerOrgIdOf(partnership, currentOrgId);
    const partnershipIds = partnershipIdsOf(partnership);
    const poolNames = new Set(
      candidateStrings(
        partnership?.poolName,
        partnership?.sourcePoolName,
        partnership?.targetPoolName,
      ).map((value) => value.toLowerCase()),
    );

    const matchingPools = (pools || []).filter((pool) => {
      const poolPartnerOrgId = firstString(pool?.partnerOrgId, pool?.sourceOrgId, pool?.targetOrgId);
      const poolPartnershipIds = partnershipIdsOf(pool);
      const poolPartnerName = firstString(pool?.partnerOrgName, pool?.partnerName);
      return (
        (!!orgId && poolPartnerOrgId === orgId) ||
        poolPartnershipIds.some((id) => partnershipIds.includes(id)) ||
        (!!pool?.name && poolNames.has(String(pool.name).toLowerCase())) ||
        (!!poolPartnerName && poolPartnerName.toLowerCase() === name.toLowerCase())
      );
    });

    const poolIds = Array.from(new Set([
      ...poolIdsOf(partnership),
      ...matchingPools.flatMap(poolIdsOf),
      ...matchingPools.flatMap((pool) => candidateStrings(pool?.id)),
    ]));
    const key = orgId ? `org:${orgId}` : `name:${name.toLowerCase()}`;
    const productCountValue = Number(partnership?.productCount);
    const productCount = Number.isFinite(productCountValue) ? productCountValue : undefined;
    const existing = byPartner.get(key);

    if (existing) {
      existing.poolIds = Array.from(new Set([...existing.poolIds, ...poolIds]));
      existing.partnershipIds = Array.from(new Set([...existing.partnershipIds, ...partnershipIds]));
      if (productCount !== undefined) existing.productCount = (existing.productCount || 0) + productCount;
      if (!existing.logoUrl) existing.logoUrl = logoUrlOf(partnership) || matchingPools.map(logoUrlOf).find(Boolean);
      continue;
    }

    byPartner.set(key, {
      id: key,
      name,
      initials: partnerInitials(name),
      logoUrl: logoUrlOf(partnership) || matchingPools.map(logoUrlOf).find(Boolean),
      orgId,
      poolIds,
      partnershipIds,
      productCount,
      partnership,
    });
  }

  return Array.from(byPartner.values()).sort((a, b) => a.name.localeCompare(b.name));
};

export const resolvePartnerInventoryOrigin = (
  link: any,
  origins: PartnerInventoryOrigin[],
  currentOrgId?: string,
): PartnerInventoryOrigin | undefined => {
  const linkPartnershipIds = partnershipIdsOf(link);
  const direct = origins.find((origin) =>
    origin.partnershipIds.some((id) => linkPartnershipIds.includes(id)),
  );
  if (direct) return direct;

  const linkOrgIds = candidateStrings(
    link?.partnerOrgId,
    link?.PartnerOrgId,
    link?.sourceOrgId,
    link?.SourceOrgId,
    link?.targetOrgId,
    link?.TargetOrgId,
  ).filter((id) => id !== currentOrgId);
  const byOrg = origins.find((origin) => !!origin.orgId && linkOrgIds.includes(origin.orgId));
  if (byOrg) return byOrg;

  const linkPoolIds = poolIdsOf(link);
  const byPool = origins.find((origin) =>
    origin.poolIds.some((id) => linkPoolIds.includes(id)),
  );
  if (byPool) return byPool;

  const linkPartnerName = firstString(link?.partnerOrgName, link?.sourceOrgName, link?.targetOrgName);
  const byName = linkPartnerName
    ? origins.find((origin) => origin.name.toLowerCase() === linkPartnerName.toLowerCase())
    : undefined;
  if (byName) return byName;

  // The link itself proves partner origin. A sole active partner is therefore
  // unambiguous even when an older link row lacks org/partnership identifiers.
  return origins.length === 1 ? origins[0] : undefined;
};
