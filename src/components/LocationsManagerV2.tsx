import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Modal,
  Dimensions,
  Clipboard,
  Switch,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import Card from './Card';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = 'https://api.sssync.app';

const PLATFORM_LOGOS: Record<string, any> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
};


type ViewMode = 'default' | 'managePools' | 'createLocation' | 'createPool' | 'partners' | 'invitePartner';
type ManageTab = 'location' | 'pool';

interface Partnership {
  id: string;
  partnerOrgName: string;
  partnerEmail: string;
  poolName: string;
  productCount: number;
  status: 'active' | 'pending';
  createdAt: string;
}

interface PendingInvite {
  id: string;
  email: string;
  poolName: string;
  expiresAt: string;
  inviteLink: string;
}



interface LocationsManagerV2Props {
  orgId?: string;
  platformConnections: Array<{
    Id: string;
    PlatformType: string;
    DisplayName: string;
    Status?: string;
    IsEnabled?: boolean;
  }>;
  disableScroll?: boolean;
  onPressConnect?: () => void;
}

interface LocationPool {
  id: string;
  name: string;
  description?: string;
  locationIds?: string[];
}

interface AvailablePlatformGroup {
  platformType: string;
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{
      id: string;
      name: string;
      timezone?: string;
    }>;
  }>;
}

interface TransformedLocationGroup {
  platformType: string;
  connections: Array<{
    connectionId: string;
    connectionName: string;
    locations: Array<{
      platformLocationId: string;
      locationName: string;
      timezone?: string;
    }>;
  }>;
}

interface PoolLocation {
  platformLocationId: string;
  locationName: string;
  timezone?: string;
  platformConnection: {
    id: string;
    platformType: string;
    displayName: string;
  };
}

interface DbPlatformLocation {
  PlatformConnectionId: string;
  PlatformLocationId: string;
  Name: string | null;
}

interface LocationMetadata {
  platformLocationId: string;
  locationName: string;
  connectionName: string;
  platformType: string;
  timezone?: string;
}

interface DraftPool {
  name: string;
  locationIds: string[];
  locationMetadata?: Map<string, LocationMetadata>;
}

interface DeletePoolState {
  loading: boolean;
}

