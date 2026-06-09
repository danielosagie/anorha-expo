import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/clerk-expo';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronDown, Target, Gauge, ShieldCheck, TriangleAlert, Trash2 } from 'lucide-react-native';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const BRAND = '#93C822';
const PACE = ['conservative', 'balanced', 'aggressive'] as const;
const PACE_LABEL: Record<string, string> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

const CampaignSettingsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const campaignId = route.params?.campaignId as string;
  const passedTitle = route.params?.title as string;

  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);

  const adapter = useMemo(
    () => new HybridConversationDataAdapter({
      getClerkToken: () => getTokenRef.current({ template: CONVEX_TEMPLATE }).catch(async () => getTokenRef.current()),
    }),
    [],
  );
  const controller = useLiquidationConversationController({ adapter, initialCampaignId: campaignId });

  const [headerH, setHeaderH] = useState(96);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({ goal: true, pacing: true, guard: false, danger: false });
  const cfg = controller.campaignConfig;

  useEffect(() => {
    controller.loadCampaignDetails(campaignId).catch(() => undefined);
  }, [campaignId]);

  const toggleSec = (k: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setOpen(o => ({ ...o, [k]: !o[k] }));
  };
  const setField = (patch: Record<string, unknown>) =>
    controller.setCampaignConfig(prev => (prev ? ({ ...prev, ...patch }) : prev));
  const setGuard = (patch: Record<string, unknown>) =>
    controller.setCampaignConfig(prev => (prev ? ({ ...prev, guardrails: { ...prev.guardrails, ...patch } }) : prev));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await adapter.updateCampaignConfig(campaignId, {
        targetRevenue: cfg.targetRevenue,
        timeframeDays: cfg.timeframeDays,
        aggressiveness: cfg.aggressiveness,
        guardrails: cfg.guardrails,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  const del = () => {
    const name = passedTitle || controller.activeCampaign?.title || 'this clearout';
    Alert.alert('Delete clearout', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await controller.deleteCampaign(campaignId);
            navigation.navigate('SproutHomeScreen');
          } catch (e: any) {
            Alert.alert('Delete failed', e?.message || 'Unable to delete');
          }
        },
      },
    ]);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: headerH + 10, paddingBottom: insets.bottom + 110, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {!cfg ? (
          <View style={s.loading}>
            <ActivityIndicator color={BRAND} />
            <Text style={s.loadingText}>Loading settings…</Text>
          </View>
        ) : (
          <>
            <Section title="Goal" icon={<Target size={18} color="#43631A" />} open={open.goal} onToggle={() => toggleSec('goal')}>
              <Field label="Target revenue" prefix="$" value={cfg.targetRevenue} onChange={(v: number) =>setField({ targetRevenue: v })} />
              <Field label="Timeline" suffix="days" value={cfg.timeframeDays} onChange={(v: number) =>setField({ timeframeDays: v })} />
            </Section>

            <Section title="Pacing" icon={<Gauge size={18} color="#43631A" />} open={open.pacing} onToggle={() => toggleSec('pacing')}>
              <Text style={s.fieldLabel}>How hard should Sprout push?</Text>
              <View style={s.segment}>
                {PACE.map(p => {
                  const active = cfg.aggressiveness === p;
                  return (
                    <TouchableOpacity key={p} style={[s.segBtn, active && s.segBtnActive]} onPress={() => setField({ aggressiveness: p })} activeOpacity={0.85}>
                      <Text style={[s.segText, active && s.segTextActive]}>{PACE_LABEL[p]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Section>

            <Section title="Negotiation guardrails" icon={<ShieldCheck size={18} color="#43631A" />} open={open.guard} onToggle={() => toggleSec('guard')}>
              <Field label="Minimum acceptable offer" suffix="%" value={cfg.guardrails.minAcceptableOfferPercent} onChange={(v: number) =>setGuard({ minAcceptableOfferPercent: v })} />
              <Field label="Max automatic price drop" suffix="%" value={cfg.guardrails.maxAutoPriceDropPercent} onChange={(v: number) =>setGuard({ maxAutoPriceDropPercent: v })} />
              <Field label="Max counters per day" value={cfg.guardrails.maxAutoCounterCountPerDay} onChange={(v: number) =>setGuard({ maxAutoCounterCountPerDay: v })} />
              <View style={s.switchRow}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={s.switchLabel}>Auto-execute within guardrails</Text>
                  <Text style={s.switchSub}>Let Sprout act without asking when inside these limits</Text>
                </View>
                <Switch
                  value={cfg.guardrails.autoExecuteWithinGuardrails}
                  onValueChange={v => setGuard({ autoExecuteWithinGuardrails: v })}
                  trackColor={{ true: BRAND, false: '#E4E4E7' }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </Section>

            <Section title="Danger zone" icon={<TriangleAlert size={18} color="#DC2626" />} open={open.danger} onToggle={() => toggleSec('danger')}>
              <TouchableOpacity style={s.deleteBtn} onPress={del} activeOpacity={0.85}>
                <Trash2 size={18} color="#DC2626" />
                <Text style={s.deleteText}>Delete this clearout</Text>
              </TouchableOpacity>
            </Section>
          </>
        )}
      </ScrollView>

      {/* ── Floating glass header ─────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]} onLayout={e => setHeaderH(e.nativeEvent.layout.height)}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={Platform.OS === 'ios' ? 24 : 14} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={s.headerRow}>
          <TouchableOpacity style={s.navCircle} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <ChevronLeft size={22} color="#18181B" />
          </TouchableOpacity>
          <View style={s.titlePill}>
            <Text style={s.pillTitle} numberOfLines={1}>Settings</Text>
            <Text style={s.pillSub} numberOfLines={1}>{passedTitle || controller.activeCampaign?.title || 'Clearout'}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </View>

      {/* ── Sticky save bar ───────────────────────────────────────── */}
      {cfg ? (
        <View style={[s.saveBar, { paddingBottom: insets.bottom || 12 }]}>
          <LinearGradient
            colors={['rgba(255,255,255,0)', '#FFFFFF']}
            style={s.saveFade}
            pointerEvents="none"
          />
          <TouchableOpacity style={s.saveBtn} onPress={save} disabled={saving} activeOpacity={0.9}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveText}>Save changes</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};

const Section = ({ title, icon, open, onToggle, children }: any) => (
  <View style={s.section}>
    <TouchableOpacity style={s.sectionHead} onPress={onToggle} activeOpacity={0.7}>
      <View style={s.sectionIcon}>{icon}</View>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={open ? s.chevOpen : undefined}>
        <ChevronDown size={18} color="#A1A1AA" />
      </View>
    </TouchableOpacity>
    {open ? <View style={s.sectionBody}>{children}</View> : null}
  </View>
);

const Field = ({ label, value, onChange, prefix, suffix }: any) => (
  <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <View style={s.fieldInputWrap}>
      {prefix ? <Text style={s.affix}>{prefix}</Text> : null}
      <TextInput
        style={s.fieldInput}
        value={String(value ?? '')}
        onChangeText={t => onChange(Number(t.replace(/[^0-9.]/g, '')) || 0)}
        keyboardType="numeric"
        placeholderTextColor="#9CA3AF"
      />
      {suffix ? <Text style={s.affix}>{suffix}</Text> : null}
    </View>
  </View>
);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },

  loading: { paddingTop: 80, alignItems: 'center', gap: 12 },
  loadingText: { color: '#71717A', fontFamily: 'Inter_500Medium', fontSize: 13 },

  // Header (glass, matches the chat/inventory)
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navCircle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  titlePill: {
    flexShrink: 1, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  pillTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_700Bold' },
  pillSub: { fontSize: 12, color: '#71717A', marginTop: 1, fontFamily: 'Inter_500Medium' },

  // Section accordion card
  section: { backgroundColor: '#FFFFFF', borderRadius: 18, marginBottom: 14, borderWidth: 1, borderColor: '#ECEBE6', overflow: 'hidden' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  sectionIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(147,200,34,0.14)', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  sectionBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2, gap: 14 },

  field: { gap: 7 },
  fieldLabel: { fontSize: 13, color: '#52525B', fontFamily: 'Inter_500Medium' },
  fieldInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F4F4F1', borderRadius: 14, paddingHorizontal: 14, height: 50 },
  fieldInput: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', paddingVertical: 0 },
  affix: { fontSize: 15, color: '#9CA3AF', fontFamily: 'Inter_600SemiBold' },

  segment: { flexDirection: 'row', backgroundColor: '#F4F4F1', borderRadius: 14, padding: 4, gap: 4 },
  segBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  segText: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_500Medium' },
  segTextActive: { color: '#43631A', fontFamily: 'Inter_700Bold' },

  switchRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 2 },
  switchLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  switchSub: { fontSize: 12, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 17 },

  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  deleteText: { fontSize: 15, color: '#DC2626', fontFamily: 'Inter_600SemiBold' },

  // Sticky save bar
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, backgroundColor: '#FFFFFF' },
  saveFade: { position: 'absolute', left: 0, right: 0, top: -28, height: 28 },
  saveBtn: { backgroundColor: BRAND, borderRadius: 16, height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
});

export default CampaignSettingsScreen;
