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
import { useAuth } from '@clerk/expo';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, ChevronDown, ChevronRight, MessageCircleMore, Target, CalendarDays, ShieldCheck, CheckCircle2, Pencil } from 'lucide-react-native';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import { ClearoutCalendar } from '../components/liquidation/ClearoutCalendar';
import {
  calendarDaysBetween,
  campaignSellByDate,
  describeCampaignDuration,
  formatSellByDate,
  startOfLocalDay,
} from '../features/liquidationConversation/campaignTiming';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const BRAND = '#93C822';

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
  const [campaignName, setCampaignName] = useState(passedTitle || '');
  const [open, setOpen] = useState<Record<string, boolean>>({ details: true, goal: true, guard: false, chat: true, danger: false });
  const [deadlineOverride, setDeadlineOverride] = useState<Date | undefined>();
  const cfg = controller.campaignConfig;

  useEffect(() => {
    controller.loadCampaignDetails(campaignId).catch(() => undefined);
  }, [campaignId]);

  useEffect(() => {
    const loadedTitle = controller.activeCampaign?.title;
    if (loadedTitle && !campaignName.trim()) setCampaignName(loadedTitle);
  }, [campaignName, controller.activeCampaign?.title]);

  const toggleSec = (k: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    setOpen(o => ({ ...o, [k]: !o[k] }));
  };
  const setField = (patch: Record<string, unknown>) =>
    controller.setCampaignConfig(prev => (prev ? ({ ...prev, ...patch }) : prev));
  const setGuard = (patch: Record<string, unknown>) =>
    controller.setCampaignConfig(prev => (prev ? ({ ...prev, guardrails: { ...prev.guardrails, ...patch } }) : prev));

  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const campaignStart = useMemo(() => {
    const parsed = new Date(controller.activeCampaign?.createdAt || Date.now());
    return startOfLocalDay(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  }, [controller.activeCampaign?.createdAt]);
  const storedDeadline = useMemo(
    () => campaignSellByDate(controller.activeCampaign?.createdAt, cfg?.timeframeDays || 0),
    [cfg?.timeframeDays, controller.activeCampaign?.createdAt],
  );
  const deadline = deadlineOverride ?? storedDeadline;
  const daysRemaining = calendarDaysBetween(today, deadline);

  useEffect(() => {
    setDeadlineOverride(undefined);
  }, [campaignId]);

  const selectDeadline = (date: Date) => {
    setDeadlineOverride(date);
    setField({ timeframeDays: Math.max(1, calendarDaysBetween(campaignStart, date)) });
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const title = campaignName.trim();
      const currentTitle = controller.activeCampaign?.title || passedTitle || '';
      if (title && title !== currentTitle) {
        await controller.renameCampaign(campaignId, title);
        navigation.setParams({ title });
      }
      await adapter.updateCampaignConfig(campaignId, {
        targetRevenue: cfg.targetRevenue,
        timeframeDays: Math.max(1, calendarDaysBetween(campaignStart, deadline)),
        sellByDate: deadline.toISOString(),
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

  // Close (end) the clearout — the single terminal action. A clearout is only ever
  // soft-hidden, never destroyed, so this replaces the old "Delete": it moves the
  // clearout to Completed via PATCH sessions/:id/status, nothing is lost.
  const close = () => {
    const name = passedTitle || controller.activeCampaign?.title || 'this clearout';
    Alert.alert('Close clearout', `Close "${name}"? It'll move to Completed. You won't lose anything.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close clearout',
        onPress: async () => {
          try {
            await controller.setCampaignStatus(campaignId, 'completed');
            navigation.navigate('SproutHomeScreen');
          } catch (e: any) {
            Alert.alert('Could not close', e?.message || 'Unable to close this clearout');
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
            <Section title="Clearout details" icon={<Pencil size={18} color="#93C822" />} open={open.details} onToggle={() => toggleSec('details')}>
              <View style={s.field}>
                <Text style={s.fieldLabel}>Clearout name</Text>
                <View style={s.fieldInputWrap}>
                  <TextInput
                    style={s.fieldInput}
                    value={campaignName}
                    onChangeText={setCampaignName}
                    placeholder="Clearout name"
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="words"
                    returnKeyType="done"
                  />
                </View>
              </View>
            </Section>

            <Section title="Goal" icon={<Target size={18} color="#93C822" />} open={open.goal} onToggle={() => toggleSec('goal')}>
              <Field label="Target revenue" prefix="$" value={cfg.targetRevenue} onChange={(v: number) =>setField({ targetRevenue: v })} />
              <View style={s.deadlineHeader}>
                <View style={s.deadlineTitleRow}>
                  <CalendarDays size={17} color="#93C822" />
                  <Text style={s.fieldLabel}>Sell by</Text>
                </View>
                <Text style={s.deadlineDate}>{formatSellByDate(deadline)}</Text>
              </View>
              <View style={s.durationPill}>
                <Text style={s.durationText}>{describeCampaignDuration(daysRemaining)}</Text>
              </View>
              <ClearoutCalendar selectedDate={deadline} onSelect={selectDeadline} minDate={today} />
            </Section>

            <Section title="Negotiation guardrails" icon={<ShieldCheck size={18} color="#93C822" />} open={open.guard} onToggle={() => toggleSec('guard')}>
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

            <Section title="Chat" icon={<MessageCircleMore size={18} color="#93C822" />} open={open.chat} onToggle={() => toggleSec('chat')}>
              <TouchableOpacity style={s.linkRow} onPress={() => navigation.navigate('SproutChatSettings')} activeOpacity={0.75}>
                <View style={s.linkCopy}>
                  <Text style={s.linkLabel}>Chat settings</Text>
                  <Text style={s.linkSub}>Memory, history, and suggested follow-ups</Text>
                </View>
                <ChevronRight size={19} color="#A1A1AA" />
              </TouchableOpacity>
            </Section>

            <Section title="End clearout" icon={<CheckCircle2 size={18} color="#93C822" />} open={open.danger} onToggle={() => toggleSec('danger')}>
              <TouchableOpacity style={s.deleteBtn} onPress={close} activeOpacity={0.85}>
                <CheckCircle2 size={18} color="#93C822" />
                <Text style={s.deleteText}>Close clearout</Text>
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
  sectionIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#f4f4f4', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  sectionBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2, gap: 14 },

  field: { gap: 7 },
  fieldLabel: { fontSize: 13, color: '#52525B', fontFamily: 'Inter_500Medium' },
  fieldInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F4F4F1', borderRadius: 14, paddingHorizontal: 14, height: 50 },
  fieldInput: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', paddingVertical: 0 },
  affix: { fontSize: 15, color: '#9CA3AF', fontFamily: 'Inter_600SemiBold' },

  deadlineHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  deadlineTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deadlineDate: { color: '#111827', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  durationPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(147,200,34,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  durationText: { color: '#93C822', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  switchRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 2 },
  switchLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  switchSub: { fontSize: 12, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 17 },

  linkRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkCopy: { flex: 1 },
  linkLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  linkSub: { fontSize: 12, lineHeight: 17, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },

  deleteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: 'rgba(147,200,34,0.12)', borderWidth: 1, borderColor: 'rgba(147,200,34,0.35)' },
  deleteText: { fontSize: 15, color: '#93C822', fontFamily: 'Inter_600SemiBold' },

  // Sticky save bar
  saveBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, backgroundColor: '#FFFFFF' },
  saveFade: { position: 'absolute', left: 0, right: 0, top: -28, height: 28 },
  saveBtn: { backgroundColor: BRAND, borderRadius: 16, height: 52, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
});

export default CampaignSettingsScreen;
