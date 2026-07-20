// ShelfFolderSheet — the "folder page" for a shelf scan.
//
// A shelf scan groups its detected items into a CartFolder in the shared cart.
// Tapping that folder card opens this page: the shelf photo, each detected item
// as a row (cropped/match thumbnail + title + status + price), tap → the item's
// pricing-research preview. Ungroup promotes the items to top-level singles.

import React from 'react';
import { ActivityIndicator, Alert, View, Text, Image, Pressable, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { LegacyBulkItem } from '../../features/cart/types';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

const GREEN = CHAT_COLORS.brand;
const C = { bg: '#F2F2F7', card: CHAT_COLORS.white, hairline: '#E8E8ED', text: CHAT_COLORS.ink, label: CHAT_COLORS.dim };

const priceValue = (price: any): number | undefined =>
  typeof price === 'number'
    ? price
    : typeof price?.extracted_value === 'number'
      ? price.extracted_value
      : undefined;
const money = (price: any) => {
  const n = priceValue(price);
  return typeof n === 'number' && isFinite(n) ? `$${Math.round(n)}` : null;
};
const soldCompCount = (pricingResearch: any): number => {
  if (pricingResearch?.error || pricingResearch?.soldCompsError) return 0;
  const explicitCount = Number(pricingResearch?.sampleCount);
  if (Number.isFinite(explicitCount) && explicitCount > 0) return explicitCount;
  return Array.isArray(pricingResearch?.samples) ? pricingResearch.samples.length : 0;
};

export interface ShelfFolderSheetProps {
  label?: string;
  sourcePhotoUri?: string;
  items: LegacyBulkItem[];
  quickScanStore?: Record<string, { matchData?: any; matchRows?: any[] }>;
  confirmedQuickMatchByItemId?: Record<string, { matchRows?: any[]; preSelectedIndices?: number[] }>;
  itemLoadingStates?: Record<string, { isLoading?: boolean; stage?: string; error?: string }>;
  inventoryMatchByItemId?: Record<string, unknown>;
  shelfPricingPendingByItemId?: Record<string, boolean>;
  onBack: () => void;
  onUngroup: () => void;
  onOpenItemPreview: (itemId: string) => void;
  onOpenLocalMatch?: (itemId: string) => void;
  onAddAllToCart?: () => void;
}

type ItemStatus = {
  kind: 'scanning' | 'inventory' | 'matched' | 'candidates' | 'needs';
  text: string;
  price?: string | null;
  title?: string;
  image?: string;
  pricingResearch?: any;
};

export const ShelfFolderSheet: React.FC<ShelfFolderSheetProps> = ({
  label,
  sourcePhotoUri,
  items,
  quickScanStore = {},
  confirmedQuickMatchByItemId = {},
  itemLoadingStates = {},
  inventoryMatchByItemId = {},
  shelfPricingPendingByItemId = {},
  onBack,
  onUngroup,
  onOpenItemPreview,
  onOpenLocalMatch,
  onAddAllToCart,
}) => {
  const insets = useSafeAreaInsets();

  const statusFor = (id: string): ItemStatus => {
    const loading = itemLoadingStates[id];
    if (loading?.isLoading) return { kind: 'scanning', text: loading.stage || 'Scanning…' };
    const confirmed = confirmedQuickMatchByItemId[id];
    const selectedIdx = confirmed?.preSelectedIndices?.[0];
    const selectedRow: any =
      typeof selectedIdx === 'number' && Array.isArray(confirmed?.matchRows)
        ? confirmed.matchRows[selectedIdx]
        : undefined;
    const scannedCandidate: any = quickScanStore[id]?.matchData?.rankedCandidates?.[0];
    const inventoryEntry: any = inventoryMatchByItemId[id];
    const inventoryCandidate = inventoryEntry?.match || inventoryEntry;
    const isInventoryMatch = Boolean(
      inventoryEntry
      || selectedRow?.isLocalMatch
      || selectedRow?.inInventory
      || scannedCandidate?.isLocalMatch
      || scannedCandidate?.inInventory
    );
    const selected = selectedRow || scannedCandidate || inventoryCandidate;
    const pricingResearch = selected?.pricingResearch ?? scannedCandidate?.pricingResearch;
    if (isInventoryMatch && selected) {
      return {
        kind: 'inventory',
        text: 'Already in inventory',
        price: money(selected?.price),
        title: selected?.title,
        image: selected?.imageUrl || selected?.image,
        pricingResearch,
      };
    }
    if (selectedRow) {
      return { kind: 'matched', text: 'Match found', price: money(selectedRow?.price), title: selectedRow?.title, image: selectedRow?.imageUrl || selectedRow?.image, pricingResearch };
    }
    const qs = quickScanStore[id];
    const cands = qs?.matchData?.rankedCandidates;
    const n = qs?.matchData?.totalMatches || cands?.length || 0;
    if (n > 0 && cands?.length) {
      const c: any = cands[0];
      return { kind: 'candidates', text: `${n} match${n > 1 ? 'es' : ''}`, price: money(c?.price), title: c?.title, image: c?.imageUrl || c?.image, pricingResearch };
    }
    return { kind: 'needs', text: 'Needs more info' };
  };

  const matchedCount = items.filter((it) => ['matched', 'inventory'].includes(statusFor(it.id).kind)).length;
  const dotColor = (k: ItemStatus['kind']) =>
    k === 'inventory' ? '#60A5FA' : k === 'matched' ? GREEN : k === 'needs' ? '#F59E0B' : '#94A3B8';

  const showFolderMenu = () => {
    Alert.alert('Shelf options', undefined, [
      { text: 'Ungroup', style: 'destructive', onPress: onUngroup },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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
        <Pressable
          onPress={showFolderMenu}
          style={styles.overflowBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Shelf options"
        >
          <Icon name="dots-horizontal" size={19} color={C.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {sourcePhotoUri ? <Image source={{ uri: sourcePhotoUri }} style={styles.banner} resizeMode="cover" /> : null}

        <View style={styles.list}>
          {items.map((it) => {
            const s = statusFor(it.id);
            const matchImage = s.image;
            const thumb = matchImage || it.photos?.find((p) => p.isCover)?.uri || it.photos?.[0]?.uri;
            const title = s.title || it.title || 'Item';
            const price = s.price;
            const comps = soldCompCount(s.pricingResearch);
            const pricingPending = Boolean(shelfPricingPendingByItemId[it.id]);
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
                  <Pressable
                    style={styles.statusRow}
                    onPress={s.kind === 'inventory' && onOpenLocalMatch ? (event) => {
                      event.stopPropagation();
                      onOpenLocalMatch(it.id);
                    } : undefined}
                    disabled={s.kind !== 'inventory' || !onOpenLocalMatch}
                    hitSlop={4}
                    accessibilityRole={s.kind === 'inventory' && onOpenLocalMatch ? 'button' : undefined}
                  >
                    <View style={[styles.dot, { backgroundColor: dotColor(s.kind) }]} />
                    <Text style={[styles.statusText, s.kind === 'inventory' && styles.inventoryText]}>{s.text}</Text>
                  </Pressable>
                </View>
                {price ? (
                  <View style={styles.priceWrap}>
                    <Text style={styles.rowPrice}>{price}</Text>
                    {pricingPending ? (
                      <View style={styles.compsRow}>
                        <ActivityIndicator size="small" color={GREEN} style={styles.compsSpinner} />
                        <Text style={styles.compsText}>Finding comps…</Text>
                      </View>
                    ) : comps > 0 ? (
                      <Text style={styles.compsText}>{comps} sold comp{comps === 1 ? '' : 's'}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Icon name="chevron-right" size={22} color="#94A3B8" />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {onAddAllToCart ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onAddAllToCart}>
            <Text style={styles.ctaText}>Add all</Text>
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
  overflowBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EDEDF0' },

  banner: { width: '100%', height: 160, backgroundColor: '#E5E5EA' },

  list: { paddingHorizontal: 12, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 10 },
  rowThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#EFEFF2' },
  rowThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, color: C.label },
  inventoryText: { color: '#3B82F6' },
  priceWrap: { alignItems: 'flex-end', maxWidth: 112, marginRight: 6 },
  rowPrice: { fontSize: 16, fontFamily: CHAT_FONT.bold, color: C.text },
  compsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  compsSpinner: { transform: [{ scale: 0.62 }], marginHorizontal: -3 },
  compsText: { fontSize: 11, fontFamily: CHAT_FONT.medium, color: C.label, marginTop: 2 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: C.bg },
  cta: { backgroundColor: GREEN, borderRadius: 18, height: 56, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 18, fontFamily: CHAT_FONT.bold, letterSpacing: -0.2 },
});

export default ShelfFolderSheet;
