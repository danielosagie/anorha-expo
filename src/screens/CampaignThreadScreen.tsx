import React, { useMemo, useRef, useEffect } from 'react';
import {
  Alert,
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
    Alert.alert(campaignTitle, 'Manage this campaign', [
      { text: 'Rename', onPress: () => Alert.alert('Rename', 'Rename functionality requires deeper UI flow.') },
      { text: 'Delete', style: 'destructive', onPress: () => {
          Alert.alert('Campaign hidden/deleted.');
          navigation.navigate('SproutHomeScreen');
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const composerPlaceholder = controller.isStreaming
    ? 'Type while agent responds...'
    : 'Steer this campaign...';
    
  // Using passed title instantly, fallback to loaded activeCampaign title
  const campaignTitle = passedTitle || controller.activeCampaign?.title || 'Campaign Thread';
  // Use progress from overview
  const soldCount = controller.campaignOverview?.summary24h?.sold || 0;
  const itemCount = controller.activeCampaign ? 34 : 0; // fallback hardcoded for now, waiting for real data to pass or loaded
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
          <TouchableOpacity style={s.backBtn} onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('SproutHomeScreen');
          }}>
            <Icon name="arrow-left" size={20} color="#111827" />
          </TouchableOpacity>
          <View style={s.topInfo}>
            <View style={s.topTitleRow}>
              <View style={s.plantDot} />
              <Text style={s.topTitle} numberOfLines={1}>{campaignTitle}</Text>
            </View>
            <Text style={s.topMeta} numberOfLines={1}>
              {controller.campaignConfig?.aggressiveness || 'balanced'} · {soldCount} sold
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity 
              style={s.itemsBtn} 
              onPress={() => navigation.navigate('LiquidationCampaignScreen', { campaignId: campaignId, entryPoint: 'detail' })}
            >
              <Text style={s.itemsBtnText}>items</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ padding: 4 }} onPress={handleEllipsis}>
              <Icon name="dots-vertical" size={24} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
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
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Top bar
  topBar: { minHeight: 60, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderBottomColor: '#E5E5E5' },
  backBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: '#E5E5E5', padding: 4 },
  topInfo: { flex: 1 },
  topTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plantDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#639922' },
  topTitle: { fontSize: 15, fontWeight: '500', color: '#111827', fontFamily: 'Inter_500Medium' },
  topMeta: { fontSize: 11, color: '#71717A', marginTop: 1, fontFamily: 'Inter_500Medium' },
  itemsBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  itemsBtnText: { fontSize: 16, color: '#374151', fontFamily: 'Inter_500Medium' },

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
});

export default CampaignThreadScreen;
