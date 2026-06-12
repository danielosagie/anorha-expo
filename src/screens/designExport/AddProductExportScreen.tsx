/**
 * AddProductExportScreen — master page for the Add Product flow:
 *   1. Flow screens (real screens via Harness)
 *   2. Camera modes (mock chrome for camera/barcode/manifest/receipt/shelf)
 *   3. Sheets & components (real bottom-sheets/modals with mock props)
 *
 * The live camera screen can't render on web, so its modes are mocked and its
 * sheets are rendered in isolation. Each tile is isolated by an error boundary.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ThemeProvider } from '../../context/ThemeContext';
import Harness from './Harness';
import { ROUTES_BY_KEY } from './registry';

import PhotoStack from '../../components/camera/PhotoStack';
import CameraControls from '../../components/camera/CameraControls';
import ItemNavigationBar from '../../components/camera/ItemNavigationBar';
import { ShelfScanProgressCard } from '../../components/camera/ShelfScanProgressCard';
import BarcodeEntrySheet from '../../components/camera/BarcodeEntrySheet';
import BusinessTemplateModal from '../../components/camera/BusinessTemplateModal';
import UsageCounter from '../../components/UsageCounter';
import BottomActionBar from '../../components/BottomActionBar';
import TierSelectorModal from '../../components/TierSelectorModal';
import BillingGateSheet from '../../components/BillingGateSheet';
import QuickProductDetailSheet from '../../components/QuickProductDetailSheet';
import ManifestReviewSheet from '../../components/ManifestReviewSheet';
import ReceiptReviewSheet from '../../components/ReceiptReviewSheet';

const noop = () => {};
const PHONE_W = 390;
const PHONE_H = 812;

const mockPhotos = [
  { id: 'p1', uri: 'https://picsum.photos/seed/ap1/600/800', width: 600, height: 800, timestamp: Date.now(), isCover: true },
  { id: 'p2', uri: 'https://picsum.photos/seed/ap2/600/800', width: 600, height: 800, timestamp: Date.now(), isCover: false },
  { id: 'p3', uri: 'https://picsum.photos/seed/ap3/600/800', width: 600, height: 800, timestamp: Date.now(), isCover: false },
];
const mockItems = [
  { id: 'item-1', photos: [mockPhotos[0]], isActive: true },
  { id: 'item-2', photos: [mockPhotos[1]], isActive: false },
];

class TileBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean; msg?: string }> {
  state: { failed: boolean; msg?: string } = { failed: false };
  static getDerivedStateFromError(e: any) { return { failed: true, msg: e?.message ? String(e.message) : String(e) }; }
  render() {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>Couldn't render on web</Text>
          {!!this.state.msg && <Text style={styles.fallbackMsg}>{this.state.msg}</Text>}
        </View>
      );
    }
    return this.props.children as any;
  }
}

function Frame({ label, children, h = 520 }: { label: string; children: React.ReactNode; h?: number }) {
  return (
    <View style={styles.frameWrap}>
      <Text style={styles.frameLabel}>{label}</Text>
      <View style={[styles.frame, { height: h }]}>
        <TileBoundary>{children}</TileBoundary>
      </View>
    </View>
  );
}

function ScreenTile({ routeKey, label }: { routeKey: string; label: string }) {
  const route = ROUTES_BY_KEY[routeKey];
  if (!route) return null;
  return (
    <View style={styles.frameWrap}>
      <Text style={styles.frameLabel}>{label}</Text>
      <View style={styles.device}>
        <TileBoundary><Harness route={route} /></TileBoundary>
      </View>
    </View>
  );
}

function CameraMode({ label, instruction, mode }: { label: string; instruction: string; mode: string }) {
  return (
    <Frame label={label} h={PHONE_H}>
      <View style={styles.viewfinder}>
        <View style={styles.cameraTop}>
          <CameraControls flash={'off' as any} onToggleFlash={noop} onPastScans={noop} />
        </View>
        <View style={styles.modeBadge}><Text style={styles.modeBadgeText}>{mode}</Text></View>
        <View style={styles.instructionWrap}><Text style={styles.instruction}>{instruction}</Text></View>
        <View style={styles.shutterRow}>
          <View style={styles.shutterOuter}><View style={styles.shutterInner} /></View>
        </View>
        <View style={styles.itemNavWrap}>
          <ItemNavigationBar items={mockItems} activeItemId={'item-1'} onSelectItem={noop} onNewItem={noop} onContinue={noop} />
        </View>
      </View>
    </Frame>
  );
}

export default function AddProductExportScreen() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ScrollView style={styles.page} contentContainerStyle={styles.content}>
          <Text style={styles.title}>Add Product Flow</Text>
          <Text style={styles.subtitle}>Flow screens, camera modes, and the bottom-sheets / modals — import this page into one Figma page.</Text>

          <Text style={styles.section}>Flow screens</Text>
          <View style={styles.board}>
            <ScreenTile routeKey="photo-upload" label="Photo upload" />
            <ScreenTile routeKey="loading" label="Processing / Loading" />
            <ScreenTile routeKey="match" label="Match selection" />
            <ScreenTile routeKey="generate-details" label="Generate details" />
            <ScreenTile routeKey="confirm" label="Publish confirmation" />
            <ScreenTile routeKey="past-scans" label="Past scans" />
          </View>

          <Text style={styles.section}>Camera modes</Text>
          <View style={styles.board}>
            <ScreenTile routeKey="add-photo" label="Camera · Photo mode" />
            <ScreenTile routeKey="add-barcode" label="Camera · Barcode mode" />
            <ScreenTile routeKey="add-shelf" label="Camera · Shelf scan mode" />
          </View>

          <Text style={styles.section}>Camera states</Text>
          <View style={styles.board}>
            <ScreenTile routeKey="add-items" label="With items captured" />
            <ScreenTile routeKey="add-loading" label="Recognizing (loading)" />
            <ScreenTile routeKey="add-match" label="Match results sheet" />
            <ScreenTile routeKey="add-shelf-scanning" label="Shelf · Scanning" />
            <ScreenTile routeKey="add-shelf-complete" label="Shelf · Complete" />
          </View>

          <Text style={styles.section}>Sheets &amp; components</Text>
          <View style={styles.board}>
            <Frame label="PhotoStack" h={260}>
              <View style={styles.darkPad}><PhotoStack photos={mockPhotos} onPress={noop} /></View>
            </Frame>
            <Frame label="UsageCounter" h={160}>
              <UsageCounter usageCount={8} freeLimit={10} onUpgradePress={noop} isSubscriber={false} />
            </Frame>
            <Frame label="BottomActionBar" h={180}>
              <BottomActionBar primaryLabel="Save item" onPrimary={noop} secondaryLabel="Cancel" onSecondary={noop}
                stepNav={{ currentLabel: 'Details', currentIndex: 2, totalSteps: 4, onPrevStep: noop, onNextStep: noop }} />
            </Frame>
            <Frame label="ShelfScanProgressCard" h={420}>
              <View style={styles.darkPad}>
                <ShelfScanProgressCard photoUri={'https://picsum.photos/seed/shelf/600/400'} title="Shelf Scan"
                  subtitle="Scanning in progress…" phase="reading_labels" status={'streaming' as any}
                  progress={0.65} totalItems={12} completedItems={8} />
              </View>
            </Frame>
            <Frame label="BarcodeEntrySheet" h={PHONE_H}>
              <BarcodeEntrySheet visible barcode="9780134685991" onChangeBarcode={noop} onSubmit={noop} onCancel={noop} />
            </Frame>
            <Frame label="BusinessTemplateModal" h={PHONE_H}>
              <BusinessTemplateModal visible onClose={noop} onSelectTemplate={noop} />
            </Frame>
            <Frame label="TierSelectorModal" h={PHONE_H}>
              <TierSelectorModal visible onClose={noop} usageInfo={{ usageCount: 8, freeLimit: 10, remaining: 2 }} hasSubscription={false} />
            </Frame>
            <Frame label="BillingGateSheet" h={520}>
              <BillingGateSheet visible onClose={noop} onOpenBilling={noop}
                gate={{ code: 'credits_exhausted', message: 'You have used all your free credits this month.', canProceed: false, creditsRequired: 10, creditsAvailable: 0 } as any} />
            </Frame>
            <Frame label="QuickProductDetailSheet" h={PHONE_H}>
              <QuickProductDetailSheet
                product={{ variant: { Id: 'var-123', ProductId: 'prod-456', Title: 'Blue T-Shirt — Size M', Price: 29.99, Sku: 'TSH-BLU-M', Options: { Color: 'Blue', Size: 'M' } }, inventoryLevels: [{ PlatformLocationId: 'loc-1', Quantity: 5, Price: 29.99 }], images: [{ ImageUrl: 'https://picsum.photos/seed/tee/300/300' }] }}
                onClose={noop} onSave={async () => {}}
                platformLocations={[{ id: 'loc-1', name: 'Square — Main', platformType: 'square' }]} />
            </Frame>
            <Frame label="ManifestReviewSheet" h={PHONE_H}>
              <ManifestReviewSheet jobId="manifest_mock" onClose={noop} />
            </Frame>
            <Frame label="ReceiptReviewSheet" h={PHONE_H}>
              <ReceiptReviewSheet jobId="receipt_mock" onClose={noop} />
            </Frame>
          </View>
          <View style={{ height: 60 }} />
        </ScrollView>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EEF1F4' },
  content: { padding: 32 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4, marginBottom: 8 },
  section: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, color: '#374151', marginTop: 28, marginBottom: 14 },
  board: { flexDirection: 'row', flexWrap: 'wrap', gap: 28 },
  frameWrap: { width: PHONE_W },
  frameLabel: { fontSize: 12, fontWeight: '700', color: '#6B7280', marginBottom: 8 },
  frame: { width: PHONE_W, position: 'relative', overflow: 'hidden', backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB' },
  device: { width: PHONE_W, height: PHONE_H, position: 'relative', overflow: 'hidden', backgroundColor: '#fff', borderRadius: 28, borderWidth: 6, borderColor: '#111827' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#F9FAFB' },
  fallbackText: { fontSize: 13, fontWeight: '700', color: '#B91C1C' },
  fallbackMsg: { fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 6 },
  darkPad: { flex: 1, backgroundColor: '#111827', padding: 16, justifyContent: 'flex-end' },
  viewfinder: { flex: 1, backgroundColor: '#1F2937' },
  cameraTop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 },
  modeBadge: { position: 'absolute', top: 70, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  modeBadgeText: { color: '#fff', fontWeight: '700', letterSpacing: 1, fontSize: 12 },
  instructionWrap: { position: 'absolute', bottom: 200, left: 0, right: 0, alignItems: 'center' },
  instruction: { color: '#fff', fontSize: 16, fontWeight: '600', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  shutterRow: { position: 'absolute', bottom: 110, left: 0, right: 0, alignItems: 'center' },
  shutterOuter: { width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  itemNavWrap: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
