import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import Card from './Card';
import PlatformLogo from './PlatformLogo';
import { getPlatform, listPlatforms } from '../config/platforms';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import { SessionContext } from '../context/SessionContext';
import { createLogger } from '../utils/logger';
const log = createLogger('LocationsManagerV2');


const API_BASE_URL = ENV_API_BASE_URL;

// Platform brand logos, keyed by platform key — derived from the central
// registry so adding a platform there flows through here automatically.
const PLATFORM_LOGOS: Record<string, React.FC<any>> = Object.fromEntries(
  listPlatforms().map((d) => [d.key, d.logo]),
);


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
  isInviter?: boolean; // true if current org sent the invite (false means we accepted)
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
    NeedsReauth?: boolean; // Backend signals when OAuth token is expired/revoked
  }>;
  disableScroll?: boolean;
  onPressConnect?: () => void;
  refreshTrigger?: number;
}

interface LocationPool {
  id: string;
  name: string;
  description?: string;
  locationIds?: string[];
  isPartnerPool?: boolean;
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
  isPartnerPool?: boolean;
}

interface DeletePoolState {
  visible: boolean;
  poolId: string | null;
  poolName: string | null; // NEW: To show which pool is being deleted in the modal
  mergeTarget: string | null; // 'none' or pool ID
  availablePools: Array<{ id: string; name: string }>;
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

  // Filter to only include locations that have valid metadata (exist in PlatformLocations)
  const validLocationIds = useMemo(() => {
    return (pool.locationIds || []).filter(id => locationMetadataMap.has(id));
  }, [pool.locationIds, locationMetadataMap]);

  const locationCount = validLocationIds.length;
  // Partner pools are never "empty" in the sense that they are valid containers for shared inventory
  // even if they have no physical locations attached
  const isEmpty = locationCount === 0 && !pool.isPartnerPool;

  // Deduplicate platform types for the closed state icons
  const platformTypes = useMemo(() => {
    const types = new Set<string>();
    validLocationIds.forEach(id => {
      const meta = locationMetadataMap.get(id);
      if (meta?.platformType) types.add(meta.platformType);
    });
    // Add partner icon if it's a partner pool
    if (pool.isPartnerPool) types.add('partner');
    return Array.from(types);
  }, [validLocationIds, locationMetadataMap, pool.isPartnerPool]);

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
            {locationCount > 0 && (
              <Text style={styles.accordionBadgeText}>({locationCount})</Text>
            )}
            <View style={styles.accordionIcons}>
              {platformTypes.map(type => (
                getPlatform(type) ? (
                  <PlatformLogo key={type} type={type} size={14} style={{ marginLeft: 4 }} />
                ) : null
              ))}
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
          {pool.isPartnerPool && validLocationIds.length === 0 ? (
            <View style={styles.accordionItemRow}>
              <Text style={[styles.accordionItemText, { fontStyle: 'italic', color: '#666' }]}>
                Shared Inventory Pool
              </Text>
              <Icon name="cloud-sync" size={16} color="#666" />
            </View>
          ) : (
            validLocationIds.map(locId => {
              const meta = locationMetadataMap.get(locId);

              return (
                <View key={locId} style={styles.accordionItemRow}>
                  <Text style={styles.accordionItemText}>{meta?.locationName || locId}</Text>
                  {meta?.platformType && getPlatform(meta.platformType) && (
                    <PlatformLogo type={meta.platformType} size={16} />
                  )}
                </View>
              );
            })
          )}
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
              backgroundColor: BRAND_PRIMARY,
              paddingVertical: 16,
              paddingHorizontal: 32,
              borderRadius: 12,
              width: '100%',
              alignItems: 'center',
              shadowColor: BRAND_PRIMARY,
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
            <PlatformLogo type="shopify" size={24} />
            <PlatformLogo type="square" size={24} />
            <PlatformLogo type="clover" size={24} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const LocationsManagerV2: React.FC<LocationsManagerV2Props> = ({
  orgId,
  platformConnections,
  disableScroll = false,
  onPressConnect,
  refreshTrigger
}) => {
  const session = useContext(SessionContext);
  const theme = useTheme();
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [partnerNameForOverlay, setPartnerNameForOverlay] = useState('');

  // Accordion state
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set());

