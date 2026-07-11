import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, Image, TouchableOpacity, Pressable, ScrollView, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PlatformLogo from '../components/PlatformLogo';
import PlatformBrandChip from '../components/PlatformBrandChip';
import PrintingComplete from '../components/import/PrintingComplete';
import { normalizeDisplayName } from '../config/platforms';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import LinkComputerSheet from '../components/LinkComputerSheet';
import ConnectFlowSheet from '../components/ConnectFlowSheet';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { derivePlatformConnectStatus } from '../lib/platformConnectStatus';
import { useOrg } from '../context/OrgContext';
import { API_BASE_URL } from '../config/env';
import { ensureSupabaseJwt } from '../lib/supabase';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useOptimizerQueues } from '../hooks/useOptimizerQueues';
import { InboxHeader, SuccessBlock, PillButton } from '../components/importinbox/InboxKit';
import { createLogger } from '../utils/logger';
const log = createLogger('PublishConfirmationScreen');


type Props = StackScreenProps<AppStackParamList, 'PublishConfirmation'>;

const PublishConfirmationScreen: React.FC<Props> = ({ route, navigation }) => {
  const insets = useSafeAreaInsets();
  const params: any = route.params || {};
  const {
    productId,
    variantId,
    title,
    description,
    price,
    sku,
    imageUrl,
    platforms = [],
    accountNames = [],
    quantityByPlatform = {},
    origin = 'generate',
    sourcePlatform,
    syncRules,

    backRoute,
    savedToInventory,
    mode,            // 'publishing' → this screen owns the publish POST
    publishPayload,  // the ready-to-send body for /api/products/publish
  } = params;

  // Facebook posts asynchronously through the user's computer — show its live
  // dispatch status here instead of implying a synchronous "Published!".
  const fbDispatch = useFacebookJobStatus();
  const { liveConnections } = usePlatformConnections();
  const fbSelected = (platforms || []).map((p: string) => String(p).toLowerCase()).includes('facebook');
  const fbStatus = fbSelected ? fbDispatch.statusForVariant(variantId) : null;
  // State A: is Facebook connected (OAuth marker exists)? This is distinct from
  // the computer being offline (State B). Publishing needs the connection first,
  // so a user with no connection should be told to connect, not to link a computer.
  const fbConnected = derivePlatformConnectStatus('facebook', liveConnections, {
    computerOnline: fbDispatch.computerOnline,
    presenceLoaded: fbDispatch.presenceLoaded,
  }).oauthConnected;
  // Pre-flight: Facebook posts through the user's computer. If none is online we
  // still queue the job (it posts when a computer comes on) — but say so calmly
  // and up front, with a one-tap way to link one, instead of surfacing it as an
  // after-the-fact "problem" once the receipt has already printed.
  const { currentOrg } = useOrg();
  const [linkComputerOpen, setLinkComputerOpen] = useState(false);
  const [connectFlowOpen, setConnectFlowOpen] = useState(false);
  // Only warn once presence has actually loaded (else it flashes on mount while
  // the query is in flight), only when the FB job isn't already live/posting
  // (a posted listing shouldn't say "posts when your computer's on"), and never
  // in degraded mode where onlineness is unknown.
  const fbAlreadyMoving = fbStatus?.tone === 'good' || fbStatus?.label === 'Live';
  // No Facebook connection yet → prompt to connect (State A), never "computer offline".
  const showConnectFacebook = fbSelected && !fbConnected;
  const showComputerPreflight =
    fbSelected &&
    fbConnected &&
    fbDispatch.presenceLoaded &&
    !fbDispatch.computerOnline &&
    !fbDispatch.degraded &&
    !fbAlreadyMoving;

  // Representative quantity for the receipt (the largest per-channel inventory, ≥1).
  const receiptQty = (() => {
    const vals = Object.values(quantityByPlatform || {}).map((v: any) => Number(v)).filter((v) => !Number.isNaN(v) && v > 0);
    return vals.length ? Math.max(...vals) : 1;
  })();

  // ── Publish phase ──────────────────────────────────────────────────────────
  // When we arrive in 'publishing' mode this screen OWNS the POST: the receipt prints
  // while it runs, then morphs to "Published!" only on a real 2xx. On failure it shows an
  // inline error + Retry — never a false success, never an abrupt pop-back.
  const [phase, setPhase] = useState<'publishing' | 'done' | 'error'>(mode === 'publishing' ? 'publishing' : 'done');
  const [errorMsg, setErrorMsg] = useState('');
  // Per-platform "open the live listing" URLs. Seeded from params (for non-owning callers),
  // then filled from the publish response so channel rows deep-link to the real marketplace page.
  const [liveUrls, setLiveUrls] = useState<Record<string, any>>(params.liveUrls || {});
  const ranRef = useRef(false);

  const runPublish = useCallback(async () => {
    if (!publishPayload) { setPhase('done'); return; }
    setPhase('publishing');
    setErrorMsg('');
    try {
      const token = await ensureSupabaseJwt();
      if (!token) { setErrorMsg('Your session expired — sign in again.'); setPhase('error'); return; }
      const res = await fetch(`${API_BASE_URL}/api/products/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(publishPayload),
      });
      if (!res.ok) {
        const text = await res.text();
        log.error('[PublishConfirmation] Publish failed:', res.status, text);
        let msg = text;
        try {
          const j = JSON.parse(text);
          msg = (j.statusCode === 409 && j.details?.sku)
            ? `“${j.details.sku}” is already used by another product. Change the SKU and try again.`
            : (j.message || text);
        } catch { /* keep raw text */ }
        setErrorMsg(msg || 'Something went wrong while publishing.');
        setPhase('error');
        return;
      }
      // Capture the live-listing URLs the publish endpoint resolved (eBay item, Shopify
      // admin product, …) so the channel rows deep-link to the real page.
      const body = await res.json().catch(() => null);
      if (body?.listings && typeof body.listings === 'object') {
        setLiveUrls((prev) => ({ ...prev, ...body.listings }));
      }
      setPhase('done'); // success → the receipt tears off + morphs
    } catch (e: any) {
      log.error('[PublishConfirmation] Publish error:', e);
      setErrorMsg('Something went wrong while publishing. Please try again.');
      setPhase('error');
    }
  }, [publishPayload]);

  useEffect(() => {
    if (mode !== 'publishing' || ranRef.current) return;
    ranRef.current = true;
    runPublish();
  }, [mode, runPublish]);

  // True once at least one channel has resolved a real live-listing link.
  const anyLiveLink = (platforms.length ? platforms : ['shopify']).some((p: string) => {
    const l: any = (liveUrls || {})[String(p).toLowerCase()];
    return typeof l === 'string' ? !!l : !!l?.url;
  });

  const handleCreateAnother = () => {
    // Go to the add product flow in the current stack
    navigation.navigate('TabNavigator' as any, { screen: 'AddProduct' } as any);
  };

  const handleReviewInInventory = () => {
    log.debug('[PublishConfirmation] handleReviewInInventory called');
    log.debug('[PublishConfirmation] origin:', origin);
    log.debug('[PublishConfirmation] productId:', productId);
    log.debug('[PublishConfirmation] variantId:', variantId);

    // For import flow (multiple products), always go to Inventory tab
    if (origin === 'import') {
      log.debug('[PublishConfirmation] Import origin - navigating to Inventory tab');
      navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
      return;
    }

    // For publish flow (single product), try to go to ProductDetail
    // Use variantId first since ProductDetail queries ProductVariants table
    const idToUse = variantId || productId;

    if (idToUse) {
      log.debug('[PublishConfirmation] Navigating to ProductDetail with ID:', idToUse);
      navigation.navigate('ProductDetail', { productId: idToUse });
    } else {
      log.debug('[PublishConfirmation] No valid ID, navigating to Inventory tab');
      navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
    }
  };

  const renderLogoSquare = () => {
    // Show platform + Anorha in the image square area
    const primaryPlatform = (platforms[0] || sourcePlatform || '').toLowerCase();
    return (
      <View style={[styles.image, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6', flexDirection: 'row', gap: 10 }]}>
        {primaryPlatform ? renderPlatformSvg(primaryPlatform, 22) : null}
        {/* Anorha mark - reuse a square icon */}
        <Icon name="shape" size={22} color="#111" />
      </View>
    );
  };

  // Import / Optimize stages share this completion — the printing-receipt
  // animation that morphs into the result card, now with the session tally and a
  // next-step CTA (into the optimizer, or back to the inbox). Extracted so its
  // useOptimizerQueues() only runs on the import path, never single-publish.
  if (origin === 'import') {
    return <ImportCompleteView params={params} navigation={navigation} />;
  }

  // Single-product publish — the receipt prints while the POST runs, then morphs into the
  // rich "Published!" card (1ABT-0): cover, status, per-channel live rows, actions.
  const goBack = () => { if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any); else navigation.goBack(); };

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top + 6 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={goBack} style={styles.backCircle} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Icon name="chevron-left" size={22} color="#18181B" />
        </TouchableOpacity>
      </View>

      {phase === 'error' ? (
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ alignItems: 'center', gap: 14 }}>
            <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="alert-circle-outline" size={38} color="#D9534F" />
            </View>
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#18181B', letterSpacing: -0.4 }}>Couldn’t publish</Text>
            <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 20 }}>{errorMsg}</Text>
            <View style={{ alignSelf: 'stretch', gap: 9, marginTop: 6 }}>
              <TouchableOpacity onPress={runPublish} style={[styles.primaryBtn, { marginTop: 0 }]}>
                <Text style={styles.primaryText}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goBack} style={[styles.secondaryBtn, { marginTop: 0 }]}>
                <Text style={styles.secondaryText}>Back to editor</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : phase === 'publishing' ? (
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 8 }}>
          {/* Prints the receipt from a static top slot and HOLDS (ready=false) until the POST returns. */}
          <PrintingComplete
            title={savedToInventory ? 'Saving' : 'Going live'}
            subtitle={platforms.length > 0 ? `${platforms.length} channel${platforms.length === 1 ? '' : 's'}` : ''}
            platforms={platforms}
            productTitle={title}
            sku={sku}
            price={Number(price) || undefined}
            qty={receiptQty}
            stamp={savedToInventory ? '· SAVED' : '· LIVE'}
            syncingLabel={savedToInventory ? 'Saving…' : 'Going live…'}
            primaryLabel="View listing"
            onPrimary={handleReviewInInventory}
            secondaryLabel="List another"
            onSecondary={handleCreateAnother}
            ready={false}
          />
        </View>
      ) : (
        <View style={{ flex: 1, alignContent: "space-between" }}>
        
          <View style={styles.heroBlock}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.cover} />
            ) : (
              <View style={[styles.cover, styles.coverPlaceholder]} />
            )}
            <View style={styles.publishedRow}>
              <View style={styles.checkCircle}>
                <Icon name="check" size={15} color="#FFFFFF" />
              </View>
              <Text style={styles.publishedTitle}>{savedToInventory ? 'Saved!' : 'Published!'}</Text>
            </View>
          </View>

          <Text style={styles.liveOn}>{savedToInventory ? 'IN INVENTORY' : 'LIVE ON'}</Text>

          <View style={{ paddingHorizontal: 16 }}>
            <View style={styles.channelsCard}>
              {(platforms.length ? platforms : ['shopify']).map((p: string, i: number) => {
                const lower = String(p).toLowerCase();
                const isFb = lower === 'facebook';
                // Live URL may arrive as a {url,id} object (new) or a bare string (legacy param).
                const live: any = (liveUrls || {})[lower];
                const url: string | undefined = typeof live === 'string' ? live : live?.url;
                const hasLink = !!url;
                const st = isFb
                  ? (fbStatus || { dotColor: '#BA7517', color: '#BA7517', label: 'Posting via your computer…' })
                  : { dotColor: '#93C822', color: '#93C822', label: hasLink ? (lower === 'shopify' ? 'Live · view in store' : 'Live · view') : 'Live' };
                // A real listing link → open the marketplace page. Otherwise the row still
                // opens the in-app product (where they can manage/retry); FB without a link is inert.
                const tappable = hasLink || !isFb;
                return (
                  <View key={`${p}-${i}`}>
                    {i > 0 && <View style={styles.rowDivider} />}
                    <TouchableOpacity disabled={!tappable} activeOpacity={0.7} onPress={() => { if (url) Linking.openURL(url).catch(() => undefined); else handleReviewInInventory(); }} style={styles.channelRow}>
                      <PlatformBrandChip platform={lower} size={32} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.channelName}>{platformLabel(lower)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={[styles.statusDot, { backgroundColor: st.dotColor }]} />
                          <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                        </View>
                      </View>
                      {hasLink ? <Icon name="open-in-new" size={16} color="#6B7280" /> : null}
                      {tappable ? <Icon name="chevron-right" size={18} color="#C4C8CE" /> : null}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>

          <Text style={styles.hint}>{anyLiveLink ? 'Tap a channel to open the live listing.' : 'Tap a channel to manage it.'}</Text>

          {showConnectFacebook ? (
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setConnectFlowOpen(true)} style={styles.preflightCard}>
                <Icon name="facebook" size={20} color="#BA7517" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.preflightTitle}>Connect Facebook first</Text>
                  <Text style={styles.preflightBody}>Link your Facebook account to post here. It only takes a moment.</Text>
                </View>
                <Icon name="chevron-right" size={18} color="#C4C8CE" />
              </TouchableOpacity>
            </View>
          ) : null}

          {showComputerPreflight ? (
            <View style={{ paddingHorizontal: 16, marginTop: 10 }}>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setLinkComputerOpen(true)} style={styles.preflightCard}>
                <Icon name="laptop" size={20} color="#BA7517" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.preflightTitle}>Posts when your computer’s on</Text>
                  <Text style={styles.preflightBody}>Facebook goes live through your Mac. It’ll post automatically once Anorha is open, or link a computer now.</Text>
                </View>
                <Icon name="chevron-right" size={18} color="#C4C8CE" />
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 16 }}>
            <Pressable onPress={handleCreateAnother} style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}>
              <Text style={styles.createText}>Create another listing</Text>
            </Pressable>
            <Pressable onPress={handleReviewInInventory} style={({ pressed }) => [styles.viewBtn, pressed && styles.pressed]}>
              <Text style={styles.viewText}>View in inventory</Text>
            </Pressable>
          </View>
        </View>
      )}

      <LinkComputerSheet
        visible={linkComputerOpen}
        orgId={currentOrg?.id}
        onClose={() => setLinkComputerOpen(false)}
      />
      <ConnectFlowSheet
        visible={connectFlowOpen}
        platform="facebook"
        orgId={currentOrg?.id}
        onCancel={() => setConnectFlowOpen(false)}
        onConnected={() => setConnectFlowOpen(false)}
      />
    </View>
  );

};

// Import completion — the "real ending" beat (docs/import-hub-redesign.md §3).
// Shows the session tally (only non-zero rows) on the receipt subtitle, then a
// smart primary: continue into the optimizer if it still has gaps, else Done →
// back to the (now all-clear) inbox. Replaces so Back can't re-enter the deck.
const ImportCompleteView: React.FC<{ params: any; navigation: any }> = ({ params, navigation }) => {
  const insets = useSafeAreaInsets();
  // Cheap gap check — same catalog-wide counts the hub/optimizer use.
  const { counts: optCounts, loading: optLoading } = useOptimizerQueues();

  const {
    platforms = [],
    importCount,
    importCounts,
    savedToInventory,
    backRoute,
    connectionId,
    completedLane,
  } = params;

  const linked = importCounts?.linked ?? 0;
  const created = importCounts?.created ?? 0;
  const ignored = importCounts?.ignored ?? 0;
  const autoImported = (importCounts?.autoLinked ?? 0) + (importCounts?.autoCreated ?? 0);

  // Only non-zero rows, per the brief.
  const segments = [
    linked > 0 ? `${linked} linked` : null,
    created > 0 ? `${created} added` : null,
    ignored > 0 ? `${ignored} ignored` : null,
    autoImported > 0 ? `${autoImported} auto-imported` : null,
  ].filter(Boolean) as string[];

  const receiptN = importCounts
    ? linked + created + autoImported
    : typeof importCount === 'number'
      ? importCount
      : platforms?.length || 0;

  const subtitle = segments.length
    ? segments.join(' · ')
    : platforms.length > 0
      ? `${receiptN} item${receiptN === 1 ? '' : 's'} · ${platforms.length} channel${platforms.length === 1 ? '' : 's'}`
      : `${receiptN} item${receiptN === 1 ? '' : 's'} ready`;

  const optRemaining = optCounts.photoNeeded + optCounts.dataNeeded + optCounts.manualQueue;
  const hasNext = !optLoading && optRemaining > 0;

  const goReview = () => navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
  const goHub = () =>
    navigation.replace('ImportHub' as any, { completedLane: completedLane ?? 'matches', connectionId });
  const goOptimize = () =>
    navigation.replace('BackfillOptimizer' as any, {
      source: optCounts.photoNeeded > 0 ? 'hub-photos' : 'hub-details',
    });

  // Hold a neutral label until optimizer counts settle so the CTA doesn't flip
  // from "Done" to "Continue — N" mid-read.
  const primaryLabel = optLoading ? 'Checking what’s next…' : hasNext ? `Continue — ${optRemaining} need photos/details` : 'Done';
  const onPrimary = optLoading ? () => {} : hasNext ? goOptimize : goHub;

  // Second status line: only when the optimizer still has gaps to fill.
  const nextLine = hasNext
    ? `${optRemaining} item${optRemaining === 1 ? '' : 's'} still need photos or details`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top + 6 }}>
      <InboxHeader
        onBack={() => {
          if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any);
          else navigation.goBack();
        }}
      />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24 }}>
        <SuccessBlock
          title={savedToInventory ? 'Saved to inventory' : 'Import complete'}
          lines={[subtitle, nextLine]}
        />
      </View>
      <View style={{ gap: 10, paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}>
        <PillButton label="Review listings" variant="secondary" onPress={goReview} />
        <PillButton label={primaryLabel} onPress={onPrimary} />
      </View>
    </View>
  );
};

function platformLabel(key: string): string {
  return normalizeDisplayName(key);
}

function platformIconName(key: string): string {
  // MaterialCommunityIcons names; simple mapping to avoid extra assets
  switch (key) {
    case 'ebay': return 'shopping';
    case 'clover': return 'leaf';
    case 'shopify': return 'shopping';
    case 'amazon': return 'amazon';
    case 'square': return 'square-outline';
    default: return 'shopping-outline';
  }
}

function renderPlatformSvg(key: string, size: number = 16) {
  return <PlatformLogo type={key} size={size} fallbackIcon={platformIconName(key)} />;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 60, paddingBottom: 40 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.96 },
  imageWrap: { alignSelf: 'center', width: 200, height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#E5E5E5', backgroundColor: '#F3F4F6' },
  image: { width: '100%', height: '100%' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 16 },
  label: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  value: { color: '#000', fontWeight: '500' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#fff' },
  platformPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, backgroundColor: '#fff' },
  primaryBtn: { marginTop: 18, backgroundColor: BRAND_PRIMARY, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 0, borderColor: '#7EB12D' },
  primaryText: { color: '#FFF', fontWeight: '800' },
  secondaryBtn: { marginTop: 12, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  secondaryText: { color: '#71717A', fontWeight: '700' },

  // ── 1ABT-0 "Published!" card ──────────────────────────────────────────────
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 6 },
  backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  heroBlock: { marginTop: "20%", alignItems: 'center', gap: 14, paddingHorizontal: 24, paddingTop: 6, paddingBottom: 18 },
  cover: { width: 140, height: 140, borderRadius: 16, borderWidth: 2, borderColor: '#E5E7EB' },
  coverPlaceholder: { backgroundColor: '#E7E1D6' },
  publishedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkCircle: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#93C822', alignItems: 'center', justifyContent: 'center' },
  publishedTitle: { color: '#18181B', fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  liveOn: { color: '#9CA3AF', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 20, paddingBottom: 9 },
  channelsCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, overflow: 'hidden' },
  rowDivider: { height: 1, backgroundColor: '#F1F2F4' },
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 13 },
  channelName: { color: '#18181B', fontSize: 15, fontWeight: '700' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },
  hint: { color: '#9CA3AF', fontSize: 12, fontWeight: '500', paddingHorizontal: 20, paddingTop: 9 },
  preflightCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FDF6EC', borderColor: '#F0E2CC', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  preflightTitle: { color: '#7A5210', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  preflightBody: { color: '#9A7A45', fontSize: 12, lineHeight: 17 },
  createBtn: { backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  createText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  viewBtn: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, paddingVertical: 18, alignItems: 'center' },
  viewText: { color: '#3F3F46', fontSize: 16, fontWeight: '600' },
});

export default PublishConfirmationScreen;


