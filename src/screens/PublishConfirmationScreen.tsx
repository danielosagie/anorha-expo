import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, PackagePlus } from 'lucide-react-native';
import PlatformLogo from '../components/PlatformLogo';
import PrintingComplete from '../components/import/PrintingComplete';
import { normalizeDisplayName } from '../config/platforms';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
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
  } = params;

  // Facebook posts asynchronously through the user's computer — show its live
  // dispatch status here instead of implying a synchronous "Published!".
  const fbDispatch = useFacebookJobStatus();
  const fbSelected = (platforms || []).map((p: string) => String(p).toLowerCase()).includes('facebook');
  const fbStatus = fbSelected ? fbDispatch.statusForVariant(variantId) : null;

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
        <PrintingComplete
          title={savedToInventory ? 'Saved to inventory' : 'Published!'}
          subtitle={savedToInventory ? 'In your inventory' : (platforms.length > 0 ? `Live on ${platforms.length} channel${platforms.length === 1 ? '' : 's'}` : 'Live')}
          platforms={platforms}
          stamp={savedToInventory ? '· SAVED' : '· LIVE'}
          syncingLabel={savedToInventory ? 'Saving…' : 'Going live…'}
          primaryLabel="View listing"
          onPrimary={handleReviewInInventory}
          secondaryLabel="List another"
          onSecondary={handleCreateAnother}
        />
        {fbStatus && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: fbStatus.dotColor }} />
            <Text style={{ color: fbStatus.color, fontSize: 13, fontWeight: '600' }}>Facebook · {fbStatus.label}</Text>
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


