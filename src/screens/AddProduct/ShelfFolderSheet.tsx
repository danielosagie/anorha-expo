// ShelfFolderSheet — the "folder page" for a shelf scan.
//
// A shelf scan groups its detected items into a CartFolder in the shared cart.
// Tapping that folder card opens this page: the shelf photo, each detected item
// as a row (cropped/match thumbnail + title + status + price), tap → the item's
// pricing-research preview. Ungroup promotes the items to top-level singles.
// Long-press a row (or hit the header's ⋯) for save-for-later / delete.

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, View, Text, Image, Pressable, ScrollView, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { LegacyBulkItem } from '../../features/cart/types';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import { ShelfItemCrop } from './ShelfItemCrop';
import { resolveImageUri } from '../../utils/resolveImageUri';

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
  /** Cart id of the folder itself, so the shelf can be saved for later as one unit. */
  folderId?: string;
  sourcePhotoUri?: string;
  items: LegacyBulkItem[];
  quickScanStore?: Record<string, { matchData?: any; matchRows?: any[] }>;
  confirmedQuickMatchByItemId?: Record<string, { matchRows?: any[]; preSelectedIndices?: number[] }>;
  itemLoadingStates?: Record<string, { isLoading?: boolean; stage?: string; error?: string }>;
  inventoryMatchByItemId?: Record<string, unknown>;
  shelfPricingPendingByItemId?: Record<string, boolean>;
  /** Ids (items and/or this folder) the user set aside via "Save for later". */
  savedForLaterIds?: string[];
  onToggleSavedForLater?: (id: string, saved: boolean) => void;
  onDeleteItem?: (itemId: string) => void;
  onDeleteShelf?: () => void;
  onBack: () => void;
  onUngroup: () => void;
  onOpenItemPreview: (itemId: string) => void;
  onOpenLocalMatch?: (itemId: string) => void;
  onAddAllToCart?: () => void;
}

/** What the inline action sheet is acting on. */
type MenuTarget = { kind: 'shelf' } | { kind: 'item'; id: string };

type MenuAction = {
  key: string;
  label: string;
  icon: string;
  destructive?: boolean;
  onPress: () => void;
};

