/**
 * DesignExportScreen
 *
 * A web-only gallery that renders the real Inventory components with mock props
 * so the page can be imported into Figma via the html.to.design plugin.
 *
 * Reach it by running `expo start --web` and opening:  http://localhost:8081/?design=export
 * (App.tsx short-circuits to this screen when ?design=export is present on web.)
 *
 * Layout: a composed full inventory-screen mock, then each component in its own
 * labeled, phone-width frame. Audio/native components are lazy-loaded inside an
 * ErrorBoundary so they degrade to a placeholder instead of breaking the page.
 */
import React, { Suspense, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';

import Button from '../components/Button';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import PlatformFilterChips from '../components/PlatformFilterChips';
import PoolLocationCombobox from '../components/PoolLocationCombobox';
import InventoryListCard from '../components/InventoryListCard';
import { BaseModal } from '../components/BaseModal';
import SortByDropdown from '../components/SortByDropdown';

// Lazy so an import-time failure of expo-audio on web is contained to the frame.
const VoiceRecorder = React.lazy(() =>
  import('../components/VoiceRecorder').then((m) => ({ default: m.VoiceRecorder }))
);
const SmartCommandInput = React.lazy(() =>
  import('../components/SmartCommandInput').then((m) => ({ default: m.SmartCommandInput }))
);

const PHONE_WIDTH = 390;
const noop = () => {};

// MaterialCommunityIcons glyphs need the web font registered or they render as boxes.
function injectIconFont() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById('mci-font')) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const font = require('react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf');
    const uri = typeof font === 'string' ? font : font?.uri ?? font?.default ?? '';
    if (!uri) return;
    const style = document.createElement('style');
    style.id = 'mci-font';
    style.textContent = `@font-face { font-family: "MaterialCommunityIcons"; src: url(${uri}) format("truetype"); }`;
    document.head.appendChild(style);
  } catch {
    /* font not bundled — icons fall back to boxes, layout unaffected */
  }
}

class FrameErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; message?: string }
> {
  state: { failed: boolean; message?: string } = { failed: false };
  static getDerivedStateFromError(err: any) {
    return { failed: true, message: err?.message ? String(err.message) : String(err) };
  }
  render() {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>
            Couldn't render on web (likely native-only). Import the other frames.
          </Text>
          {!!this.state.message && (
            <Text style={styles.fallbackError}>{this.state.message}</Text>
          )}
        </View>
      );
    }
    return this.props.children;
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

function Frame({
  label,
  width = PHONE_WIDTH,
  children,
}: {
  label: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.frame, { width }]}>
      <Text style={styles.frameLabel}>{label}</Text>
      <View style={styles.frameBody}>
        <FrameErrorBoundary>{children}</FrameErrorBoundary>
      </View>
    </View>
  );
}

const mockPlatforms = [
  { name: 'Shopify', type: 'shopify', connectionCount: 1 },
  { name: 'Amazon', type: 'amazon', connectionCount: 1 },
  { name: 'Square', type: 'square', connectionCount: 2 },
  { name: 'Clover', type: 'clover', connectionCount: 1 },
  { name: 'eBay', type: 'ebay', connectionCount: 1 },
  { name: 'Facebook', type: 'facebook', connectionCount: 1 },
];

