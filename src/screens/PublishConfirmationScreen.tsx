import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Linking, ActivityIndicator, BackHandler, Image } from 'react-native';
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
import { ensureSupabaseJwt } from '../lib/supabase';
import { apiFetch, ApiError } from '../lib/apiClient';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useOptimizerQueues } from '../hooks/useOptimizerQueues';
import { IC, InboxHeader, SuccessBlock, PillButton, SectionCaption } from '../components/importinbox/InboxKit';
import { createLogger } from '../utils/logger';
import {
  countProvenPublishSuccesses,
  decidePublishStart,
  initializePublishOutcomes,
  publishOutcomeClaim,
  reconcilePublishOutcomes,
  type PublishOutcomeMap,
} from '../lib/publishOutcomes';
const log = createLogger('PublishConfirmationScreen');

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
);

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const quantityFromLocations = (value: unknown): number | null => {
  const locations = asRecord(value);
  if (!locations) return null;
  let found = false;
  let total = 0;
  for (const location of Object.values(locations)) {
    const locationRecord = asRecord(location);
    const quantity = finiteNumber(locationRecord?.quantity ?? location);
    if (quantity === null) continue;
    found = true;
    total += quantity;
  }
  return found ? total : null;
};

const quantityFromPlatformDetail = (value: unknown): number | null => {
  const detail = asRecord(value);
  if (!detail) return null;

  if (Array.isArray(detail.variants) && detail.variants.length > 0) {
    let found = false;
    let total = 0;
    for (const variantValue of detail.variants) {
      const variant = asRecord(variantValue);
      if (!variant) continue;
      const quantity = quantityFromLocations(variant.inventoryByLocation)
        ?? finiteNumber(variant.inventoryQuantity)
        ?? finiteNumber(variant.quantity);
      if (quantity === null) continue;
      found = true;
      total += quantity;
    }
    if (found) return total;
  }

  const listingDetails = asRecord(detail.listingDetails);
  const locationQuantities = asRecord(detail.locationQuantities);
  return quantityFromLocations(detail.inventoryByLocation)
    ?? finiteNumber(detail.inventoryQuantity)
    ?? finiteNumber(detail.quantity)
    ?? finiteNumber(listingDetails?.quantity)
    ?? finiteNumber(locationQuantities?.default);
};

