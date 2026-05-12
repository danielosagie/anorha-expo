import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  StatusBar,
  Animated as RNAnimated,
  Easing,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CameraView } from 'expo-camera';
import { supabase } from '../lib/supabase';
import { useLegendState } from '../context/LegendStateContext';

const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

// type SearchCategory = 'All' | 'Orders' | 'Products' | 'Customers';
type SearchCategory = 'All' | 'Shopify' | 'Square' | 'eBay';

type ProductResult = {
  type: 'product';
  id: string;
  productId?: string;
  title: string;
  imageUrl?: string;
  price?: number;
  sku?: string;
  status?: string;
  isArchived?: boolean;
};

type SearchResult = ProductResult;

const CHIPS: { key: SearchCategory; label: string }[] = [
  { key: 'All', label: 'All' },
  // { key: 'Orders', label: 'Orders' },
  // { key: 'Products', label: 'Products' },
  // { key: 'Customers', label: 'Customers' },
  { key: 'Shopify', label: 'Shopify' },
  { key: 'Square', label: 'Square' },
  { key: 'eBay', label: 'eBay' },
];

const PLATFORM_COLUMN: Partial<Record<SearchCategory, string>> = {
  Shopify: 'OnShopify',
  Square: 'OnSquare',
  eBay: 'OnEbay',
};

const escapeFilter = (s: string) => s.replace(/[%,()]/g, '\\$&');

const GlobalSearchScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const legendState = useLegendState();
  const userId = legendState?.userId;

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<SearchCategory>('All');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMounted, setScannerMounted] = useState(false);
  const scannerHeight = useRef(new RNAnimated.Value(0)).current;
  const scannerResultHandlerRef = useRef<((code: string) => void) | null>(null);

  const openScanner = useCallback(
    (handler: (code: string) => void) => {
      scannerHeight.stopAnimation();
      scannerHeight.setValue(0);
      setScannerMounted(true);
      setScannerOpen(true);
      scannerResultHandlerRef.current = handler;
      RNAnimated.spring(scannerHeight, {
        toValue: SCANNER_GROW_HEIGHT,
        speed: 18,
        bounciness: 6,
        useNativeDriver: false,
      }).start();
    },
    [scannerHeight],
  );

  const closeScanner = useCallback(() => {
    scannerResultHandlerRef.current = null;
    setScannerOpen(false);
    scannerHeight.stopAnimation();
    RNAnimated.timing(scannerHeight, {
      toValue: 0,
      duration: SCANNER_CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setScannerMounted(false);
    });
  }, [scannerHeight]);

  const handleScannerOpen = useCallback(() => {
    inputRef.current?.blur();
    openScanner((code) => {
      setQuery(code);
      closeScanner();
      setTimeout(() => inputRef.current?.focus(), 120);
    });
  }, [openScanner, closeScanner]);

  useEffect(() => {
    if (scannerOpen) return;
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, [scannerOpen]);

  const runSearch = useCallback(
    async (q: string, category: SearchCategory) => {
      const trimmed = q.trim();
      if (!userId || trimmed.length === 0) {
        setResults([]);
        setLoading(false);
        return;
      }

      const reqId = ++requestIdRef.current;
      setLoading(true);

      try {
        const aggregated: SearchResult[] = [];
        const safe = escapeFilter(trimmed);
        let req = supabase
          .from('ProductVariants')
          .select('Id, ProductId, Title, Sku, Barcode, Price, status, IsArchived, PrimaryImageUrl')
          .eq('UserId', userId)
          .or(`Title.ilike.%${safe}%,Sku.ilike.%${safe}%,Barcode.ilike.%${safe}%`)
          .limit(50);

        const platformColumn = PLATFORM_COLUMN[category];
        if (platformColumn) {
          req = req.eq(platformColumn, true);
        }

        const { data, error } = await req;

        if (!error && data) {
          data.forEach((v: any) => {
            aggregated.push({
              type: 'product',
              id: v.Id,
              productId: v.ProductId,
              title: v.Title || '(Untitled)',
              imageUrl: v.PrimaryImageUrl || undefined,
              price: typeof v.Price === 'number' ? v.Price : undefined,
              sku: v.Sku || undefined,
              status: v.status || undefined,
              isArchived: !!v.IsArchived,
            });
          });
        }

        if (reqId === requestIdRef.current) {
          setResults(aggregated);
        }
      } catch (e) {
        console.warn('[GlobalSearch] error', e);
        if (reqId === requestIdRef.current) setResults([]);
      } finally {
        if (reqId === requestIdRef.current) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query, activeCategory), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, activeCategory, runSearch]);

  const handleClose = () => navigation.goBack();
  const handleClear = () => setQuery('');

  const handleResultPress = (item: SearchResult) => {
    if (item.type === 'product') {
      const target = item.productId || item.id;
      navigation.navigate('ProductDetail', { productId: target });
    }
  };

  const renderItem = ({ item }: { item: SearchResult }) => {
    const archived =
      item.isArchived || (item.status || '').toLowerCase() === 'archived';
    const active = !archived && (item.status || '').toLowerCase() === 'active';
    return (
      <TouchableOpacity
        onPress={() => handleResultPress(item)}
        style={styles.resultRow}
        activeOpacity={0.6}
      >
        <View style={styles.thumb}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumbImage} />
          ) : (
            <Icon name="package-variant" size={20} color="#9CA3AF" />
          )}
        </View>
        <View style={styles.resultBody}>
          <Text numberOfLines={1} style={styles.resultTitle}>
            {item.title}
          </Text>
          <Text numberOfLines={1} style={styles.resultMeta}>
            {typeof item.price === 'number' ? `$${item.price.toFixed(2)}` : ''}
            {item.sku ? `${typeof item.price === 'number' ? ' • ' : ''}SKU ${item.sku}` : ''}
          </Text>
          <View
            style={[
              styles.badge,
              archived ? styles.badgeArchived : active ? styles.badgeActive : styles.badgeNeutral,
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                archived
                  ? styles.badgeArchivedText
                  : active
                    ? styles.badgeActiveText
                    : styles.badgeNeutralText,
              ]}
            >
              {archived ? 'Archived' : active ? 'Active' : item.status || 'Draft'}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const trimmedQuery = query.trim();
  const showEmpty = !loading && trimmedQuery.length === 0;
  const showNoResults = !loading && trimmedQuery.length > 0 && results.length === 0;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />

      {scannerMounted && (
        <View style={styles.scannerDock} pointerEvents="box-none">
          <RNAnimated.View
            pointerEvents={scannerOpen ? 'auto' : 'none'}
            style={[styles.scannerSurface, { height: scannerHeight }]}
          >
            <CameraView
              style={styles.scannerCamera}
              facing="back"
              onBarcodeScanned={
                scannerOpen
                  ? (result: any) => {
                      const code = result?.data || result?.rawValue;
                      if (code && scannerResultHandlerRef.current) {
                        scannerResultHandlerRef.current(code);
                      }
                    }
                  : undefined
              }
              barcodeScannerSettings={{
                barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
              }}
            />
            <TouchableOpacity onPress={closeScanner} style={styles.scannerCloseButton}>
              <Icon name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </RNAnimated.View>
        </View>
      )}

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchRow}>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Icon name="close" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.inputWrap}>
            <Icon name="magnify" size={18} color="#9CA3AF" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={handleClear} accessibilityLabel="Clear search">
                <Icon name="close-circle" size={18} color="#9CA3AF" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={handleScannerOpen} accessibilityLabel="Scan barcode">
                <Icon name="barcode-scan" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {CHIPS.map((c) => {
            const isActive = activeCategory === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => setActiveCategory(c.key)}
                style={[styles.chip, isActive && styles.chipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* <TouchableOpacity style={styles.chipAllFilters} activeOpacity={0.7}>
            <Icon name="tune-variant" size={14} color="#FFFFFF" style={styles.chipAllFiltersIcon} />
            <Text style={styles.chipAllFiltersText}>All filters</Text>
          </TouchableOpacity> */}
        </ScrollView>
      </View>

      <View style={styles.body}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#84CC16" />
          </View>
        ) : showEmpty ? (
          <View style={styles.center}>
            <Icon name="magnify" size={28} color="#9CA3AF" />
            <Text style={styles.emptyText}>No recent searches</Text>
          </View>
        ) : showNoResults ? (
          <View style={styles.center}>
            <Icon name="magnify" size={28} color="#9CA3AF" />
            <Text style={styles.emptyText}>No results for "{trimmedQuery}"</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  header: {
    backgroundColor: '#000000',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F1F1F',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 38,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    paddingVertical: 0,
    marginLeft: 8,
    marginRight: 8,
  },
  chipsRow: {
    paddingTop: 14,
    paddingBottom: 4,
    paddingRight: 12,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'transparent',
    marginRight: 4,
  },
  chipActive: {
    backgroundColor: '#1F1F1F',
  },
  chipText: {
    color: '#9CA3AF',
    fontSize: 13.5,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  chipAllFilters: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  chipAllFiltersIcon: {
    marginRight: 6,
  },
  chipAllFiltersText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '500',
  },
  body: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 8,
  },
  listContent: {
    paddingVertical: 4,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  resultBody: { flex: 1 },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  resultMeta: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 4,
  },
  badgeActive: { backgroundColor: '#DCFCE7' },
  badgeArchived: { backgroundColor: '#F3F4F6' },
  badgeNeutral: { backgroundColor: '#FEF3C7' },
  badgeText: { fontSize: 12, fontWeight: '500' },
  badgeActiveText: { color: '#15803D' },
  badgeArchivedText: { color: '#6B7280' },
  badgeNeutralText: { color: '#92400E' },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  scannerDock: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5000,
    width: '100%',
  },
  scannerSurface: {
    backgroundColor: '#000000',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
  },
  scannerCamera: {
    width: '100%',
    height: '100%',
  },
  scannerCloseButton: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});

export default GlobalSearchScreen;