const tapFeedback = () => { Haptics.selectionAsync().catch(() => undefined); };

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
  folderId,
  sourcePhotoUri,
  items,
  quickScanStore = {},
  confirmedQuickMatchByItemId = {},
  itemLoadingStates = {},
  inventoryMatchByItemId = {},
  shelfPricingPendingByItemId = {},
  savedForLaterIds,
  onToggleSavedForLater,
  onDeleteItem,
  onDeleteShelf,
  onBack,
  onUngroup,
  onOpenItemPreview,
  onOpenLocalMatch,
  onAddAllToCart,
}) => {
  const insets = useSafeAreaInsets();
  const savedSet = useMemo(() => new Set(savedForLaterIds ?? []), [savedForLaterIds]);
  const shelfSaved = Boolean(folderId && savedSet.has(folderId));
  // The menu is drawn inline rather than through Alert/Modal: this page already lives
  // inside the Add Product modal, and an iOS alert raised from behind it never lands —
  // which is why the ⋯ button used to look like it had no options at all.
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);

  const openMenu = useCallback((target: MenuTarget) => {
    tapFeedback();
    setPendingDelete(false);
    setMenu(target);
  }, []);
  const closeMenu = useCallback(() => {
    setPendingDelete(false);
    setMenu(null);
  }, []);

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
    // The backend's veto outranks an inventory flag. A raw text-search hit on the seller's own
    // catalog arrives flagged isLocalMatch even when the backend scored the item NEEDS_REVIEW,
    // and this branch used to run BEFORE the veto check below — so an unresolved item was shown
    // as a settled "Already in inventory" with someone else's product name on it. Only an
    // explicit dedup decision (inventoryEntry) or a match the backend was willing to confirm
    // may claim inventory; everything else falls through to review.
    const backendVetoed = quickScanStore[id]?.matchData?.canAutoConfirm === false;
    const inventoryClaimTrusted = Boolean(inventoryEntry) || !backendVetoed;
    if (isInventoryMatch && selected && inventoryClaimTrusted) {
      return {
        kind: 'inventory',
        text: 'Already in inventory',
        price: money(selected?.price),
        title: selected?.title,
        image: resolveImageUri(selected),
        pricingResearch,
      };
    }
    if (isInventoryMatch && selected && backendVetoed) {
      return {
        kind: 'candidates',
        text: 'Needs review',
        price: money(selected?.price),
        title: selected?.title,
        image: resolveImageUri(selected),
        pricingResearch,
      };
    }
    if (selectedRow) {
      return { kind: 'matched', text: 'Match found', price: money(selectedRow?.price), title: selectedRow?.title, image: resolveImageUri(selectedRow), pricingResearch };
    }
    const qs = quickScanStore[id];
    const cands = qs?.matchData?.rankedCandidates;
    const n = qs?.matchData?.totalMatches || cands?.length || 0;
    if (n > 0 && cands?.length) {
      const c: any = cands[0];
      // A backend veto is review state even when candidates exist.
      if (qs?.matchData?.canAutoConfirm === false) {
        return { kind: 'candidates', text: 'Needs review', price: money(c?.price), title: c?.title, image: resolveImageUri(c), pricingResearch };
      }
      return { kind: 'candidates', text: `${n} match${n > 1 ? 'es' : ''}`, price: money(c?.price), title: c?.title, image: resolveImageUri(c), pricingResearch };
    }
    return { kind: 'needs', text: 'Needs more info' };
  };

  const matchedCount = items.filter((it) => ['matched', 'inventory'].includes(statusFor(it.id).kind)).length;
  const savedCount = items.filter((it) => savedSet.has(it.id)).length;
  const addableItems = items.filter((it) => !savedSet.has(it.id));
  const dotColor = (k: ItemStatus['kind']) =>
    k === 'inventory' ? '#60A5FA' : k === 'matched' ? GREEN : k === 'needs' ? '#F59E0B' : '#94A3B8';

  const menuItem = menu?.kind === 'item' ? items.find((it) => it.id === menu.id) : undefined;
  const menuItemSaved = menuItem ? savedSet.has(menuItem.id) : false;
  const menuTitle = menu?.kind === 'shelf'
    ? (label || 'Shelf')
    : (menuItem ? (statusFor(menuItem.id).title || menuItem.title || 'Item') : '');

  const menuActions = useMemo((): MenuAction[] => {
    if (!menu) return [];
    if (menu.kind === 'shelf') {
      const actions: MenuAction[] = [];
      if (folderId && onToggleSavedForLater) {
        actions.push({
          key: 'save',
          label: shelfSaved ? 'Move shelf back to cart' : 'Save shelf for later',
          icon: shelfSaved ? 'bookmark-off-outline' : 'bookmark-outline',
          onPress: () => { onToggleSavedForLater(folderId, !shelfSaved); closeMenu(); },
        });
      }
      actions.push({
        key: 'ungroup',
        label: 'Ungroup into separate items',
        icon: 'folder-remove-outline',
        onPress: () => { closeMenu(); onUngroup(); },
      });
      if (onDeleteShelf) {
        actions.push({
          key: 'delete',
          label: 'Delete shelf',
          icon: 'trash-can-outline',
          destructive: true,
          onPress: () => setPendingDelete(true),
        });
      }
      return actions;
    }
    if (!menuItem) return [];
    const actions: MenuAction[] = [];
    if (onToggleSavedForLater) {
      actions.push({
        key: 'save',
        label: menuItemSaved ? 'Move back to shelf' : 'Save for later',
        icon: menuItemSaved ? 'bookmark-off-outline' : 'bookmark-outline',
        onPress: () => { onToggleSavedForLater(menuItem.id, !menuItemSaved); closeMenu(); },
      });
    }
    actions.push({
      key: 'open',
      label: 'Open item',
      icon: 'open-in-new',
      onPress: () => { const id = menuItem.id; closeMenu(); onOpenItemPreview(id); },
    });
    if (onDeleteItem) {
      actions.push({
        key: 'delete',
        label: 'Delete item',
        icon: 'trash-can-outline',
        destructive: true,
        onPress: () => setPendingDelete(true),
      });
    }
    return actions;
  }, [closeMenu, folderId, menu, menuItem, menuItemSaved, onDeleteItem, onDeleteShelf, onOpenItemPreview, onToggleSavedForLater, onUngroup, shelfSaved]);

  const confirmDelete = useCallback(() => {
    if (!menu) return;
    if (menu.kind === 'shelf') {
      closeMenu();
      onDeleteShelf?.();
      return;
    }
    const id = menu.id;
    closeMenu();
    onDeleteItem?.(id);
  }, [closeMenu, menu, onDeleteItem, onDeleteShelf]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg} />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="chevron-left" size={26} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 6 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{label || 'Shelf'}</Text>
          <Text style={styles.headerSub}>
            {items.length} item{items.length === 1 ? '' : 's'} · {matchedCount} matched{savedCount > 0 ? ` · ${savedCount} saved` : ''}
          </Text>
        </View>
        {folderId && onToggleSavedForLater ? (
          <Pressable
            onPress={() => { tapFeedback(); onToggleSavedForLater(folderId, !shelfSaved); }}
            style={styles.overflowBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={shelfSaved ? 'Move shelf back to cart' : 'Save shelf for later'}
          >
            <Icon name={shelfSaved ? 'bookmark' : 'bookmark-outline'} size={19} color={shelfSaved ? GREEN : C.text} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => openMenu({ kind: 'shelf' })}
          style={[styles.overflowBtn, styles.overflowBtnTrailing]}
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
          {items.length === 0 ? (
            <View style={styles.emptyState}>
              <Icon name="tray-remove" size={26} color="#A1A1AA" />
              <Text style={styles.emptyTitle}>Nothing left on this shelf</Text>
              <Text style={styles.emptySub}>Every item was deleted. Go back and scan again.</Text>
            </View>
          ) : null}
          {items.map((it) => {
            const s = statusFor(it.id);
            const matchImage = s.image;
            const itemPhoto = resolveImageUri(it.photos?.find((p) => p.isCover) || it.photos?.[0]);
            const thumb = matchImage || itemPhoto;
            const title = s.title || it.title || 'Item';
            const price = s.price;
            const comps = soldCompCount(s.pricingResearch);
            const pricingPending = Boolean(shelfPricingPendingByItemId[it.id]);
            const isSaved = savedSet.has(it.id);
            return (
              <TouchableOpacity
                key={it.id}
                style={[styles.row, isSaved && styles.rowSaved]}
                activeOpacity={0.7}
                onPress={() => onOpenItemPreview(it.id)}
                onLongPress={() => openMenu({ kind: 'item', id: it.id })}
                delayLongPress={280}
                accessibilityRole="button"
                accessibilityHint="Press and hold for save and delete options"
              >
                {itemPhoto ? (
                  <Image source={{ uri: itemPhoto }} style={styles.rowThumb} resizeMode="cover" />
                ) : sourcePhotoUri && it.shelfBox ? (
                  <ShelfItemCrop
                    uri={sourcePhotoUri}
                    box={it.shelfBox}
                    width={52}
                    height={52}
                    borderRadius={12}
                  />
                ) : thumb ? (
                  <Image source={{ uri: thumb }} style={styles.rowThumb} />
                ) : (
                  <View style={[styles.rowThumb, styles.rowThumbEmpty]}>
                    <Icon name="image-off-outline" size={18} color="#C7C7CC" />
                  </View>
                )}
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
                  {isSaved ? (
                    <View style={styles.statusRow}>
                      <Icon name="bookmark" size={12} color={GREEN} />
                      <Text style={[styles.statusText, styles.savedText]}>Saved for later</Text>
                    </View>
                  ) : (
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
                  )}
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

      {onAddAllToCart && addableItems.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onAddAllToCart}>
            <Text style={styles.ctaText}>
              {/* A saved shelf leaves the saved pile when this is tapped — say "Move", not "Add". */}
              {shelfSaved
                ? `Move ${addableItems.length} to cart`
                : savedCount > 0
                  ? `Add ${addableItems.length} to cart`
                  : 'Add all'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {menu ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={styles.menuBackdrop}
            onPress={closeMenu}
            accessibilityRole="button"
            accessibilityLabel="Dismiss menu"
          />
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
            <Text style={styles.menuTitle} numberOfLines={2}>
              {pendingDelete ? `Delete ${menuTitle}?` : menuTitle}
            </Text>
            {pendingDelete ? (
              <>
                <Text style={styles.menuMessage}>
                  {menu.kind === 'shelf'
                    ? `This removes the shelf and all ${items.length} item${items.length === 1 ? '' : 's'} from your cart.`
                    : 'This removes the item from your cart.'}
                </Text>
                <Pressable style={[styles.menuRow, styles.menuRowDanger]} onPress={confirmDelete}>
                  <Icon name="trash-can-outline" size={20} color="#DC2626" />
                  <Text style={[styles.menuRowText, styles.menuRowTextDestructive]}>
                    {menu.kind === 'shelf' ? 'Delete shelf' : 'Delete item'}
                  </Text>
                </Pressable>
              </>
            ) : (
              menuActions.map((action) => (
                <Pressable
                  key={action.key}
                  style={[styles.menuRow, action.destructive && styles.menuRowDanger]}
                  onPress={action.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                >
                  <Icon name={action.icon} size={20} color={action.destructive ? '#DC2626' : C.text} />
                  <Text style={[styles.menuRowText, action.destructive && styles.menuRowTextDestructive]}>
                    {action.label}
                  </Text>
                </Pressable>
              ))
            )}
            <Pressable style={styles.menuCancel} onPress={closeMenu} accessibilityRole="button">
              <Text style={styles.menuCancelText}>Cancel</Text>
            </Pressable>
          </View>
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
  overflowBtnTrailing: { marginLeft: 8 },

  banner: { width: '100%', height: 160, backgroundColor: '#E5E5EA' },

  list: { paddingHorizontal: 12, paddingTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 16, padding: 12, marginBottom: 10 },
  rowSaved: { opacity: 0.6 },

  emptyState: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 6 },
  emptyTitle: { fontSize: 16, fontFamily: CHAT_FONT.bold, color: C.text, marginTop: 6 },
  emptySub: { fontSize: 13, color: C.label, textAlign: 'center' },
  rowThumb: { width: 52, height: 52, borderRadius: 12, backgroundColor: '#EFEFF2' },
  rowThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', color: C.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, color: C.label },
  inventoryText: { color: '#3B82F6' },
  savedText: { color: GREEN, fontFamily: CHAT_FONT.medium },
  priceWrap: { alignItems: 'flex-end', maxWidth: 112, marginRight: 6 },
  rowPrice: { fontSize: 16, fontFamily: CHAT_FONT.bold, color: C.text },
  compsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  compsSpinner: { transform: [{ scale: 0.62 }], marginHorizontal: -3 },
  compsText: { fontSize: 11, fontFamily: CHAT_FONT.medium, color: C.label, marginTop: 2 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: C.bg },
  cta: { backgroundColor: GREEN, borderRadius: 18, height: 56, alignItems: 'center', justifyContent: 'center' },
  ctaText: { color: '#FFFFFF', fontSize: 18, fontFamily: CHAT_FONT.bold, letterSpacing: -0.2 },

  menuBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  menuSheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 12,
    paddingTop: 16,
    gap: 4,
  },
  menuTitle: { fontSize: 15, fontFamily: CHAT_FONT.bold, color: C.text, paddingHorizontal: 8, marginBottom: 6 },
  menuMessage: { fontSize: 13, color: C.label, paddingHorizontal: 8, marginBottom: 8, lineHeight: 18 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 8, borderRadius: 14 },
  menuRowDanger: { backgroundColor: '#FEF2F2' },
  menuRowText: { fontSize: 16, fontFamily: CHAT_FONT.medium, color: C.text },
  menuRowTextDestructive: { color: '#DC2626' },
  menuCancel: { alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 6, borderRadius: 14, backgroundColor: '#F2F2F7' },
  menuCancelText: { fontSize: 16, fontFamily: CHAT_FONT.bold, color: C.label },
});

export default ShelfFolderSheet;