const priceFromPlatformDetail = (value: unknown): number | null => {
  const detail = asRecord(value);
  if (!detail) return null;
  const direct = finiteNumber(detail.price);
  if (direct !== null) return direct;
  if (!Array.isArray(detail.variants)) return null;
  for (const variantValue of detail.variants) {
    const price = finiteNumber(asRecord(variantValue)?.price);
    if (price !== null) return price;
  }
  return null;
};


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

  const publishPayloadRecord = asRecord(publishPayload);
  const payloadPlatformDetails = asRecord(publishPayloadRecord?.platformDetails);
  const payloadSelectedPlatforms: string[] = Array.isArray(publishPayloadRecord?.selectedPlatformsToPublish)
    ? publishPayloadRecord.selectedPlatformsToPublish
      .filter((platform: unknown): platform is string => typeof platform === 'string' && platform.length > 0)
    : [];
  const paramPlatforms: string[] = Array.isArray(platforms)
    ? platforms.filter((platform: unknown): platform is string => typeof platform === 'string' && platform.length > 0)
    : [];
  const publishedPlatforms: string[] = Array.from(new Set<string>(
    (payloadSelectedPlatforms.length > 0 ? payloadSelectedPlatforms : paramPlatforms)
      .map((platform) => platform.toLowerCase()),
  ));
  const receiptSources = [
    ...publishedPlatforms.map((platform) => payloadPlatformDetails?.[platform]),
    payloadPlatformDetails?.canonical,
  ];
  const payloadMedia = asRecord(publishPayloadRecord?.media);
  const payloadImages: string[] = Array.isArray(payloadMedia?.imageUris)
    ? payloadMedia.imageUris.filter((uri: unknown): uri is string => typeof uri === 'string' && uri.length > 0)
    : [];
  const coverImageIndex = finiteNumber(payloadMedia?.coverImageIndex) ?? 0;
  const receiptImageUrl = payloadImages[coverImageIndex] || imageUrl;
  const receiptTitle = receiptSources
    .map((source) => asRecord(source)?.title)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    ?? title;
  const receiptPrice = receiptSources
    .map(priceFromPlatformDetail)
    .find((value): value is number => value !== null)
    ?? finiteNumber(price);

  // Facebook posts asynchronously through the user's computer — show its live
  // dispatch status here instead of implying a synchronous "Published!".
  const fbDispatch = useFacebookJobStatus();
  const { liveConnections } = usePlatformConnections();
  const fbSelected = publishedPlatforms.includes('facebook');
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
    !fbDispatch.presenceUnavailable &&
    !fbAlreadyMoving;

  // Representative quantity for the summary line from the exact publish details.
  const summaryQty = (() => {
    const payloadQuantities = receiptSources
      .map(quantityFromPlatformDetail)
      .filter((value): value is number => value !== null);
    if (payloadQuantities.length > 0) return Math.max(...payloadQuantities);
    const paramQuantities = Object.values(quantityByPlatform || {})
      .map(finiteNumber)
      .filter((value): value is number => value !== null);
    return paramQuantities.length > 0 ? Math.max(...paramQuantities) : null;
  })();

  // ── Publish phase ──────────────────────────────────────────────────────────
  // When we arrive in 'publishing' mode this screen OWNS the POST: a calm "Publishing…"
  // state shows while it runs, then resolves to "Published!" only on a real 2xx. On failure
  // it shows an inline error + Retry — never a false success, never an abrupt pop-back.
  const initialPublishDecision = mode === 'publishing'
    ? decidePublishStart(publishPayloadRecord !== null)
    : 'publishing';
  const [phase, setPhase] = useState<'publishing' | 'done' | 'error'>(
    mode === 'publishing' ? initialPublishDecision : 'done',
  );
  const [errorMsg, setErrorMsg] = useState(
    mode === 'publishing' && initialPublishDecision === 'error'
      ? 'Publishing details are missing. Go back and try again.'
      : '',
  );
  // Per-platform "open the live listing" URLs. Seeded from params (for non-owning callers),
  // then filled from the publish response so channel rows deep-link to the real marketplace page.
  const [liveUrls, setLiveUrls] = useState<Record<string, any>>(params.liveUrls || {});
  // Complete by construction: every requested channel exists as pending before
  // the request. Only an explicit successful result can make it green.
  const [publishResults, setPublishResults] = useState<PublishOutcomeMap>(() => (
    initializePublishOutcomes(publishedPlatforms)
  ));
  const [imageFailed, setImageFailed] = useState(false);
  const ranRef = useRef(false);
  // ONE base idempotency key per full-publish intent. This screen is mounted fresh per
  // publish (new route params), so a per-instance key identifies that full payload and
  // "Try again" reuses it. A per-channel retry is a different payload, so it derives a
  // subset-scoped key from the same base plus the sorted, lowercased channel identity.
  // Retrying that same subset reuses its key, while a different subset cannot be falsely
  // deduped. The apiFetch layer sends the selected key as the Idempotency-Key header.
  const publishIdemKeyRef = useRef<string>('');
  if (!publishIdemKeyRef.current) {
    publishIdemKeyRef.current = `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const activePublishSubsetRef = useRef<string[] | null>(null);
  const activePublishIdemKeyRef = useRef(publishIdemKeyRef.current);

  const runPublish = useCallback(async (platformSubset?: string[]) => {
    if (!publishPayloadRecord) {
      setErrorMsg('Publishing details are missing. Go back and try again.');
      setPhase('error');
      return;
    }
    const normalizedSubset = platformSubset?.map((platform) => platform.toLowerCase());
    if (normalizedSubset) {
      activePublishSubsetRef.current = normalizedSubset;
      const subsetIdentity = [...normalizedSubset].sort().join(',');
      activePublishIdemKeyRef.current = `${publishIdemKeyRef.current}-subset-${subsetIdentity}`;
    }
    const requestedPlatforms = activePublishSubsetRef.current || publishedPlatforms;
    const requestPayload = requestedPlatforms
      ? {
        ...publishPayloadRecord,
        selectedPlatformsToPublish: requestedPlatforms,
        connectionIds: Object.fromEntries(
          Object.entries(asRecord(publishPayloadRecord.connectionIds) || {}).filter(([platform]) => requestedPlatforms.includes(platform.toLowerCase())),
        ),
      }
      : publishPayloadRecord;
    setPublishResults((previous) => ({
      ...previous,
      ...initializePublishOutcomes(requestedPlatforms),
    }));
    setPhase('publishing');
    setErrorMsg('');
    try {
      const token = await ensureSupabaseJwt();
      if (!token) { setErrorMsg('Your session expired. Sign in again.'); setPhase('error'); return; }
      // Route through apiFetch (auth + Idempotency-Key + the client's default 18s timeout)
      // so a stalled POST throws instead of pinning "Publishing…" forever, and a retry is
      // deduped by the stable key above.
      const res = await apiFetch('/api/products/publish', {
        method: 'POST',
        body: requestPayload,
        idempotencyKey: activePublishIdemKeyRef.current,
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
        if (activePublishSubsetRef.current) {
          setPublishResults((previous) => {
            const next = { ...previous };
            requestedPlatforms.forEach((platform) => {
              next[platform] = { status: 'failed', error: msg || 'Couldn’t publish this channel.' };
            });
            return next;
          });
          setPhase('done');
        } else {
          setErrorMsg(msg || 'Something went wrong while publishing.');
          setPhase('error');
        }
        return;
      }
      // Capture the live-listing URLs the publish endpoint resolved (eBay item, Shopify
      // admin product, …) so the channel rows deep-link to the real page.
      const body = await res.json().catch(() => null);
      if (body?.listings && typeof body.listings === 'object') {
        setLiveUrls((prev) => ({ ...prev, ...body.listings }));
      }
      // The endpoint returns 202 even when platforms fail — the truth is in `results`.
      // Every platform failed → this is an error, not a "Published!"; partial failures
      // stay on the summary but mark their rows honestly.
      const map = reconcilePublishOutcomes(
        requestedPlatforms,
        Array.isArray(body?.results) ? body.results : [],
      );
      setPublishResults((previous) => activePublishSubsetRef.current
        ? { ...previous, ...map }
        : map);
      if (Array.isArray(body?.results) && body.results.length) {
        const entries = Object.values(map);
        if (entries.length && entries.every((result) => result.status === 'failed')) {
          if (activePublishSubsetRef.current) {
            setPhase('done');
          } else {
            setErrorMsg(entries.find((result) => result.error)?.error || 'None of your channels accepted the listing.');
            setPhase('error');
          }
          return;
        }
      }
      setPhase('done');
    } catch (e: any) {
      log.error('[PublishConfirmation] Publish error:', e);
      // A client timeout (ApiError status 0, "Request timed out") reads calmer as a
      // "taking too long" nudge; the same stable idempotency key makes "Try again" safe.
      const msg =
        e instanceof ApiError && e.status === 0
          ? 'This is taking longer than expected. Please try again.'
          : 'Something went wrong while publishing. Please try again.';
      if (activePublishSubsetRef.current) {
        setPublishResults((previous) => {
          const next = { ...previous };
          requestedPlatforms.forEach((platform) => {
            next[platform] = { status: 'failed', error: msg };
          });
          return next;
        });
        setPhase('done');
      } else {
        setErrorMsg(msg);
        setPhase('error');
      }
    }
  }, [publishPayloadRecord, publishedPlatforms]);

  useEffect(() => {
    if (mode !== 'publishing' || ranRef.current) return;
    ranRef.current = true;
    runPublish();
  }, [mode, runPublish]);

  // True once at least one channel has resolved a real live-listing link.
  const anyLiveLink = (publishedPlatforms.length ? publishedPlatforms : ['shopify']).some((p: string) => {
    const l: any = (liveUrls || {})[String(p).toLowerCase()];
    const hasUrl = typeof l === 'string' ? !!l : !!l?.url;
    return hasUrl && publishResults[String(p).toLowerCase()]?.status === 'success';
  });

  const goBack = useCallback(() => {
    if (backRoute?.name) {
      navigation.navigate(backRoute.name as any, backRoute.params as any);
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
  }, [backRoute, navigation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => subscription.remove();
  }, [goBack]);

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
      navigation.navigate('ProductDetail', { productId: idToUse, initialMode: 'overview' });
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
    return <ImportCompleteView params={params} navigation={navigation} onBack={goBack} />;
  }

  // Single-product publish — a calm "Publishing…" state runs while the POST is in flight,
  // then resolves into the Avec "Published!" summary: green check, a muted summary line,
  // and per-channel calm rows (live deep-links + every dispatch nuance preserved).
  const channelKeys: string[] = publishedPlatforms.length ? publishedPlatforms : ['shopify'];
  const failedChannelCount = channelKeys.filter((platform) => publishResults[platform]?.status === 'failed').length;
  const unknownChannelCount = channelKeys.filter((platform) => publishResults[platform]?.status === 'confirmation_unknown').length;
  const successfulChannelCount = countProvenPublishSuccesses(channelKeys, publishResults);
  const isPartialPublish = !savedToInventory && failedChannelCount > 0 && successfulChannelCount > 0;
  const doneTitle = savedToInventory
    ? 'Saved to inventory'
    : successfulChannelCount === channelKeys.length && channelKeys.length > 0
      ? 'Published!'
      : successfulChannelCount > 0
      ? `Published to ${successfulChannelCount} of ${channelKeys.length}`
      : `${successfulChannelCount} of ${channelKeys.length} confirmed`;
  const summaryLine = [
    receiptTitle ? String(receiptTitle) : null,
    channelKeys.length ? `${channelKeys.length} channel${channelKeys.length === 1 ? '' : 's'}` : null,
    summaryQty !== null ? `Qty ${summaryQty}` : null,
  ].filter(Boolean).join(' · ');

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
            {publishPayloadRecord ? (
              <PillButton label="Try again" onPress={() => { void runPublish(); }} />
            ) : null}
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
              {isPartialPublish || unknownChannelCount > 0 ? (
                <View style={styles.partialBlock}>
                  <View style={styles.partialCircle}>
                    <Icon name="alert-outline" size={32} color="#6B7280" />
                  </View>
                  <Text style={styles.partialTitle}>{doneTitle}</Text>
                  {!!summaryLine && <Text style={styles.partialLine}>{summaryLine}</Text>}
                </View>
              ) : (
                <SuccessBlock title={doneTitle} lines={[summaryLine]} />
              )}
            </View>

            <View style={{ paddingHorizontal: 20 }}>
              <View style={styles.itemCard}>
                {receiptImageUrl && !imageFailed ? (
                  <Image
                    source={{ uri: receiptImageUrl }}
                    style={styles.itemImage}
                    resizeMode="cover"
                    onError={() => setImageFailed(true)}
                  />
                ) : (
                  <View style={[styles.itemImage, styles.itemImageEmpty]}>
                    <Icon name="image-outline" size={24} color="#C4C8CE" />
                  </View>
                )}
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle} numberOfLines={2}>{receiptTitle || 'Untitled product'}</Text>
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemPrice}>
                      {receiptPrice !== null ? `$${receiptPrice.toFixed(2)}` : 'Price not set'}
                    </Text>
                    <Text style={styles.itemMetaDot}>·</Text>
                    <Text style={styles.itemQuantity}>{summaryQty !== null ? `Qty ${summaryQty}` : 'Quantity not set'}</Text>
                  </View>
                </View>
              </View>

              <SectionCaption>{savedToInventory ? 'In inventory' : 'Live on'}</SectionCaption>

              {channelKeys.map((p: string, i: number) => {
                const lower = String(p).toLowerCase();
                const isFb = lower === 'facebook';
                // Live URL may arrive as a {url,id} object (new) or a bare string (legacy param).
                const live: any = (liveUrls || {})[lower];
                const url: string | undefined = typeof live === 'string' ? live : live?.url;
                const hasLink = !!url;
                // A per-platform failure from the publish response overrides everything —
                // that row must not read "Live". Otherwise FB keeps its full dispatch
                // vocabulary (queued / posting / waiting-for-computer / needs-a-check /
                // couldn't-post); everything else without a link reads a quiet "Live" —
                // unless this was an inventory-only save, where nothing is live yet.
                const outcome = publishResults[lower];
                const failed = outcome?.status === 'failed';
                const confirmationUnknown = outcome?.status === 'confirmation_unknown';
                const provenSuccess = outcome?.status === 'success';
                const outcomeClaim = publishOutcomeClaim(outcome, platformLabel(lower));
                const st = failed
                  ? { dotColor: '#BA7517', color: '#BA7517', label: outcomeClaim.label }
                  : confirmationUnknown
                    ? { dotColor: '#9CA3AF', color: '#71717A', label: outcomeClaim.label }
                  : isFb
                    ? (fbStatus || (fbDispatch.degraded || fbDispatch.jobsUnavailable
                      ? { dotColor: '#9CA3AF', color: '#71717A', label: "Can't check now" }
                      : !fbDispatch.jobsLoaded
                        ? { dotColor: '#9CA3AF', color: '#71717A', label: 'Checking' }
                        : { dotColor: '#9CA3AF', color: '#71717A', label: 'Posting soon' }))
                    : savedToInventory
                      ? { dotColor: IC.muted, color: IC.muted, label: 'In inventory' }
                      : provenSuccess
                        ? { dotColor: IC.accent, color: IC.accent, label: outcomeClaim.label }
                        : { dotColor: '#9CA3AF', color: '#71717A', label: outcomeClaim.label };
                const canRetryDispatch = isFb && !!fbStatus?.canRetry && !!publishPayload;
                const opensComputerSheet = isFb && !!fbStatus?.opensComputerSheet;
                // Non-owning confirmation routes do not carry publishPayload, so
                // they have no truthful redispatch seam and must not show Retry.
                // A real listing link → open the marketplace page. Otherwise the row still
                // opens the in-app product (where they can manage/retry); FB without a link
                // is inert — unless its publish failed, which must stay actionable.
                const tappable = confirmationUnknown || hasLink || !isFb || failed || canRetryDispatch || opensComputerSheet;
                return (
                  <TouchableOpacity
                    key={`${p}-${i}`}
                    disabled={!tappable}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (failed || confirmationUnknown || canRetryDispatch) {
                        void runPublish([lower]);
                      } else if (opensComputerSheet) {
                        setLinkComputerOpen(true);
                      } else if (url) {
                        Linking.openURL(url).catch(() => undefined);
                      } else {
                        handleReviewInInventory();
                      }
                    }}
                    style={[styles.channelRow, (failed || confirmationUnknown) && styles.channelRowFailed]}
                    accessibilityLabel={confirmationUnknown
                      ? `Re-check ${platformLabel(lower)}`
                      : failed || canRetryDispatch
                        ? `Retry ${platformLabel(lower)}`
                        : undefined}
                  >
                    <PlatformBrandChip platform={lower} size={34} />
                    <Text style={styles.channelName} numberOfLines={1}>{platformLabel(lower)}</Text>
                    <View style={styles.channelRight}>
                      {failed || confirmationUnknown || canRetryDispatch ? (
                        <>
                          <Text style={styles.failedStatus}>{st.label}</Text>
                          <View style={styles.retryAction}>
                            <Icon name="refresh" size={16} color="#8A5A12" />
                            <Text style={styles.retryActionText}>{confirmationUnknown ? 'Re-check' : 'Retry'}</Text>
                          </View>
                        </>
                      ) : hasLink && provenSuccess ? (
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
                      {tappable && !hasLink && !failed && !confirmationUnknown && !canRetryDispatch ? <Icon name="chevron-right" size={20} color={IC.muted} /> : null}
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
const ImportCompleteView: React.FC<{ params: any; navigation: any; onBack: () => void }> = ({ params, navigation, onBack }) => {
  const insets = useSafeAreaInsets();
  // Cheap gap check — same catalog-wide counts the hub/optimizer use.
  const { counts: optCounts, loading: optLoading, error: optError, refresh: optRefresh } = useOptimizerQueues();

  const {
    platforms = [],
    importCount,
    importCounts,
    savedToInventory,
    connectionId,
    platformName,
  } = params;

  const linked = (importCounts?.linked ?? 0) + (importCounts?.autoLinked ?? 0);
  const created = (importCounts?.created ?? 0) + (importCounts?.autoCreated ?? 0);
  const ignored = importCounts?.ignored ?? 0;

  // Only non-zero rows, per the brief.
  const segments = [
    linked > 0 ? `${linked} linked` : null,
    created > 0 ? `${created} added` : null,
    ignored > 0 ? `${ignored} ignored` : null,
  ].filter(Boolean) as string[];

  const receiptN = importCounts
    ? linked + created
    : typeof importCount === 'number'
      ? importCount
      : platforms?.length || 0;

  const subtitle = segments.length
    ? segments.join(' · ')
    : platforms.length > 0
      ? `${receiptN} item${receiptN === 1 ? '' : 's'} · ${platforms.length} channel${platforms.length === 1 ? '' : 's'}`
      : `${receiptN} item${receiptN === 1 ? '' : 's'} ready`;

  // Only REQUIRED gaps carry the "Continue" push — polish is invited from the
  // hub, never chained. That keeps this receipt's next-step honest: it only
  // nags about items a connected store will refuse.
  const optRemaining = optCounts.required;
  const hasNext = !optLoading && optRemaining > 0;

  const goReview = () => navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
  const goQueue = () => {
    if (!connectionId) {
      goReview();
      return;
    }
    navigation.replace('ImportQuestionQueue' as any, {
      connectionId,
      platformName: platformName || platforms[0] || 'Platform',
    });
  };
  const goOptimize = () =>
    navigation.replace('BackfillOptimizer' as any, { source: 'hub-required' });

  // Hold a neutral label until optimizer counts settle so the CTA doesn't flip
  // from "Done" to "Continue — N" mid-read.
  const primaryLabel = optLoading ? 'Checking what’s next…' : hasNext ? `Continue, ${optRemaining} to finish` : 'Done';
  const onPrimary = optLoading ? () => {} : hasNext ? goOptimize : goQueue;

  // Second status line: only when required gaps remain.
  const nextLine = hasNext
    ? `${optRemaining} item${optRemaining === 1 ? '' : 's'} still missing required details`
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF', paddingTop: insets.top + 6 }}>
      <InboxHeader
        onBack={onBack}
      />
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 24 }}>
        <SuccessBlock
          title={savedToInventory ? 'Saved to inventory' : 'Import complete'}
          lines={[subtitle, nextLine]}
        />
        {/* The gap check failed — say so quietly rather than defaulting the CTA to a false
            "Done" (which would hide items that still need photos/details). Calm, no red. */}
        {optError && !optLoading ? (
          <TouchableOpacity onPress={optRefresh} activeOpacity={0.7} style={{ marginTop: 16, alignSelf: 'center' }}>
            <Text style={{ fontSize: 14, color: IC.muted, textAlign: 'center' }}>
              Couldn’t check what’s left — <Text style={{ color: IC.accent, fontWeight: '700' }}>Retry</Text>
            </Text>
          </TouchableOpacity>
        ) : null}
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

  partialBlock: { alignItems: 'center', paddingHorizontal: 24 },
  partialCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F1F1EF', alignItems: 'center', justifyContent: 'center' },
  partialTitle: { fontSize: 26, fontWeight: '700', color: IC.ink, letterSpacing: -0.6, marginTop: 20, textAlign: 'center' },
  partialLine: { fontSize: 15, color: IC.muted, marginTop: 8, textAlign: 'center', lineHeight: 21 },

  // Published item — a quiet receipt card before the per-channel rows.
  itemCard: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EDEEF1', borderRadius: 16, padding: 12, marginBottom: 18 },
  itemImage: { width: 72, height: 72, borderRadius: 12, backgroundColor: '#ECECEF' },
  itemImageEmpty: { alignItems: 'center', justifyContent: 'center' },
  itemInfo: { flex: 1, minWidth: 0, gap: 7 },
  itemTitle: { fontSize: 16, lineHeight: 21, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  itemPrice: { fontSize: 14, fontWeight: '700', color: IC.ink },
  itemMetaDot: { fontSize: 13, color: '#C4C8CE' },
  itemQuantity: { fontSize: 13, fontWeight: '600', color: IC.muted },

  // Channel rows — calm Avec soft-card rows: logo · name · right-side link/status.
  channelRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: IC.card, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  channelRowFailed: { backgroundColor: '#FBF5EA', borderWidth: 1, borderColor: '#EEDAB7' },
  channelName: { fontSize: 16, fontWeight: '700', color: IC.ink, letterSpacing: -0.2 },
  channelRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  liveLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  liveLinkText: { fontSize: 14, fontWeight: '700', color: IC.accent, letterSpacing: -0.1 },
  failedStatus: { fontSize: 12, fontWeight: '600', color: '#8A5A12', flexShrink: 1 },
  retryAction: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDBE88', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  retryActionText: { fontSize: 13, fontWeight: '800', color: '#8A5A12' },
  channelHint: { fontSize: 13, color: IC.muted, marginTop: 8, marginBottom: 2, marginLeft: 4 },

  // Facebook pre-flight prompts (connect / computer-offline) — warm attention cards.
  preflightCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FDF6EC', borderColor: '#F0E2CC', borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  preflightTitle: { color: '#7A5210', fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  preflightBody: { color: '#9A7A45', fontSize: 12, lineHeight: 17 },
});

export default PublishConfirmationScreen;
