// CompareSheet — the "let me actually look at these" bottom sheet for the Match
// deck. Opened from DecisionCard: either the incoming item alone (single-column
// detail) or the incoming item BESIDE a tapped candidate (two columns, the same
// field on the same row across both so the seller can eyeball "which is which").
//
// The incoming side is whatever the resolver already handed us (SyncItem). The
// candidate side is thin (CanonicalRef: id/sku/title/image) so we fetch the rest
// — description, price, barcode, every image — straight from Supabase by the
// canonical ProductVariants.Id, with a quiet spinner and a graceful "couldn't
// load" fallback to the little we already have.
//
// Actions live here too: "Link this one" sets the deck's pick and closes (the
// deck's action bar still owns the actual commit — this never fakes one), and
// "Close" just dismisses.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BaseModal from '../BaseModal';
import { RC } from '../resolve/ResolveKit';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import type { SyncItem, CanonicalRef } from '../../types/syncItem';
import { createLogger } from '../../utils/logger';

const log = createLogger('CompareSheet');

function money(v: string | number | null | undefined): string {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? `$${n.toFixed(2)}` : '';
}

interface VariantDetail {
  id: string;
  title: string | null;
  sku: string | null;
  barcode: string | null;
  price: number | null;
  description: string | null;
  images: string[];
}

// Barcode/Price/Description + every ordered image, by canonical ProductVariants.Id.
const VARIANT_DETAIL_SELECT = `
  Id, Title, Sku, Barcode, Description, Price,
  ProductImages:ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl, Position)
`;

function BigImage({ uri, loading }: { uri?: string | null; loading?: boolean }) {
  if (loading) {
    return (
      <View style={styles.bigImg}>
        <ActivityIndicator color={RC.faint} />
      </View>
    );
  }
  if (uri) {
    return <Image source={{ uri }} style={styles.bigImg} resizeMode="cover" />;
  }
  return (
    <View style={styles.bigImg}>
      <MaterialCommunityIcons name="image-off-outline" size={26} color={RC.faint} />
    </View>
  );
}

