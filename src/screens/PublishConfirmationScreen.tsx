import React from 'react';
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
  const {
    productId,
    variantId,
    title,
    description,
    price,
    imageUrl,
    platforms = [],
    quantityByPlatform = {},
  } = route.params || {} as any;

  const handleCreateAnother = () => {
    // Go to the add product flow in the current stack
    navigation.navigate('TabNavigator' as any, { screen: 'AddProduct' } as any);
  };

  const handleReviewInInventory = () => {
    if (productId) {
      navigation.navigate('ProductDetail', { productId });
    } else {
      // Fallback to Inventory tab
      navigation.navigate('TabNavigator' as any, { screen: 'Inventory' } as any);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "white", flexDirection: "column", gap: 2,}}>

        {/* Back */}
        <View style={{ backgroundColor: "green", marginTop: 30, marginBottom: 10}}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={18} color={'#000'} />
            <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
            </TouchableOpacity>
        </View>

        <View style={{flex:1, flexDirection: "column", justifyContent:"center", paddingHorizontal: 30, paddingTop: 40, gap: 8 }}>

        
            {/* Image */}
            <View style={styles.imageWrap}>
            {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.image} />
            ) : (
                <View style={[styles.image, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F4F6' }]}> 
                <Icon name="image-outline" size={28} color="#9CA3AF" />
                </View>
            )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: "center" }}>
                <Icon name="check-circle" size={22} color={'#93C822'} />
                <Text style={{ color: '#000', fontWeight: '600', fontSize: 20 }}>Product Published!</Text>
            </View>

            {/* Details Card */}
            <View style={{ }}>
            <ScrollView style={styles.card}>
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

                {/* Quantities per platform, if provided */}
                {platforms.length > 0 && (
                    <View style={{ marginBottom: 12 }}>
                    <Text style={styles.label}>QUANTITY</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                        {platforms.map((p) => {
                        const qty = quantityByPlatform?.[p];
                        return (
                            <View key={p} style={styles.chip}>
                              {renderPlatformSvg(p, 14)}
                              <Text style={{ color: '#111', fontWeight: '600', marginLeft: 6 }}>
                                {qty !== undefined ? `${qty} - ${platformLabel(p)}` : platformLabel(p)}
                              </Text>
                            </View>
                        );
                        })}
                    </View>
                    </View>
                )}

                {/* Platform list row */}
                {platforms.length > 0 && (
                    <View>
                    <Text style={styles.label}>PLATFORMS</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                        {platforms.map((p) => (
                        <View key={`pf-${p}`} style={styles.platformPill}>
                          {renderPlatformSvg(p)}
                          <Text style={{ color: '#111', fontWeight: '600', marginLeft: 6 }}>{platformLabel(p)}</Text>
                        </View>
                        ))}
                    </View>
                    </View>
                )}
                </ScrollView>
            </View>    

        </View>

        {/* Actions */}
        <View style={{backgroundColor: 'white', paddingBottom: 24, paddingHorizontal: 16}}>
            <TouchableOpacity onPress={handleCreateAnother} style={styles.primaryBtn}>
            <PackagePlus size={18} color={'#FFF'} />
            <Text style={styles.primaryText}>Create Another Listing</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleReviewInInventory} style={styles.secondaryBtn}>
            <Boxes size={18} color={'#71717A'} />
            <Text style={styles.secondaryText}>Review In Inventory</Text>
            </TouchableOpacity>
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
  imageWrap: { alignSelf: 'center', width: 200, height: 200, borderRadius: 14, overflow: 'hidden', borderWidth: 2, borderColor: '#E5E5E5', backgroundColor: "red"},
  image: { width: '100%', height: '100%' },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 16 },
  label: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  value: { color: '#000', fontWeight: '500' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: '#fff' },
  platformPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, backgroundColor: '#fff' },
  primaryBtn: { marginTop: 18, backgroundColor: '#93C822', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 0, borderColor: "7EB12D",  },
  primaryText: { color: '#FFF', fontWeight: '800' },
  secondaryBtn: { marginTop: 12, backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  secondaryText: { color: '#71717A', fontWeight: '700' },
});

export default PublishConfirmationScreen;


