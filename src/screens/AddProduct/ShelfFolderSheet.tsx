// ShelfFolderSheet — the "folder page" for a shelf scan.
//
// A shelf scan groups its detected items into a CartFolder in the shared cart.
// Tapping that folder card opens this page: the shelf photo, each detected item
// as a row (cropped/match thumbnail + title + status + price), tap → the item's
// pricing-research preview. Ungroup promotes the items to top-level singles.

import React from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { LegacyBulkItem } from '../../features/cart/types';

const GREEN = '#93C822';
const C = { bg: '#F2F2F7', card: '#FFFFFF', hairline: '#E8E8ED', text: '#0A0A0B', label: '#8E8E93' };

const money = (n?: number) => (typeof n === 'number' && isFinite(n) ? `$${Math.round(n)}` : null);

export interface ShelfFolderSheetProps {
  label?: string;
  sourcePhotoUri?: string;
  items: LegacyBulkItem[];
  quickScanStore?: Record<string, { matchData?: any; serpApiData?: any[] }>;
  confirmedQuickMatchByItemId?: Record<string, { serpApiData?: any[]; preSelectedIndices?: number[] }>;
  itemLoadingStates?: Record<string, { isLoading?: boolean; stage?: string; error?: string }>;
  onBack: () => void;
  onUngroup: () => void;
  onOpenItemPreview: (itemId: string) => void;
  onAddAllToCart?: () => void;
}

type ItemStatus =
  | { kind: 'scanning'; text: string }
  | { kind: 'matched'; text: string; price: string | null; title?: string; image?: string }
  | { kind: 'candidates'; text: string; price: string | null; title?: string; image?: string }
  | { kind: 'needs'; text: string };

export const ShelfFolderSheet: React.FC<ShelfFolderSheetProps> = ({
  label,
  sourcePhotoUri,
  items,
  quickScanStore = {},
  confirmedQuickMatchByItemId = {},
  itemLoadingStates = {},
  onBack,
  onUngroup,
  onOpenItemPreview,
  onAddAllToCart,
}) => {
  const insets = useSafeAreaInsets();

  const statusFor = (id: string): ItemStatus => {
    const loading = itemLoadingStates[id];
    if (loading?.isLoading) return { kind: 'scanning', text: loading.stage || 'Scanning…' };
    const confirmed = confirmedQuickMatchByItemId[id];
    if (confirmed?.serpApiData && confirmed.preSelectedIndices?.length) {
      const c: any = confirmed.serpApiData[confirmed.preSelectedIndices[0]];
      return { kind: 'matched', text: 'Match found', price: money(c?.price), title: c?.title, image: c?.imageUrl || c?.image };
    }
    const qs = quickScanStore[id];
    const cands = qs?.matchData?.rankedCandidates;
    const n = qs?.matchData?.totalMatches || cands?.length || 0;
    if (n > 0 && cands?.length) {
      const c: any = cands[0];
      return { kind: 'candidates', text: `${n} match${n > 1 ? 'es' : ''}`, price: money(c?.price), title: c?.title, image: c?.imageUrl || c?.image };
    }
    return { kind: 'needs', text: 'Needs more info' };
  };

  const matchedCount = items.filter((it) => statusFor(it.id).kind === 'matched').length;
  const dotColor = (k: ItemStatus['kind']) =>
    k === 'matched' ? GREEN : k === 'needs' ? '#F59E0B' : '#94A3B8';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="chevron-left" size={26} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 6 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{label || 'Shelf'}</Text>
          <Text style={styles.headerSub}>{items.length} item{items.length === 1 ? '' : 's'} · {matchedCount} matched</Text>
        </View>
        <TouchableOpacity onPress={onUngroup} style={styles.ungroupBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="call-split" size={15} color="#475569" />
          <Text style={styles.ungroupText}>Ungroup</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {sourcePhotoUri ? <Image source={{ uri: sourcePhotoUri }} style={styles.banner} resizeMode="cover" /> : null}

        <View style={styles.list}>
          {items.map((it) => {
            const s = statusFor(it.id);
            const matchImage = (s.kind === 'matched' || s.kind === 'candidates') ? s.image : undefined;
            const thumb = matchImage || it.photos?.find((p) => p.isCover)?.uri || it.photos?.[0]?.uri;
            const title = ((s.kind === 'matched' || s.kind === 'candidates') && s.title) || it.title || 'Item';
            const price = (s.kind === 'matched' || s.kind === 'candidates') ? s.price : null;
            return (
              <TouchableOpacity key={it.id} style={styles.row} activeOpacity={0.7} onPress={() => onOpenItemPreview(it.id)}>
                {thumb ? (
                  <Image source={{ uri: thumb }} style={styles.rowThumb} />
                ) : (
                  <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                    <Icon name="image-off-outline" size={18} color="#C7C7CC" />
                  </View>
                )}
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: dotColor(s.kind) }]} />
                    <Text style={styles.statusText}>{s.text}</Text>
                  </View>
                </View>
                {price ? <Text style={styles.rowPrice}>{price}</Text> : null}
                <Icon name="chevron-right" size={22} color="#94A3B8" />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {onAddAllToCart ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onAddAllToCart}>
            <Text style={styles.ctaText}>Add all to cart</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub: { fontSize: 13, color: C.label, marginTop: 2 },
  ungroupBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: '#EDEDF0' },
  ungroupText: { fontSize: 13, fontWeight: '700', color: '#475569' },

  banner: { width: '100%', height: 160, backgroundColor: '#E5E5EA' },

  list: { paddingHorizontal: 12, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 10 },
  rowThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#EFEFF2' },
  rowThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, color: C.label },
  rowPrice: { fontSize: 16, fontWeight: '700', color: C.text, marginRight: 6 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: C.bg },
  cta: { backgroundColor: GREEN, borderRadius: 18, height: 56, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#0A0A0B', fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
});

export default ShelfFolderSheet;