const mockCards = [
  {
    id: '1',
    title: 'Organic Coconut Oil - 32oz',
    minPrice: 19.99,
    maxPrice: 24.99,
    sku: 'COCO-32',
    totalQuantity: 87,
    platformNames: ['Shopify', 'Amazon'],
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: '2',
    title: 'African Spices Gift Set',
    price: 39.99,
    sku: 'SPICE-GS',
    totalQuantity: 23,
    platformNames: ['Shopify', 'Clover', 'Square'],
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: '3',
    title: 'Handmade Caribbean Wooden Bowl',
    price: 59.99,
    sku: 'BOWL-CAR',
    totalQuantity: 4,
    platformNames: ['Amazon', 'Shopify'],
    isStale: true,
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: '4',
    title: 'Traditional Jamaican Coffee Beans',
    price: 19.99,
    sku: 'COFFEE-JM',
    totalQuantity: 78,
    platformNames: ['Shopify', 'Amazon', 'Clover'],
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: '5',
    title: 'Caribbean Sea Salt Collection',
    price: 34.99,
    sku: 'SALT-CAR',
    totalQuantity: 32,
    platformNames: ['Square', 'Amazon'],
    lastSyncedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
];

export default function DesignExportScreen() {
  return (
    <FrameErrorBoundary>
      <DesignExportContent />
    </FrameErrorBoundary>
  );
}

function DesignExportContent() {
  injectIconFont();

  const [search, setSearch] = useState('');
  const [screenSearch, setScreenSearch] = useState('');
  const [platform, setPlatform] = useState<string | null>(null);
  const [screenPlatform, setScreenPlatform] = useState<string | null>('shopify');
  const [sort, setSort] = useState('date');
  const [screenSort, setScreenSort] = useState('date');
  const [locations, setLocations] = useState<string[]>([]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.pageTitle}>Inventory — Design Export</Text>
      <Text style={styles.pageSubtitle}>
        Full screen + component library, rendered from live app code for Figma import.
      </Text>

      {/* ---------- FULL SCREEN MOCK ---------- */}
      <Section title="Full Inventory Screen">
        <FrameErrorBoundary>
        <View style={styles.device}>
          <View style={screenStyles.background}>
            <View style={screenStyles.container}>
              <View style={screenStyles.listContainer}>
                <View style={{ paddingHorizontal: 16, marginBottom: 8, backgroundColor: '#FFF' }}>
                  <SearchBarWithScanner
                    placeholder="Search for a product"
                    value={screenSearch}
                    onChangeText={setScreenSearch}
                    onScan={noop}
                    onScannerOpen={noop}
                    onClear={() => setScreenSearch('')}
                    onVoicePress={noop}
                  />
                </View>

                <View style={{ paddingHorizontal: 8 }}>
                  <PlatformFilterChips
                    platforms={mockPlatforms}
                    selectedPlatform={screenPlatform}
                    onSelectPlatform={setScreenPlatform}
                  />
                </View>

                <View style={screenStyles.filterRow}>
                  <View style={{ flex: 1 }}>
                    <PoolLocationCombobox
                      selectedItems={locations}
                      onSelectionChange={setLocations}
                      startOpen={false}
                    />
                  </View>
                  <View style={{ marginLeft: 8 }}>
                    <SortByDropdown sortBy={screenSort} onSortChange={setScreenSort} />
                  </View>
                </View>

                <View style={{ flex: 1 }}>
                  {mockCards.map((c) => (
                    <InventoryListCard key={c.id} {...c} onPress={noop} />
                  ))}
                </View>
              </View>
            </View>
          </View>
        </View>
        </FrameErrorBoundary>
      </Section>

      {/* ---------- COMPONENT LIBRARY ---------- */}
      <Section title="Component Library">
        <Frame label="InventoryListCard — default">
          <InventoryListCard {...mockCards[0]} onPress={noop} />
        </Frame>

        <Frame label="InventoryListCard — low stock + stale">
          <InventoryListCard {...mockCards[2]} onPress={noop} />
        </Frame>

        <Frame label="InventoryListCard — search match">
          <InventoryListCard
            {...mockCards[1]}
            searchQuery="spice"
            matchLocations={['title', 'sku']}
            matchSnippet="African Spices Gift Set"
            onPress={noop}
          />
        </Frame>

        <Frame label="InventoryListCard — selection mode">
          <InventoryListCard {...mockCards[3]} isSelectionMode isSelected onPress={noop} />
        </Frame>

        <Frame label="SearchBarWithScanner — empty">
          <SearchBarWithScanner
            placeholder="Search for a product"
            value={search}
            onChangeText={setSearch}
            onScan={noop}
            onScannerOpen={noop}
            onClear={() => setSearch('')}
            onVoicePress={noop}
          />
        </Frame>

        <Frame label="SearchBarWithScanner — with text">
          <SearchBarWithScanner
            placeholder="Search for a product"
            value="coconut oil"
            onChangeText={noop}
            onScan={noop}
            onScannerOpen={noop}
            onClear={noop}
            onVoicePress={noop}
          />
        </Frame>

        <Frame label="PlatformFilterChips">
          <PlatformFilterChips
            platforms={mockPlatforms}
            selectedPlatform={platform}
            onSelectPlatform={setPlatform}
          />
        </Frame>

        <Frame label="PoolLocationCombobox (closed)">
          <PoolLocationCombobox selectedItems={[]} onSelectionChange={noop} startOpen={false} />
        </Frame>

        <Frame label="SortByDropdown (trigger)">
          <SortByDropdown sortBy={sort} onSortChange={setSort} />
        </Frame>

        <Frame label="Button — variants">
          <View style={{ gap: 12 }}>
            <Button title="Primary" onPress={noop} />
            <Button title="With icon" icon="qrcode-scan" onPress={noop} />
            <Button title="Outlined" outlined onPress={noop} />
            <Button title="Loading" loading onPress={noop} />
            <Button title="Disabled" disabled onPress={noop} />
          </View>
        </Frame>

        <Frame label="BaseModal — content (center)">
          <View style={styles.modalPreview}>
            <BaseModalContentPreview />
          </View>
        </Frame>

        <Frame label="SmartCommandInput (collapsed)">
          <FrameErrorBoundary>
            <Suspense fallback={<Placeholder label="Loading…" />}>
              <SmartCommandInput mode="quick_fix" variant="inline" fullWidth onSubmit={noop} />
            </Suspense>
          </FrameErrorBoundary>
        </Frame>

        <Frame label="VoiceRecorder">
          <FrameErrorBoundary>
            <Suspense fallback={<Placeholder label="Loading…" />}>
              <VoiceRecorder onTranscription={noop} onCancel={noop} />
            </Suspense>
          </FrameErrorBoundary>
        </Frame>
      </Section>

      <View style={{ height: 80 }} />
    </ScrollView>
  );
}

