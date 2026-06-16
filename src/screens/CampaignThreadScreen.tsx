import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  PanResponder,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { interpolate, runOnJS, useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { ProgressiveBlurView } from '../components/ProgressiveBlurView';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { setActiveThread } from '../lib/activeThread';
import { useAuth } from '@clerk/clerk-expo';
import { ChevronLeft, Menu, MessageCircle, Package, Search, Settings, AlertCircle, CheckCircle2, X, Plus } from 'lucide-react-native';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { ConversationComposer } from '../features/liquidationConversation/components/ConversationComposer';
import { ConversationList } from '../features/liquidationConversation/components/ConversationList';
import { ConvexLiveMessages } from '../features/liquidationConversation/ConvexLiveMessages';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import QuestionCard from '../features/liquidationConversation/components/QuestionCard';
import PlanCard from '../features/liquidationConversation/components/PlanCard';
import type { CampaignThreadSummary } from '../features/liquidationConversation/types';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const QUICK_CHIPS = [
  { label: 'Find slow movers', action: 'find_slow_movers' },
  { label: 'Lower floor', action: 'lower_floor' },
  { label: 'Flash sale', action: 'run_flash_campaign' },
  { label: 'Pause campaign', action: 'pause_campaign' },
];

const relativeTime = (iso?: string) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

type DrawerContentProps = {
  threads: CampaignThreadSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onNavInventory: () => void;
  onNavSettings: () => void;
  onCloseDrawer: () => void;
  bottomInset: number;
};

// Owns the search query locally so each keystroke re-renders only the drawer
// content — not the whole chat screen (message list, composer, header).
const DrawerContent = React.memo(({
  threads,
  activeThreadId,
  onSelectThread,
  onNewThread,
  onNavInventory,
  onNavSettings,
  onCloseDrawer,
  bottomInset,
}: DrawerContentProps) => {
  const [threadSearch, setThreadSearch] = useState('');

  // Recents: newest first, locally filtered by the search box
  const visibleThreads = useMemo(() => {
    const sorted = [...threads].sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.updatedAt).getTime() - new Date(a.lastMessageAt || a.updatedAt).getTime(),
    );
    const q = threadSearch.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter(t => (t.title || (t.isPrimary ? 'Main thread' : 'Thread')).toLowerCase().includes(q));
  }, [threads, threadSearch]);

  return (
    <>
      {/* Search */}
      <View style={s.drawerSearch}>
        <Search size={18} color="#71717A" />
        <TextInput
          style={s.drawerSearchInput}
          value={threadSearch}
          onChangeText={setThreadSearch}
          placeholder="Search threads…"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* Pinned nav shortcuts */}
      <TouchableOpacity style={s.navRow} onPress={onCloseDrawer} activeOpacity={0.7}>
        <MessageCircle size={20} color="#18181B" />
        <Text style={s.navRowLabel}>Chat</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.navRow} onPress={onNavInventory} activeOpacity={0.7}>
        <Package size={20} color="#18181B" />
        <Text style={s.navRowLabel}>Inventory</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.navRow} onPress={onNavSettings} activeOpacity={0.7}>
        <Settings size={20} color="#18181B" />
        <Text style={s.navRowLabel}>Campaign settings</Text>
      </TouchableOpacity>
      <View style={s.drawerDivider} />

      {/* Recents — newest first */}
      <Text style={s.recentsLabel}>Recents</Text>
      <ScrollView contentContainerStyle={{ paddingBottom: bottomInset + 92 }} showsVerticalScrollIndicator={false}>
        {visibleThreads.length === 0 ? (
          <Text style={s.drawerEmpty}>
            {threadSearch.trim() ? 'No threads match your search.' : 'No threads yet — start one below.'}
          </Text>
        ) : (
          visibleThreads.map(t => {
            const active = t.id === activeThreadId;
            return (
              <TouchableOpacity key={t.id} style={[s.threadRow, active && s.threadRowActive]} onPress={() => onSelectThread(t.id)} activeOpacity={0.7}>
                <View style={[s.threadDot, { backgroundColor: active ? '#93C822' : '#D4D4D8' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.threadTitle} numberOfLines={1}>
                    {t.title || (t.isPrimary ? 'Main thread' : 'Thread')}
                  </Text>
                  <Text style={s.threadMeta} numberOfLines={1}>
                    {t.isPrimary ? 'Primary · ' : ''}{relativeTime(t.lastMessageAt || t.updatedAt)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Floating new-chat FAB */}
      <TouchableOpacity
        style={[s.newChatFab, { bottom: bottomInset + 16 }]}
        onPress={onNewThread}
        activeOpacity={0.85}
      >
        <Plus size={18} color="#FFFFFF" />
        <Text style={s.newChatFabText}>New chat</Text>
      </TouchableOpacity>
    </>
  );
});
DrawerContent.displayName = 'DrawerContent';

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
  const controllerRef = useRef(controller);

  // Mark this thread foregrounded so a reply push for THIS campaign is suppressed
  // in-app (the seller is already watching it); cleared on blur so it pings elsewhere.
  useFocusEffect(
    useCallback(() => {
      setActiveThread(campaignId ?? null, controller.activeThreadId ?? null);
      return () => setActiveThread(null, null);
    }, [campaignId, controller.activeThreadId]),
  );
  useEffect(() => { controllerRef.current = controller; });
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(104);
  const [footerH, setFooterH] = useState(150);

  // Keyboard handling: KeyboardAvoidingView is unreliable on the New Architecture (Fabric,
  // which reanimated 4 requires) — it silently fails to lift an absolute composer. Drive the
  // composer directly from reanimated's keyboard value instead. translateY lifts it to sit
  // just above the keyboard (minus the bottom safe area, which the keyboard already covers).
  const keyboard = useAnimatedKeyboard();
  const composerLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(keyboard.height.value - insets.bottom, 0) }],
  }));
  // JS mirror of the keyboard height so the feed can reserve room (the latest message stays
  // visible above the lifted composer instead of hiding behind it / the keyboard).
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(Math.max(e.endCoordinates?.height ?? 0, 0)));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const feedKeyboardInset = Math.max(keyboardHeight - insets.bottom, 0);

  // ── Threads drawer: swipe left→right (or tap) to open, like the chat template ──
  const screenW = Dimensions.get('window').width;
  const DRAWER_W = Math.min(330, screenW * 0.84);
  const drawerProgress = useSharedValue(0);
  const [drawerMounted, setDrawerMounted] = useState(false);

  const closeDrawer = useCallback(() => {
    drawerMountedRef.current = false;
    drawerProgress.value = withTiming(0, { duration: 220 }, finished => {
      if (finished) runOnJS(setDrawerMounted)(false);
    });
  }, [drawerProgress]);

  // Plain PanResponder (JS responder system) on the edge strip: RNGH's Pan
  // never activated on this absolute strip under Fabric, and a drawer pull
  // doesn't need native-thread tracking. Created once — everything it closes
  // over (shared value, setState, refs, DRAWER_W) is stable across renders.
  const drawerMountedRef = useRef(false);
  const edgePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 10 && Math.abs(g.dy) < g.dx,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        drawerMountedRef.current = true;
        setDrawerMounted(true);
      },
      onPanResponderMove: (_e, g) => {
        drawerProgress.value = Math.max(0, Math.min(1, g.dx / DRAWER_W));
      },
      onPanResponderRelease: (_e, g) => {
        // g.vx is px/ms — 0.45 ≈ a 450px/s fling.
        const open = g.dx > DRAWER_W * 0.35 || g.vx > 0.45;
        drawerProgress.value = withTiming(open ? 1 : 0, { duration: 200 }, finished => {
          if (finished && !open) runOnJS(setDrawerMounted)(false);
        });
        if (!open) drawerMountedRef.current = false;
      },
      onPanResponderTerminate: () => {
        drawerProgress.value = withTiming(0, { duration: 150 }, finished => {
          if (finished) runOnJS(setDrawerMounted)(false);
        });
        drawerMountedRef.current = false;
      },
    }),
  ).current;

  const overlayStyle = useAnimatedStyle(() => ({ opacity: drawerProgress.value * 0.45 }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawerProgress.value, [0, 1], [-DRAWER_W, 0]) }],
  }));

  const switchThread = useCallback((threadId: string) => {
    const c = controllerRef.current;
    if (threadId !== c.activeThreadId) c.openThread(threadId);
    closeDrawer();
  }, [closeDrawer]);
  const startThread = useCallback(async () => {
    closeDrawer();
    try { await controllerRef.current.createNewThread(); } catch { /* ignore */ }
  }, [closeDrawer]);
  const navToInventory = useCallback(() => {
    closeDrawer();
    // THIS campaign's items (LiquidationCampaignScreen = the campaign inventory,
    // headerTitle "Inventory"), not the global Inventory tab. Mirrors goToInventory.
    navigation.navigate('LiquidationCampaignScreen', { campaignId, entryPoint: 'detail' });
  }, [closeDrawer, navigation, campaignId]);
  const navToSettings = useCallback(() => {
    closeDrawer();
    // Campaign settings for THIS clearout (not the app settings page).
    navigation.navigate('CampaignSettings', { campaignId, title: passedTitle });
  }, [closeDrawer, navigation, campaignId, passedTitle]);

  // Our left-edge pan opens the threads drawer; the stack's back-swipe would
  // steal that exact gesture, so it's off for this screen (the ‹ button remains).
  useEffect(() => {
    navigation.setOptions?.({ gestureEnabled: false });
  }, [navigation]);

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
  const goToSettings = () => {
    setMenuOpen(false);
    navigation.navigate('CampaignSettings', { campaignId, title: passedTitle });
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
      {/* Renders nothing — subscribes to live Convex messages for the open thread
          and feeds agent-initiated posts (digests, proactive updates) into the feed. */}
      <ConvexLiveMessages threadId={controller.activeThreadId} onMessages={controller.ingestLiveMessages} />

      {/* ── Feed scrolls full-bleed under both floating glass bars ── */}
      <ConversationList
        messages={controller.activeMessages}
        loading={controller.isLoadingMessages}
        onDecision={controller.submitDecision}
        onRetry={controller.retryMessage}
        onCancelQueued={controller.cancelQueuedMessage}
        onOpenCart={(sessionId: string) => {
          // AddProduct is a hidden TAB screen, so go through the nested navigator
          // (the pattern PastScans uses), with a flat fallback.
          try {
            navigation.navigate('TabNavigator', { screen: 'AddProduct', params: { sessionId } });
          } catch {
            navigation.navigate('AddProduct', { sessionId });
          }
        }}
        contentTopInset={headerH + 8}
        contentBottomInset={footerH + 8 + feedKeyboardInset}
      />

      {/* ── Composer + pending question ride the keyboard. Absolute bottom anchor whose
          translateY is driven by reanimated's live keyboard height (composerLiftStyle) —
          NOT KeyboardAvoidingView, which silently no-ops for an absolute composer on the
          New Architecture (Fabric). box-none lets taps above the bar reach the feed. ── */}
      <Animated.View
        style={[s.composerAvoider, composerLiftStyle]}
        pointerEvents="box-none"
      >
        {/* One measured wrapper around BOTH the question card and the composer, so the feed's
            contentBottomInset reserves room for the whole composer area (not just the footer)
            and the last message can't hide behind the pending-question card. */}
        <View onLayout={e => setFooterH(e.nativeEvent.layout.height)}>
        {/* ── Sprout's proposed plan (Accept / Revise / Follow-up), above the composer ── */}
        {controller.pendingPlan && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <PlanCard
              prompt={controller.pendingPlan}
              onDecision={controller.submitDecision}
            />
          </View>
        )}

        {/* ── Sprout's structured question (tappable options), above the composer ── */}
        {controller.pendingQuestion && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard
              prompt={controller.pendingQuestion}
              submitting={controller.answeringQuestion}
              onSubmit={(answers, other) =>
                controller.submitAnswer(controller.pendingQuestion!, answers, other)
              }
            />
          </View>
        )}

        {/* ── Bottom: floating glass composer (no border, fades to white) ─ */}
        <View style={[s.footer, { paddingBottom: insets.bottom || 10 }]}>
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

          {/* Scroll Chips of quick options - Iceboxxed for now
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
          */}

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
        </View>
      </Animated.View>

      {/* ── Top: floating glass header (white at top → transparent, blur) ─ */}
      <View
        style={[s.header, { paddingTop: insets.top + 6 }]}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
      >
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {/* Progressive blur: strongest under the status bar / title, fading to clear
              as content scrolls out the bottom (rit3zh/expo-progressive-blur technique). */}
          <ProgressiveBlurView intensity={Platform.OS === 'ios' ? 50 : 28} tint="light" direction="down" />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
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
          </View>

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
            <TouchableOpacity style={s.dropItem} onPress={goToSettings} activeOpacity={0.7}>
              <Settings size={18} color="#3F3F46" />
              <Text style={s.dropText}>Campaign settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ── Threads drawer: pull right from the left edge ──────── */}
      <View style={[s.edgeSwipe, { top: insets.top + 50 }]} {...edgePan.panHandlers} />

      <Animated.View style={[s.drawerOverlay, overlayStyle]} pointerEvents={drawerMounted ? 'auto' : 'none'}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[s.drawerPanel, { width: DRAWER_W, paddingTop: insets.top + 14 }, panelStyle]}
        pointerEvents={drawerMounted ? 'auto' : 'none'}
      >
        <DrawerContent
          threads={controller.threads}
          activeThreadId={controller.activeThreadId}
          onSelectThread={switchThread}
          onNewThread={startThread}
          onNavInventory={navToInventory}
          onNavSettings={navToSettings}
          onCloseDrawer={closeDrawer}
          bottomInset={insets.bottom}
        />
      </Animated.View>
    </View>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  // The composer's keyboard-avoider: absolute bottom anchor so behavior:'padding' lifts
  // the composer column with the keyboard (the feed is a full-bleed sibling behind it).
  composerAvoider: { position: 'absolute', left: 0, right: 0, bottom: 0 },

  // Floating glass header — white at the top, fading to transparent, content scrolls under
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
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
  footer: { paddingTop: 6, backgroundColor: '#FFFFFF' },
  footerFade: { position: 'absolute', left: 0, right: 0, top: -30, height: 30 },
  errorBanner: { marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12 },
  errorRetry: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 12 },
  noticeBanner: { marginHorizontal: 12, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(147,200,34,0.3)', backgroundColor: 'rgba(147,200,34,0.12)', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, color: '#5D7E16', fontFamily: 'Inter_500Medium', fontSize: 12 },
  chipsContent: { paddingHorizontal: 12, gap: 8, flexDirection: 'row', paddingBottom: 8, paddingTop: 2 },
  quickChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16, backgroundColor: '#F4F4F1' },
  quickChipText: { fontSize: 14, color: '#52525B', fontFamily: 'Inter_500Medium' },

  // Clean dropdown menu
  dropdown: {
    position: 'absolute', right: 14, minWidth: 200,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  dropItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  dropText: { color: '#27272A', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  dropDivider: { height: 1, backgroundColor: '#F1F2EE', marginHorizontal: 12 },

  // Threads drawer
  edgeSwipe: { position: 'absolute', left: 0, bottom: 0, width: 34 },
  drawerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  drawerPanel: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    backgroundColor: '#FFFFFF', paddingHorizontal: 14,
    borderTopRightRadius: 28, borderBottomRightRadius: 28,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 6, height: 0 }, elevation: 16,
  },
  drawerSearch: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F1F1EE', borderRadius: 14, paddingHorizontal: 12, marginBottom: 10,
  },
  drawerSearchInput: {
    flex: 1, fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular',
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
  },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 4 },
  navRowLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  drawerDivider: { height: 1, backgroundColor: '#F1F1EE', marginVertical: 8 },
  recentsLabel: {
    fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 4, paddingVertical: 8,
  },
  drawerEmpty: { color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  threadRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 10, borderRadius: 14 },
  threadRowActive: { backgroundColor: 'rgba(147,200,34,0.12)' },
  threadDot: { width: 8, height: 8, borderRadius: 4 },
  threadTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  threadMeta: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_500Medium', marginTop: 2 },
  newChatFab: {
    flex: 1,
    position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#93C822', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  newChatFabText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 14 },
});

export default CampaignThreadScreen;
