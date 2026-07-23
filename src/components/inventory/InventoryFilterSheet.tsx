// InventoryFilterSheet — one floating bottom sheet that combines the inventory
// filters (Order/Sort, Location, Partner, Status) into a single column of rows, each a
// fully in-sheet subpage. Modeled on DateRangeSheet's look (grab handle, icon+
// title header, drill rows). Location data is lifted in here (pools + platform
// locations) so we no longer depend on PoolLocationCombobox.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SlidersHorizontal, ArrowUpDown, MapPin, Tag, ChevronRight, X, Check, Handshake } from 'lucide-react-native';
import { API_BASE_URL } from '../../config/env';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { useOrg } from '../../context/OrgContext';
import PartnerBadge from '../PartnerBadge';

export interface FilterChoice { value: string; label: string; }
export interface PartnerFilterChoice extends FilterChoice {
  count: number;
  initials: string;
  logoUrl?: string;
}
interface LocationOption { id: string; name: string; sub?: string }
interface ConnectionLike { Id: string; DisplayName?: string; PlatformType?: string }

export interface InventoryFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  sortBy: string;
  sortOptions: FilterChoice[];
  onSortChange: (v: string) => void;
  filterStatus: string;
  statusOptions: FilterChoice[];
  onStatusChange: (v: string) => void;
  platformConnections: ConnectionLike[];
  selectedLocationIds: string[];
  onLocationChange: (ids: string[]) => void;
  partnerOptions: PartnerFilterChoice[];
  selectedPartnerId: string | null;
  onPartnerChange: (id: string | null) => void;
  onReset: () => void;
}

type Page = 'main' | 'sort' | 'status' | 'location' | 'partner';

const labelFor = (opts: FilterChoice[], value: string, fallback: string) =>
  opts.find((o) => o.value === value)?.label || fallback;

/** Loads the org's selectable locations (platform locations + partner pools) — the
 *  same data PoolLocationCombobox used, lifted so the sheet owns it. */
