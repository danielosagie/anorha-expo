import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { ChevronLeft, Search, X, Check, Box, Sparkles, AudioLines } from 'lucide-react-native';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { useLegendState } from '../context/LegendStateContext';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { API_BASE_URL } from '../config/env';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const BRAND = '#93C822';
const SELECT_COLS =
  'Id, Title, Sku, Price, Tags, PrimaryImageUrl, VariantType, IsArchived, OnShopify, OnSquare, OnClover, OnAmazon, OnEbay, OnFacebook';

const PLATFORM_FLAGS: Array<{ key: string; label: string }> = [
  { key: 'OnShopify', label: 'Shopify' },
  { key: 'OnEbay', label: 'eBay' },
  { key: 'OnAmazon', label: 'Amazon' },
  { key: 'OnFacebook', label: 'Facebook' },
  { key: 'OnSquare', label: 'Square' },
  { key: 'OnClover', label: 'Clover' },
];

// Words that carry no selection signal — stripped before keyword matching.
const STOPWORDS = new Set([
  'select', 'all', 'the', 'with', 'in', 'model', 'that', 'have', 'has', 'and', 'or', 'for', 'to',
  'of', 'a', 'an', 'products', 'product', 'items', 'item', 'my', 'me', 'please', 'find', 'show',
  'everything', 'any', 'some', 'from', 'on', 'add', 'get', 'pick', 'choose', 'are', 'is', 'this',
]);

const CampaignInventorySelectScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const legendState: any = useLegendState();
  const campaignId = route.params?.campaignId as string;
  const campaignTitle = (route.params?.title as string) || 'Clearout';

  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);
  const adapter = useMemo(
    () => new HybridConversationDataAdapter({
      getClerkToken: () => getTokenRef.current({ template: CONVEX_TEMPLATE }).catch(async () => getTokenRef.current()),
    }),
    [],
  );

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('All');
  const [command, setCommand] = useState('');
  const [commandNote, setCommandNote] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [headerH, setHeaderH] = useState(64);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = legendState?.userId;
      if (!userId) return;
      setLoading(true);
      try {
        const all: any[] = [];
        let from = 0;
        const size = 200;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const to = from + size - 1;
          const { data, error } = await supabase
            .from('ProductVariants')
            .select(SELECT_COLS)
            .eq('UserId', userId)
            .not('Sku', 'like', 'DRAFT-%')
            .range(from, to);
          if (error) throw error;
          const r = data || [];
          all.push(...r);
          if (r.length < size) break;
          from += size;
        }
        if (!cancelled) setRows(all.filter(r => r.VariantType !== 'option' && !r.IsArchived));
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [legendState?.userId]);

  const platformChips = useMemo(
    () => PLATFORM_FLAGS.filter(p => rows.some(r => r[p.key])),
    [rows],
  );

  const visible = useMemo(() => {
    let list = rows;
    if (platform !== 'All') {
      const pk = PLATFORM_FLAGS.find(p => p.label === platform)?.key;
      if (pk) list = list.filter(r => r[pk]);
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(r => `${r.Title || ''} ${r.Sku || ''} ${r.Tags || ''}`.toLowerCase().includes(q));
    return list;
  }, [rows, platform, query]);

  const haystack = (r: any) => `${r.Title || ''} ${r.Tags || ''} ${r.Sku || ''}`.toLowerCase();

  const runCommand = useCallback((text: string) => {
    const terms = text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOPWORDS.has(w));
    if (!terms.length) {
      setCommandNote('Tell me what to select, like "tech items with Pro".');
      return;
    }
    let matches = rows.filter(r => terms.every(t => haystack(r).includes(t)));
    if (!matches.length) matches = rows.filter(r => terms.some(t => haystack(r).includes(t)));
    if (!matches.length) {
      setCommandNote(`Nothing matched "${terms.join(' ')}".`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }
    setSelected(prev => {
      const n = new Set(prev);
      matches.forEach(m => n.add(m.Id));
      return n;
    });
    setCommandNote(`Selected ${matches.length} item${matches.length === 1 ? '' : 's'} matching ${terms.map(t => `“${t}”`).join(' + ')}.`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [rows]);

  const startRecording = useCallback(async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      // playsInSilentMode is required on iOS — without it recording can fail or capture
      // silence even when the mic permission is granted.
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      setRecording(true);
    } catch {
      setRecording(false);
    }
  }, [recorder]);

  const finishRecording = useCallback(async () => {
    setRecording(false);
    setTranscribing(true);
    try {
      recorder.stop();
      await new Promise(r => setTimeout(r, 400));
      const uri = recorder.uri;
      const token = await ensureSupabaseJwt();
      if (uri && token) {
        const form = new FormData();
        form.append('file', { uri, type: 'audio/m4a', name: 'voice.m4a' } as any);
        const resp = await fetch(`${API_BASE_URL}/api/audio/transcribe`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
        if (resp.ok) {
          const json = await resp.json();
          const text = String(json?.text || json?.transcription || '').trim();
          if (text) {
            setCommand(text);
            runCommand(text);
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      setTranscribing(false);
    }
  }, [recorder, runCommand]);

  const toggle = (id: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const addToCampaign = async () => {
    if (selected.size === 0 || adding) return;
    setAdding(true);
    try {
      await adapter.addCampaignItems(campaignId, Array.from(selected));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      navigation.navigate('LiquidationCampaignScreen', { campaignId, entryPoint: 'detail' });
    } catch (e: any) {
      Alert.alert('Could not add items', e?.message || 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const listHeader = (
    <View style={{ paddingTop: headerH + 6 }}>
      {/* Command bar */}
      <View style={s.commandWrap}>
        <View style={s.commandBox}>
          <Sparkles size={18} color={BRAND} />
          <TextInput
            style={s.commandInput}
            value={command}
            onChangeText={setCommand}
            onSubmitEditing={() => runCommand(command)}
            placeholder="Tell Sprout what to select…"
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
            editable={!transcribing}
          />
          {transcribing ? (
            <ActivityIndicator size="small" color="#71717A" />
          ) : (
            <TouchableOpacity
              onPress={recording ? finishRecording : startRecording}
              style={[s.micBtn, recording && s.micBtnRec]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <AudioLines size={18} color={recording ? '#FFFFFF' : '#71717A'} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity style={s.runBtn} onPress={() => runCommand(command)} activeOpacity={0.85}>
          <Text style={s.runBtnText}>Select</Text>
        </TouchableOpacity>
      </View>
      {commandNote ? <Text style={s.commandNote}>{commandNote}</Text> : (
        <Text style={s.commandHint}>Try “select all tech items with Pro” or “Nike shoes”.</Text>
      )}

      {/* Search */}
      <View style={s.searchBox}>
        <Search size={18} color="#9CA3AF" />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search inventory"
          placeholderTextColor="#9CA3AF"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color="#9CA3AF" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Platform filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterRow}>
        {['All', ...platformChips.map(p => p.label)].map(p => {
          const active = platform === p;
          const count = p === 'All' ? rows.length : rows.filter(r => r[PLATFORM_FLAGS.find(x => x.label === p)!.key]).length;
          return (
            <TouchableOpacity key={p} style={[s.filterChip, active && s.filterChipActive]} onPress={() => setPlatform(p)} activeOpacity={0.8}>
              <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{p}</Text>
              <Text style={[s.filterCount, active && s.filterCountActive]}>{count}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      {loading ? (
        <View style={[s.loading, { paddingTop: headerH }]}>
          <ActivityIndicator color={BRAND} />
          <Text style={s.loadingText}>Loading your inventory…</Text>
        </View>
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(item: any) => item.Id}
          ListHeaderComponent={listHeader}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 96 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={s.empty}>No matching items.</Text>}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          renderItem={({ item }: any) => {
            const sel = selected.has(item.Id);
            return (
              <TouchableOpacity style={s.row} onPress={() => toggle(item.Id)} activeOpacity={0.7}>
                <View style={[s.cb, sel && s.cbOn]}>{sel ? <Check size={13} color="#FFFFFF" /> : null}</View>
                <View style={s.thumb}>
                  {item.PrimaryImageUrl ? (
                    <Image source={{ uri: item.PrimaryImageUrl }} style={s.thumbImg} resizeMode="cover" />
                  ) : (
                    <Box size={20} color="#A1A1AA" />
                  )}
                </View>
                <View style={s.info}>
                  <Text style={s.title} numberOfLines={1}>{item.Title || 'Untitled'}</Text>
                  <Text style={s.sub} numberOfLines={1}>
                    ${Number(item.Price ?? 0).toFixed(2)}
                    {item.Sku ? `  ·  ${item.Sku}` : ''}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* ── Floating glass header ─────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]} onLayout={e => setHeaderH(e.nativeEvent.layout.height)}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={Platform.OS === 'ios' ? 24 : 14} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
        </View>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.navCircle} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <ChevronLeft size={22} color="#18181B" />
          </TouchableOpacity>
          <View style={s.titlePill}>
            <Text style={s.pillTitle} numberOfLines={1}>Select items</Text>
            <Text style={s.pillSub} numberOfLines={1}>for {campaignTitle}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>

      {/* ── Sticky add bar ────────────────────────────────────────── */}
      {selected.size > 0 ? (
        <View style={[s.addBar, { paddingBottom: insets.bottom || 12 }]}>
          <LinearGradient colors={['rgba(255,255,255,0)', '#FFFFFF']} style={s.addFade} pointerEvents="none" />
          <TouchableOpacity style={s.addBtn} onPress={addToCampaign} disabled={adding} activeOpacity={0.9}>
            {adding ? <ActivityIndicator color="#FFFFFF" /> : (
              <Text style={s.addText}>Add {selected.size} to {campaignTitle}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#71717A', fontFamily: 'Inter_500Medium', fontSize: 13 },
  empty: { textAlign: 'center', color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 30 },

  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  titlePill: { flexShrink: 1, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  pillTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_700Bold' },
  pillSub: { fontSize: 12, color: '#71717A', marginTop: 1, fontFamily: 'Inter_500Medium' },

  // Command bar
  commandWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  commandBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(147,200,34,0.10)', borderRadius: 22, paddingHorizontal: 14, height: 46, borderWidth: 1, borderColor: 'rgba(147,200,34,0.35)' },
  commandInput: { flex: 1, fontSize: 15, color: '#18181B', fontFamily: 'Inter_500Medium', paddingVertical: 0 },
  micBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F2EE' },
  micBtnRec: { backgroundColor: '#EF4444' },
  runBtn: { backgroundColor: '#18181B', borderRadius: 22, paddingHorizontal: 18, height: 46, alignItems: 'center', justifyContent: 'center' },
  runBtnText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 14 },
  commandHint: { color: '#9CA3AF', fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 12, paddingHorizontal: 4 },
  commandNote: { color: '#5D7E16', fontFamily: 'Inter_600SemiBold', fontSize: 12.5, marginBottom: 12, paddingHorizontal: 4 },

  // Search
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F4F4F1', borderRadius: 24, paddingHorizontal: 16, height: 48, marginBottom: 4 },
  searchInput: { flex: 1, fontSize: 15, color: '#18181B', fontFamily: 'Inter_500Medium', paddingVertical: 0 },

  // Filter chips
  filterScroll: { flexGrow: 0, flexShrink: 0, marginHorizontal: -14 },
  filterRow: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, gap: 8, flexDirection: 'row', alignItems: 'center' },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F2EE' },
  filterChipActive: { backgroundColor: '#18181B' },
  filterChipText: { fontSize: 13, color: '#52525B', fontFamily: 'Inter_600SemiBold' },
  filterChipTextActive: { color: '#FFFFFF' },
  filterCount: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_600SemiBold' },
  filterCountActive: { color: 'rgba(255,255,255,0.7)' },

  // Rows
  sep: { height: 1, backgroundColor: '#F1F1EE', marginLeft: 92 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  cb: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  cbOn: { backgroundColor: BRAND, borderColor: BRAND },
  thumb: { width: 52, height: 52, borderRadius: 13, backgroundColor: '#F4F4F1', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', overflow: 'hidden' },
  thumbImg: { width: '100%', height: '100%' },
  info: { flex: 1, marginLeft: 14 },
  title: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  sub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular' },

  // Sticky add bar
  addBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, backgroundColor: '#FFFFFF' },
  addFade: { position: 'absolute', left: 0, right: 0, top: -28, height: 28 },
  addBtn: { backgroundColor: BRAND, borderRadius: 16, height: 52, alignItems: 'center', justifyContent: 'center' },
  addText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
});

export default CampaignInventorySelectScreen;