// BaseModal renders as a full-screen portal overlay, which would cover the
// gallery. Render its content inline in a card that mirrors the modal container.
function BaseModalContentPreview() {
  return (
    <View style={styles.modalCard}>
      <Text style={styles.modalTitle}>Edit inventory</Text>
      <Text style={styles.modalBody}>
        BaseModal wraps this content with a dimmed overlay. Shown inline here so it
        imports as a card. To capture the real overlay, open it in the app and import.
      </Text>
      <Button title="Done" onPress={noop} />
    </View>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EEF1F4' },
  pageContent: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  pageTitle: { fontSize: 24, fontWeight: '700', color: '#111827' },
  pageSubtitle: { fontSize: 14, color: '#6B7280', marginTop: 4, marginBottom: 24 },
  section: { width: '100%', maxWidth: 1100, alignItems: 'center', marginBottom: 40 },
  sectionTitle: {
    alignSelf: 'flex-start',
    fontSize: 18,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 16,
  },
  sectionBody: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'center',
  },
  device: {
    width: PHONE_WIDTH,
    height: 844,
    borderRadius: 40,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 8,
    borderColor: '#111827',
  },
  frame: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  frameLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  frameBody: {},
  fallback: {
    padding: 20,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  fallbackText: { fontSize: 13, color: '#6B7280', textAlign: 'center' },
  fallbackError: { fontSize: 11, color: '#B91C1C', textAlign: 'center', marginTop: 8 },
  modalPreview: { backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 12, padding: 24 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  modalBody: { fontSize: 14, color: '#4B5563', lineHeight: 20 },
});

// Mirrors the real InventoryOrdersScreen chrome (background/container/list).
const screenStyles = StyleSheet.create({
  background: { flex: 1, backgroundColor: 'rgb(208, 255, 170)' },
  container: {
    borderTopRightRadius: 32,
    borderTopLeftRadius: 32,
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 4,
    marginTop: 60,
    paddingTop: 20,
  },
  listContainer: { backgroundColor: '#FFF', flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 16,
    justifyContent: 'space-between',
  },
});
