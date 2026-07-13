import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import PlatformLogo from '../components/PlatformLogo';
import PlatformBrandChip from '../components/PlatformBrandChip';
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
import { IC, InboxHeader, SuccessBlock, PillButton, SectionCaption } from '../components/importinbox/InboxKit';
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

  // Representative quantity for the summary line (the largest per-channel inventory, ≥1).
  const summaryQty = (() => {
    const vals = Object.values(quantityByPlatform || {}).map((v: any) => Number(v)).filter((v) => !Number.isNaN(v) && v > 0);
    return vals.length ? Math.max(...vals) : 1;
  })();

  // ── Publish phase ──────────────────────────────────────────────────────────
  // When we arrive in 'publishing' mode this screen OWNS the POST: a calm "Publishing…"
  // state shows while it runs, then resolves to "Published!" only on a real 2xx. On failure
  // it shows an inline error + Retry — never a false success, never an abrupt pop-back.
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
      setPhase('done'); // success → resolves to the calm "Published!" summary
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

  // Import / Optimize stages share this completion — the calm Avec SuccessBlock
  // composition, with the session tally and a next-step CTA (into the optimizer, or
  // back to the inbox). Extracted so its useOptimizerQueues() only runs on the import
  // path, never single-publish.
  if (origin === 'import') {
    return <ImportCompleteView params={params} navigation={navigation} />;
  }

  // Single-product publish — a calm "Publishing…" state runs while the POST is in flight,
  // then resolves into the Avec "Published!" summary: green check, a muted summary line,
  // and per-channel calm rows (live deep-links + every dispatch nuance preserved).
  const goBack = () => { if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any); else navigation.goBack(); };

  const doneTitle = savedToInventory ? 'Saved to inventory' : 'Published!';
  const summaryLine = [
    title ? String(title) : null,
    platforms.length ? `${platforms.length} channel${platforms.length === 1 ? '' : 's'}` : null,
    `Qty ${summaryQty}`,
  ].filter(Boolean).join(' · ');
  const channelKeys: string[] = platforms.length ? platforms : ['shopify'];

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top + 6 }}>
      <InboxHeader onBack={goBack} />

      {phase === 'error' ? (
        <>
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ alignItems: 'center' }}>
              <View style={styles.errorCircle}>
                <Icon name="alert-circle-outline" size={34} color="#D9534F" />
              </View>
              <Text style={styles.errorTitle}>Couldn’t publish</Text>
              <Text style={styles.errorLine}>{errorMsg}</Text>
            </View>
          </View>
          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <PillButton label="Back to editor" variant="secondary" onPress={goBack} />
            <PillButton label="Try again" onPress={runPublish} />
          </View>
        </>
      ) : phase === 'publishing' ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 16 }}>
          <ActivityIndicator color={IC.accent} />
          <Text style={styles.publishingText}>{savedToInventory ? 'Saving…' : 'Publishing…'}</Text>
          {!!summaryLine && <Text style={styles.publishingSub}>{summaryLine}</Text>}
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ paddingBottom: 12 }} showsVerticalScrollIndicator={false}>
            <View style={{ paddingTop: 28, paddingBottom: 14 }}>
              <SuccessBlock title={doneTitle} lines={[summaryLine]} />
            </View>

            <View style={{ paddingHorizontal: 20 }}>
              <SectionCaption>{savedToInventory ? 'In inventory' : 'Live on'}</SectionCaption>

              {channelKeys.map((p: string, i: number) => {
                const lower = String(p).toLowerCase();
                const isFb = lower === 'facebook';
                // Live URL may arrive as a {url,id} object (new) or a bare string (legacy param).
                const live: any = (liveUrls || {})[lower];
                const url: string | undefined = typeof live === 'string' ? live : live?.url;
                const hasLink = !!url;
                // FB keeps its full dispatch vocabulary (queued / posting / waiting-for-computer /
                // needs-a-check / couldn't-post); everything else without a link reads a quiet "Live".
                const st = isFb
                  ? (fbStatus || { dotColor: '#BA7517', color: '#BA7517', label: 'Posting via your computer…' })
                  : { dotColor: IC.accent, color: IC.accent, label: 'Live' };
                // A real listing link → open the marketplace page. Otherwise the row still
                // opens the in-app product (where they can manage/retry); FB without a link is inert.
                const tappable = hasLink || !isFb;
                return (
                  <TouchableOpacity
                    key={`${p}-${i}`}
                    disabled={!tappable}
                    activeOpacity={0.85}
                    onPress={() => { if (url) Linking.openURL(url).catch(() => undefined); else handleReviewInInventory(); }}
                    style={styles.channelRow}
                  >
                    <PlatformBrandChip platform={lower} size={34} />
                    <Text style={styles.channelName} numberOfLines={1}>{platformLabel(lower)}</Text>
                    <View style={styles.channelRight}>
                      {hasLink ? (
                        <View style={styles.liveLink}>
                          <Text style={styles.liveLinkText}>Live</Text>
                          <Icon name="arrow-top-right" size={15} color={IC.accent} />
                        </View>
                      ) : (
                        <>
                          <View style={[styles.statusDot, { backgroundColor: st.dotColor }]} />
                          <Text style={[styles.statusText, { color: st.color }]} numberOfLines={2}>{st.label}</Text>
                        </>
                      )}
                      {tappable && !hasLink ? <Icon name="chevron-right" size={20} color={IC.muted} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              <Text style={styles.channelHint}>{anyLiveLink ? 'Tap a channel to open the live listing.' : 'Tap a channel to manage it.'}</Text>

              {showConnectFacebook ? (
                <TouchableOpacity activeOpacity={0.7} onPress={() => setConnectFlowOpen(true)} style={[styles.preflightCard, { marginTop: 6 }]}>
                  <Icon name="facebook" size={20} color="#BA7517" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.preflightTitle}>Connect Facebook first</Text>
                    <Text style={styles.preflightBody}>Link your Facebook account to post here. It only takes a moment.</Text>
                  </View>
                  <Icon name="chevron-right" size={18} color="#C4C8CE" />
                </TouchableOpacity>
              ) : null}

              {showComputerPreflight ? (
                <TouchableOpacity activeOpacity={0.7} onPress={() => setLinkComputerOpen(true)} style={[styles.preflightCard, { marginTop: 6 }]}>
                  <Icon name="laptop" size={20} color="#BA7517" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.preflightTitle}>Posts when your computer’s on</Text>
                    <Text style={styles.preflightBody}>Facebook goes live through your Mac. It’ll post automatically once Anorha is open, or link a computer now.</Text>
                  </View>
                  <Icon name="chevron-right" size={18} color="#C4C8CE" />
                </TouchableOpacity>
              ) : null}
            </View>
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
            <PillButton label="View in inventory" variant="secondary" onPress={handleReviewInInventory} />
            <PillButton label="Create another listing" onPress={handleCreateAnother} />
          </View>
        </>
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
  // Logo square used by the legacy renderLogoSquare helper.
  image: { width: '100%', height: '100%' },

  // Footer — the pinned primary/secondary pill stack.
  footer: { gap: 10, paddingHorizontal: 20, paddingTop: 12 },

  // Error state — inline "Couldn't publish" + Retry (never a false success).
  errorCircle: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  errorTitle: { fontSize: 24, fontWeight: '700', color: IC.ink, letterSpacing: -0.5, textAlign: 'center' },
  errorLine: { fontSize: 15, color: IC.muted, textAlign: 'center', lineHeight: 21, marginTop: 8 },

  // Publishing (in-flight) state — spinner + "Publishing…".
  publishingText: { fontSize: 18, fontWeight: '600', color: IC.ink, letterSpacing: -0.3 },
  publishingSub: { fontSize: 14, color: IC.muted, textAlign: 'center', lineHeight: 20 },

  // Channel rows — calm Avec soft-card rows: logo · name · right-side link/status.
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: IC.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  channelName: { fontSize: 16, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  channelRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  liveLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  liveLinkText: { fontSize: 14, fontWeight: '700', color: IC.accent, letterSpacing: -0.1 },
  channelHint: { fontSize: 13, color: IC.muted, marginTop: 8, marginBottom: 2, marginLeft: 4 },

  // Facebook pre-flight prompts (connect / computer-offline) — warm attention cards.
  preflightCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FDF6EC', borderColor: '#F0E2CC', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  preflightTitle: { color: '#7A5210', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  preflightBody: { color: '#9A7A45', fontSize: 12, lineHeight: 17 },
});

export default PublishConfirmationScreen;