// Internal component for Pool Accordion Item
// Internal component for Pool Accordion Item
const PoolAccordionItem = ({
  pool,
  onToggle,
  isExpanded,
  locationMetadataMap,
  onPressManage,
  onDelete
}: {
  pool: LocationPool,
  onToggle: () => void,
  isExpanded: boolean,
  locationMetadataMap: Map<string, any>,
  onPressManage: () => void,
  onDelete: () => void
}) => {
  const theme = useTheme();

  const locationCount = pool.locationIds?.length || 0;
  const isEmpty = locationCount === 0;

  // Deduplicate platform types for the closed state icons
  const platformTypes = useMemo(() => {
    const types = new Set<string>();
    pool.locationIds?.forEach(id => {
      const meta = locationMetadataMap.get(id);
      if (meta?.platformType) types.add(meta.platformType);
    });
    return Array.from(types);
  }, [pool.locationIds, locationMetadataMap]);

  return (
    <View style={[styles.accordionContainer, isEmpty && { opacity: 0.8 }]}>
      <TouchableOpacity
        style={[
          styles.accordionHeader,
          isExpanded && !isEmpty && styles.accordionHeaderOpen
        ]}
        onPress={isEmpty ? undefined : onToggle}
        activeOpacity={isEmpty ? 1 : 0.7}
      >
        <View style={styles.accordionHeaderLeft}>
          <Text style={styles.accordionTitle}>{pool.name}</Text>
        </View>
        <View style={styles.accordionHeaderRight}>
          <View style={styles.accordionBadge}>
            <Text style={styles.accordionBadgeText}>({locationCount})</Text>
            <View style={styles.accordionIcons}>
              {platformTypes.map(type => {
                const Logo = PLATFORM_LOGOS[type as keyof typeof PLATFORM_LOGOS];
                return Logo ? <Logo key={type} width={14} height={14} style={{ marginLeft: 4 }} /> : null;
              })}
            </View>
          </View>

          {!isEmpty && (
            <View style={{ marginLeft: 8 }}>
              {isExpanded ? (
                <Icon name="chevron-up" size={24} color="#666" />
              ) : (
                <Icon name="chevron-down" size={24} color="#666" />
              )}
            </View>
          )}
        </View>
      </TouchableOpacity>

      {isExpanded && !isEmpty && (
        <View style={styles.accordionContent}>
          {pool.locationIds?.map(locId => {
            const meta = locationMetadataMap.get(locId);
            const Logo = meta?.platformType ? PLATFORM_LOGOS[meta.platformType as keyof typeof PLATFORM_LOGOS] : null;

            return (
              <View key={locId} style={styles.accordionItemRow}>
                <Text style={styles.accordionItemText}>{meta?.locationName || locId}</Text>
                {Logo && <Logo width={16} height={16} />}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const PartnerWelcomeOverlay: React.FC<{
  visible: boolean;
  partnerName: string;
  onConnect: () => void;
}> = ({ visible, partnerName, onConnect }) => {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.7)',
        justifyContent: 'center',
        padding: 20,
      }}>
        <View style={{
          backgroundColor: '#fff',
          borderRadius: 24,
          padding: 32,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 10,
          elevation: 10,
        }}>
          <View style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            backgroundColor: '#e6f4ea',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}>
            <Icon name="handshake" size={40} color="#647653" />
          </View>

          <Text style={{
            fontSize: 24,
            fontWeight: 'bold',
            textAlign: 'center',
            marginBottom: 12,
            color: '#111',
          }}>
            Welcome to {partnerName}'s Network!
          </Text>

          <Text style={{
            fontSize: 16,
            color: '#666',
            textAlign: 'center',
            lineHeight: 24,
            marginBottom: 32,
          }}>
            To start selling these products, you need to connect your own POS or E-commerce platform.
          </Text>

          <TouchableOpacity
            onPress={onConnect}
            style={{
              backgroundColor: '#93C822',
              paddingVertical: 16,
              paddingHorizontal: 32,
              borderRadius: 12,
              width: '100%',
              alignItems: 'center',
              shadowColor: '#93C822',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Text style={{
              color: '#fff',
              fontSize: 18,
              fontWeight: 'bold',
            }}>
              Connect Platform
            </Text>
          </TouchableOpacity>

          <View style={{ marginTop: 24, flexDirection: 'row', gap: 12, opacity: 0.6 }}>
            <ShopifySvg width={24} height={24} />
            <SquareSvg width={24} height={24} />
            <CloverSvg width={24} height={24} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const LocationsManagerV2: React.FC<LocationsManagerV2Props> = ({ orgId, platformConnections, disableScroll = false, onPressConnect }) => {
  const theme = useTheme();
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [partnerNameForOverlay, setPartnerNameForOverlay] = useState('');

  // Accordion state
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());

  // View mode state machine
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [manageTab, setManageTab] = useState<ManageTab>('pool');
  // Sub-tab for default view: 'locations' | 'partners'
  const [activeTab, setActiveTab] = useState<'locations' | 'partners'>('locations');

  // List state (top card)
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pools, setPools] = useState<LocationPool[]>([]);
  const [singleLocations, setSingleLocations] = useState<DbPlatformLocation[]>([]);
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [selectedListItem, setSelectedListItem] = useState<{ kind: 'pool' | 'single' | null; id?: string | null }>({ kind: null, id: null });
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(orgId || null);

  // Implicit Detection of FTUX Partner
  useEffect(() => {
    // Only run if we have loaded partnerships and it's not empty
    if (!isLoading && partnerships.length > 0) {
      // Check if user has NO active working connections
      const hasWorkingConnection = platformConnections.some(c =>
        ['active', 'ready_to_sync', 'scanning', 'syncing'].includes(c.Status?.toLowerCase() || '')
      );

      if (!hasWorkingConnection) {
        // Get the partner name from the first partnership
        const firstPartner = partnerships[0];
        setPartnerNameForOverlay(firstPartner.partnerOrgName || firstPartner.partnerEmail);
        setShowWelcomeOverlay(true);
      }
    }
  }, [isLoading, partnerships, platformConnections]);

  // Available locations for creating/editing pools
  const [available, setAvailable] = useState<TransformedLocationGroup[]>([]);

  // Draft pools for manage mode (per-pool editing)
  const [draftPools, setDraftPools] = useState<Record<string, DraftPool>>({});

  // For create new location/pool
  const [newPoolName, setNewPoolName] = useState('');
  const [newPoolLocations, setNewPoolLocations] = useState<Record<string, string[]>>({});

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePoolId, setInvitePoolId] = useState('');
  const [inviteCanRevoke, setInviteCanRevoke] = useState(true); // Default: consignment mode
  const [isInviting, setIsInviting] = useState(false);

  // Loading and saving states
  const [loadingManage, setLoadingManage] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete modal state
  const [deleteState, setDeleteState] = useState<DeletePoolState>({
    visible: false,
    poolId: null,
    mergeTarget: null,
    availablePools: [],
    loading: false,
  });

  // State for platform/location selection in create mode (single/pool)
  const [selectedPlatformForManage, setSelectedPlatformForManage] = useState<{
    connectionId: string;
    connectionName: string;
    platformType: string;
  } | null>(null);

  // Per-pool platform selection in manage mode
  const [managePlatformSelectionByPool, setManagePlatformSelectionByPool] = useState<
    Record<
      string,
      {
        connectionId: string;
        connectionName: string;
        platformType: string;
      } | null
    >
  >({});

  // Track drag state for cross-pool dragging
  const [draggedLocation, setDraggedLocation] = useState<{
    locationId: string;
    sourcePoolId: string;
    metadata: LocationMetadata | null;
  } | null>(null);

  const connectionIds = useMemo(() => platformConnections?.map((c) => c.Id) || [], [platformConnections]);

  const connectionById = useMemo(() => {
    const map = new Map<string, { Id: string; PlatformType: string; DisplayName: string }>();
    for (const c of platformConnections || []) map.set(c.Id, c as any);
    return map;
  }, [platformConnections]);

  // Transform API response from Record<connId, {...}> to the grouped format we need
  const transformAvailableLocations = (record: Record<string, any>): TransformedLocationGroup[] => {
    const byPlatform = new Map<string, TransformedLocationGroup>();

    // Handle empty object or null
    if (!record || Object.keys(record).length === 0) {
      // console.log('[LocationsManagerV2] No available locations (empty record)');
      return [];
    }

    for (const [connId, connData] of Object.entries(record)) {
      if (!connData) continue;

      const platformType = connData.platformType?.toLowerCase();
      if (!platformType) continue;

      if (!byPlatform.has(platformType)) {
        byPlatform.set(platformType, {
          platformType,
          connections: [],
        });
      }

      const group = byPlatform.get(platformType)!;

      // Only add if there are locations
      const locations = connData.locations || [];
      if (locations.length > 0) {
        group.connections.push({
          connectionId: connId,
          connectionName: connData.connectionName,
          locations: locations.map((loc: any) => ({
            platformLocationId: loc.platformLocationId,
            locationName: loc.locationName,
            timezone: loc.timezone,
          })),
        });
      }
    }

    const result = Array.from(byPlatform.values());
    console.log('[LocationsManagerV2] Transformed locations:', result.length, 'platforms');
    return result;
  };

  // Load available locations for creating/editing
  const loadAvailableLocations = useCallback(async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!resolvedOrgId) {
        console.log('[LocationsManagerV2] No org ID, skipping locations load');
        setAvailable([]);
        return;
      }
      // console.log('[LocationsManagerV2] Loading available locations for org:', resolvedOrgId);
      const r = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        const errorText = await r.text();
        // console.warn(`Failed to load locations: ${r.status} - ${errorText}`);
        return; // Don't throw for background loading in Default view
      }
      const rawRecord: Record<string, any> = await r.json();
      const transformed = transformAvailableLocations(rawRecord);
      setAvailable(transformed);
    } catch (e) {
      console.error('[LocationsManagerV2] loadAvailableLocations error', e);
      setAvailable([]);
    }
  }, [resolvedOrgId]);

  const loadList = useCallback(async () => {
    // If no org ID yet, just ensure we're not loading forever
    if (!resolvedOrgId) {
      if (isLoading) setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const token = await ensureSupabaseJwt();

      // Load available locations FIRST (for metadata)
      // We do this in parallel or before to ensure we have data for the UI
      loadAvailableLocations();

      // Load pools, partnerships, invites, and members in parallel
      const headers = { Authorization: `Bearer ${token}` };

      console.log('[LocationsManagerV2] Fetching data for org:', resolvedOrgId);

      const [poolsRes, partnersRes, invitesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, { headers }),
        fetch(`${API_BASE_URL}/api/cross-org/partnerships?orgId=${resolvedOrgId}`, { headers }).catch(e => { console.error('Partners fetch failed', e); return null; }),
        fetch(`${API_BASE_URL}/api/cross-org/invites/pending?orgId=${resolvedOrgId}`, { headers }).catch(e => { console.error('Invites fetch failed', e); return null; }),
      ]);

      // Handle Pools
      if (poolsRes.ok) {
        const poolData = await poolsRes.json();
        setPools(Array.isArray(poolData) ? poolData : []);
      } else {
        console.error('[LocationsManagerV2] Pools fetch failed', poolsRes.status, await poolsRes.text());
        setPools([]);
      }

      // Handle Partnerships
      if (partnersRes?.ok) {
        const data = await partnersRes.json();
        setPartnerships(data.partnerships || []);
      } else {
        if (partnersRes) console.error('[LocationsManagerV2] Partners fetch failed', partnersRes.status);
        setPartnerships([]);
      }

      // Handle Invites
      if (invitesRes?.ok) {
        const data = await invitesRes.json();
        setPendingInvites(data.sent || []);
      } else {
        if (invitesRes) console.error('[LocationsManagerV2] Invites fetch failed', invitesRes.status);
        setPendingInvites([]);
      }

      // Load single platform locations directly from DB (fast path)
      if (connectionIds.length > 0) {
        const { data: platformLocs } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);
        setSingleLocations(platformLocs || []);
      } else {
        setSingleLocations([]);
      }
    } catch (e) {
      console.error('[LocationsManagerV2] loadList error', e);
      Alert.alert('Error', 'Failed to load locations');
      setPools([]);
      setSingleLocations([]);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedOrgId, connectionIds, loadAvailableLocations]);

  // Sync prop to state
  useEffect(() => {
    if (orgId && orgId !== resolvedOrgId) {
      setResolvedOrgId(orgId);
    }
  }, [orgId, resolvedOrgId]);

  // Trigger load on change
  useEffect(() => {
    loadList();
  }, [loadList]);

  const sendPartnerInvite = async () => {
    if (!inviteEmail || !invitePoolId || !resolvedOrgId) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsInviting(true);
    try {
      const token = await ensureSupabaseJwt();
      const res = await fetch(`${API_BASE_URL}/api/cross-org/invites`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inviteeEmail: inviteEmail,
          poolId: invitePoolId,
          shareType: inviteCanRevoke ? 'consignment' : 'sync',
          syncDirection: 'bidirectional',
          canRevoke: inviteCanRevoke,
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[LocationsManagerV2] Invite failed:', res.status, errText);
        throw new Error(`Failed to send invite: ${errText || res.status}`);
      }

      const { inviteLink } = await res.json();
      Clipboard.setString(inviteLink);
      Alert.alert('Success', 'Invite sent! Link copied to clipboard.');
      setInviteEmail('');
      setInvitePoolId('');
      setInviteCanRevoke(true); // Reset to default
      setViewMode('default');
      loadList(); // Refresh
    } catch (e: any) {
      console.error('[LocationsManagerV2] sendPartnerInvite error', e);
      Alert.alert('Error', e.message || 'Failed to send invite');
    } finally {
      setIsInviting(false);
    }
  };



  // Load an existing pool and its locations for editing
  const loadPoolForEditing = useCallback(
    async (poolId: string) => {
      try {
        const token = await ensureSupabaseJwt();
        const r = await fetch(`${API_BASE_URL}/api/pools/${poolId}/locations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error('Failed to load pool');
        const j = await r.json();
        const pool: LocationPool = j.pool;
        const locations: PoolLocation[] = j.locations || [];

        // Build location metadata map for quick lookup
        const locationMetadata = new Map<string, LocationMetadata>();
        for (const loc of locations) {
          locationMetadata.set(loc.platformLocationId, {
            platformLocationId: loc.platformLocationId,
            locationName: loc.locationName || loc.platformLocationId,
            connectionName: loc.platformConnection.displayName || 'Unknown connection',
            platformType: loc.platformConnection.platformType?.toLowerCase() || '',
            timezone: loc.timezone,
          });
        }

        setDraftPools((prev) => ({
          ...prev,
          [poolId]: {
            name: pool.name,
            locationIds: pool.locationIds || [],
            locationMetadata,
          },
        }));
      } catch (e) {
        console.error('[LocationsManagerV2] loadPoolForEditing error', e);
        Alert.alert('Error', 'Failed to load pool details');
      }
    },
    []
  );

  // Enter manage mode: load all pools and their locations
  const enterManageMode = async () => {
    setLoadingManage(true);
    try {
      const token = await ensureSupabaseJwt();

      // Load available locations FIRST
      console.log('[LocationsManagerV2] enterManageMode: loading available locations');
      await loadAvailableLocations();

      if (!resolvedOrgId) return;

      // Load all pools and prepare drafts
      console.log('[LocationsManagerV2] enterManageMode: loading pools for org', resolvedOrgId);
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load pools');
      const poolList: LocationPool[] = await res.json();
      console.log('[LocationsManagerV2] enterManageMode: found', poolList.length, 'pools');

      // Load each pool's locations with metadata
      // loadPoolForEditing will set the drafts with metadata via setDraftPools
      for (const pool of poolList) {
        await loadPoolForEditing(pool.id);
      }

      // Reset per-pool platform selection state (all closed by default)
      setManagePlatformSelectionByPool({});

      setViewMode('managePools');
    } catch (e) {
      console.error('[LocationsManagerV2] enterManageMode error', e);
      Alert.alert('Error', 'Failed to load managing view');
    } finally {
      setLoadingManage(false);
    }
  };

  // Enter create location/pool mode - default to location tab
  const enterCreateMode = async () => {
    setManageTab('location');
    setNewPoolName('');
    setNewPoolLocations({});
    setCreateAddPlatformMode(false);
    setSelectedPlatformForManage(null);
    setActiveCreateDropdownConnId(null);
    await loadAvailableLocations();
    setViewMode('createLocation');
  };

  // Switch from create location to create pool (when user clicks "Add Another Location")
  const switchToCreatePool = () => {
    setManageTab('pool');
    setViewMode('createPool');
  };

  // Toggle location selection in create/edit forms (supports multi-select per connection)
  const toggleLocationSelection = (
    mode: 'create' | 'edit',
    connectionId: string,
    platformLocationId: string
  ) => {
    if (mode === 'create') {
      setNewPoolLocations((prev) => {
        const current = prev[connectionId] || [];
        const idx = current.indexOf(platformLocationId);
        if (idx >= 0) {
          return {
            ...prev,
            [connectionId]: current.filter((_, i) => i !== idx),
          };
        } else {
          return {
            ...prev,
            [connectionId]: [...current, platformLocationId],
          };
        }
      });
    } else {
      // For edit, we update the draft pool's locationIds
      // This is handled per pool in the manage view
    }
  };

  // Confirm all changes in manage mode and save pools
  const confirmManageChanges = async () => {
    try {
      setSaving(true);
      const token = await ensureSupabaseJwt();

      // For each modified draft, call PATCH /api/pools/:id
      for (const [poolId, draft] of Object.entries(draftPools)) {
        const currentPool = pools.find((p) => p.id === poolId);
        if (!currentPool) continue;

        // Only save if something changed
        if (draft.name !== currentPool.name || JSON.stringify(draft.locationIds) !== JSON.stringify(currentPool.locationIds)) {
          const res = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: draft.name,
              location_ids: draft.locationIds,
            }),
          });
          if (!res.ok) {
            let errorMessage = `Failed to update pool ${poolId}`;
            try {
              const errorData = await res.json();
              // Extract detailed error message
              if (errorData.message) {
                errorMessage = errorData.message;
              } else if (errorData.error) {
                errorMessage = errorData.error;
              } else if (typeof errorData === 'string') {
                errorMessage = errorData;
              }

              // Add status code for context
              errorMessage = `[${res.status}] ${errorMessage}`;

              // If it's a validation error, add more context
              if (res.status === 400 && errorData.message?.includes('does not belong')) {
                errorMessage = `Validation Error: ${errorData.message}\n\nThis usually means a location's connection doesn't belong to your organization. Please check your platform connections and ensure they're properly linked to your organization.`;
              } else if (res.status === 400 && (errorData.message?.includes('duplicate') || errorData.message?.includes('unique') || errorData.message?.includes('constraint') || errorData.message?.includes('INSERT'))) {
                errorMessage = `Database Constraint Error: ${errorData.message}\n\nThis usually means:\n• A location already exists in the database\n• There's a conflict with location IDs\n\nTry refreshing the page and ensuring all locations belong to your organization's connections.`;
              } else if (res.status === 400) {
                errorMessage = `Bad Request: ${errorData.message}\n\nPlease verify that:\n• All locations belong to your organization\n• Platform connections are properly configured\n• No duplicate locations are selected`;
              } else if (res.status === 500) {
                errorMessage = `Server Error: ${errorData.message || 'An unexpected error occurred on the server'}\n\nPlease try again. If the issue persists, contact support with the error details.`;
              } else if (res.status === 401 || res.status === 403) {
                errorMessage = `Authentication Error: ${errorData.message || 'You may not have permission to update this pool'}\n\nPlease check your login status and try again.`;
              }
            } catch (parseError) {
              // If JSON parsing fails, try to get text
              try {
                const errorText = await res.text();
                if (errorText) {
                  errorMessage = `[${res.status}] ${errorText}`;
                }
              } catch {
                // Fall back to default message
              }
            }
            throw new Error(errorMessage);
          }
        }
      }

      // Reload list and exit manage mode
      await loadList();
      setViewMode('default');
      setDraftPools({});
    } catch (e) {
      console.error('[LocationsManagerV2] confirmManageChanges error', e);
      const errorMessage = e instanceof Error ? e.message : 'Failed to save changes';
      Alert.alert(
        'Failed to Save Changes',
        errorMessage,
        [{ text: 'OK' }]
      );
    } finally {
      setSaving(false);
    }
  };

  // Create new pool or location
  const confirmCreate = async (overrideName?: string) => {
    try {
      setSaving(true);
      const token = await ensureSupabaseJwt();

      if (!resolvedOrgId) throw new Error('No organization');

      const nameToUse = (overrideName ?? newPoolName).trim();
      if (!nameToUse) throw new Error('Name is required');

      // Collect all selected locations
      const allLocationIds: string[] = [];
      for (const locIds of Object.values(newPoolLocations)) {
        allLocationIds.push(...locIds);
      }

      if (allLocationIds.length === 0) throw new Error('Select at least one location');

      const res = await fetch(`${API_BASE_URL}/api/pools`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: resolvedOrgId,
          name: nameToUse,
          syncInventory: true,
          syncPricing: true,
          location_ids: allLocationIds,
        }),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(error || 'Failed to create pool');
      }

      // Reset and reload
      setNewPoolName('');
      setNewPoolLocations({});
      await loadList();
      setViewMode('default');
    } catch (e) {
      console.error('[LocationsManagerV2] confirmCreate error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to create pool');
    } finally {
      setSaving(false);
    }
  };

  // NEW: Load available pools for merge target selection
  const loadAvailablePoolsForDelete = useCallback(async (excludePoolId: string) => {
    try {
      const token = await ensureSupabaseJwt();
      if (!resolvedOrgId) return [];

      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to load pools for delete');

      const poolData: LocationPool[] = await res.json();
      const filteredPools = (Array.isArray(poolData) ? poolData : []).filter(p => p.id !== excludePoolId);

      setDeleteState(prev => ({ ...prev, availablePools: filteredPools }));
      return filteredPools;
    } catch (e) {
      console.error('[LocationsManagerV2] loadAvailablePoolsForDelete error', e);
      setDeleteState(prev => ({ ...prev, availablePools: [] }));
      return [];
    }
  }, [resolvedOrgId]);

  // NEW: Handle pool delete confirmation
  const confirmDeletePool = async () => {
    if (!deleteState.poolId || !resolvedOrgId || deleteState.mergeTarget === null) {
      Alert.alert('Error', 'Invalid delete state');
      return;
    }

    setDeleteState(prev => ({ ...prev, loading: true }));

    try {
      const token = await ensureSupabaseJwt();

      const res = await fetch(`${API_BASE_URL}/api/pools/${deleteState.poolId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mergeIntoPoolId: deleteState.mergeTarget === 'none' ? undefined : deleteState.mergeTarget
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Delete failed: ${res.status} - ${errorText}`);
      }

      Alert.alert('Success', 'Pool deleted successfully');
      setDeleteState({ visible: false, poolId: null, mergeTarget: null, availablePools: [], loading: false });
      await loadList(); // Refresh the list
    } catch (e) {
      console.error('[LocationsManagerV2] deletePool error', e);
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete pool');
      setDeleteState(prev => ({ ...prev, loading: false }));
    }
  };

  // NEW: Open delete confirmation for a pool (modal only, no Alert)
  const openDeletePool = async (poolId: string, poolName: string) => {
    const availablePools = await loadAvailablePoolsForDelete(poolId);
    const defaultMergeTarget = availablePools.length > 0 ? availablePools[0].id : 'none';

    setDeleteState({
      visible: true,
      poolId,
      mergeTarget: defaultMergeTarget, // Default to first available pool or 'none'
      availablePools,
      loading: false,
    });
    // Modal handles confirmation - no Alert.alert needed
  };

  const renderListItemRight = (platformType?: string) => {
    if (!platformType) return null;
    const Logo = PLATFORM_LOGOS[platformType as keyof typeof PLATFORM_LOGOS];
    if (!Logo) return null;
    return <Logo width={16} height={16} />;
  };

  const groupedSingleLocations = useMemo(() => {
    // Calculate filter set: all locations currently in any pool
    const pooledLocationIds = new Set<string>();
    for (const pool of pools) {
      if (pool.locationIds) {
        for (const locId of pool.locationIds) {
          pooledLocationIds.add(locId);
        }
      }
    }

    // Filter out pooled locations from singleLocations
    const availableSingle = singleLocations.filter(
      l => !pooledLocationIds.has(l.PlatformLocationId)
    );

    const items = availableSingle.map((l) => ({
      id: l.PlatformLocationId,
      name: l.Name || 'Unnamed Location',
      platformType: connectionById.get(l.PlatformConnectionId)?.PlatformType?.toLowerCase(),
    }));

    // Deduplicate logic (existing)
    const keySet = new Set<string>();
    const out: { id: string; name: string; platformType?: string }[] = [];
    for (const it of items) {
      const k = `${it.platformType}:${it.name}`;
      if (keySet.has(k)) continue;
      keySet.add(k);
      out.push(it);
    }
    return out;
  }, [singleLocations, connectionById, pools]);

  // Fast lookup for available locations by platformLocationId
  const availableLocationById = useMemo(() => {
    const map = new Map<
      string,
      {
        platformLocationId: string;
        locationName: string;
        timezone?: string;
        connectionName?: string;
        platformType?: string;
      }
    >();

    for (const platform of available) {
      for (const conn of platform.connections) {
        for (const loc of conn.locations) {
          map.set(loc.platformLocationId, {
            platformLocationId: loc.platformLocationId,
            locationName: loc.locationName,
            timezone: loc.timezone,
            connectionName: conn.connectionName,
            platformType: platform.platformType,
          });
        }
      }
    }

    return map;
  }, [available]);

  // Get all currently selected location IDs across all pools (for filtering)
  const allSelectedLocationIds = useMemo(() => {
    const selected = new Set<string>();
    for (const draft of Object.values(draftPools)) {
      for (const locId of draft.locationIds || []) {
        selected.add(locId);
      }
    }
    return selected;
  }, [draftPools]);

  // Filter available locations to exclude already-selected ones
  const getFilteredAvailableLocations = useCallback((connectionId: string) => {
    const connection = available
      .flatMap((p) => p.connections)
      .find((c) => c.connectionId === connectionId);

    if (!connection) return [];

    return connection.locations.filter(
      (loc) => !allSelectedLocationIds.has(loc.platformLocationId)
    );
  }, [available, allSelectedLocationIds]);


  // Render the appropriate view based on viewMode
  const renderView = () => {
    if (viewMode === 'default') {
      return renderDefaultView();
    } else if (viewMode === 'managePools') {
      return renderManagePoolsView();
    } else if (viewMode === 'createLocation') {
      return renderCreateLocationView();
    } else if (viewMode === 'createPool') {
      return renderCreatePoolView();
    } else if (viewMode === 'invitePartner') {
      return renderInvitePartnerView();
    }
    return null;
  };

  // Render invite partner screen
  const renderInvitePartnerView = () => (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => setViewMode('default')} style={styles.backBtn}>
          <Icon name="arrow-left" size={24} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Invite Partner</Text>
      </View>

      <View style={{ padding: 16 }}>
        <Text style={{ marginBottom: 8, fontWeight: '600', color: theme.colors.text }}>Partner Email</Text>
        <TextInput
          style={[styles.input, { color: theme.colors.text, borderColor: '#E5E7EB' }]}
          placeholder="partner@example.com"
          placeholderTextColor="#999"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={{ marginTop: 16, marginBottom: 8, fontWeight: '600', color: theme.colors.text }}>Share Pool</Text>
        <Text style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
          Select which pool to share with this partner. They will receive a copy of all locations in the pool.
        </Text>

        <View style={{ maxHeight: 300 }}>
          <ScrollView
            style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8 }}
            scrollEnabled={!disableScroll}
          >
            {pools.map(pool => (
              <TouchableOpacity
                key={pool.id}
                style={{
                  padding: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: '#E5E7EB',
                  backgroundColor: invitePoolId === pool.id ? theme.colors.primary + '15' : 'transparent',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
                onPress={() => setInvitePoolId(pool.id)}
              >
                <View>
                  <Text style={{ fontWeight: '500', color: theme.colors.text }}>{pool.name}</Text>
                  <Text style={{ fontSize: 12, color: '#666' }}>
                    {(pool.locationIds?.length || 0)} locations
                  </Text>
                </View>
                {invitePoolId === pool.id && <Icon name="check" size={20} color={theme.colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Sharing Mode Toggle */}
        <View style={{ marginTop: 20, padding: 12, backgroundColor: theme.colors.surface, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={{ fontWeight: '600', color: theme.colors.text, marginBottom: 4 }}>
                Consignment Mode
              </Text>
              <Text style={{ fontSize: 12, color: '#666' }}>
                {inviteCanRevoke
                  ? 'You retain control. Can revoke products anytime.'
                  : 'Partner gets permanent copies. Cannot revoke.'}
              </Text>
            </View>
            <Switch
              value={inviteCanRevoke}
              onValueChange={setInviteCanRevoke}
              trackColor={{ false: '#E5E7EB', true: theme.colors.primary + '60' }}
              thumbColor={inviteCanRevoke ? theme.colors.primary : '#f4f4f4'}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { marginTop: 24, opacity: (!inviteEmail || !invitePoolId || isInviting) ? 0.6 : 1 }
          ]}
          onPress={sendPartnerInvite}
          disabled={!inviteEmail || !invitePoolId || isInviting}
        >
          {isInviting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Send Invite</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>

  );

  // Default view: list of pools and locations OR partners OR team
  const renderDefaultView = () => {
    const hasPools = pools.length > 0;
    const hasLocations = groupedSingleLocations.length > 0;
    const hasAnyData = hasPools || hasLocations;

    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Locations/Pools</Text>
          {activeTab === 'locations' && (
            <TouchableOpacity onPress={enterManageMode} style={styles.manageBtn}>
              <Text style={styles.manageBtnText}>Manage</Text>
            </TouchableOpacity>
          )}
        </View>

        {(!resolvedOrgId || isLoading) ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : !hasAnyData && activeTab === 'locations' ? (
          <View style={styles.emptyState}>
            <Icon name="map-marker-off" size={48} color="#ccc" />
            <Text style={styles.emptyStateTitle}>No Locations Yet</Text>
            <Text style={styles.emptyStateSubtitle}>
              Connect a platform to sync your store locations, or create a custom location group.
            </Text>
          </View>
        ) : (
          <ScrollView scrollEnabled={!disableScroll} contentContainerStyle={{ paddingBottom: 12 }}>
            {/* POOLS SECTION */}
            {hasPools && (
              <View style={{ marginBottom: 16 }}>
                <Text style={styles.sectionTitle}>POOLS</Text>
                {pools.map(pool => (
                  <PoolAccordionItem
                    key={pool.id}
                    pool={pool}
                    locationMetadataMap={availableLocationById}
                    onToggle={() => {
                      setExpandedPools(prev => {
                        const next = new Set(prev);
                        if (next.has(pool.id)) next.delete(pool.id);
                        else next.add(pool.id);
                        return next;
                      });
                    }}
                    isExpanded={expandedPools.has(pool.id)}
                    onPressManage={enterManageMode}
                    onDelete={() => openDeletePool(pool.id, pool.name)}
                  />
                ))}
              </View>
            )}

            {/* LOCATIONS SECTION */}
            {hasLocations && (
              <View>
                <Text style={styles.sectionTitle}>LOCATIONS</Text>
                {groupedSingleLocations.map(loc => {
                  const Logo = loc.platformType ? PLATFORM_LOGOS[loc.platformType as keyof typeof PLATFORM_LOGOS] : null;

                  return (
                    <TouchableOpacity
                      key={loc.id}
                      style={styles.accordionContainer} // Reuse container style for consistent border
                      activeOpacity={0.8}
                      onPress={() => { }} // No action on single location tap yet aside maybe edit? Design doesn't specify.
                    >
                      <View style={styles.singleLocationRow}>
                        <Text style={styles.accordionTitle}>{loc.name}</Text>
                        {Logo && <Logo width={20} height={20} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Create Button */}
            <TouchableOpacity style={styles.confirmBtn} onPress={enterCreateMode}>
              <Icon name="plus" size={18} color="#fff" />
              <Text style={styles.confirmBtnText}>Create New Location/Group</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        <PartnerWelcomeOverlay
          visible={showWelcomeOverlay}
          partnerName={partnerNameForOverlay}
          onConnect={() => {
            setShowWelcomeOverlay(false);
            if (onPressConnect) onPressConnect();
            else Alert.alert('Connection', 'Please go to Settings > Connections to connect a platform.');
          }}
        />
      </View>
    );
  };


  // Manage pools view: inline card with all pools expanded
  const renderManagePoolsView = () => (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Managing Locations</Text>
        <TouchableOpacity onPress={() => setViewMode('default')}>
          <Icon name="close" size={22} />
        </TouchableOpacity>
      </View>

      {/* Managing Locations content */}
      <View style={styles.manageCard}>
        {loadingManage ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <ScrollView>
            {Object.entries(draftPools).map(([poolId, draft]) => {
              const selection = managePlatformSelectionByPool[poolId];

              return (
                <View key={`draft-${poolId}`} style={{
                  backgroundColor: '#fff',
                  borderWidth: 1,
                  borderColor: '#ddd',
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 10,
                }}>
                  <View style={styles.poolHeader}>
                    <TextInput
                      value={draft.name}
                      onChangeText={(text) =>
                        setDraftPools((prev) => ({
                          ...prev,
                          [poolId]: { ...prev[poolId], name: text },
                        }))
                      }
                      style={styles.poolNameInput}
                    />
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        openDeletePool(poolId, draft.name);
                      }}
                      style={{ padding: 4 }}
                    >
                      <Icon name="delete-outline" size={20} color="#ff4444" />
                    </TouchableOpacity>
                  </View>

                  {/* Selected locations in this pool - draggable */}
                  <View style={styles.poolLocations}>
                    {draft.locationIds.length > 0 && (
                      <>
                        <Text style={styles.label}>Selected Locations</Text>
                        <DraggableFlatList
                          scrollEnabled={!disableScroll}
                          data={draft.locationIds.map((locId) => ({ key: locId, id: locId }))}
                          onDragBegin={(params: any) => {
                            const item = params.item;
                            const metaFromDraft = draft.locationMetadata?.get(item.id);
                            const metaFromAvailable = availableLocationById.get(item.id);
                            const meta = metaFromDraft || metaFromAvailable;
                            setDraggedLocation({
                              locationId: item.id,
                              sourcePoolId: poolId,
                              metadata: meta ? {
                                platformLocationId: item.id,
                                locationName: meta.locationName || item.id,
                                connectionName: meta.connectionName || 'Unknown connection',
                                platformType: meta.platformType || '',
                                timezone: meta.timezone,
                              } : null,
                            });
                          }}
                          onDragEnd={({ data }) => {
                            // If dragged to a different pool, handle cross-pool move
                            if (draggedLocation && draggedLocation.sourcePoolId !== poolId) {
                              // This is handled by the drop zone, reset drag state
                              setDraggedLocation(null);
                              return;
                            }

                            // Same pool reordering
                            const newLocationIds = data.map((item) => item.id);
                            setDraftPools((prev) => ({
                              ...prev,
                              [poolId]: {
                                ...prev[poolId],
                                locationIds: newLocationIds,
                              },
                            }));
                            setDraggedLocation(null);
                          }}
                          keyExtractor={(item) => item.id}
                          renderItem={({ item: { id: locId }, drag, isActive }: RenderItemParams<{ key: string; id: string }>) => {
                            // Try to get metadata from draft first, then fallback to availableLocationById
                            const metaFromDraft = draft.locationMetadata?.get(locId);
                            const metaFromAvailable = availableLocationById.get(locId);
                            const meta = metaFromDraft || metaFromAvailable;

                            const connName = meta?.connectionName || 'Unknown connection';
                            const locName = meta?.locationName || locId;
                            const platformType = meta?.platformType || '';
                            const Logo = platformType && PLATFORM_LOGOS[platformType as keyof typeof PLATFORM_LOGOS];

                            return (
                              <ScaleDecorator>
                                <TouchableOpacity
                                  activeOpacity={0.7}
                                  onLongPress={drag}
                                  disabled={isActive}
                                  style={[
                                    styles.selectedLocationRow,
                                    isActive && styles.selectedLocationRowActive,
                                  ]}
                                >
                                  <View style={styles.selectedLocationLeft}>
                                    <Icon name="drag-horizontal" size={20} color="#999" style={{ marginRight: 8 }} />
                                    {Logo ? <Logo width={20} height={20} /> : null}
                                  </View>
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                      style={styles.selectedLocationText}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {locName}
                                    </Text>
                                    <Text
                                      style={styles.selectedLocationSubText}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {connName}
                                    </Text>
                                  </View>
                                  <TouchableOpacity
                                    onPress={() => {
                                      setDraftPools((prev) => ({
                                        ...prev,
                                        [poolId]: {
                                          ...prev[poolId],
                                          locationIds: prev[poolId].locationIds.filter(
                                            (id) => id !== locId
                                          ),
                                        },
                                      }));
                                    }}
                                    style={{ padding: 4 }}
                                  >
                                    <Icon name="close" size={18} color="#ff4444" />
                                  </TouchableOpacity>
                                </TouchableOpacity>
                              </ScaleDecorator>
                            );
                          }}
                        />
                      </>
                    )}

                    {/* Drop zone for cross-pool dragging */}
                    {draggedLocation && draggedLocation.sourcePoolId !== poolId && (
                      <TouchableOpacity
                        style={styles.dropZone}
                        onPress={() => {
                          // Move location from source pool to this pool
                          const { locationId, metadata } = draggedLocation;
                          setDraftPools((prev) => {
                            const sourcePool = prev[draggedLocation.sourcePoolId];
                            const targetPool = prev[poolId];

                            if (!sourcePool || !targetPool) return prev;

                            // Remove from source
                            const newSourceLocationIds = sourcePool.locationIds.filter(id => id !== locationId);
                            const newSourceMetadata = new Map(sourcePool.locationMetadata || new Map());
                            newSourceMetadata.delete(locationId);

                            // Add to target
                            const newTargetLocationIds = [...targetPool.locationIds, locationId];
                            const newTargetMetadata = new Map(targetPool.locationMetadata || new Map());
                            if (metadata) {
                              newTargetMetadata.set(locationId, metadata);
                            }

                            return {
                              ...prev,
                              [draggedLocation.sourcePoolId]: {
                                ...sourcePool,
                                locationIds: newSourceLocationIds,
                                locationMetadata: newSourceMetadata,
                              },
                              [poolId]: {
                                ...targetPool,
                                locationIds: newTargetLocationIds,
                                locationMetadata: newTargetMetadata,
                              },
                            };
                          });
                          setDraggedLocation(null);
                        }}
                      >
                        <Icon name="arrow-down" size={20} color="#8BC34A" />
                        <Text style={styles.dropZoneText}>Drop here to move location</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Add location from platform */}
                  <TouchableOpacity
                    style={styles.addMoreRow}
                    onPress={() =>
                      setManagePlatformSelectionByPool((prev) => ({
                        ...prev,
                        [poolId]: null,
                      }))
                    }
                  >
                    <Icon name="plus" size={16} color="#666" />
                    <Text style={styles.addMoreText}>Add Location from Platform</Text>
                  </TouchableOpacity>

                  {/* Platform selector for this pool (opened by Add Location button) */}
                  {selection === null && (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.label}>Select Platform</Text>
                      {available.length === 0 ? (
                        <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                      ) : (
                        available.map((platform) => {
                          const Logo =
                            PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                          return (
                            <View key={platform.platformType}>
                              {platform.connections.map((conn) => {
                                const connection = platformConnections.find(c => c.Id === conn.connectionId);
                                const needsReauth = connection && (
                                  connection.Status === 'error' ||
                                  connection.Status === 'disconnected' ||
                                  !connection.IsEnabled
                                );

                                return (
                                  <View key={conn.connectionId} style={{ marginBottom: 6 }}>
                                    <TouchableOpacity
                                      style={styles.platformSelectButton}
                                      onPress={() =>
                                        setManagePlatformSelectionByPool((prev) => ({
                                          ...prev,
                                          [poolId]: {
                                            connectionId: conn.connectionId,
                                            connectionName: conn.connectionName,
                                            platformType: platform.platformType,
                                          },
                                        }))
                                      }
                                    >
                                      {Logo ? <Logo width={20} height={20} /> : null}
                                      <Text style={styles.platformSelectText}>
                                        {conn.connectionName}
                                      </Text>
                                    </TouchableOpacity>
                                    {needsReauth && (
                                      <TouchableOpacity
                                        style={styles.reauthButton}
                                        onPress={async () => {
                                          try {
                                            const token = await ensureSupabaseJwt();
                                            const res = await fetch(`${API_BASE_URL}/api/sync/connection/${conn.connectionId}/reconcile`, {
                                              method: 'POST',
                                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                            });
                                            if (!res.ok) {
                                              const error = await res.json().catch(() => ({ message: 'Reconnection failed' }));
                                              throw new Error(error.message || 'Reconnection failed');
                                            }
                                            Alert.alert('Success', 'Reconnection initiated. Please wait a moment and refresh.');
                                            await loadAvailableLocations();
                                          } catch (e) {
                                            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reconnect');
                                          }
                                        }}
                                      >
                                        <Icon name="refresh" size={14} color="#8BC34A" />
                                        <Text style={styles.reauthButtonText}>Reconnect</Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  {/* Location dropdown for selected platform in this pool */}
                  {selection && (
                    <View style={{ marginTop: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 8,
                        }}
                      >
                        <Text style={styles.label}>Select Location</Text>
                        <TouchableOpacity
                          onPress={() =>
                            setManagePlatformSelectionByPool((prev) => ({
                              ...prev,
                              [poolId]: null,
                            }))
                          }
                          style={{ marginLeft: 'auto' }}
                        >
                          <Icon name="close" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.dropdownContainer}>
                        <ScrollView style={{ maxHeight: 200 }}>
                          {getFilteredAvailableLocations(selection.connectionId).length === 0 ? (
                            <View style={{ padding: 16, alignItems: 'center' }}>
                              <Text style={{ fontSize: 13, color: '#999' }}>
                                All locations from this platform are already selected
                              </Text>
                            </View>
                          ) : (
                            getFilteredAvailableLocations(selection.connectionId).map((loc) => (
                              <TouchableOpacity
                                key={loc.platformLocationId}
                                style={styles.dropdownItem}
                                onPress={() => {
                                  const locationId = loc.platformLocationId;
                                  const meta = availableLocationById.get(locationId);
                                  setDraftPools((prev) => {
                                    const current = prev[poolId]?.locationIds || [];
                                    const currentMetadata = prev[poolId]?.locationMetadata || new Map();
                                    if (current.includes(locationId)) return prev;

                                    // Add location metadata if available
                                    if (meta) {
                                      currentMetadata.set(locationId, {
                                        platformLocationId: locationId,
                                        locationName: meta.locationName || locationId,
                                        connectionName: meta.connectionName || 'Unknown connection',
                                        platformType: meta.platformType || '',
                                        timezone: meta.timezone,
                                      });
                                    }

                                    return {
                                      ...prev,
                                      [poolId]: {
                                        ...prev[poolId],
                                        locationIds: [...current, locationId],
                                        locationMetadata: currentMetadata,
                                      },
                                    };
                                  });
                                  setManagePlatformSelectionByPool((prev) => {
                                    const updated = { ...prev };
                                    delete updated[poolId];
                                    return updated;
                                  });
                                }}
                              >
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text
                                    style={styles.dropdownItemText}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {loc.locationName}
                                  </Text>
                                  {loc.timezone ? (
                                    <Text
                                      style={styles.dropdownItemTimezone}
                                      numberOfLines={1}
                                      ellipsizeMode="tail"
                                    >
                                      {loc.timezone}
                                    </Text>
                                  ) : null}
                                </View>
                                <Icon name="chevron-right" size={18} color="#ccc" />
                              </TouchableOpacity>
                            ))
                          )}
                        </ScrollView>
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footerRow}>
          <Button title="Cancel" outlined onPress={() => setViewMode('default')} style={{ flex: 1 }} />
          <Button title="Confirm Updates" onPress={confirmManageChanges} loading={saving} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );


  // Create-mode helpers
  const [createAddPlatformMode, setCreateAddPlatformMode] = useState(false);
  const [activeCreateDropdownConnId, setActiveCreateDropdownConnId] = useState<string | null>(null);

  // Create location view - now with tabs to switch to pool
  const renderCreateLocationView = () => (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>
          {manageTab === 'location' ? 'Create Location' : 'Create Location Pool'}
        </Text>
        <TouchableOpacity onPress={() => setViewMode('default')}>
          <Icon name="close" size={22} />
        </TouchableOpacity>
      </View>

      <View style={styles.manageCard}>


        {/* Both tabs visible - user can toggle */}
        <View style={styles.tabsRow}>
          <TouchableOpacity
            onPress={() => setManageTab('location')}
            style={[styles.tab, manageTab === 'location' ? styles.tabActive : styles.tabGhost]}
          >
            <Text style={[styles.tabText, manageTab === 'location' && styles.tabTextActive]}>Location</Text>
            <Icon name="map-marker-outline" size={16} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setManageTab('pool')}
            style={[styles.tab, manageTab === 'pool' ? styles.tabActive : styles.tabGhost]}
          >
            <Text style={[styles.tabText, manageTab === 'pool' && styles.tabTextActive]}>Location Pool</Text>
            <Icon name="account-group-outline" size={16} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        {manageTab === 'location' ? (
          <>
            {/* Location name input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location Name</Text>
              <TextInput
                value={newPoolName}
                onChangeText={setNewPoolName}
                placeholder="Enter location name"
                style={styles.textInput}
              />
            </View>

            {/* Platform/Location Selector Stack */}
            <ScrollView style={{ maxHeight: 300, marginBottom: 12 }}>
              {Object.keys(newPoolLocations).length > 0 && (
                <View>
                  <Text style={styles.label}>Selected Platforms</Text>
                  {Object.entries(newPoolLocations).map(([connId, locIds]) => {
                    if (!locIds || locIds.length === 0) return null;
                    const selectedId = locIds[0];
                    const meta = availableLocationById.get(selectedId);

                    const platformGroup = available.find((p) =>
                      p.connections.some((c) => c.connectionId === connId)
                    );
                    const conn = platformGroup?.connections.find(
                      (c) => c.connectionId === connId
                    );
                    const Logo =
                      platformGroup &&
                      PLATFORM_LOGOS[platformGroup.platformType as keyof typeof PLATFORM_LOGOS];

                    return (
                      <View key={connId} style={styles.platformCard}>
                        <View style={styles.platformCardHeader}>
                          <View style={styles.platformCardHeaderLeft}>
                            {Logo ? <Logo width={22} height={22} /> : null}
                            <Text style={styles.platformCardHeaderText}>
                              {conn?.connectionName || 'Unknown connection'}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() =>
                              setNewPoolLocations((prev) => {
                                const clone = { ...prev };
                                delete clone[connId];
                                return clone;
                              })
                            }
                          >
                            <Icon name="close" size={18} color="#ff4444" />
                          </TouchableOpacity>
                        </View>

                        {/* Selected location field (dropdown trigger) */}
                        <TouchableOpacity
                          style={styles.platformLocationSelectRow}
                          onPress={() =>
                            setActiveCreateDropdownConnId((current) =>
                              current === connId ? null : connId
                            )
                          }
                        >
                          <Text style={styles.platformLocationSelectText}>
                            {meta?.locationName || 'Select location'}
                          </Text>
                          <Icon
                            name={
                              activeCreateDropdownConnId === connId ? 'chevron-up' : 'chevron-down'
                            }
                            size={18}
                            color="#999"
                          />
                        </TouchableOpacity>

                        {/* Inline dropdown for this platform */}
                        {activeCreateDropdownConnId === connId && (() => {
                          const allSelectedInCreate = new Set(Object.values(newPoolLocations).flat());
                          const filteredLocs = platformGroup
                            ?.connections.find((c) => c.connectionId === connId)
                            ?.locations.filter(loc => !allSelectedInCreate.has(loc.platformLocationId)) || [];

                          return (
                            <View style={[styles.dropdownContainer, { marginTop: 6 }]}>
                              <ScrollView style={{ maxHeight: 200 }}>
                                {filteredLocs.length === 0 ? (
                                  <View style={{ padding: 16, alignItems: 'center' }}>
                                    <Text style={{ fontSize: 13, color: '#999' }}>
                                      All locations from this platform are already selected
                                    </Text>
                                  </View>
                                ) : (
                                  filteredLocs.map((loc) => (
                                    <TouchableOpacity
                                      key={loc.platformLocationId}
                                      style={styles.dropdownItem}
                                      onPress={() => {
                                        setNewPoolLocations((prev) => ({
                                          ...prev,
                                          [connId]: [loc.platformLocationId],
                                        }));
                                        setActiveCreateDropdownConnId(null);
                                      }}
                                    >
                                      <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text
                                          style={styles.dropdownItemText}
                                          numberOfLines={1}
                                          ellipsizeMode="tail"
                                        >
                                          {loc.locationName}
                                        </Text>
                                        {loc.timezone ? (
                                          <Text
                                            style={styles.dropdownItemTimezone}
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                          >
                                            {loc.timezone}
                                          </Text>
                                        ) : null}
                                      </View>
                                      <Icon name="chevron-right" size={18} color="#ccc" />
                                    </TouchableOpacity>
                                  ))
                                )}
                              </ScrollView>
                            </View>
                          );
                        })()}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Add Another Platform Button */}
              {!createAddPlatformMode && (
                <TouchableOpacity
                  style={styles.addAnotherRow}
                  onPress={() => {
                    setCreateAddPlatformMode(true);
                    setSelectedPlatformForManage(null);
                  }}
                >
                  <Icon name="plus" size={18} color="#777" />
                  <Text style={styles.addAnotherText}>Add Another Platform</Text>
                </TouchableOpacity>
              )}

              {/* Platform Selector (shown when adding) */}
              {createAddPlatformMode && selectedPlatformForManage === null && (
                <View style={{ marginTop: 12 }}>
                  <View
                    style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}
                  >
                    <Text style={styles.label}>Select Platform</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setCreateAddPlatformMode(false);
                        setSelectedPlatformForManage(null);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>
                  {available.length === 0 ? (
                    <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                  ) : (
                    available.map((platform) => {
                      const Logo =
                        PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                      return (
                        <View key={platform.platformType}>
                          {platform.connections.map((conn) => {
                            // Skip already-selected platforms
                            if (newPoolLocations[conn.connectionId]) return null;
                            return (
                              <TouchableOpacity
                                key={conn.connectionId}
                                style={styles.platformSelectButton}
                                onPress={() => setSelectedPlatformForManage(conn as any)}
                              >
                                {Logo ? <Logo width={20} height={20} /> : null}
                                <Text style={styles.platformSelectText}>
                                  {conn.connectionName}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* Location Selector Dropdown for chosen platform (adding new platform) */}
              {createAddPlatformMode && selectedPlatformForManage && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.label}>Select Location</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedPlatformForManage(null);
                        setCreateAddPlatformMode(false);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>

                  {/* Dropdown picker */}
                  <View style={styles.dropdownContainer}>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {(() => {
                        const allSelectedInCreate = new Set(Object.values(newPoolLocations).flat());
                        const connection = available
                          .flatMap((p) => p.connections)
                          .find((c) => c.connectionId === selectedPlatformForManage.connectionId);
                        const filteredLocs = connection?.locations.filter(
                          loc => !allSelectedInCreate.has(loc.platformLocationId)
                        ) || [];

                        return filteredLocs.length === 0 ? (
                          <View style={{ padding: 16, alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, color: '#999' }}>
                              All locations from this platform are already selected
                            </Text>
                          </View>
                        ) : (
                          filteredLocs.map((loc) => (
                            <TouchableOpacity
                              key={loc.platformLocationId}
                              style={styles.dropdownItem}
                              onPress={() => {
                                setNewPoolLocations((prev) => ({
                                  ...prev,
                                  [selectedPlatformForManage.connectionId]: [
                                    loc.platformLocationId,
                                  ],
                                }));
                                setSelectedPlatformForManage(null);
                                setCreateAddPlatformMode(false);
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={styles.dropdownItemText}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {loc.locationName}
                                </Text>
                                {loc.timezone ? (
                                  <Text
                                    style={styles.dropdownItemTimezone}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {loc.timezone}
                                  </Text>
                                ) : null}
                              </View>
                              <Icon name="chevron-right" size={18} color="#ccc" />
                            </TouchableOpacity>
                          ))
                        );
                      })()}
                    </ScrollView>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.footerRow}>
              <Button
                title="Cancel"
                outlined
                onPress={() => {
                  setViewMode('default');
                  setNewPoolLocations({});
                  setSelectedPlatformForManage(null);
                  setCreateAddPlatformMode(false);
                  setActiveCreateDropdownConnId(null);
                  setNewPoolName('');
                }}
                style={{ flex: 1 }}
              />
              <Button
                title="Confirm Location"
                onPress={() => {
                  const allIds = Object.values(newPoolLocations).flat();
                  if (allIds.length === 1) {
                    const onlyId = allIds[0];
                    const meta = availableLocationById.get(onlyId);
                    const defaultName =
                      meta?.locationName || meta?.connectionName || 'Location';
                    const finalName =
                      newPoolName && newPoolName.trim().length > 0
                        ? newPoolName.trim()
                        : defaultName;
                    confirmCreate(finalName);
                  } else {
                    setManageTab('pool');
                  }
                }}
                loading={saving}
                disabled={Object.values(newPoolLocations).flat().length === 0}
                style={{ flex: 1 }}
              />
            </View>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Location Pool Name</Text>
              <TextInput
                value={newPoolName}
                onChangeText={setNewPoolName}
                placeholder="Enter pool name"
                style={styles.textInput}
              />
            </View>

            <ScrollView style={{ maxHeight: 300, marginBottom: 12 }}>
              {newPoolLocations[Object.keys(newPoolLocations)[0]] && Object.keys(newPoolLocations).length > 0 ? (
                <View>
                  <Text style={styles.label} >Selected Locations</Text>
                  {Object.entries(newPoolLocations).map(([connId, locIds]) => {
                    const platformGroup = available.find((p) =>
                      p.connections.some((c) => c.connectionId === connId)
                    );
                    const conn = platformGroup?.connections.find(
                      (c) => c.connectionId === connId
                    );
                    const Logo =
                      platformGroup &&
                      PLATFORM_LOGOS[platformGroup.platformType as keyof typeof PLATFORM_LOGOS];

                    const locs = available
                      .flatMap((p) => p.connections)
                      .flatMap((c) => c.locations)
                      .filter((l) => locIds.includes(l.platformLocationId));

                    return locs.map((loc) => (
                      <View
                        key={`${connId}-${loc.platformLocationId}`}
                        style={styles.selectedLocationRow}
                      >
                        <View style={styles.selectedLocationLeft}>
                          {Logo ? <Logo width={20} height={20} /> : null}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={styles.selectedLocationText}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {loc.locationName}
                          </Text>
                          <Text
                            style={styles.selectedLocationSubText}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            {conn?.connectionName || 'Unknown connection'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            setNewPoolLocations((prev) => ({
                              ...prev,
                              [connId]: prev[connId].filter(
                                (id) => id !== loc.platformLocationId
                              ),
                            }));
                          }}
                          style={{ padding: 4 }}
                        >
                          <Icon name="close" size={18} color="#ff4444" />
                        </TouchableOpacity>
                      </View>
                    ));
                  })}
                </View>
              ) : null}

              {/* Add Another Location Button */}
              <TouchableOpacity
                style={styles.addAnotherRow}
                onPress={() => {
                  setCreateAddPlatformMode(true);
                  setSelectedPlatformForManage(null);
                }}
              >
                <Icon name="plus" size={18} color="#777" />
                <Text style={styles.addAnotherText}>Add Location from Platform</Text>
              </TouchableOpacity>

              {/* Platform Selector (shown when adding) */}
              {createAddPlatformMode && selectedPlatformForManage === null && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.label}>Select Platform</Text>
                  {available.length === 0 ? (
                    <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                  ) : (
                    available.map((platform) => {
                      const Logo =
                        PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                      return (
                        <View key={platform.platformType}>
                          {platform.connections.map((conn) => (
                            <TouchableOpacity
                              key={conn.connectionId}
                              style={styles.platformSelectButton}
                              onPress={() => setSelectedPlatformForManage(conn as any)}
                            >
                              {Logo ? <Logo width={20} height={20} /> : null}
                              <Text style={styles.platformSelectText}>
                                {conn.connectionName}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })
                  )}
                </View>
              )}

              {/* Location Selector Dropdown for chosen platform */}
              {createAddPlatformMode && selectedPlatformForManage && (
                <View style={{ marginTop: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={styles.label}>Select Location</Text>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedPlatformForManage(null);
                        setCreateAddPlatformMode(false);
                      }}
                      style={{ marginLeft: 'auto' }}
                    >
                      <Icon name="close" size={16} color="#999" />
                    </TouchableOpacity>
                  </View>

                  {/* Dropdown picker */}
                  <View style={styles.dropdownContainer}>
                    <ScrollView style={{ maxHeight: 200 }}>
                      {(() => {
                        const allSelectedInCreate = new Set(Object.values(newPoolLocations).flat());
                        const connection = available
                          .flatMap((p) => p.connections)
                          .find((c) => c.connectionId === selectedPlatformForManage.connectionId);
                        const filteredLocs = connection?.locations.filter(
                          loc => !allSelectedInCreate.has(loc.platformLocationId)
                        ) || [];

                        return filteredLocs.length === 0 ? (
                          <View style={{ padding: 16, alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, color: '#999' }}>
                              All locations from this platform are already selected
                            </Text>
                          </View>
                        ) : (
                          filteredLocs.map((loc) => (
                            <TouchableOpacity
                              key={loc.platformLocationId}
                              style={styles.dropdownItem}
                              onPress={() => {
                                toggleLocationSelection(
                                  'create',
                                  selectedPlatformForManage.connectionId,
                                  loc.platformLocationId
                                );
                                setSelectedPlatformForManage(null);
                                setCreateAddPlatformMode(false);
                              }}
                            >
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={styles.dropdownItemText}
                                  numberOfLines={1}
                                  ellipsizeMode="tail"
                                >
                                  {loc.locationName}
                                </Text>
                                {loc.timezone ? (
                                  <Text
                                    style={styles.dropdownItemTimezone}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {loc.timezone}
                                  </Text>
                                ) : null}
                              </View>
                              <Icon name="chevron-right" size={18} color="#ccc" />
                            </TouchableOpacity>
                          ))
                        );
                      })()}
                    </ScrollView>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.footerRow}>
              <Button title="Cancel" outlined onPress={() => setViewMode('default')} style={{ flex: 1 }} />
              <Button
                title="Confirm New Location Pool"
                onPress={() => confirmCreate()}
                loading={saving}
                disabled={!newPoolName.trim() || available.length === 0 || Object.values(newPoolLocations).flat().length === 0}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
      </View>
    </View>
  );

  // Create pool view - now unified with location view via tabs
  // This is kept for the state machine but renderCreateLocationView handles both tabs
  const renderCreatePoolView = () => renderCreateLocationView();

  return (
    <View style={styles.root}>
      {renderView()}

      {/* Delete Confirmation Modal */}
      {deleteState.visible && (
        <Modal visible animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { maxWidth: 350 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Delete Pool</Text>
                <TouchableOpacity onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}>
                  <Icon name="close" size={22} />
                </TouchableOpacity>
              </View>

              <View style={{ paddingHorizontal: 16, paddingBottom: 16, alignContent: 'center', justifyContent: 'center' }}>
                <Text style={styles.label}>Where will this Pool's locations go?:</Text>
                <View style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    style={[
                      styles.chip,
                      deleteState.mergeTarget === 'none' && styles.chipSelected,
                      { marginBottom: 8, alignSelf: 'flex-start' },
                    ]}
                    onPress={() => setDeleteState((prev) => ({ ...prev, mergeTarget: 'none' }))}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        deleteState.mergeTarget === 'none' && styles.chipTextSelected,
                      ]}
                    >
                      Delete without merging (locations become single)
                    </Text>
                  </TouchableOpacity>

                  <ScrollView style={{ maxHeight: 200 }}>
                    {deleteState.availablePools.map((pool) => (
                      <TouchableOpacity
                        key={pool.id}
                        style={[
                          styles.chip,
                          deleteState.mergeTarget === pool.id && styles.chipSelected,
                          { marginBottom: 4, paddingHorizontal: 6, alignSelf: 'flex-start', minHeight: `10%`, minWidth: `100%` },
                        ]}
                        onPress={() => setDeleteState((prev) => ({ ...prev, mergeTarget: pool.id }))}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            deleteState.mergeTarget === pool.id && styles.chipTextSelected,
                          ]}
                        >
                          {pool.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {deleteState.availablePools.length === 0 && (
                    <Text style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                      No other pools available. Locations will become single.
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.footerRow}>
                <TouchableOpacity
                  onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}
                  style={[styles.primaryBtn, { flex: 1, backgroundColor: '#f0f0f0', marginRight: 8 }]}
                >
                  <Text style={{ color: '#666', fontWeight: '700' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmDeletePool}
                  disabled={deleteState.loading || deleteState.mergeTarget === null}
                  style={[styles.primaryBtn, { flex: 1, backgroundColor: '#ff4444' }]}
                >
                  {deleteState.loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryBtnText}>Delete Pool</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

export default LocationsManagerV2;

const styles = StyleSheet.create({
  root: {},
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  manageBtn: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f6f6f6',
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#666',
    marginBottom: 10,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 14,
    marginBottom: 10,
    minHeight: 52,
  },
  listItemPoolActive: {
    backgroundColor: '#fffaef',
    borderColor: '#f0c36b',
  },
  listItemSingleActive: {
    backgroundColor: '#f3f8ff',
    borderColor: '#d0e2ff',
  },
  listItemText: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  confirmBtn: {
    marginTop: 12,
    backgroundColor: '#8BC34A',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  manageCard: {
    padding: 0,
    marginTop: 0,
  },
  poolCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  poolNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 44,
  },
  poolLocations: {
    marginBottom: 8,
  },
  poolLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  addMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
    minHeight: 44,
  },
  addMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  selectedLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0f8ff',
    borderLeftWidth: 3,
    borderLeftColor: '#d0e2ff',
    paddingHorizontal: 10,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 6,
    minHeight: 56,
  },
  selectedLocationRowActive: {
    backgroundColor: '#e0f0ff',
    borderLeftColor: '#8BC34A',
  },
  selectedLocationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  selectedLocationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  selectedLocationSubText: {
    fontSize: 13,
    color: '#666',
    marginTop: 3,
  },
  platformCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 6,
  },
  platformCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  platformCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  platformCardHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  platformLocationSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 2,
  },
  platformLocationSelectText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  platformSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    marginBottom: 8,
    gap: 10,
    minHeight: 48,
  },
  platformSelectText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  dropdownContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    minHeight: 52,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    flex: 1,
    marginRight: 8,
  },
  dropdownItemTimezone: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  tabGhost: {
    borderColor: '#d9d9d9',
    backgroundColor: '#fafafa',
  },
  tabActive: {
    borderColor: '#f0c36b',
    backgroundColor: '#fff5db',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#b8860b',
  },
  inputGroup: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    minHeight: 48,
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  connLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  connName: {
    fontSize: 14,
    fontWeight: '600',
  },
  comboShell: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  inlineChipsRow: {
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#fafafa',
  },
  chipSelected: {
    borderColor: '#8BC34A',
    backgroundColor: '#8BC34A20',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  chipTextSelected: {
    color: '#4CAF50',
  },
  addAnotherRow: {
    marginTop: 12,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  addAnotherText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  footerRow: {
    flexDirection: 'column',
    gap: 12,
    paddingTop: 12,
    marginTop: 8,
    color: 'white',
  },
  dropZone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f8f0',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#8BC34A',
    borderRadius: 8,
    padding: 16,
    marginTop: 8,
    gap: 8,
  },
  dropZoneText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8BC34A',
  },
  reauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#f0f8f0',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  reauthButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8BC34A',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    maxWidth: 300,
    textAlign: 'center',
    lineHeight: 20,
  },
  backBtn: {
    marginRight: 10,
    padding: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  primaryBtn: {
    backgroundColor: '#8BC34A',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  sectionTitle: { // Ensure this exists or override it to match design
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  accordionContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e0e0e0', // matches design "Closed - Default" look
    marginBottom: 8,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    minHeight: 56,
  },
  accordionHeaderOpen: {
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8, // space between title and badge
  },
  accordionHeaderRight: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111',
  },
  accordionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionBadgeText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#111',
    marginRight: 6,
  },
  accordionIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  accordionContent: {
    backgroundColor: '#fff',
  },
  accordionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  accordionItemText: {
    fontSize: 15,
    color: '#333',
  },
  singleLocationRow: { // For single locations in the main list
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
});