  // View mode state machine
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [createAddPlatformMode, setCreateAddPlatformMode] = useState(false);
  const [activeCreateDropdownConnId, setActiveCreateDropdownConnId] = useState<string | null>(null); const [manageTab, setManageTab] = useState<ManageTab>('pool');
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

  // Implicit Detection of FTUX Partner - only for ACCEPTERS who received shared inventory
  // Shows only ONCE per user (persisted via AsyncStorage)
  useEffect(() => {
    const checkAndShowWelcome = async () => {
      // Only run if we have loaded partnerships and it's not empty
      if (!isLoading && partnerships.length > 0 && resolvedOrgId) {
        // Check if already dismissed
        const dismissedKey = `partner_welcome_dismissed_${resolvedOrgId}`;
        const dismissed = await AsyncStorage.getItem(dismissedKey);
        if (dismissed === 'true') {
          return; // Already shown and dismissed
        }

        // Check if user has NO active working connections
        const hasWorkingConnection = platformConnections.some(c =>
          ['active', 'ready_to_sync', 'scanning', 'syncing'].includes(c.Status?.toLowerCase() || '')
        );

        if (!hasWorkingConnection) {
          // Only show for ACCEPTERS (those who received shared inventory, not inviters)
          const acceptedPartnership = partnerships.find(p => p.isInviter === false);
          if (acceptedPartnership) {
            setPartnerNameForOverlay(acceptedPartnership.partnerOrgName || acceptedPartnership.partnerEmail);
            setShowWelcomeOverlay(true);
          }
        }
      }
    };
    checkAndShowWelcome();
  }, [isLoading, partnerships, platformConnections, resolvedOrgId]);

  // Handler for dismissing welcome overlay (persists so it only shows once)
  const handleDismissWelcome = useCallback(async () => {
    setShowWelcomeOverlay(false);
    if (resolvedOrgId) {
      await AsyncStorage.setItem(`partner_welcome_dismissed_${resolvedOrgId}`, 'true');
    }
  }, [resolvedOrgId]);

  // Available locations for creating/editing pools
  const [available, setAvailable] = useState<TransformedLocationGroup[]>([]);

