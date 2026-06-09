import React, { useMemo, useRef, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { ensureSupabaseJwt } from '../../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 0}
      >
        {/* ── Top bar ──────────────────────────────────────────────── */}
        <View style={s.topBar}>
          <TouchableOpacity
            style={s.navCircle}
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
              else navigation.navigate('SproutHomeScreen');
            }}
          >
            <Icon name="chevron-left" size={22} color="#18181B" />
          </TouchableOpacity>

          <View style={s.titlePill}>
            <Text style={s.pillTitle} numberOfLines={1}>{campaignTitle}</Text>
            <Text style={s.pillSub} numberOfLines={1}>
              {soldCount}/{itemCount} sold · {daysLeftLabel}
            </Text>
          </View>

          <TouchableOpacity style={s.chatPill} onPress={handleEllipsis}>
            <Icon name="menu" size={16} color="#18181B" />
            <Text style={s.chatPillText}>Chat</Text>
          </TouchableOpacity>
        </View>

        {/* ── Progress strip ──────────────────────────────────────── */}
        <View style={s.progStrip}>
          <View style={[s.progFill, { width: undefined, flex: (soldCount / (itemCount || 1)) }]} />
        </View>

        {/* ── Ambient tray ────────────────────────────────────────── */}
        {hasPendingAsks && latestAsk ? (
          <View style={s.ambientTray}>
            <View style={s.trayDot} />
            <Text style={s.trayText} numberOfLines={1}>{latestAsk.title} — needs you</Text>
            <TouchableOpacity onPress={() => {
              if (latestAsk.threadId) controller.openThread(latestAsk.threadId);
            }}>
              <Text style={s.trayAction}>Review ↓</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Main content (Feed) ─────────────────────────────────── */}
        <View style={s.container}>
          <ConversationList
            messages={controller.activeMessages}
            loading={controller.isLoadingMessages}
            onDecision={controller.submitDecision}
            onRetry={controller.retryMessage}
          />
        </View>

        {/* ── Footer (composer) ───────────────────────────────────── */}
        <View style={s.footerStack}>
          {controller.error ? (
            <View style={s.errorBanner}>
              <Icon name="alert-circle-outline" size={14} color="#EF4444" />
              <Text style={s.errorText}>{controller.error}</Text>
              <TouchableOpacity onPress={controller.onRefresh}><Text style={s.errorRetry}>Retry</Text></TouchableOpacity>
            </View>
          ) : null}
          {controller.notice ? (
            <View style={s.noticeBanner}>
              <Icon name="check-circle-outline" size={14} color="#5D7E16" />
              <Text style={s.noticeText}>{controller.notice}</Text>
              <TouchableOpacity onPress={() => controller.setNotice(null)}>
                <Icon name="close" size={14} color="#5D7E16" />
              </TouchableOpacity>
            </View>
          ) : null}
          
          <View style={s.chipsContent}>
            {QUICK_CHIPS.map(chip => (
              <TouchableOpacity key={chip.action} style={s.quickChip} onPress={() => handleQuickChip(chip.action)}>
                <Text style={s.quickChipText}>{chip.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          
          <ConversationComposer
            value={controller.composerText}
            placeholder={composerPlaceholder}
            onChangeText={controller.setComposerText}
            onSend={() => controller.sendComposer()}
            queuedCount={controller.queuedCount}
            isStreaming={controller.isStreaming}
            getAuthToken={ensureSupabaseJwt}
          />
        </View>

        {/* ── Clean dropdown menu (not native) ────────────────────── */}
        {menuOpen ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMenuOpen(false)} />
            <View style={s.dropdown}>
              <TouchableOpacity style={s.dropItem} onPress={goToInventory} activeOpacity={0.7}>
                <Icon name="package-variant-closed" size={18} color="#3F3F46" />
                <Text style={s.dropText}>Inventory</Text>
              </TouchableOpacity>
              <View style={s.dropDivider} />
              <TouchableOpacity style={s.dropItem} onPress={deleteCampaign} activeOpacity={0.7}>
                <Icon name="trash-can-outline" size={18} color="#DC2626" />
                <Text style={[s.dropText, { color: '#DC2626' }]}>Delete clearout</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Top bar
  topBar: { minHeight: 60, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navCircle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  titlePill: {
    flexShrink: 1, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
  },
  pillTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_700Bold' },
  pillSub: { fontSize: 12, color: '#71717A', marginTop: 1, fontFamily: 'Inter_500Medium' },
  chatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  chatPillText: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_600SemiBold' },

  // Progress strip
  progStrip: { height: 2, backgroundColor: '#F3F4F6' },
  progFill: { height: '100%', backgroundColor: '#639922' },

  // Ambient tray
  ambientTray: { backgroundColor: '#fafdf5', borderBottomWidth: 0.5, borderBottomColor: '#c0dd97', paddingHorizontal: 16, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 8 },
  trayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#BA7517' },
  trayText: { flex: 1, fontSize: 11, color: '#3B6D11', fontFamily: 'Inter_500Medium' },
  trayAction: { fontSize: 11, color: '#BA7517', fontWeight: '500' },

  // Footer
  footerStack: { backgroundColor: '#FFFFFF', paddingTop: 4, borderTopWidth: 0.5, borderTopColor: '#E5E5E5' },
  errorBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12 },
  errorRetry: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 12 },
  noticeBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(147,200,34,0.3)', backgroundColor: 'rgba(147,200,34,0.12)', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, color: '#5D7E16', fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipsContent: { paddingHorizontal: 12, gap: 6, flexDirection: 'row', paddingBottom: 8, paddingTop: 4 },
  quickChip: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 14, borderWidth: 0.5, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  quickChipText: { fontSize: 11, color: '#71717A', fontFamily: 'Inter_500Medium' },

  // Clean dropdown menu
  dropdown: {
    position: 'absolute', top: 58, right: 14, minWidth: 200,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  dropItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  dropText: { color: '#27272A', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  dropDivider: { height: 1, backgroundColor: '#F1F2EE', marginHorizontal: 12 },
});

export default CampaignThreadScreen;