function useLocationFilterOptions(platformConnections: ConnectionLike[], active: boolean) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id;
  const [options, setOptions] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const connectionIds = useMemo(() => platformConnections?.map((c) => c.Id) || [], [platformConnections]);
  const connById = useMemo(() => {
    const m = new Map<string, ConnectionLike>();
    for (const c of platformConnections || []) m.set(c.Id, c);
    return m;
  }, [platformConnections]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const token = await ensureSupabaseJwt();
      let poolList: any[] = [];
      try {
        const r = await fetch(`${API_BASE_URL}/api/pools/org/${orgId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) { const j = await r.json(); poolList = Array.isArray(j) ? j : []; }
      } catch { /* pools are best-effort */ }

      let locs: Array<{ PlatformConnectionId: string; PlatformLocationId: string; Name: string | null }> = [];
      if (connectionIds.length) {
        const { data } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);
        locs = data || [];
      }

      const opts: LocationOption[] = [];
      const seen = new Set<string>();
      for (const loc of locs) {
        const id = loc.PlatformLocationId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const conn = connById.get(loc.PlatformConnectionId);
        opts.push({ id, name: loc.Name || id, sub: conn?.DisplayName });
      }
      // Partner pools appear as a single selectable (the pool id acts as a location).
      for (const p of poolList) {
        const isPartner = p?.isPartnerPool || String(p?.name || '').toLowerCase().includes('partner');
        if (isPartner && p?.id && !seen.has(p.id)) {
          seen.add(p.id);
          opts.push({ id: p.id, name: p.name || 'Partner Pool', sub: 'Shared inventory' });
        }
      }
      setOptions(opts);
    } catch { /* ignore — empty list */ } finally {
      setLoading(false);
    }
  }, [orgId, connectionIds, connById]);

  useEffect(() => { if (active) load(); }, [active, load]);

  return { options, loading };
}

export const InventoryFilterSheet: React.FC<InventoryFilterSheetProps> = ({
  visible, onClose,
  sortBy, sortOptions, onSortChange,
  filterStatus, statusOptions, onStatusChange,
  platformConnections, selectedLocationIds = [], onLocationChange,
  partnerOptions, selectedPartnerId, onPartnerChange,
  onReset,
}) => {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('main');
  const { options: locationOptions, loading: locationsLoading } = useLocationFilterOptions(platformConnections, visible);

  const close = () => { setPage('main'); onClose(); };
  const locCount = selectedLocationIds.length;
  const selectedPartnerName = partnerOptions.find((option) => option.value === selectedPartnerId)?.label;

  const toggleLocation = (id: string) => {
    onLocationChange(selectedLocationIds.includes(id)
      ? selectedLocationIds.filter((x) => x !== id)
      : [...selectedLocationIds, id]);
  };

  const renderOptionList = (title: string, opts: FilterChoice[], current: string, onPick: (v: string) => void) => (
    <>
      <SubHeader title={title} onBack={() => setPage('main')} />
      <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
        {opts.map((o, i) => {
          const isActive = o.value === current;
          return (
            <TouchableOpacity key={o.value} style={[styles.optionRow, i > 0 && styles.rowBorder]} activeOpacity={0.7}
              onPress={() => { onPick(o.value); setPage('main'); }}>
              <Text style={[styles.optionText, isActive && styles.optionActive]}>{o.label}</Text>
              {isActive ? <Check size={18} color="#5A8F12" /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdropWrap}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.handle} />

          {page === 'main' ? (
            <>
              <View style={styles.titleRow}>
                <View style={styles.titleLeft}>
                  <SlidersHorizontal size={18} color="#18181B" />
                  <Text style={styles.title}>Filter by</Text>
                </View>
                <TouchableOpacity onPress={onReset} activeOpacity={0.7}>
                  <Text style={styles.reset}>Reset</Text>
                </TouchableOpacity>
              </View>

              <DrillRow icon={<ArrowUpDown size={18} color="#43631A" />} title="Order"
                sub={labelFor(sortOptions, sortBy, 'Default')} onPress={() => setPage('sort')} />
              <DrillRow icon={<MapPin size={18} color="#43631A" />} title="Location"
                sub={locCount > 0 ? `${locCount} selected` : 'All locations'} onPress={() => setPage('location')} />
              {partnerOptions.length > 0 ? (
                <DrillRow icon={<Handshake size={18} color="#43631A" />} title="Partner"
                  sub={selectedPartnerName || 'All partners'} onPress={() => setPage('partner')} />
              ) : null}
              <DrillRow icon={<Tag size={18} color="#43631A" />} title="Status"
                sub={labelFor(statusOptions, filterStatus, 'All')} onPress={() => setPage('status')} />
            </>
          ) : page === 'sort' ? (
            renderOptionList('Order', sortOptions, sortBy, onSortChange)
          ) : page === 'status' ? (
            renderOptionList('Status', statusOptions, filterStatus, onStatusChange)
          ) : page === 'location' ? (
            <>
              <SubHeader title="Location" onBack={() => setPage('main')} />
              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                <TouchableOpacity style={styles.optionRow} activeOpacity={0.7} onPress={() => onLocationChange([])}>
                  <Text style={[styles.optionText, locCount === 0 && styles.optionActive]}>All locations</Text>
                  {locCount === 0 ? <Check size={18} color="#5A8F12" /> : null}
                </TouchableOpacity>
                {locationsLoading && locationOptions.length === 0 ? (
                  <View style={{ paddingVertical: 24, alignItems: 'center' }}><ActivityIndicator color="#93C822" /></View>
                ) : locationOptions.map((o) => {
                  const checked = selectedLocationIds.includes(o.id);
                  return (
                    <TouchableOpacity key={o.id} style={[styles.optionRow, styles.rowBorder]} activeOpacity={0.7} onPress={() => toggleLocation(o.id)}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.optionText, checked && styles.optionActive]}>{o.name}</Text>
                        {o.sub ? <Text style={styles.optionSub} numberOfLines={1}>{o.sub}</Text> : null}
                      </View>
                      {checked ? <Check size={18} color="#5A8F12" /> : null}
                    </TouchableOpacity>
                  );
                })}
                {!locationsLoading && locationOptions.length === 0 ? (
                  <Text style={styles.empty}>No locations connected yet.</Text>
                ) : null}
              </ScrollView>
            </>
          ) : (
            <>
              <SubHeader title="Partner" onBack={() => setPage('main')} />
              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                <TouchableOpacity style={styles.optionRow} activeOpacity={0.7} onPress={() => onPartnerChange(null)}>
                  <Text style={[styles.optionText, selectedPartnerId === null && styles.optionActive]}>All partners</Text>
                  {selectedPartnerId === null ? <Check size={18} color="#5A8F12" /> : null}
                </TouchableOpacity>
                {partnerOptions.map((option) => {
                  const checked = option.value === selectedPartnerId;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.optionRow, styles.rowBorder]}
                      activeOpacity={0.7}
                      onPress={() => onPartnerChange(option.value)}
                    >
                      <View style={styles.partnerOption}>
                        <PartnerBadge
                          name={option.label}
                          initials={option.initials}
                          logoUrl={option.logoUrl}
                          size={30}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.optionText, checked && styles.optionActive]}>{option.label}</Text>
                          <Text style={styles.optionSub}>{option.count} {option.count === 1 ? 'item' : 'items'}</Text>
                        </View>
                      </View>
                      {checked ? <Check size={18} color="#5A8F12" /> : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
};

const SubHeader: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <View style={styles.subHeader}>
    <TouchableOpacity style={styles.closeCircle} onPress={onBack} activeOpacity={0.85}>
      <X size={18} color="#18181B" />
    </TouchableOpacity>
    <Text style={styles.title}>{title}</Text>
    <View style={{ width: 36 }} />
  </View>
);

const DrillRow: React.FC<{ icon: React.ReactNode; title: string; sub: string; onPress: () => void }> = ({ icon, title, sub, onPress }) => (
  <TouchableOpacity style={styles.drillRow} activeOpacity={0.7} onPress={onPress}>
    <View style={styles.drillIcon}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={styles.drillTitle}>{title}</Text>
      <Text style={styles.drillSub} numberOfLines={1}>{sub}</Text>
    </View>
    <ChevronRight size={20} color="#D4D4D8" />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  backdropWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8 },
  handle: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: '#D4D4D8', marginBottom: 12 },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 18, color: '#18181B', fontFamily: 'Inter_700Bold' },
  reset: { fontSize: 15, color: '#5A8F12', fontFamily: 'Inter_600SemiBold' },

  drillRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FAFAF8', borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  drillIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(147,200,34,0.16)', alignItems: 'center', justifyContent: 'center' },
  drillTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  drillSub: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 1 },

  subHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  closeCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center' },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, gap: 12 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  optionText: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_500Medium' },
  optionActive: { color: '#5A8F12', fontFamily: 'Inter_700Bold' },
  optionSub: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 1 },
  partnerOption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  empty: { paddingVertical: 24, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 14 },
});

export default InventoryFilterSheet;
