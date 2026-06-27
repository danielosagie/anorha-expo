import React, { useEffect, useState, useCallback, useRef } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, PackagePlus } from 'lucide-react-native';
import PlatformLogo from '../components/PlatformLogo';
import PrintingComplete from '../components/import/PrintingComplete';
import { normalizeDisplayName, getPlatform } from '../config/platforms';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { API_BASE_URL } from '../config/env';
import { ensureSupabaseJwt } from '../lib/supabase';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { createLogger } from '../utils/logger';
const log = createLogger('PublishConfirmationScreen');


type Props = StackScreenProps<AppStackParamList, 'PublishConfirmation'>;

const PublishConfirmationScreen: React.FC<Props> = ({ route, navigation }) => {
  const params: any = route.params || {};
  const {
    productId,
    variantId,
    title,
    description,
    price,
    imageUrl,
    platforms = [],
    accountNames = [],
    quantityByPlatform = {},
    origin = 'generate',
    sourcePlatform,
    importCount,
    syncRules,

    backRoute,
    savedToInventory,
    mode,            // 'publishing' → this screen owns the publish POST
    publishPayload,  // the ready-to-send body for /api/products/publish
  } = params;

  // Facebook posts asynchronously through the user's computer — show its live
  // dispatch status here instead of implying a synchronous "Published!".
  const fbDispatch = useFacebookJobStatus();
  const fbSelected = (platforms || []).map((p: string) => String(p).toLowerCase()).includes('facebook');
  const fbStatus = fbSelected ? fbDispatch.statusForVariant(variantId) : null;

  // ── Publish phase ──────────────────────────────────────────────────────────
  // When we arrive in 'publishing' mode this screen OWNS the POST: the receipt prints
  // while it runs, then morphs to "Published!" only on a real 2xx. On failure it shows an
  // inline error + Retry — never a false success, never an abrupt pop-back.
  const [phase, setPhase] = useState<'publishing' | 'done' | 'error'>(mode === 'publishing' ? 'publishing' : 'done');
  const [errorMsg, setErrorMsg] = useState('');
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

  const handleExitImport = () => {
    navigation.navigate('TabNavigator' as any, { screen: 'Profile' } as any);
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
  // animation that morphs into the result card. (Single-product publish keeps
  // the static layout below.)
  if (origin === 'import') {
    const n = typeof importCount === 'number' ? importCount : (platforms?.length || 0);
    const sub =
      platforms.length > 0
        ? `${n} item${n === 1 ? '' : 's'} · live on ${platforms.length} channel${platforms.length === 1 ? '' : 's'}`
        : `${n} item${n === 1 ? '' : 's'} ready`;
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ marginTop: 30 }}>
          <TouchableOpacity
            onPress={() => {
              if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any);
              else navigation.goBack();
            }}
            style={styles.backBtn}
          >
            <Icon name="arrow-left" size={18} color={'#000'} />
            <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
          <PrintingComplete
            title={savedToInventory ? 'Saved to inventory' : 'Import complete'}
            subtitle={sub}
            platforms={platforms}
            stamp={`#${String(n).padStart(4, '0')} · SYNCED`}
            syncingLabel="Syncing your listings…"
            primaryLabel="Review listings"
            onPrimary={handleReviewInInventory}
            secondaryLabel="Exit import"
            onSecondary={handleExitImport}
          />
        </View>
      </View>
    );
  }

  // Single-product publish — the same printer-receipt → result-card animation as import:
  // the receipt prints out of the printer, tears off, and morphs into the result card.
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ marginTop: 30 }}>
        <TouchableOpacity
          onPress={() => { if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any); else navigation.goBack(); }}
          style={styles.backBtn}
        >
          <Icon name="arrow-left" size={18} color={'#000'} />
          <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
        </TouchableOpacity>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
        {phase === 'error' ? (
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
              <TouchableOpacity
                onPress={() => { if (backRoute && backRoute.name) navigation.navigate(backRoute.name as any, backRoute.params as any); else navigation.goBack(); }}
                style={[styles.secondaryBtn, { marginTop: 0 }]}
              >
                <Text style={styles.secondaryText}>Back to editor</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : phase === 'publishing' ? (
          // Prints the receipt and HOLDS (ready=false) until the POST returns; then we swap
          // in the rich card below.
          <PrintingComplete
            title={savedToInventory ? 'Saving…' : 'Going live'}
            subtitle={platforms.length > 0 ? `${platforms.length} channel${platforms.length === 1 ? '' : 's'}` : ''}
            platforms={platforms}
            stamp={savedToInventory ? '· SAVED' : '· LIVE'}
            syncingLabel={savedToInventory ? 'Saving…' : 'Going live…'}
            primaryLabel="View listing"
            onPrimary={handleReviewInInventory}
            secondaryLabel="List another"
            onSecondary={handleCreateAnother}
            ready={false}
          />
        ) : (
          // phase 'done' — the rich result: cover, status, per-channel live rows, actions.
          <View style={{ flex: 1, alignSelf: 'stretch', paddingTop: 8 }}>
            <View style={{ alignItems: 'center', gap: 14 }}>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={{ width: 132, height: 132, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB' }} />
              ) : (
                <View style={{ width: 132, height: 132, borderRadius: 16, backgroundColor: '#E7E1D6', borderWidth: 1, borderColor: '#E5E7EB' }} />
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#93C822', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={15} color="#FFFFFF" />
                </View>
                <Text style={{ color: '#18181B', fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{savedToInventory ? 'Saved!' : 'Published!'}</Text>
              </View>
            </View>

            <Text style={{ color: '#9CA3AF', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 22, marginBottom: 8 }}>{savedToInventory ? 'IN INVENTORY' : 'LIVE ON'}</Text>

            <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, overflow: 'hidden' }}>
              {(platforms.length ? platforms : ['shopify']).map((p: string, i: number) => {
                const lower = String(p).toLowerCase();
                const isFb = lower === 'facebook';
                const st = isFb
                  ? (fbStatus || { dotColor: '#BA7517', color: '#BA7517', label: 'Posting via your computer…' })
                  : { dotColor: '#93C822', color: '#93C822', label: 'Live' };
                const brand = getPlatform(lower)?.brandColor || '#6B7280';
                const url = (params.liveUrls || {})[lower];
                const tappable = !isFb;
                return (
                  <View key={`${p}-${i}`}>
                    {i > 0 && <View style={{ height: 1, backgroundColor: '#F1F2F4' }} />}
                    <TouchableOpacity disabled={!tappable} activeOpacity={0.7} onPress={() => { if (url) Linking.openURL(url).catch(() => undefined); else handleReviewInInventory(); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 13 }}>
                      <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: brand, alignItems: 'center', justifyContent: 'center' }}>
                        <PlatformLogo type={lower} size={17} color="#FFFFFF" />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: '#18181B', fontSize: 15, fontWeight: '700' }}>{platformLabel(lower)}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: st.dotColor }} />
                          <Text style={{ color: st.color, fontSize: 12, fontWeight: '600' }}>{st.label}{tappable ? ' · view' : ''}</Text>
                        </View>
                      </View>
                      {tappable ? <Icon name="open-in-new" size={16} color="#6B7280" /> : null}
                      {tappable ? <Icon name="chevron-right" size={18} color="#C4C8CE" /> : null}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            <Text style={{ color: '#9CA3AF', fontSize: 12, fontWeight: '500', marginTop: 9 }}>Tap a channel to open the live listing.</Text>

            <View style={{ flex: 1 }} />

            <View style={{ gap: 10, paddingBottom: 10 }}>
              <TouchableOpacity onPress={handleCreateAnother} activeOpacity={0.9} style={{ backgroundColor: '#93C822', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '800' }}>Create another listing</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleReviewInInventory} activeOpacity={0.85} style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}>
                <Text style={{ color: '#3F3F46', fontSize: 15, fontWeight: '600' }}>View in inventory</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
  backBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' },
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
});

export default PublishConfirmationScreen;


