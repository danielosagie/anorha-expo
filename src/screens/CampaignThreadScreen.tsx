import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { ChevronLeft, Menu, Package, Trash2, AlertCircle, CheckCircle2, X } from 'lucide-react-native';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { ConversationComposer } from '../features/liquidationConversation/components/ConversationComposer';
import { ConversationList } from '../features/liquidationConversation/components/ConversationList';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const QUICK_CHIPS = [
  { label: 'Find slow movers', action: 'find_slow_movers' },
  { label: 'Lower floor', action: 'lower_floor' },
  { label: 'Flash sale', action: 'run_flash_campaign' },
  { label: 'Pause campaign', action: 'pause_campaign' },
  { label: '+ attach items', action: 'attach_items' },
];

const CampaignThreadScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { getToken } = useAuth();
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
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(104);
  const [footerH, setFooterH] = useState(150);

  // Success haptic when the agent finishes streaming a turn (chat-template polish)
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !controller.isStreaming) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    prevStreamingRef.current = controller.isStreaming;
  }, [controller.isStreaming]);

  const sendAction = (actionType: string, title: string, payload?: Record<string, unknown>) => {
    controller.dispatchAction({ actionType, title, payload }).catch(() => controller.setNotice(null));
  };

  const handleQuickChip = (action: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    if (action === 'run_flash_campaign') {
      sendAction('run_flash_campaign', 'Run flash campaign', { discountPercent: 15, durationHours: 24, reason: 'manual_run' });
    } else {
      sendAction(action, action.replace(/_/g, ' '));
    }
  };

  const handleEllipsis = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setMenuOpen(open => !open);
  };

  const goToInventory = () => {
    setMenuOpen(false);
    navigation.navigate('LiquidationCampaignScreen', { campaignId, entryPoint: 'detail' });
  };
  const deleteCampaign = () => {
    setMenuOpen(false);
    navigation.navigate('SproutHomeScreen');
  };

  const composerPlaceholder = controller.isStreaming
    ? 'Type while agent responds...'
    : 'Steer this campaign...';
    
  // Using passed title instantly, fallback to loaded activeCampaign title
  const campaignTitle = passedTitle || controller.activeCampaign?.title || 'Campaign Thread';
  // Use progress from overview
  const stats = controller.activeCampaign?.stats;
  const soldCount = stats?.soldCount ?? controller.campaignOverview?.summary24h?.sold ?? 0;
  const itemCount = stats?.totalCount ?? 0;
  const daysLeftLabel = (() => {
    const days = controller.campaignConfig?.timeframeDays;
    const created = controller.activeCampaign?.createdAt;
    if (days && created) {
      const elapsed = (Date.now() - new Date(created).getTime()) / 86400000;
      return `${Math.max(0, Math.ceil(days - elapsed))}d left`;
    }
    return controller.campaignConfig?.aggressiveness || 'balanced';
  })();
  const hasPendingAsks = (controller.campaignOverview?.needsInput?.length || 0) > 0;
  const latestAsk = controller.campaignOverview?.needsInput?.[0];

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {/* ── Feed scrolls under both glass bars ──────────────────── */}
        <ConversationList
          messages={controller.activeMessages}
          loading={controller.isLoadingMessages}
          onDecision={controller.submitDecision}
          onRetry={controller.retryMessage}
          contentTopInset={headerH + 8}
          contentBottomInset={footerH + 8}
        />

        {/* ── Bottom: floating glass composer (no border, fades to white) ─ */}
        <View
          style={[s.footer, { paddingBottom: insets.bottom || 10 }]}
          onLayout={e => setFooterH(e.nativeEvent.layout.height)}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.9)', '#FFFFFF']}
            locations={[0, 0.55, 1]}
            style={s.footerFade}
            pointerEvents="none"
          />
          {controller.error ? (
            <View style={s.errorBanner}>
              <AlertCircle size={14} color="#EF4444" />
              <Text style={s.errorText}>{controller.error}</Text>
              <TouchableOpacity onPress={controller.onRefresh}><Text style={s.errorRetry}>Retry</Text></TouchableOpacity>
            </View>
          ) : null}
          {controller.notice ? (
            <View style={s.noticeBanner}>
              <CheckCircle2 size={14} color="#5D7E16" />
              <Text style={s.noticeText}>{controller.notice}</Text>
              <TouchableOpacity onPress={() => controller.setNotice(null)}>
                <X size={14} color="#5D7E16" />
              </TouchableOpacity>
            </View>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.chipsContent}
          >
            {QUICK_CHIPS.map(chip => (
              <TouchableOpacity key={chip.action} style={s.quickChip} onPress={() => handleQuickChip(chip.action)} activeOpacity={0.7}>
                <Text style={s.quickChipText}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <ConversationComposer
            value={controller.composerText}
            placeholder={composerPlaceholder}
            onChangeText={controller.setComposerText}
            onSend={(photos) => controller.sendComposer(photos)}
            queuedCount={controller.queuedCount}
            isStreaming={controller.isStreaming}
            getAuthToken={ensureSupabaseJwt}
          />
        </View>
      </KeyboardAvoidingView>

      {/* ── Top: floating glass header (white at top → transparent, blur) ─ */}
      <View
        style={[s.header, { paddingTop: insets.top + 6 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={Platform.OS === 'ios' ? 24 : 14} tint="light" style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={s.headerRow}>
          <TouchableOpacity
            style={s.navCircle}
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate('SproutHomeScreen');
            }}
            activeOpacity={0.85}
          >
            <ChevronLeft size={22} color="#18181B" />
          </TouchableOpacity>

          <View style={s.titlePill}>
            <Text style={s.pillTitle} numberOfLines={1}>{campaignTitle}</Text>
            <Text style={s.pillSub} numberOfLines={1}>
              {soldCount}/{itemCount} sold · {daysLeftLabel}
            </Text>
          </View>

          <TouchableOpacity style={s.chatPill} onPress={handleEllipsis} activeOpacity={0.85}>
            <Menu size={16} color="#18181B" />
            <Text style={s.chatPillText}>Chat</Text>
          </TouchableOpacity>
        </View>

        {hasPendingAsks && latestAsk ? (
          <TouchableOpacity
            style={s.ambientTray}
            activeOpacity={0.85}
            onPress={() => { if (latestAsk.threadId) controller.openThread(latestAsk.threadId); }}
          >
            <View style={s.trayDot} />
            <Text style={s.trayText} numberOfLines={1}>{latestAsk.title} needs you</Text>
            <Text style={s.trayAction}>Review</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Clean dropdown menu (not native) ────────────────────── */}
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={[s.dropdown, { top: insets.top + 54 }]}>
            <TouchableOpacity style={s.dropItem} onPress={goToInventory} activeOpacity={0.7}>
              <Package size={18} color="#3F3F46" />
              <Text style={s.dropText}>Inventory</Text>
            </TouchableOpacity>
            <View style={s.dropDivider} />
            <TouchableOpacity style={s.dropItem} onPress={deleteCampaign} activeOpacity={0.7}>
              <Trash2 size={18} color="#DC2626" />
              <Text style={[s.dropText, { color: '#DC2626' }]}>Delete clearout</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },

  // Floating glass header — white at the top, fading to transparent, content scrolls under
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
  chatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  chatPillText: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_600SemiBold' },

  // Ambient "needs you" tray (floats under the pills)
  ambientTray: {
    marginTop: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(250,253,245,0.97)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  trayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#BA7517' },
  trayText: { fontSize: 12, color: '#3B6D11', fontFamily: 'Inter_500Medium' },
  trayAction: { fontSize: 12, color: '#BA7517', fontFamily: 'Inter_600SemiBold' },

  // Floating glass footer — content fades to white, no border
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 6, backgroundColor: '#FFFFFF' },
  footerFade: { position: 'absolute', left: 0, right: 0, top: -30, height: 30 },
  errorBanner: { marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12 },
  errorRetry: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 12 },
  noticeBanner: { marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(147,200,34,0.3)', backgroundColor: 'rgba(147,200,34,0.12)', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, color: '#5D7E16', fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipsContent: { paddingHorizontal: 12, gap: 8, flexDirection: 'row', paddingBottom: 8, paddingTop: 2 },
  quickChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16, backgroundColor: '#F4F4F1' },
  quickChipText: { fontSize: 12, color: '#52525B', fontFamily: 'Inter_500Medium' },

  // Clean dropdown menu
  dropdown: {
    position: 'absolute', right: 14, minWidth: 200,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  dropItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  dropText: { color: '#27272A', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  dropDivider: { height: 1, backgroundColor: '#F1F2EE', marginHorizontal: 12 },
});

export default CampaignThreadScreen;
