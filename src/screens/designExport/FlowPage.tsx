/**
 * FlowPage — one master page per flow: every screen of the flow rendered as a
 * device-framed tile on a single page, so html.to.design imports the whole flow at once.
 *
 * Reached via http://localhost:8082/?flow=<slug>
 */
import React, { Suspense } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import Harness from './Harness';
import DesignExportScreen from '../DesignExportScreen';
import { routesForGroup, ExportRoute } from './registry';

const AddProductExportScreen = React.lazy(() => import('./AddProductExportScreen'));

const DEVICE_W = 390;
const DEVICE_H = 844;

function Tile({ route }: { route: ExportRoute }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{route.title}</Text>
      <View style={styles.device}>
        <Harness route={route} />
      </View>
    </View>
  );
}

export default function FlowPage({ group }: { group: string }) {
  const routes = routesForGroup(group);

  // Inventory's master page is the self-contained component gallery.
  if (group === 'Inventory') {
    return <DesignExportScreen />;
  }

  // Add Product's master page = flow screens + camera modes + sheets.
  if (group === 'Add Product Flow') {
    return (
      <Suspense fallback={null}>
        <AddProductExportScreen />
      </Suspense>
    );
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <Text style={styles.title}>{group}</Text>
      <Text style={styles.subtitle}>
        {routes.length} screens — import this whole page into one Figma page.
      </Text>
      <View style={styles.board}>
        {routes.map((r) => (
          <Tile key={r.key} route={r} />
        ))}
      </View>
      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EEF1F4' },
  pageContent: { padding: 32 },
  title: { fontSize: 26, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4, marginBottom: 28 },
  board: { flexDirection: 'row', flexWrap: 'wrap', gap: 28 },
  tile: { width: DEVICE_W },
  tileLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10 },
  device: {
    width: DEVICE_W,
    height: DEVICE_H,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: 6,
    borderColor: '#111827',
  },
});
