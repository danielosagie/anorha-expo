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
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { setActiveThread } from '../lib/activeThread';
import { useAuth } from '@clerk/expo';
import { ChevronRight, MessageCircle, Package, PanelLeft, Search, Settings, X, SquarePen } from 'lucide-react-native';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { ConversationComposer } from '../features/liquidationConversation/components/ConversationComposer';
import { ConversationList } from '../features/liquidationConversation/components/ConversationList';
import { ConvexLiveMessages } from '../features/liquidationConversation/ConvexLiveMessages';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import QuestionCard from '../features/liquidationConversation/components/QuestionCard';
import PlanCard from '../features/liquidationConversation/components/PlanCard';
import type { CampaignItem, CampaignThreadSummary, ConversationMessage, PlanPayload } from '../features/liquidationConversation/types';
import { useLegendState } from '../context/LegendStateContext';
import { loadInventoryCatalog } from '../lib/inventoryCatalog';
import { NarrationPlayerHost } from '../context/NarrationContext';
import {
  ChatChromeHeader,
  ChatComposerFooter,
  ChatSurfaceWash,
} from '../features/liquidationConversation/components/ChatChrome';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

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
  messages: ConversationMessage[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onSelectMessage: (messageId: string) => void;
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
  messages,
  activeThreadId,
  onSelectThread,
  onSelectMessage,
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
    return sorted.filter(t => (t.title || 'New chat').toLowerCase().includes(q));
  }, [threads, threadSearch]);

  const messageMatches = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    if (!q) return [];
    return messages
      .filter(message => message.content.toLowerCase().includes(q))
      .slice(-4)
      .reverse()
      .map(message => {
        const matchIndex = message.content.toLowerCase().indexOf(q);
        const start = Math.max(0, matchIndex - 44);
        const end = Math.min(message.content.length, matchIndex + q.length + 72);
        return {
          ...message,
          searchExcerpt: `${start > 0 ? '…' : ''}${message.content.slice(start, end)}${end < message.content.length ? '…' : ''}`,
        };
      });
  }, [messages, threadSearch]);

  return (
    <View style={s.drawerContent}>


      <View style={s.drawerSearch}>
        <Search size={18} color="#71717A" />
        <TextInput
          style={s.drawerSearchInput}
          value={threadSearch}
          onChangeText={setThreadSearch}
          placeholder="Search chats"
          placeholderTextColor="#8C8C86"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      <View style={s.drawerPrimaryNav}>
        <TouchableOpacity style={[s.drawerNavRow, s.drawerNavRowActive]} onPress={onCloseDrawer} activeOpacity={0.7}>
          <MessageCircle size={21} color="#18181B" />
          <Text style={s.drawerNavLabel}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.drawerNavRow} onPress={onNavInventory} activeOpacity={0.7}>
          <Package size={21} color="#52525B" />
          <Text style={s.drawerNavLabel}>Inventory</Text>
          <ChevronRight size={18} color="#A1A1AA" />
        </TouchableOpacity>
        <TouchableOpacity style={s.drawerNavRow} onPress={onNavSettings} activeOpacity={0.7}>
          <Settings size={21} color="#52525B" />
          <Text style={s.drawerNavLabel}>Settings</Text>
          <ChevronRight size={18} color="#A1A1AA" />
        </TouchableOpacity>
      </View>

      {threadSearch.trim() ? (
        <>
          <Text style={s.recentsLabel}>In this chat</Text>
          {messageMatches.length ? (
            <View style={s.messageMatches}>
              {messageMatches.map(message => (
                <TouchableOpacity
                  key={message.id}
                  style={s.messageMatchRow}
                  onPress={() => onSelectMessage(message.id)}
                  activeOpacity={0.7}
                >
                  <MessageCircle size={17} color="#71717A" />
                  <View style={s.messageMatchCopy}>
                    <Text style={s.messageMatchRole}>{message.role === 'user' ? 'You' : 'Sprout'}</Text>
                    <Text style={s.messageMatchText} numberOfLines={2}>{message.searchExcerpt}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={s.drawerEmpty}>No messages match your search.</Text>
          )}
          <Text style={s.recentsLabel}>Chats</Text>
        </>
      ) : (
        <Text style={s.recentsLabel}>Recent</Text>
      )}
      <ScrollView style={s.drawerThreads} contentContainerStyle={s.drawerThreadsContent} showsVerticalScrollIndicator={false}>
        {visibleThreads.length === 0 ? (
          <Text style={s.drawerEmpty}>
            {threadSearch.trim() ? 'No chats match your search.' : 'No chats yet. Start one above.'}
          </Text>
        ) : (
          visibleThreads.map(t => {
            const active = t.id === activeThreadId;
            return (
              <TouchableOpacity key={t.id} style={[s.threadRow, active && s.threadRowActive]} onPress={() => onSelectThread(t.id)} activeOpacity={0.7}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.threadTitle, active && s.threadTitleActive]} numberOfLines={1}>
                    {t.title || 'New chat'}
                  </Text>
                  <Text style={s.threadMeta} numberOfLines={1}>
                    {relativeTime(t.lastMessageAt || t.updatedAt)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <View style={[s.drawerFooter, { paddingBottom: bottomInset + 8 }]}>
        <TouchableOpacity style={s.footerSettingsButton} onPress={onNavSettings} activeOpacity={0.7}>
          <Settings size={19} color="#52525B" />
          <Text style={s.footerSettingsLabel}>Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.footerNewChatButton} onPress={onNewThread} activeOpacity={0.75}>
          <SquarePen size={18} color="#18181B" />
          <Text style={s.footerNewChatLabel}>New chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
DrawerContent.displayName = 'DrawerContent';

const CampaignThreadScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const { getToken } = useAuth();
  const legendState: any = useLegendState();
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
  const [campaignItems, setCampaignItems] = useState<CampaignItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<CampaignItem[]>([]);

  useEffect(() => {
    let active = true;
    if (!campaignId) {
      setCampaignItems([]);
      return () => { active = false; };
    }
    adapter.getCampaignItems(campaignId)
      .then((items) => {
        if (active) setCampaignItems(items);
      })
      .catch(() => {
        if (active) setCampaignItems([]);
      });
    return () => { active = false; };
  }, [adapter, campaignId]);

  useEffect(() => {
    const userId = legendState?.userId;
    if (!userId) return;
    let active = true;
    loadInventoryCatalog(userId).then((catalog) => {
      if (!active) return;
      const mapped: CampaignItem[] = catalog.map((item) => ({
        id: item.id,
        productId: item.id,
        name: item.title,
        channels: '',
        currentPrice: item.price,
        status: 'listed',
        imageUrl: item.imageUrl,
      }));
      setInventoryItems(mapped);
    }).catch(() => {
      if (active) setInventoryItems([]);
    });
    return () => { active = false; };
  }, [legendState?.userId]);

  const planItems = useMemo(() => {
    const catalogById = new Map(inventoryItems.map(item => [item.productId, item]));
    const mergedCampaignItems = campaignItems.map((item) => {
      const catalogItem = catalogById.get(item.productId);
      return catalogItem ? { ...catalogItem, ...item, imageUrl: item.imageUrl || catalogItem.imageUrl } : item;
    });
    const campaignIds = new Set(mergedCampaignItems.map(item => item.productId));
    return [...mergedCampaignItems, ...inventoryItems.filter(item => !campaignIds.has(item.productId))];
  }, [campaignItems, inventoryItems]);

  // Mark this thread foregrounded so a reply push for THIS campaign is suppressed
  // in-app (the seller is already watching it); cleared on blur so it pings elsewhere.
  useFocusEffect(
    useCallback(() => {
      setActiveThread(campaignId ?? null, controller.activeThreadId ?? null);
      return () => setActiveThread(null, null);
    }, [campaignId, controller.activeThreadId]),
  );
  useEffect(() => { controllerRef.current = controller; });

  // Notifications open the exact chat that produced them. Home reports and overseer
  // plans intentionally start a fresh chat, then send their handoff prompt into it.
  const requestedThreadId = route.params?.threadId as string | undefined;
  const initialPrompt = route.params?.initialPrompt as string | undefined;
  const startNewChat = route.params?.startNewChat === true;
  const handledRouteRef = useRef<string | null>(null);
  useEffect(() => {
    if (controller.activeCampaignId !== campaignId || controller.isLoadingThreads) return;
    if (!requestedThreadId && !initialPrompt) return;
    const routeKey = `${campaignId}:${requestedThreadId || ''}:${startNewChat ? 'new' : 'existing'}:${initialPrompt || ''}`;
    if (handledRouteRef.current === routeKey) return;
    handledRouteRef.current = routeKey;

    const applyRoute = async () => {
      const activeController = controllerRef.current;
      if (requestedThreadId) {
        activeController.openThread(requestedThreadId);
      }
      if (initialPrompt) {
        if (startNewChat) await activeController.createNewThread();
        navigation.setParams({ threadId: undefined, initialPrompt: undefined, startNewChat: undefined });
        await activeController.queueTextMessage(initialPrompt);
      } else {
        navigation.setParams({ threadId: undefined });
      }
    };
    void applyRoute().catch(() => {
      handledRouteRef.current = null;
      controllerRef.current.setNotice('Could not open that chat. Try again.');
    });
  }, [campaignId, controller.activeCampaignId, controller.isLoadingThreads, initialPrompt, navigation, requestedThreadId, startNewChat]);

  const [editingPlan, setEditingPlan] = useState<PlanPayload | null>(null);
  const [composerFocusKey, setComposerFocusKey] = useState(0);
  const [messageJump, setMessageJump] = useState<{ id: string; key: number } | null>(null);
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

  // When Sprout asks a structured question (or proposes a plan), drop the keyboard so the
  // card takes its place at the bottom instead of stacking on top of the keyboard. Tapping
  // the card's "type your own answer" field brings the keyboard back when the seller wants it.
  // Fire only on the none→pending transition: pendingQuestion/pendingPlan are fresh object
  // refs on every refresh, so keying off truthiness alone would dismiss the keyboard mid-typing
  // whenever a new message lands.
  const prevPendingRef = useRef({ question: false, plan: false });
  useEffect(() => {
    const nowQuestion = !!controller.pendingQuestion;
    const nowPlan = !!controller.pendingPlan;
    if ((nowQuestion && !prevPendingRef.current.question) || (nowPlan && !prevPendingRef.current.plan)) {
      Keyboard.dismiss();
    }
    prevPendingRef.current = { question: nowQuestion, plan: nowPlan };
  }, [controller.pendingQuestion, controller.pendingPlan]);

  // ── Threads drawer: swipe left→right (or tap) to open, like the chat template ──
  const screenW = Dimensions.get('window').width;
  const DRAWER_W = Math.min(330, screenW * 0.84);
  const drawerProgress = useSharedValue(0);
  const [drawerMounted, setDrawerMounted] = useState(false);

  const closeDrawer = useCallback(() => {
    Keyboard.dismiss();
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
  const openDrawer = useCallback(() => {
    if (drawerMountedRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    drawerMountedRef.current = true;
    setDrawerMounted(true);
    drawerProgress.value = withTiming(1, { duration: 200 });
  }, [drawerProgress]);

  useEffect(() => {
    if (!route.params?.openDrawer) return;
    const timer = setTimeout(() => {
      openDrawer();
      navigation.setParams({ openDrawer: undefined });
    }, 120);
    return () => clearTimeout(timer);
  }, [navigation, openDrawer, route.params?.openDrawer]);
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
    setMessageJump(null);
    closeDrawer();
  }, [closeDrawer]);

  const jumpToMessage = useCallback((messageId: string) => {
    setMessageJump({ id: messageId, key: Date.now() });
    closeDrawer();
  }, [closeDrawer]);
  const startThread = useCallback(async () => {
    closeDrawer();
    try {
      await controllerRef.current.createNewThread();
      setComposerFocusKey(key => key + 1);
    } catch { /* ignore */ }
  }, [closeDrawer]);
  const navToInventory = useCallback(() => {
    closeDrawer();
    // THIS campaign's items (LiquidationCampaignScreen = the campaign inventory,
    // headerTitle "Inventory"), not the global Inventory tab. Mirrors goToInventory.
    navigation.navigate('LiquidationCampaignScreen', { campaignId, entryPoint: 'detail' });
  }, [closeDrawer, navigation, campaignId]);
  const navToSettings = useCallback(() => {
    closeDrawer();
    navigation.navigate('CampaignSettings', { campaignId, title: passedTitle });
  }, [closeDrawer, navigation, campaignId, passedTitle]);

  // Our left-edge pan opens the threads drawer; the stack's back-swipe would
  // steal that exact gesture, so it's off for this screen (the close button remains).
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

  const handleFollowUp = useCallback((prompt: string) => {
    const activeController = controllerRef.current;
    void activeController.queueTextMessage(prompt).catch(() => {
      activeController.setNotice('Could not send that question. Try again.');
    });
  }, []);

  // Stage-aware nudge: before the first sale, invite a first move; once it's selling,
  // it's about steering. Keeps the composer from reading like a generic blank box.
  const composerPlaceholder = controller.isStreaming
    ? 'Type while Sprout responds…'
    : (controller.activeCampaign?.stats?.soldCount || 0) > 0
      ? 'Steer this clearout…'
      : 'What should we try first?';
    
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

  // If the proposed plan already shows as an inline card in the feed (openable → approve),
  // don't ALSO float the plan bar above the composer — keep one plan surface.
  const planShownInline = useMemo(() => {
    const id = controller.pendingPlan?.planId;
    if (!id) return false;
    return controller.activeMessages.some((m) =>
      ((m.metadata as any)?.toolSteps as any[] | undefined)?.some((s) => s?.plan?.pendingActionId === id),
    );
  }, [controller.pendingPlan?.planId, controller.activeMessages]);
  const pendingQuestionForThread =
    controller.pendingQuestion &&
    (!controller.pendingQuestion.threadId || controller.pendingQuestion.threadId === controller.activeThreadId)
      ? controller.pendingQuestion
      : null;
  const pendingPlanForThread =
    controller.pendingPlan &&
    (!controller.pendingPlan.threadId || controller.pendingPlan.threadId === controller.activeThreadId)
      ? controller.pendingPlan
      : null;

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" />
      <ChatSurfaceWash />
      {/* Renders nothing — subscribes to live Convex messages for the open thread
          and feeds agent-initiated posts (digests, proactive updates) into the feed. */}
      <ConvexLiveMessages threadId={controller.activeThreadId} onMessages={controller.ingestLiveMessages} />

      {/* ── Feed scrolls full-bleed under both floating glass bars ── */}
      <ConversationList
        messages={controller.activeMessages}
        planItems={planItems}
        loading={controller.isLoadingMessages}
        onDecision={controller.submitDecision}
        onRetry={controller.retryMessage}
        onFeedback={controller.submitMessageFeedback}
        onFollowUp={handleFollowUp}
        onCancelQueued={controller.cancelQueuedMessage}
        onOpenCart={(sessionId: string) => {
          // AddProduct is a hidden TAB screen, so go through the nested navigator
          // (the pattern PastScans uses), with a flat fallback. Navigating to the
          // already-mounted TabNavigator pops THIS chat off the stack, so its back
          // history is gone — hand the cart an explicit `origin` so its back button
          // (and swipe-back ring) can return here, restoring the thread by campaignId.
          const origin = { screen: 'CampaignThreadScreen', params: { campaignId, title: passedTitle } };
          try {
            navigation.navigate('TabNavigator', { screen: 'AddProduct', params: { sessionId, origin } });
          } catch {
            navigation.navigate('AddProduct', { sessionId, origin });
          }
        }}
        // Activity cards: open the product, undo a change, or control a routine —
        // all dispatched through the same action pipeline the quick chips use.
        onOpenItem={(productId: string) => navigation.navigate('ProductDetail', { productId })}
        onUndo={(payload, change) => {
          const undo = (payload as any)?.undo as { actionType?: string; payload?: Record<string, unknown>; revertLabel?: string } | undefined;
          if (undo?.actionType) {
            sendAction(undo.actionType, undo.revertLabel || 'Undo change', { ...(undo.payload || {}), changeField: change?.field });
          }
        }}
        onRoutineAction={(id, action) => sendAction(`routine_${action}`, `Routine ${action}`, { routineId: id })}
        // Report revision: pre-fill the composer with the seller's request so they can
        // review + send. Sprout has revise_report and updates the doc in place.
        onReviseDocument={(_documentId, title, note) => {
          controller.setComposerText(`Revise the "${title}" report: ${note}`);
        }}
        // Plan approval from the inline plan card's tray → the same decision pipeline the
        // floating plan card uses (approve runs it via the pending-action endpoint).
        onApprovePlan={(planId, action) =>
          controller.submitDecision({ id: planId, kind: 'approve', title: 'Plan', planId }, action)
        }
        onEditPlan={(plan) => {
          setEditingPlan(plan);
          setComposerFocusKey(key => key + 1);
          controller.setNotice(null);
        }}
        submittingDecisionId={controller.submittingDecisionId}
        contentTopInset={headerH + 8}
        contentBottomInset={footerH + 8 + feedKeyboardInset}
        scrollToMessageId={messageJump?.id}
        scrollRequestKey={messageJump?.key}
      />

      {/* ── Faded scrim behind the question/plan card so it reads as a focused tray sitting
          where the keyboard was. Non-interactive (taps fall through to scroll the feed). ── */}
      {(pendingQuestionForThread || (pendingPlanForThread && !planShownInline)) ? (
        <View pointerEvents="none" style={s.cardScrim} />
      ) : null}

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
        {pendingPlanForThread && !planShownInline && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <PlanCard
              prompt={pendingPlanForThread}
              onDecision={controller.submitDecision}
              submitting={!!controller.submittingDecisionId}
            />
          </View>
        )}

        {/* ── Sprout's structured question (tappable options), above the composer ── */}
        {pendingQuestionForThread && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <QuestionCard
              prompt={pendingQuestionForThread}
              submitting={controller.answeringQuestion}
              onSubmit={(answers, other) =>
                controller.submitAnswer(pendingQuestionForThread, answers, other)
              }
            />
          </View>
        )}

        {/* ── Bottom: floating glass composer (no border, progressive blur to white) ─ */}
        <ChatComposerFooter
          bottomPadding={(insets.bottom || 10) + 12}
          error={controller.error}
          onRetry={controller.onRefresh}
          notice={controller.notice}
          onDismissNotice={() => controller.setNotice(null)}
        >

          <ConversationComposer
            value={controller.composerText}
            placeholder={composerPlaceholder}
            onChangeText={controller.setComposerText}
            onSend={(photos) => {
              const contextPrefix = editingPlan
                ? `Revise the pending plan "${editingPlan.title}"${editingPlan.pendingActionId ? ` (${editingPlan.pendingActionId})` : ''} based on this request:`
                : undefined;
              void controller.sendComposer(photos, contextPrefix);
              setEditingPlan(null);
            }}
            queuedCount={controller.queuedCount}
            isStreaming={controller.isStreaming}
            getAuthToken={ensureSupabaseJwt}
            contextAttachment={editingPlan ? { label: 'Revising plan' } : null}
            onRemoveContextAttachment={() => setEditingPlan(null)}
            focusRequestKey={composerFocusKey}
          />
        </ChatComposerFooter>
        </View>
      </Animated.View>

      {/* ── Top: floating glass header (white at top → transparent, blur) ─ */}
      <ChatChromeHeader
        title={campaignTitle}
        subtitle={`${soldCount}/${itemCount} sold · ${daysLeftLabel}`}
        topInset={insets.top}
        onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
        leftAction={{
          icon: <PanelLeft size={17} color="#18181B" />,
          label: 'Chat',
          onPress: openDrawer,
          accessibilityLabel: 'Open chat sidebar',
        }}
        rightAction={{
          icon: <X size={21} color="#18181B" />,
          onPress: () => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate('SproutHomeScreen');
          },
          accessibilityLabel: 'Go back',
        }}
      >
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
      </ChatChromeHeader>

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
          messages={controller.activeMessages}
          activeThreadId={controller.activeThreadId}
          onSelectThread={switchThread}
          onSelectMessage={jumpToMessage}
          onNewThread={startThread}
          onNavInventory={navToInventory}
          onNavSettings={navToSettings}
          onCloseDrawer={closeDrawer}
          bottomInset={insets.bottom}
        />
      </Animated.View>

      {isFocused ? <NarrationPlayerHost /> : null}
    </View>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  // The composer's keyboard-avoider: absolute bottom anchor so behavior:'padding' lifts
  // the composer column with the keyboard (the feed is a full-bleed sibling behind it).
  composerAvoider: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // Dim scrim shown behind a pending question/plan card.
  cardScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(17,17,17,0.28)' },

  // Ambient "needs you" tray (floats under the pills)
  ambientTray: {
    marginTop: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(250,253,245,0.97)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  trayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#BA7517' },
  trayText: { fontSize: 13, color: '#3B6D11', fontFamily: 'Inter_500Medium' },
  trayAction: { fontSize: 13, color: '#BA7517', fontFamily: 'Inter_600SemiBold' },

  // Threads drawer
  edgeSwipe: { position: 'absolute', left: 0, bottom: 0, width: 34, zIndex: 20 },
  drawerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 21,
  },
  drawerPanel: {
    position: 'absolute', top: 0, left: 0, bottom: 0,
    backgroundColor: '#F7F8F4', paddingHorizontal: 16,
    borderTopRightRadius: 20, borderBottomRightRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 5, height: 0 }, elevation: 14,
    zIndex: 22,
  },
  drawerContent: { flex: 1 },
  drawerPrimaryNav: { gap: 4, marginBottom: 14 },
  drawerNavRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 12, borderRadius: 14 },
  drawerNavRowActive: { backgroundColor: '#ECEEE8' },
  drawerNavLabel: { flex: 1, fontSize: 17, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  drawerSearch: {
    height: 46, flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: '#ECEEE8', borderRadius: 15, paddingHorizontal: 13, marginBottom: 10,
  },
  drawerSearchInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#18181B',
    fontFamily: 'Inter_400Regular',
    paddingVertical: 0,
    textAlign: 'left',
    textAlignVertical: 'center',
  },
  messageMatches: { gap: 2 },
  messageMatchRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
  },
  messageMatchCopy: { flex: 1, justifyContent: 'center' },
  messageMatchRole: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textAlign: 'left' },
  messageMatchText: { marginTop: 2, fontSize: 15, lineHeight: 20, color: '#27272A', fontFamily: 'Inter_500Medium', textAlign: 'left' },
  drawerThreads: { flex: 1 },
  drawerThreadsContent: { paddingBottom: 20 },
  drawerFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E8E3', paddingTop: 12 },
  recentsLabel: {
    fontSize: 14, color: '#71717A', fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: 10, paddingTop: 14, paddingBottom: 8,
  },
  drawerEmpty: { color: '#9CA3AF', fontFamily: 'Inter_500Medium', fontSize: 14, paddingVertical: 20, textAlign: 'center' },
  threadRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14 },
  threadRowActive: { backgroundColor: '#EAF2DA' },
  threadTitle: { fontSize: 16, color: '#3F3F46', fontFamily: 'Inter_500Medium', textAlign: 'left' },
  threadTitleActive: { color: '#18181B', fontFamily: 'Inter_700Bold' },
  threadMeta: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_500Medium', marginTop: 2 },
  footerSettingsButton: { height: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16 },
  footerSettingsLabel: { fontSize: 15, color: '#3F3F46', fontFamily: 'Inter_600SemiBold' },
  footerNewChatButton: { height: 48, flex: 1.25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E4E4DF' },
  footerNewChatLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_700Bold' },
});

export default CampaignThreadScreen;
