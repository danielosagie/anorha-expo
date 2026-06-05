import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes, PackagePlus } from 'lucide-react-native';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import SquareSvg from '../assets/square.svg';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';

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

  const handleCreateAnother = () => {
    // Go to the add product flow in the current stack
    navigation.navigate('TabNavigator' as any, { screen: 'AddProduct' } as any);
  };

  const handleReviewInInventory = () => {
    console.log('[PublishConfirmation] handleReviewInInventory called');
    console.log('[PublishConfirmation] origin:', origin);
    console.log('[PublishConfirmation] productId:', productId);
    console.log('[PublishConfirmation] variantId:', variantId);

    // For import flow (multiple products), always go to Inventory tab
    if (origin === 'import') {
      console.log('[PublishConfirmation] Import origin - navigating to Inventory tab');
      navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
      return;
    }

    // For publish flow (single product), try to go to ProductDetail
    // Use variantId first since ProductDetail queries ProductVariants table
    const idToUse = variantId || productId;

    if (idToUse) {
      console.log('[PublishConfirmation] Navigating to ProductDetail with ID:', idToUse);
      navigation.navigate('ProductDetail', { productId: idToUse });
    } else {
      console.log('[PublishConfirmation] No valid ID, navigating to Inventory tab');
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

  return (
    <View style={{ flex: 1, backgroundColor: "white", flexDirection: "column", gap: 2, }}>

      {/* Back */}
      <View style={{ backgroundColor: "green", marginTop: 30, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => {
          if (backRoute && backRoute.name) {
            navigation.navigate(backRoute.name as any, backRoute.params as any);
          } else {
            navigation.goBack();
          }
        }} style={styles.backBtn}>
          <Icon name="arrow-left" size={18} color={'#000'} />
          <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1, flexDirection: "column", justifyContent: "center", paddingHorizontal: 30, paddingTop: 40, gap: 8 }}>


        {/* Image */}
        <View style={styles.imageWrap}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.image} />
          ) : (
            renderLogoSquare()
          )}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: "center" }}>
          <Icon name="check-circle" size={22} color={BRAND_PRIMARY} />
          <Text style={{ color: '#000', fontWeight: '600', fontSize: 20 }}>
            {savedToInventory ? 'Saved to Inventory' : (origin === 'import' ? 'Import Complete!' : 'Product Published!')}
          </Text>
        </View>

        {/* Details Card */}
        <View style={{}}>
          <ScrollView style={styles.card}>
            {origin === 'import' ? (
              <View>
                <View style={{ marginBottom: 12 }}>
                  <Text style={styles.label}>SUMMARY</Text>
                  <Text style={styles.value}>Imported {typeof importCount === 'number' ? importCount : (platforms?.length || 0)} item{(importCount || 0) === 1 ? '' : 's'}</Text>
                </View>
                {platforms.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>PLATFORMS</Text>
                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                      {platforms.map((p: string) => (
                        <View key={`pf-${p}`} style={styles.platformPill}>
                          {renderPlatformSvg(p)}
                          <Text style={{ color: '#111', fontWeight: '600', marginLeft: 6 }}>{platformLabel(p)}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
                {!!syncRules && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>SYNC SETTINGS</Text>
                    <View style={{ gap: 4 }}>
                      {'syncDirection' in (syncRules || {}) && (
                        <Text style={styles.value}>Direction: {String(syncRules.syncDirection)}</Text>
                      )}
                      {'sourceOfTruth' in (syncRules || {}) && (
                        <Text style={styles.value}>Source of Truth: {String(syncRules.sourceOfTruth)}</Text>
                      )}
                      {'autoCreate' in (syncRules || {}) && (
                        <Text style={styles.value}>Auto-create: {syncRules.autoCreate ? 'On' : 'Off'}</Text>
                      )}
                      {'autoUpdate' in (syncRules || {}) && (
                        <Text style={styles.value}>Auto-update: {syncRules.autoUpdate ? 'On' : 'Off'}</Text>
                      )}
                      {'syncInventory' in (syncRules || {}) && (
                        <Text style={styles.value}>Sync Inventory: {syncRules.syncInventory ? 'On' : 'Off'}</Text>
                      )}
                      {'syncPricing' in (syncRules || {}) && (
                        <Text style={styles.value}>Sync Pricing: {syncRules.syncPricing ? 'On' : 'Off'}</Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <View>
                <View style={{ marginBottom: 12 }}>
                  <Text style={styles.label}>TITLE</Text>
                  <Text style={styles.value}>{title || 'Untitled'}</Text>
                </View>
                {!!description && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>DESCRIPTION</Text>
                    <Text style={[styles.value, { color: '#111' }]} numberOfLines={2}>{description}</Text>
                  </View>
                )}
                <View style={{ marginBottom: 12 }}>
                  <Text style={styles.label}>PRICE</Text>
                  <Text style={styles.value}>{typeof price === 'number' ? `$${price.toFixed(2)}` : '-'}</Text>
                </View>
                {accountNames.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>PUBLISHED TO</Text>
                    <Text style={styles.value}>{accountNames.join(', ')}</Text>
                  </View>
                )}
              </View>
            )}
          </ScrollView>
        </View>

      </View>

      {/* Actions */}
      <View style={{ backgroundColor: 'white', paddingBottom: 24, paddingHorizontal: 16 }}>
        {origin === 'import' ? (
          <>
            <TouchableOpacity onPress={handleExitImport} style={styles.primaryBtn}>
              <PackagePlus size={18} color={'#FFF'} />
              <Text style={styles.primaryText}>Exit Import</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleReviewInInventory} style={styles.secondaryBtn}>
              <Boxes size={18} color={'#71717A'} />
              <Text style={styles.secondaryText}>Go To Inventory</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity onPress={handleCreateAnother} style={styles.primaryBtn}>
              <PackagePlus size={18} color={'#FFF'} />
              <Text style={styles.primaryText}>Create Another Listing</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleReviewInInventory} style={styles.secondaryBtn}>
              <Boxes size={18} color={'#71717A'} />
              <Text style={styles.secondaryText}>View In Inventory</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
};

function platformLabel(key: string): string {
  switch (key) {
    case 'ebay': return 'eBay';
    case 'clover': return 'Clover';
    case 'shopify': return 'Shopify';
    case 'amazon': return 'Amazon';
    case 'square': return 'Square';
    default: return key.charAt(0).toUpperCase() + key.slice(1);
  }
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
  const map: Record<string, React.FC<any>> = {
    ebay: EbaySvg as any,
    clover: CloverSvg as any,
    shopify: ShopifySvg as any,
    amazon: AmazonSvg as any,
    square: SquareSvg as any,
  };
  const Svg = map[key];
  return Svg ? <Svg width={size} height={size} /> : <Icon name={platformIconName(key)} size={size} color={'#111'} />;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 60, paddingBottom: 40 },
  backBtn: { position: 'absolute', top: 16, left: 16, zIndex: 10, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' },
  imageWrap: { alignSelf: 'center', width: 200, height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#E5E5E5', backgroundColor: "red" },
  image: { width: '100%', height: '100%' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 16 },
  label: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  value: { color: '#000', fontWeight: '500' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#fff' },
  platformPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, backgroundColor: '#fff' },
  primaryBtn: { marginTop: 18, backgroundColor: BRAND_PRIMARY, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 0, borderColor: "7EB12D", },
  primaryText: { color: '#FFF', fontWeight: '800' },
  secondaryBtn: { marginTop: 12, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  secondaryText: { color: '#71717A', fontWeight: '700' },
});

export default PublishConfirmationScreen;