// A field row: shared uppercase label, then one cell per column, aligned.
// Module-scope (was declared inside CompareSheet's render body, so React saw a
// brand-new component type every render and remounted the whole subtree across
// loading transitions). `twoCol` is now an explicit prop instead of a closure.
function FieldRow({
  label,
  left,
  right,
  multiline,
  twoCol,
}: {
  label: string;
  left: React.ReactNode;
  right?: React.ReactNode;
  multiline?: boolean;
  twoCol: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.cellsRow}>
        <View style={styles.cell}>
          {typeof left === 'string' ? (
            <Text style={styles.value} numberOfLines={multiline ? undefined : 1}>
              {left}
            </Text>
          ) : (
            left
          )}
        </View>
        {twoCol && (
          <View style={styles.cell}>
            {typeof right === 'string' ? (
              <Text style={styles.value} numberOfLines={multiline ? undefined : 1}>
                {right}
              </Text>
            ) : (
              right
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export default function CompareSheet({
  visible,
  onClose,
  incoming,
  candidate,
  platformName,
  onLink,
}: {
  visible: boolean;
  onClose: () => void;
  /** The incoming platform item — always present. */
  incoming: SyncItem;
  /** The tapped candidate, or null/undefined for a single-column incoming detail. */
  candidate?: CanonicalRef | null;
  platformName?: string;
  /** Sets the deck's pick to this candidate (the deck's bar still commits). */
  onLink?: (candidateId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const twoCol = !!candidate;

  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<VariantDetail | null>(null);

  useEffect(() => {
    let alive = true;
    if (!visible || !candidate) {
      setDetail(null);
      setFailed(false);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        await ensureSupabaseJwt();
        const { data, error } = await supabase
          .from('ProductVariants')
          .select(VARIANT_DETAIL_SELECT)
          .eq('Id', candidate.id)
          .maybeSingle();
        if (error) throw error;
        if (!alive) return;
        if (!data) {
          setFailed(true);
          setDetail(null);
          return;
        }
        const row = data as any;
        const images: string[] = Array.isArray(row.ProductImages)
          ? [...row.ProductImages]
              .sort((a, b) => (a?.Position ?? 0) - (b?.Position ?? 0))
              .map((r: any) => r?.ImageUrl)
              .filter((u: any): u is string => !!u)
          : [];
        setDetail({
          id: row.Id,
          title: row.Title ?? null,
          sku: row.Sku ?? null,
          barcode: row.Barcode ?? null,
          price: typeof row.Price === 'number' ? row.Price : null,
          description: row.Description ?? null,
          images,
        });
      } catch (e) {
        log.warn('[CompareSheet] failed to load candidate detail:', e);
        if (alive) {
          setFailed(true);
          setDetail(null);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, candidate?.id]);

  // Incoming side — straight off the SyncItem.
  const inTitle = incoming.title || '—';
  const inSku = incoming.sku || '—';
  const inBarcode = incoming.barcode || '—';
  const inPrice = money(incoming.price) || '—';
  const inImage = incoming.imageUrl;
  const inDesc = (incoming as SyncItem & { description?: string | null }).description;

  // Candidate side — prefer the fetched detail, fall back to the thin CanonicalRef.
  const candTitle = detail?.title ?? candidate?.title ?? candidate?.sku ?? '—';
  const candSku = detail?.sku ?? candidate?.sku ?? '—';
  const candBarcode = detail?.barcode ?? (loading ? '' : '—');
  const candPriceStr = detail ? money(detail.price) || '—' : loading ? '' : '—';
  const candDesc = detail?.description ?? (loading ? '' : '');
  const candImages =
    detail?.images && detail.images.length
      ? detail.images
      : candidate?.imageUrl
        ? [candidate.imageUrl]
        : [];
  const candPrimary = candImages[0];

  const dashOrSpinner = (val: string) =>
    val === '' && loading ? <ActivityIndicator size="small" color={RC.faint} style={styles.inlineSpin} /> : val || '—';

  return (
    <BaseModal
      visible={visible}
      onClose={onClose}
      position="bottom"
      containerStyle={{ padding: 0, maxHeight: '88%', alignItems: 'stretch' }}
    >
      <View style={styles.grabber} />

      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {twoCol ? 'Compare' : 'Item detail'}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={HIT} activeOpacity={0.7} style={styles.headerClose}>
          <MaterialCommunityIcons name="close" size={22} color={RC.muted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* Column headers */}
        <View style={styles.cellsRow}>
          <View style={styles.cell}>
            <View style={[styles.colHead, styles.colHeadIn]}>
              <MaterialCommunityIcons name="tray-arrow-down" size={14} color={RC.muted} />
              <Text style={styles.colHeadInText} numberOfLines={1}>
                From {platformName || 'import'}
              </Text>
            </View>
          </View>
          {twoCol && (
            <View style={styles.cell}>
              <View style={[styles.colHead, styles.colHeadMine]}>
                <MaterialCommunityIcons name="store-outline" size={14} color={RC.greenDark} />
                <Text style={styles.colHeadMineText} numberOfLines={1}>
                  Your catalog
                </Text>
              </View>
            </View>
          )}
        </View>

        {failed && (
          <View style={styles.failNote}>
            <MaterialCommunityIcons name="cloud-off-outline" size={14} color={RC.warnInk} />
            <Text style={styles.failNoteText}>Couldn’t load full details. Showing what we have.</Text>
          </View>
        )}

        {/* Images */}
        <View style={styles.imagesRow}>
          <View style={styles.cell}>
            <BigImage uri={inImage} />
          </View>
          {twoCol && (
            <View style={styles.cell}>
              <BigImage uri={candPrimary} loading={loading && !candPrimary} />
              {candImages.length > 1 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.thumbStrip}
                  contentContainerStyle={styles.thumbStripBody}
                >
                  {candImages.slice(1).map((u, i) => (
                    <Image key={`${u}-${i}`} source={{ uri: u }} style={styles.stripThumb} resizeMode="cover" />
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </View>

        {/* Fields — same field on the same row across both columns */}
        <FieldRow label="TITLE" left={inTitle} right={dashOrSpinner(candTitle)} multiline twoCol={twoCol} />
        <FieldRow label="SKU" left={inSku} right={dashOrSpinner(candSku)} twoCol={twoCol} />
        <FieldRow label="BARCODE" left={inBarcode} right={dashOrSpinner(candBarcode)} twoCol={twoCol} />
        <FieldRow label="PRICE" left={inPrice} right={dashOrSpinner(candPriceStr)} twoCol={twoCol} />
        {twoCol && (
          <FieldRow
            label="DESCRIPTION"
            left={<Text style={[styles.value, !inDesc && styles.valueMuted]}>{inDesc || 'No description'}</Text>}
            right={
              candDesc === '' && loading ? (
                <ActivityIndicator size="small" color={RC.faint} style={styles.inlineSpin} />
              ) : (
                <Text style={styles.value}>{candDesc || 'No description'}</Text>
              )
            }
            multiline
            twoCol={twoCol}
          />
        )}
      </ScrollView>

      {/* Actions */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {twoCol ? (
          <>
            <TouchableOpacity
              style={styles.linkBtn}
              activeOpacity={0.9}
              onPress={() => {
                if (candidate) onLink?.(candidate.id);
              }}
            >
              <MaterialCommunityIcons name="link-variant" size={18} color="#fff" />
              <Text style={styles.linkBtnText}>Link this one</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} activeOpacity={0.85} onPress={onClose}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={[styles.closeBtn, styles.closeBtnFull]} activeOpacity={0.85} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    </BaseModal>
  );
}

const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

const styles = StyleSheet.create({
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: RC.line,
    marginTop: 8,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: RC.line,
  },
  headerTitle: { fontSize: 18, fontWeight: '800', color: RC.ink, letterSpacing: -0.3 },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // flexShrink so a tall compare bounds to the sheet's capped maxHeight and
  // scrolls internally, instead of overflowing and shoving the footer off-screen.
  scroll: { flexShrink: 1 },
  scrollBody: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 12 },

  cellsRow: { flexDirection: 'row', gap: 12 },
  cell: { flex: 1, minWidth: 0 },

  // column headers
  colHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  colHeadIn: { backgroundColor: RC.surface2, borderColor: RC.line },
  colHeadInText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3, color: RC.muted },
  colHeadMine: { backgroundColor: RC.greenSoft, borderColor: RC.greenLine },
  colHeadMineText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3, color: RC.greenDark },

  // fail note
  failNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: RC.warnSoft,
    borderWidth: 1,
    borderColor: RC.warnLine,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  failNoteText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: RC.warnInk },

  // images
  imagesRow: { flexDirection: 'row', gap: 12 },
  bigImg: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: RC.surface2,
    borderWidth: 1,
    borderColor: RC.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbStrip: { marginTop: 6 },
  thumbStripBody: { gap: 6, paddingRight: 4 },
  stripThumb: {
    width: 36,
    height: 36,
    borderRadius: 7,
    backgroundColor: RC.surface2,
    borderWidth: 1,
    borderColor: RC.line,
  },

  // field rows
  fieldRow: { gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: RC.faint },
  value: { fontSize: 14, lineHeight: 19, fontWeight: '600', color: RC.ink },
  valueMuted: { color: RC.faint, fontWeight: '500' },
  inlineSpin: { alignSelf: 'flex-start' },

  // footer actions
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: RC.line,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: RC.green,
    borderRadius: 14,
    paddingVertical: 15,
  },
  linkBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: RC.line,
    backgroundColor: '#fff',
  },
  closeBtnFull: {},
  closeBtnText: { fontSize: 16, fontWeight: '700', color: RC.muted },
});