  // Draft pools for manage mode (per-pool editing)
  const [draftPools, setDraftPools] = useState<Record<string, DraftPool>>({});
  const [originalPools, setOriginalPools] = useState<Record<string, DraftPool>>({});

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
    poolName: null,
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
    log.debug('[LocationsManagerV2] Transformed locations:', result.length, 'platforms');
    return result;
  };

  // Load available locations for creating/editing
  const loadAvailableLocations = useCallback(async () => {
    if (!session?.bridgeReady) {
      log.debug('[LocationsManagerV2] Skipping available locations load until auth bridge is ready');
      setAvailable([]);
      return;
    }

    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        log.warn('[LocationsManagerV2] No JWT available for available locations load');
        setAvailable([]);
        return;
      }
      if (!resolvedOrgId) {
        log.debug('[LocationsManagerV2] No org ID, skipping locations load');
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
      log.error('[LocationsManagerV2] loadAvailableLocations error', e);
      setAvailable([]);
    }
  }, [resolvedOrgId, session?.bridgeReady]);

  const loadList = useCallback(async () => {
    // If no org ID yet, just ensure we're not loading forever
    if (!resolvedOrgId) {
      setIsLoading(false);
      return;
    }

    if (!session?.bridgeReady) {
      log.debug('[LocationsManagerV2] Skipping list load until auth bridge is ready');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        log.warn('[LocationsManagerV2] No JWT available for list load');
        setPools([]);
        setPartnerships([]);
        setPendingInvites([]);
        setSingleLocations([]);
        return;
      }

      // Load available locations FIRST (for metadata)
      // We do this in parallel or before to ensure we have data for the UI
      loadAvailableLocations();

      // Load pools, partnerships, invites, and members in parallel
      const headers = { Authorization: `Bearer ${token}` };

      log.debug('[LocationsManagerV2] Fetching data for org:', resolvedOrgId);

      const [poolsRes, partnersRes, invitesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, { headers }),
        fetch(`${API_BASE_URL}/api/cross-org/partnerships?orgId=${resolvedOrgId}`, { headers }).catch(e => { log.error('Partners fetch failed', e); return null; }),
        fetch(`${API_BASE_URL}/api/cross-org/invites/pending?orgId=${resolvedOrgId}`, { headers }).catch(e => { log.error('Invites fetch failed', e); return null; }),
      ]);

      // Handle Pools
      if (poolsRes.ok) {
        const poolData = await poolsRes.json();
        setPools(Array.isArray(poolData) ? poolData : []);
      } else {
        log.error('[LocationsManagerV2] Pools fetch failed', poolsRes.status, await poolsRes.text());
        setPools([]);
      }

      // Handle Partnerships
      if (partnersRes?.ok) {
        const data = await partnersRes.json();
        setPartnerships(data.partnerships || []);
      } else {
        if (partnersRes) log.error('[LocationsManagerV2] Partners fetch failed', partnersRes.status);
        setPartnerships([]);
      }

      // Handle Invites
      if (invitesRes?.ok) {
        const data = await invitesRes.json();
        setPendingInvites(data.sent || []);
      } else {
        if (invitesRes) log.error('[LocationsManagerV2] Invites fetch failed', invitesRes.status);
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
      log.error('[LocationsManagerV2] loadList error', e);
      Alert.alert('Error', 'Failed to load locations');
      setPools([]);
      setSingleLocations([]);
    } finally {
      setIsLoading(false);
    }
  }, [resolvedOrgId, connectionIds, loadAvailableLocations, session?.bridgeReady]);

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

  // Trigger load on refreshTrigger change
  useEffect(() => {
    if (refreshTrigger !== undefined) {
      loadList();
    }
  }, [refreshTrigger, loadList]);

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
        log.error('[LocationsManagerV2] Invite failed:', res.status, errText);
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
      log.error('[LocationsManagerV2] sendPartnerInvite error', e);
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
            timezone: loc.timezone || undefined,
          });
        }

        const draft: DraftPool = {
          name: pool.name,
          locationIds: pool.locationIds || [],
          locationMetadata,
          isPartnerPool: pool.isPartnerPool,
        };
        return draft;

      } catch (e) {
        log.error('[LocationsManagerV2] loadPoolForEditing error', e);
        Alert.alert('Error', 'Failed to load pool details');
        return null;
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
      log.debug('[LocationsManagerV2] enterManageMode: loading available locations');
      await loadAvailableLocations();

      if (!resolvedOrgId) return;

      // Load all pools and prepare drafts
      log.debug('[LocationsManagerV2] enterManageMode: loading pools for org', resolvedOrgId);
      const res = await fetch(`${API_BASE_URL}/api/pools/org/${resolvedOrgId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load pools');
      const poolList: LocationPool[] = await res.json();
      log.debug('[LocationsManagerV2] enterManageMode: found', poolList.length, 'pools');

      // Load each pool's locations with metadata
      const drafts: Record<string, DraftPool> = {};
      for (const pool of poolList) {
        const draft = await loadPoolForEditing(pool.id);
        if (draft) {
          drafts[pool.id] = draft;
        }
      }
      setDraftPools(drafts);
      setOriginalPools(drafts);

      // Reset per-pool platform selection state (all closed by default)
      setManagePlatformSelectionByPool({});

      setViewMode('managePools');
    } catch (e) {
      log.error('[LocationsManagerV2] enterManageMode error', e);
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

        // Filter out virtual location IDs (they start with "virtual-" and are only for local display)
        // These are used for partner pools and should never be sent to the backend
        const realLocationIds = (draft.locationIds || []).filter(
          id => !id.startsWith('virtual-')
        );

        // Only save if something changed (compare with filtered IDs)
        const currentRealLocationIds = (currentPool.locationIds || []).filter(
          id => !id.startsWith('virtual-')
        );

        if (draft.name !== currentPool.name || JSON.stringify(realLocationIds) !== JSON.stringify(currentRealLocationIds)) {
          const res = await fetch(`${API_BASE_URL}/api/pools/${poolId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: draft.name,
              location_ids: realLocationIds,
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
      log.error('[LocationsManagerV2] confirmManageChanges error', e);
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
      log.error('[LocationsManagerV2] confirmCreate error', e);
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
      log.error('[LocationsManagerV2] loadAvailablePoolsForDelete error', e);
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
      setDeleteState({ visible: false, poolId: null, poolName: null, mergeTarget: null, availablePools: [], loading: false });
      await loadList(); // Refresh the list
    } catch (e) {
      log.error('[LocationsManagerV2] deletePool error', e);
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
      poolName, // Store pool name for display in modal
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
    // Build set of valid location IDs from singleLocations (source of truth for what exists)
    const validLocationIdSet = new Set(singleLocations.map(l => l.PlatformLocationId));

    // Calculate filter set: only pool locationIds that actually exist in PlatformLocations
    const pooledLocationIds = new Set<string>();
    for (const pool of pools) {
      if (pool.locationIds) {
        for (const locId of pool.locationIds) {
          // Only add to pooled set if this location actually exists
          if (validLocationIdSet.has(locId)) {
            pooledLocationIds.add(locId);
          }
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

    // Filter out items without a valid platform type (connections that don't exist)
    const validItems = items.filter(it => !!it.platformType);

    // Deduplicate logic (existing)
    const keySet = new Set<string>();
    const out: { id: string; name: string; platformType?: string }[] = [];
    for (const it of validItems) {
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

  // Locations already assigned to an existing pool. The backend enforces one
  // pool per location, so offering these in "New pool" just leads to a rejected
  // Create — don't show them.
  const assignedLocationIds = useMemo(() => {
    const s = new Set<string>();
    for (const pool of pools) {
      for (const id of pool.locationIds || []) s.add(id);
    }
    return s;
  }, [pools]);

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
  function renderView() {
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
    <Card style={styles.card}>
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
    </Card>

  );

  // Default view: list of pools and locations OR partners OR team
  const renderDefaultView = () => {
    const hasPools = pools.length > 0;
    const hasLocations = groupedSingleLocations.length > 0;
    const hasAnyData = hasPools || hasLocations;

    return (
      <Card style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Locations/Pools</Text>
          {activeTab === 'locations' && (
            <TouchableOpacity onPress={enterManageMode} style={styles.manageBtn}>
              <Text style={styles.manageBtnText}>Manage</Text>
            </TouchableOpacity>
          )}
        </View>

        {isLoading ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : !hasAnyData && activeTab === 'locations' ? (
          <View style={styles.emptyState}>
            <Text style={styles.noConnectionsText}>No locations/pools found.</Text>

            <TouchableOpacity style={styles.confirmBtn} onPress={enterCreateMode}>
              <Icon name="plus" size={18} color="#fff" />
              <Text style={styles.confirmBtnText}>Create Location / Pool</Text>
            </TouchableOpacity>
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
            handleDismissWelcome(); // Persist dismissal so it only shows once
            if (onPressConnect) onPressConnect();
            else Alert.alert('Connection', 'Please go to Settings > Connections to connect a platform.');
          }}
        />
      </Card>
    );
  };


  // Flatten data for the single list (must be at top level, not inside renderManagePoolsView)
  const flatData = useMemo(() => {
    const data: any[] = [];
    Object.entries(draftPools).forEach(([poolId, draft]) => {
      // Header
      data.push({ type: 'header', key: `header-${poolId}`, poolId, draft });
      // Locations
      draft.locationIds.forEach((locId) => {
        data.push({ type: 'location', key: locId, id: locId, poolId });
      });
      // Footer (Actions)
      data.push({ type: 'footer', key: `footer-${poolId}`, poolId });
    });
    return data;
  }, [draftPools]);

  // Manage pools view: flattened list for cross-pool dragging
  // Rendered inline relative to the parent container
  function renderManagePoolsView() {
    return (
      /* Managing Locations content */
      <Card style={styles.card}>
        {loadingManage ? (
          <View style={{ paddingVertical: 24 }}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Managing Locations</Text>
              <TouchableOpacity onPress={() => setViewMode('default')}>
                <Icon name="close" size={22} />
              </TouchableOpacity>
            </View>
            <DraggableFlatList
              containerStyle={{ minHeight: 100 }}
              scrollEnabled={!disableScroll}
              data={flatData}
              renderItem={({ item, drag, isActive }) => {
                if (item.type === 'header') {
                  const { poolId, draft } = item;
                  return (
                    <View style={{
                      backgroundColor: '#f8fafc',
                      padding: 10,
                      borderTopLeftRadius: 12,
                      borderTopRightRadius: 12,
                      borderBottomWidth: 1,
                      borderColor: '#e2e8f0',
                      marginTop: 10,
                      flexDirection: 'row',
                      alignItems: 'center'
                    }}>
                      <TextInput
                        value={draft.name}
                        onChangeText={(text) =>
                          setDraftPools((prev) => ({
                            ...prev,
                            [poolId]: { ...prev[poolId], name: text },
                          }))
                        }
                        style={{
                          flex: 1,
                          fontSize: 16,
                          fontWeight: '600',
                          color: '#334155',
                          padding: 4,
                        }}
                      />

                      {!draft.isPartnerPool && (
                        <TouchableOpacity
                          onPress={() => openDeletePool(poolId, draft.name)}
                          style={{ padding: 8 }}
                        >
                          <Icon name="delete-outline" size={20} color="#ff4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }

                if (item.type === 'location') {
                  const locId = item.id;
                  const oldPool = draftPools[item.poolId];
                  const metaFromDraft = oldPool?.locationMetadata?.get(locId);
                  const metaFromAvailable = availableLocationById.get(locId);
                  const meta = metaFromDraft || metaFromAvailable;

                  // Skip virtual locations in the manage view (they are for display only)
                  if (locId.startsWith('virtual-')) {
                    return null;
                  }

                  const connName = meta?.connectionName || 'Unknown connection';
                  const locName = meta?.locationName || locId;
                  const platformType = meta?.platformType || '';
                  const Logo = platformType && PLATFORM_LOGOS[platformType as keyof typeof PLATFORM_LOGOS];

                  return (
                    <ScaleDecorator>
                      <TouchableOpacity
                        activeOpacity={1}
                        onLongPress={drag}
                        disabled={isActive}
                        style={{
                          backgroundColor: isActive ? '#e0f2fe' : '#fff',
                          padding: 12,
                          flexDirection: 'row',
                          alignItems: 'center',
                          borderBottomWidth: 1,
                          borderColor: '#f1f5f9',
                          borderLeftWidth: 4,
                          borderLeftColor: isActive ? '#3b82f6' : 'transparent',
                        }}
                      >
                        <TouchableOpacity onPressIn={drag} style={{ paddingRight: 12 }}>
                          <Icon name="drag-horizontal" size={20} color="#94a3b8" />
                        </TouchableOpacity>

                        {Logo ? <Logo width={20} height={20} style={{ marginRight: 8 }} /> : null}

                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '500', color: '#334155' }} numberOfLines={1}>
                            {locName}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }} numberOfLines={1}>
                            {connName}
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            let currentPoolIdOfLoc: string | null = null;
                            Object.entries(draftPools).forEach(([pid, d]) => {
                              if (d.locationIds.includes(locId)) currentPoolIdOfLoc = pid;
                            });

                            if (currentPoolIdOfLoc) {
                              setDraftPools((prev) => ({
                                ...prev,
                                [currentPoolIdOfLoc!]: {
                                  ...prev[currentPoolIdOfLoc!],
                                  locationIds: prev[currentPoolIdOfLoc!].locationIds.filter(id => id !== locId)
                                }
                              }));
                            }
                          }}
                          style={{ padding: 4 }}
                        >
                          <Icon name="close" size={18} color="#ff4444" />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </ScaleDecorator>
                  );
                }

                if (item.type === 'footer') {
                  const { poolId } = item;
                  const selection = managePlatformSelectionByPool[poolId];

                  return (
                    <View style={{
                      padding: 10,
                      backgroundColor: '#fff',
                      borderBottomLeftRadius: 12,
                      borderBottomRightRadius: 12,
                      marginBottom: 10
                    }}>
                      {/* Only show Add Location if there are available locations ANYWHERE */}
                      {(() => {
                        const hasAnyAvailableLocs = available.some(p =>
                          p.connections.some(c =>
                            c.locations.some(l => !allSelectedLocationIds.has(l.platformLocationId))
                          )
                        );

                        if (!hasAnyAvailableLocs) return null;

                        return (
                          <TouchableOpacity
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingVertical: 8
                            }}
                            onPress={() =>
                              setManagePlatformSelectionByPool((prev) => ({
                                ...prev,
                                [poolId]: null,
                              }))
                            }
                          >
                            <Icon name="plus" size={16} color="#64748b" />
                            <Text style={{ fontSize: 13, color: '#64748b', marginLeft: 6 }}>Add Location from Platform</Text>
                          </TouchableOpacity>
                        );
                      })()}

                      {selection === null && (
                        <View style={{ marginTop: 8 }}>
                          <Text style={styles.label}>Select Platform</Text>
                          {available.length === 0 ? (
                            <Text style={{ fontSize: 12, color: '#999' }}>No platforms available</Text>
                          ) : (
                            available.map((platform) => {
                              const Logo = PLATFORM_LOGOS[platform.platformType as keyof typeof PLATFORM_LOGOS];
                              // Filter connections that have unallocated locations
                              const visibleConnections = platform.connections.filter(c =>
                                c.locations.some(l => !allSelectedLocationIds.has(l.platformLocationId))
                              );

                              if (visibleConnections.length === 0) return null;

                              return (
                                <View key={platform.platformType}>
                                  {visibleConnections.map((conn) => (
                                    <TouchableOpacity
                                      key={conn.connectionId}
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
                                      <Text style={styles.platformSelectText}>{conn.connectionName}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              );
                            })
                          )}
                        </View>
                      )}

                      {selection && (
                        <View style={{ marginTop: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <Text style={styles.label}>Select Location</Text>
                            <TouchableOpacity
                              onPress={() => setManagePlatformSelectionByPool((prev) => ({ ...prev, [poolId]: null }))}
                              style={{ marginLeft: 'auto' }}
                            >
                              <Icon name="close" size={16} color="#999" />
                            </TouchableOpacity>
                          </View>
                          <View style={styles.dropdownContainer}>
                            <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                              {getFilteredAvailableLocations(selection.connectionId).map((loc) => (
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
                                      if (meta) {
                                        currentMetadata.set(locationId, meta);
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
                                  <Text style={styles.dropdownItemText}>{loc.locationName}</Text>
                                </TouchableOpacity>
                              ))}
                            </ScrollView>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                }
                return null;
              }}
              keyExtractor={(item) => item.key}
              onDragEnd={({ data }) => {
                const newDrafts: Record<string, DraftPool> = {};
                Object.keys(draftPools).forEach(pid => {
                  newDrafts[pid] = { ...draftPools[pid], locationIds: [], locationMetadata: new Map() };
                });

                let currentPoolId: string | null = null;

                data.forEach(item => {
                  if (item.type === 'header') {
                    currentPoolId = item.poolId;
                  } else if (item.type === 'location') {
                    if (currentPoolId && newDrafts[currentPoolId]) {
                      newDrafts[currentPoolId].locationIds.push(item.id);
                      const oldPool = draftPools[item.poolId];
                      const meta = oldPool?.locationMetadata?.get(item.id) || availableLocationById.get(item.id);
                      if (meta) {
                        newDrafts[currentPoolId].locationMetadata!.set(item.id, {
                          ...meta,
                          connectionName: meta.connectionName || 'Unknown',
                          platformType: meta.platformType || '',
                        });
                      }
                    }
                  }
                });
                setDraftPools(newDrafts);
              }}
            />

            <View style={styles.footerRow}>
              <Button title="Cancel" outlined onPress={() => setViewMode('default')} style={{ flex: 1 }} />
              <Button
                title="Save Changes"
                onPress={confirmManageChanges}
                loading={saving}
                style={{ flex: 1 }}
                disabled={(() => {
                  const keys = Object.keys(draftPools);
                  if (keys.length !== Object.keys(originalPools).length) return false;
                  for (const pid of keys) {
                    const d = draftPools[pid];
                    const o = originalPools[pid];
                    if (!o) return false;
                    if (d.name !== o.name) return false;
                    if (d.locationIds.length !== o.locationIds.length) return false;
                    const s = new Set(d.locationIds);
                    for (const l of o.locationIds) {
                      if (!s.has(l)) return false;
                    }
                  }
                  return true;
                })()}
              />
            </View>
          </>
        )}
      </Card>
    );
  }


  // Create-mode helpers

  // Create location view - now with tabs to switch to pool
  function renderCreateLocationView() {
    return (
      <Card style={styles.card}>
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
                              ?.locations.filter(loc => !allSelectedInCreate.has(loc.platformLocationId) && !assignedLocationIds.has(loc.platformLocationId)) || [];

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
                            loc => !allSelectedInCreate.has(loc.platformLocationId) && !assignedLocationIds.has(loc.platformLocationId)
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
                            loc => !allSelectedInCreate.has(loc.platformLocationId) && !assignedLocationIds.has(loc.platformLocationId)
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
      </Card>
    );
  }

  // Create pool view - now unified with location view via tabs
  // This is kept for the state machine but renderCreateLocationView handles both tabs
  function renderCreatePoolView() { return renderCreateLocationView(); }

  return (
    <View style={styles.root}>
      {renderView()}

      {/* Delete Pool Confirmation Modal */}
      {deleteState.visible && (
        <Modal visible animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { maxWidth: 340, padding: 20 }]}>
              {/* Minimal Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={{ fontSize: 17, fontWeight: '600', color: '#1f2937' }}>
                  Delete "{deleteState.poolName}"?
                </Text>
                <TouchableOpacity
                  onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close" size={20} color="#9ca3af" />
                </TouchableOpacity>
              </View>

              {/* Simple prompt */}
              <Text style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>
                Select a pool to move these locations to.
              </Text>

              {/* Options - compact style */}
              <View style={{ gap: 8, marginBottom: 24 }}>
                {/* Move to other pools */}
                {deleteState.availablePools.length > 0 ? (
                  <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
                    {deleteState.availablePools.map((pool) => (
                      <TouchableOpacity
                        key={pool.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 12,
                          paddingHorizontal: 14,
                          borderRadius: 8,
                          borderWidth: 1.5,
                          borderColor: deleteState.mergeTarget === pool.id ? theme.colors.primary : '#e5e7eb',
                          backgroundColor: deleteState.mergeTarget === pool.id ? theme.colors.primary + '08' : '#fff',
                          marginBottom: 8,
                        }}
                        onPress={() => setDeleteState((prev) => ({ ...prev, mergeTarget: pool.id }))}
                      >
                        <Icon
                          name="folder-move-outline"
                          size={18}
                          color={deleteState.mergeTarget === pool.id ? theme.colors.primary : '#9ca3af'}
                        />
                        <Text style={{
                          flex: 1,
                          marginLeft: 10,
                          fontSize: 14,
                          fontWeight: '500',
                          color: deleteState.mergeTarget === pool.id ? theme.colors.primary : '#374151'
                        }}>
                          Move to "{pool.name}"
                        </Text>
                        {deleteState.mergeTarget === pool.id && (
                          <Icon name="check" size={18} color={theme.colors.primary} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={{ backgroundColor: '#f9fafb', padding: 16, borderRadius: 8, alignItems: 'center' }}>
                    <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
                      No other pools available. Locations will become independent.
                    </Text>
                  </View>
                )}
              </View>

              {/* Action buttons - side by side */}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={() => setDeleteState((prev) => ({ ...prev, visible: false }))}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 8,
                    backgroundColor: '#f3f4f6',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#6b7280' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirmDeletePool}
                  disabled={deleteState.loading || (deleteState.availablePools.length > 0 && !deleteState.mergeTarget)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 8,
                    backgroundColor: '#ef4444',
                    alignItems: 'center',
                    opacity: (deleteState.loading || (deleteState.availablePools.length > 0 && !deleteState.mergeTarget)) ? 0.5 : 1,
                  }}
                >
                  {deleteState.loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Delete</Text>
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
  modalContainer: {
    flex: 1,
    padding: 16,
    paddingTop: 20,
  },
  card: {
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    marginTop: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  manageBtn: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f6f6f6',
    minWidth: 20,
  },
  manageBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    marginBottom: 10,
    marginTop: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    borderRadius: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 16,
    marginBottom: 10,
    minHeight: 52,
    backgroundColor: '#fff',
  },
  listItemPoolActive: {
    backgroundColor: '#fffbeb',
    borderColor: '#fcd34d',
  },
  listItemSingleActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  listItemText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
    marginRight: 8,
  },
  confirmBtn: {
    width: '100%',
    marginTop: 12,
    backgroundColor: '#8BC34A',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  manageCard: {
    padding: 0,
    marginTop: 0,
  },
  poolCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  poolNameInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: '#1f2937',
    minHeight: 44,
    backgroundColor: '#f9fafb',
  },
  poolLocations: {
    marginBottom: 8,
  },
  poolLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  addMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
    minHeight: 44,
  },
  addMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  selectedLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f0f9ff',
    borderLeftWidth: 3,
    borderLeftColor: '#bae6fd',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
    borderRadius: 8,
    minHeight: 56,
  },
  selectedLocationRowActive: {
    backgroundColor: '#ecfdf5',
    borderLeftColor: '#34d399',
  },
  selectedLocationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 10,
  },
  selectedLocationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
  },
  selectedLocationSubText: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  platformCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#edf2f7',
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  platformCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  platformCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  platformCardHeaderText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
    flex: 1,
    marginRight: 8,
  },
  platformLocationSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 4,
    backgroundColor: '#f9fafb',
  },
  platformLocationSelectText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
    marginRight: 8,
  },
  platformSelectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    marginBottom: 8,
    gap: 12,
    minHeight: 52,
    backgroundColor: '#fff',
  },
  platformSelectText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
  },
  dropdownContainer: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    backgroundColor: '#fff',
    overflow: 'hidden',
    marginTop: 4,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    minHeight: 52,
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    flex: 1,
    marginRight: 8,
  },
  dropdownItemTimezone: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1f2937',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  tabGhost: {
    borderColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  tabActive: {
    borderColor: '#fcd34d',
    backgroundColor: '#fffbeb',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#d97706',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    color: '#4b5563',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    minHeight: 50,
    color: '#1f2937',
    backgroundColor: '#fff',
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
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
    color: '#374151',
  },
  comboShell: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  inlineChipsRow: {
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#f9fafb',
  },
  chipSelected: {
    borderColor: '#10b981',
    backgroundColor: '#ecfdf5',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#4b5563',
  },
  chipTextSelected: {
    color: '#059669',
  },
  addAnotherRow: {
    marginTop: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#f9fafb',
  },
  addAnotherText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  footerRow: {
    flexDirection: 'column',
    gap: 10,
    paddingTop: 16,
    marginTop: 8,
  },
  dropZone: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#34d399',
    borderRadius: 12,
    padding: 20,
    marginTop: 12,
    gap: 8,
  },
  dropZoneText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#059669',
  },
  reauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#ecfdf5',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  reauthButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  emptyState: {
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 0,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
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
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: '#1f2937',
  },
  primaryBtn: {
    backgroundColor: '#10b981',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  accordionContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    marginBottom: 10,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    minHeight: 60,
  },
  accordionHeaderOpen: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  accordionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  accordionHeaderRight: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  accordionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  accordionBadgeText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#4b5563',
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
    borderBottomColor: '#f9fafb',
  },
  accordionItemText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
  },
  singleLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
  },
  noConnectionsText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 16,
  },
});
