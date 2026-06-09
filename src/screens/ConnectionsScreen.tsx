import React, { useEffect } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Plus, Slack, Mail } from 'lucide-react-native';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import PlatformAvatar from '../components/PlatformAvatar';

const statusOf = (raw?: string): { label: string; color: string } => {
  const s = (raw || '').toLowerCase();
  if (s.includes('active') || s.includes('connect') || s === 'ok' || s === 'live') return { label: 'Connected', color: '#43631A' };
  if (s.includes('error') || s.includes('expired') || s.includes('revoked') || s.includes('fail')) return { label: 'Needs reconnect', color: '#DC2626' };
  if (s.includes('sync')) return { label: 'Syncing…', color: '#A2611A' };
  return { label: raw || 'Connected', color: '#71717A' };
};

const APPS = [
  { key: 'slack', label: 'Slack', sub: 'Post updates, read channels', icon: (c: string) => <Slack size={22} color={c} />, tint: '#4A154B' },
  { key: 'gmail', label: 'Gmail', sub: 'Send and read email', icon: (c: string) => <Mail size={22} color={c} />, tint: '#C5221F' },
];

const ConnectionsScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { liveConnections, loading, refresh } = usePlatformConnections();
  const overlay = usePlatformPickerOverlay();

  useEffect(() => {
    refresh?.();
  }, [refresh]);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backCircle} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <ChevronLeft size={22} color="#18181B" />
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Connections</Text>

        {/* Selling platforms */}
        <Text style={styles.section}>Selling platforms</Text>
        <View style={styles.card}>
          {loading && (liveConnections?.length || 0) === 0 ? (
            <View style={styles.loadingRow}><ActivityIndicator color="#93C822" /></View>
          ) : (liveConnections?.length || 0) === 0 ? (
            <Text style={styles.empty}>No platforms connected yet.</Text>
          ) : (
            liveConnections.map((c: any, i: number) => {
              const st = statusOf(c.Status);
              return (
                <TouchableOpacity
                  key={c.Id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('AccountSettings')}
                >
                  <PlatformAvatar platformType={(c.PlatformType || '').toLowerCase()} size="medium" />
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{c.DisplayName || c.PlatformType}</Text>
                    <View style={styles.statusRow}>
                      <View style={[styles.dot, { backgroundColor: st.color }]} />
                      <Text style={[styles.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <ChevronRight size={20} color="#D4D4D8" />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        <TouchableOpacity style={styles.connectBtn} onPress={() => overlay.show()} activeOpacity={0.85}>
          <Plus size={18} color="#FFFFFF" />
          <Text style={styles.connectText}>Connect a platform</Text>
        </TouchableOpacity>

        {/* Apps (Slack, Gmail, …) */}
        <Text style={[styles.section, { marginTop: 26 }]}>Apps</Text>
        <View style={styles.card}>
          {APPS.map((a, i) => (
            <View key={a.key} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={[styles.appIcon, { backgroundColor: `${a.tint}15` }]}>{a.icon(a.tint)}</View>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{a.label}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{a.sub}</Text>
              </View>
              <TouchableOpacity
                style={styles.connectPill}
                activeOpacity={0.8}
                onPress={() => Alert.alert(a.label, `Connecting ${a.label} runs through Composio — it'll be available here once Composio is set up.`)}
              >
                <Text style={styles.connectPillText}>Connect</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <Text style={styles.appsHint}>Slack and Gmail connect through Composio — available once it's set up.</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  backCircle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  title: { fontSize: 32, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 18 },

  section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  loadingRow: { paddingVertical: 26, alignItems: 'center' },
  empty: { paddingVertical: 22, textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  appIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  connectPill: { backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  connectPillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  connectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, marginTop: 14 },
  connectText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },
  appsHint: { color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 10, marginLeft: 4, lineHeight: 17 },
});

export default ConnectionsScreen;
