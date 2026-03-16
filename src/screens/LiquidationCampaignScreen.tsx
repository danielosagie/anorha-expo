import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { ConversationComposer } from '../features/liquidationConversation/components/ConversationComposer';
import { ConversationList } from '../features/liquidationConversation/components/ConversationList';
import { OverviewActionHeader } from '../features/liquidationConversation/components/OverviewActionHeader';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import type { CampaignThreadSummary } from '../features/liquidationConversation/types';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const LiquidationCampaignScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { getToken } = useAuth();
  const isTabRootEntry = route?.name === 'Clearouts' || (route.params as any)?.entryPoint === 'tab';
  const initialCampaignId = (route.params as any)?.campaignId as string | undefined;

  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const adapter = useMemo(
    () =>
      new HybridConversationDataAdapter({
        getClerkToken: () =>
          getTokenRef
            .current({ template: CONVEX_TEMPLATE })
            .catch(async () => getTokenRef.current()),
      }),
    [],
  );

  const controller = useLiquidationConversationController({
    adapter,
    initialCampaignId,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCampaignSheetOpen, setIsCampaignSheetOpen] = useState(false);
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [campaignSheetMode, setCampaignSheetMode] = useState<'switch' | 'create'>('switch');
  const [configCampaignTarget, setConfigCampaignTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<null | {
    kind: 'thread' | 'campaign';
    id: string;
    title: string;
  }>(null);
  const [renameValue, setRenameValue] = useState('');

  const [wizardTargetRevenue, setWizardTargetRevenue] = useState('5000');
  const [wizardTimeframeDays, setWizardTimeframeDays] = useState('30');
  const [wizardAggression, setWizardAggression] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [wizardInventoryScope, setWizardInventoryScope] = useState<'all' | 'pool' | 'specific'>('all');
  const [wizardProductIds, setWizardProductIds] = useState('');
  const [wizardMinOfferPct, setWizardMinOfferPct] = useState('82');
  const [wizardMaxDropPct, setWizardMaxDropPct] = useState('20');

  const filteredThreads = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return controller.threads;
    return controller.threads.filter(thread => thread.title.toLowerCase().includes(query));
  }, [controller.threads, searchQuery]);

  const groupedThreads = useMemo(() => groupThreadsByRecency(filteredThreads), [filteredThreads]);

  const confirmThen = (title: string, message: string, onConfirm: () => void) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', onPress: onConfirm },
    ]);
  };

  const sendAction = (actionType: string, title: string, payload?: Record<string, unknown>) => {
    controller.dispatchAction({ actionType, title, payload }).catch((actionError: any) => {
      controller.setNotice(null);
      console.log('[LiquidationCampaignScreen] action error', actionError);
    });
  };

  const handleFindSlowMovers = () => {
    sendAction('find_slow_movers', 'Find slow movers');
  };

  const handleRunFlashCampaign = () => {
    confirmThen('Run flash campaign', 'Apply the configured flash campaign now?', () => {
      sendAction('run_flash_campaign', 'Run flash campaign', {
        discountPercent: 15,
        durationHours: 24,
        reason: 'manual_run',
      });
    });
  };

  const handleNegotiationAction = (action: 'accept' | 'counter' | 'let_agent') => {
    confirmThen('Send negotiation action', `Send "${action.replace('_', ' ')}" to the active negotiation?`, () => {
      sendAction(`negotiation_${action}`, `Negotiation: ${action.replace('_', ' ')}`, { action });
    });
  };

  const openRename = (kind: 'thread' | 'campaign', id: string, title: string) => {
    setRenameTarget({ kind, id, title });
    setRenameValue(title);
  };

  const submitRename = async () => {
    const title = renameValue.trim();
    if (!renameTarget || !title) return;

    try {
      if (renameTarget.kind === 'thread') {
        await controller.renameThread(renameTarget.id, title);
        controller.setNotice('Thread renamed');
      } else {
        await controller.renameCampaign(renameTarget.id, title);
        controller.setNotice('Campaign renamed');
      }
      setRenameTarget(null);
      setRenameValue('');
    } catch (renameError: any) {
      Alert.alert('Rename failed', renameError?.message || 'Unable to rename item');
    }
  };

  const openThreadActions = (thread: CampaignThreadSummary) => {
    Alert.alert(thread.title, 'Manage this chat thread', [
      {
        text: 'Rename',
        onPress: () => openRename('thread', thread.id, thread.title),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          confirmThen('Delete thread', `Delete "${thread.title}" from this device view?`, () => {
            controller.deleteThread(thread.id).catch((deleteError: any) => {
              Alert.alert('Delete failed', deleteError?.message || 'Unable to delete thread');
            });
          }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const openCampaignConfig = async (campaignId: string, title: string) => {
    setConfigCampaignTarget({ id: campaignId, title });
    controller.setActiveCampaignId(campaignId);
    controller.setCampaignConfig(null);
    setIsCampaignSheetOpen(false);
    setIsConfigSheetOpen(true);
    try {
      await controller.loadCampaignDetails(campaignId);
    } catch (configError: any) {
      Alert.alert('Could not load settings', configError?.message || 'Unable to load campaign settings');
    }
  };

  const deleteCampaignFromSheet = (campaignId: string, title: string) => {
    confirmThen('Delete liquidation', `Delete "${title}" from this device view?`, () => {
      controller.deleteCampaign(campaignId).catch((deleteError: any) => {
        Alert.alert('Delete failed', deleteError?.message || 'Unable to delete liquidation');
      });
      setIsCampaignSheetOpen(false);
    });
  };

  const submitNewCampaign = async () => {
    try {
      const targetRevenue = Number(wizardTargetRevenue || '0');
      const timeframeDays = Number(wizardTimeframeDays || '0');
      const productIds = wizardProductIds
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

      if (!targetRevenue || !timeframeDays) {
        throw new Error('Target revenue and timeframe are required');
      }

      const created = await adapter.createCampaign({
        targetRevenue,
        timeframeDays,
        aggressiveness: wizardAggression,
        inventoryScope: wizardInventoryScope,
        productIds: wizardInventoryScope === 'specific' ? productIds : undefined,
      });

      controller.setActiveCampaignId(created.id);
      setCampaignSheetMode('switch');
      setIsCampaignSheetOpen(false);
      controller.setNotice('Campaign created');
      await controller.onRefresh();

      await adapter.updateCampaignConfig(created.id, {
        guardrails: {
          minAcceptableOfferPercent: Number(wizardMinOfferPct || 82),
          maxAutoPriceDropPercent: Number(wizardMaxDropPct || 20),
        },
      }).catch(() => undefined);
    } catch (createError: any) {
      Alert.alert('Create campaign failed', createError?.message || 'Failed to create campaign');
    }
  };

  const saveConfig = async () => {
    const campaignId = configCampaignTarget?.id || controller.activeCampaignId;
    if (!campaignId || !controller.campaignConfig) return;
    try {
      const updated = await adapter.updateCampaignConfig(campaignId, {
        targetRevenue: controller.campaignConfig.targetRevenue,
        timeframeDays: controller.campaignConfig.timeframeDays,
        aggressiveness: controller.campaignConfig.aggressiveness,
        inventoryScope: controller.campaignConfig.inventoryScope,
        poolId: controller.campaignConfig.poolId,
        productIds: controller.campaignConfig.productIds,
        guardrails: controller.campaignConfig.guardrails,
      });
      controller.setCampaignConfig(updated);
      setIsConfigSheetOpen(false);
      setConfigCampaignTarget(null);
      controller.setNotice('Campaign settings updated');
      await controller.loadCampaignDetails(campaignId);
    } catch (saveError: any) {
      Alert.alert('Save failed', saveError?.message || 'Failed to update campaign settings');
    }
  };

  const topSubtitle = controller.surfaceState === 'home_overview' ? 'Campaign Home' : 'Conversation';
  const composerPlaceholder =
    controller.surfaceState === 'home_overview'
      ? 'Steer campaign from Home (starts a new chat)...'
      : controller.isStreaming
        ? 'Type the next message while the agent responds...'
        : 'Message this thread...';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 0}
      >
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => setIsDrawerOpen(true)}>
            <Icon name="menu" size={22} color="#111827" />
          </TouchableOpacity>
          <Pressable
            style={styles.campaignChip}
            onPress={() => {
              setCampaignSheetMode('switch');
              setIsCampaignSheetOpen(true);
            }}
          >
            <Text style={styles.campaignChipLabel}>Switch campaign</Text>
            <Text style={styles.campaignChipText} numberOfLines={1}>
              {controller.activeCampaign?.title || 'Select campaign'}
            </Text>
          </Pressable>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.newChatButton} onPress={() => controller.createNewThread()}>
              <Icon name="chat-plus-outline" size={16} color="#5D7E16" />
              <Text style={styles.newChatText}>New chat</Text>
            </TouchableOpacity>
            {!isTabRootEntry ? (
              <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
                <Icon name="close" size={20} color="#111827" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.subtitleRow}>
          <Text style={styles.subtitleText}>{topSubtitle}</Text>
        </View>

        {controller.loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#93C822" />
            <Text style={styles.loadingText}>Loading conversation workspace...</Text>
          </View>
        ) : (
          <>
            {controller.surfaceState === 'home_overview' ? (
              <ScrollView
                style={styles.feed}
                contentContainerStyle={styles.feedContent}
                refreshControl={(
                  <RefreshControl
                    refreshing={controller.refreshing}
                    onRefresh={controller.onRefresh}
                    tintColor="#93C822"
                  />
                )}
              >
                <View style={styles.homeHero}>
                  <Image
                    source={require('../assets/anorha_logo.png')}
                    style={styles.homeLogo}
                    resizeMode="contain"
                  />
                  <Text style={styles.homeEyebrow}>Campaign home</Text>
                  <Text style={styles.homeTitle}>{controller.activeCampaign?.title || 'No campaign selected'}</Text>
                  <Text style={styles.homeBody}>
                    Review the latest agent activity, open conversations, and campaign actions from one place.
                  </Text>
                  <View style={styles.homeDivider} />
                </View>
                <OverviewActionHeader
                  campaign={controller.activeCampaign}
                  overview={controller.campaignOverview}
                  onReviewMessage={threadId => {
                    controller.openThread(threadId);
                    setIsDrawerOpen(false);
                  }}
                  onAccept={() => handleNegotiationAction('accept')}
                  onCounter={() => handleNegotiationAction('counter')}
                  onLetAgent={() => handleNegotiationAction('let_agent')}
                  onFindSlowMovers={handleFindSlowMovers}
                  onRunFlashCampaign={handleRunFlashCampaign}
                />
              </ScrollView>
            ) : (
              <ConversationList
                messages={controller.activeMessages}
                loading={controller.isLoadingMessages}
                onDecision={controller.submitDecision}
                onRetry={controller.retryMessage}
              />
            )}

            <View style={[styles.footerStack, isTabRootEntry && styles.footerStackLifted]}>
              {controller.error ? (
                <View style={styles.errorBanner}>
                  <Icon name="alert-circle-outline" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{controller.error}</Text>
                  <TouchableOpacity onPress={controller.onRefresh}>
                    <Text style={styles.errorRetry}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {controller.notice ? (
                <View style={styles.noticeBanner}>
                  <Icon name="check-circle-outline" size={14} color="#5D7E16" />
                  <Text style={styles.noticeText}>{controller.notice}</Text>
                  <TouchableOpacity onPress={() => controller.setNotice(null)}>
                    <Icon name="close" size={14} color="#5D7E16" />
                  </TouchableOpacity>
                </View>
              ) : null}

              <ConversationComposer
                value={controller.composerText}
                placeholder={composerPlaceholder}
                onChangeText={controller.setComposerText}
                onSend={() => controller.sendComposer()}
                queuedCount={controller.queuedCount}
                isStreaming={controller.isStreaming}
              />
            </View>
          </>
        )}
      </KeyboardAvoidingView>

      <Modal visible={isDrawerOpen} transparent animationType="fade" onRequestClose={() => setIsDrawerOpen(false)}>
        <View style={styles.drawerBackdrop}>
          <View style={styles.drawerPanel}>
            <Text style={styles.drawerTitle}>Threads</Text>
            <Text style={styles.drawerCampaignMeta} numberOfLines={1}>
              {controller.activeCampaign?.title || 'No campaign selected'}
            </Text>

            <View style={styles.searchWrap}>
              <Icon name="magnify" size={18} color="#71717A" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search threads"
                placeholderTextColor="#71717A"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>

            <TouchableOpacity
              style={[styles.threadRow, controller.surfaceState === 'home_overview' && styles.threadRowSelected]}
              onPress={() => {
                controller.openHome();
                setIsDrawerOpen(false);
              }}
            >
              <View style={styles.threadBody}>
                <Text style={styles.threadTitle}>Home</Text>
                <Text style={styles.threadMeta}>Campaign overview</Text>
              </View>
            </TouchableOpacity>

            <View style={styles.drawerDivider} />

            <ScrollView style={styles.threadScroll} contentContainerStyle={styles.threadContent}>
              {controller.isLoadingThreads ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" color="#93C822" />
                  <Text style={styles.inlineLoadingText}>Loading threads...</Text>
                </View>
              ) : (
                groupedThreads.map(group => (
                  <View key={group.label}>
                    <Text style={styles.groupLabel}>{group.label}</Text>
                    {group.threads.map(thread => {
                      const selected = controller.surfaceState !== 'home_overview' && thread.id === controller.activeThreadId;
                      return (
                        <TouchableOpacity
                          key={thread.id}
                          style={[styles.threadRow, selected && styles.threadRowSelected]}
                          onPress={() => {
                            controller.openThread(thread.id);
                            setIsDrawerOpen(false);
                          }}
                        >
                          <View style={styles.threadBody}>
                            <Text style={styles.threadTitle} numberOfLines={1}>{thread.title}</Text>
                            <Text style={styles.threadMeta} numberOfLines={1}>
                              {formatThreadDate(thread.lastMessageAt)} • {thread.status}
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.threadMenu}
                            onPress={() => openThreadActions(thread)}
                          >
                            <Icon name="dots-vertical" size={18} color="#71717A" />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>
          </View>

          <Pressable style={styles.drawerBackdropTap} onPress={() => setIsDrawerOpen(false)} />
        </View>
      </Modal>

      <Modal visible={isCampaignSheetOpen} transparent animationType="fade" onRequestClose={() => setIsCampaignSheetOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetBackdropTap} onPress={() => setIsCampaignSheetOpen(false)} />
          <View style={styles.sheetPanel}>
            <Text style={styles.sheetTitle}>Campaigns</Text>
            {campaignSheetMode === 'switch' ? (
              <>
                <Text style={styles.sheetHint}>Switch campaign</Text>
                <ScrollView style={styles.switchCampaignList}>
                  {controller.campaigns.map(campaign => {
                    const selected = campaign.id === controller.activeCampaignId;
                    return (
                      <TouchableOpacity
                        key={campaign.id}
                        style={[styles.sheetAction, selected && styles.sheetActionSelected]}
                        onPress={() => {
                          controller.setActiveCampaignId(campaign.id);
                          setIsCampaignSheetOpen(false);
                        }}
                      >
                        <Icon name={selected ? 'check-circle' : 'circle-outline'} size={18} color={selected ? '#5D7E16' : '#71717A'} />
                        <View style={styles.sheetActionBody}>
                          <Text style={styles.sheetActionTitle}>{campaign.title}</Text>
                          <Text style={styles.sheetActionSubtitle}>{campaign.status}</Text>
                        </View>
                        <View style={styles.sheetActionControls}>
                          <Pressable
                            style={styles.sheetMiniAction}
                            onPress={event => {
                              event.stopPropagation();
                              void openCampaignConfig(campaign.id, campaign.title);
                            }}
                          >
                            <Icon name="tune" size={15} color="#5D7E16" />
                            <Text style={styles.sheetMiniActionText}>Settings</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.sheetMiniAction, styles.sheetMiniActionDelete]}
                            onPress={event => {
                              event.stopPropagation();
                              deleteCampaignFromSheet(campaign.id, campaign.title);
                            }}
                          >
                            <Icon name="trash-can-outline" size={15} color="#B91C1C" />
                            <Text style={[styles.sheetMiniActionText, styles.sheetMiniActionDeleteText]}>Delete</Text>
                          </Pressable>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <TouchableOpacity style={styles.primaryActionButton} onPress={() => setCampaignSheetMode('create')}>
                  <Text style={styles.primaryActionText}>Create campaign</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.sheetHint}>Campaign setup</Text>
                <ConfigInput label="Target revenue" value={wizardTargetRevenue} onChangeText={setWizardTargetRevenue} />
                <ConfigInput label="Timeline (days)" value={wizardTimeframeDays} onChangeText={setWizardTimeframeDays} />
                <ConfigInput label="Aggression" value={wizardAggression} onChangeText={value => setWizardAggression((value || 'balanced') as any)} />
                <ConfigInput label="Inventory scope (all/pool/specific)" value={wizardInventoryScope} onChangeText={value => setWizardInventoryScope((value || 'all') as any)} />
                <ConfigInput label="Specific product IDs (comma separated)" value={wizardProductIds} onChangeText={setWizardProductIds} />
                <ConfigInput label="Min acceptable offer (%)" value={wizardMinOfferPct} onChangeText={setWizardMinOfferPct} />
                <ConfigInput label="Max auto price drop (%)" value={wizardMaxDropPct} onChangeText={setWizardMaxDropPct} />
                <View style={styles.rowActions}>
                  <TouchableOpacity style={[styles.secondaryActionButton, styles.flexFill]} onPress={() => setCampaignSheetMode('switch')}>
                    <Text style={styles.secondaryActionText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.primaryActionButton, styles.flexFill]} onPress={submitNewCampaign}>
                    <Text style={styles.primaryActionText}>Create campaign</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={isConfigSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setIsConfigSheetOpen(false);
          setConfigCampaignTarget(null);
        }}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={styles.sheetBackdropTap}
            onPress={() => {
              setIsConfigSheetOpen(false);
              setConfigCampaignTarget(null);
            }}
          />
          <View style={styles.sheetPanel}>
            <Text style={styles.sheetTitle}>Campaign settings</Text>
            <Text style={styles.sheetHint}>
              {configCampaignTarget?.title || controller.activeCampaign?.title || 'Selected campaign'}
            </Text>
            <ConfigInput
              label="Target revenue"
              value={String(controller.campaignConfig?.targetRevenue || '')}
              onChangeText={value => controller.setCampaignConfig(prev => prev ? ({ ...prev, targetRevenue: Number(value || 0) }) : prev)}
            />
            <ConfigInput
              label="Timeline (days)"
              value={String(controller.campaignConfig?.timeframeDays || '')}
              onChangeText={value => controller.setCampaignConfig(prev => prev ? ({ ...prev, timeframeDays: Number(value || 0) }) : prev)}
            />
            <ConfigInput
              label="Aggressiveness"
              value={controller.campaignConfig?.aggressiveness || 'balanced'}
              onChangeText={value => {
                const normalized = (value || 'balanced').toLowerCase() as 'conservative' | 'balanced' | 'aggressive';
                controller.setCampaignConfig(prev => prev ? ({ ...prev, aggressiveness: normalized }) : prev);
              }}
            />
            <ConfigInput
              label="Min acceptable offer (%)"
              value={String(controller.campaignConfig?.guardrails.minAcceptableOfferPercent || '')}
              onChangeText={value => controller.setCampaignConfig(prev => prev ? ({
                ...prev,
                guardrails: { ...prev.guardrails, minAcceptableOfferPercent: Number(value || 0) },
              }) : prev)}
            />
            <ConfigInput
              label="Max auto price drop (%)"
              value={String(controller.campaignConfig?.guardrails.maxAutoPriceDropPercent || '')}
              onChangeText={value => controller.setCampaignConfig(prev => prev ? ({
                ...prev,
                guardrails: { ...prev.guardrails, maxAutoPriceDropPercent: Number(value || 0) },
              }) : prev)}
            />
            <TouchableOpacity style={styles.primaryActionButton} onPress={saveConfig}>
              <Text style={styles.primaryActionText}>Save settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={styles.renameBackdrop}>
          <Pressable style={styles.sheetBackdropTap} onPress={() => setRenameTarget(null)} />
          <View style={styles.renamePanel}>
            <Text style={styles.sheetTitle}>{renameTarget?.kind === 'campaign' ? 'Rename liquidation' : 'Rename thread'}</Text>
            <Text style={styles.sheetHint}>Choose a clearer title for this {renameTarget?.kind === 'campaign' ? 'campaign' : 'chat'}.</Text>
            <TextInput
              style={styles.configInput}
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder={renameTarget?.kind === 'campaign' ? 'Liquidation spring push' : 'Unsynced products'}
              placeholderTextColor="#9CA3AF"
              autoFocus
            />
            <View style={styles.rowActions}>
              <TouchableOpacity style={[styles.secondaryActionButton, styles.flexFill]} onPress={() => setRenameTarget(null)}>
                <Text style={styles.secondaryActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryActionButton, styles.flexFill]} onPress={submitRename}>
                <Text style={styles.primaryActionText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const ConfigInput = ({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) => (
  <View style={styles.configField}>
    <Text style={styles.configLabel}>{label}</Text>
    <TextInput
      style={styles.configInput}
      value={value}
      onChangeText={onChangeText}
      placeholderTextColor="#9CA3AF"
    />
  </View>
);

const groupThreadsByRecency = (threads: CampaignThreadSummary[]) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 7);

  const groups: Array<{ label: string; threads: CampaignThreadSummary[] }> = [
    { label: 'Today', threads: [] },
    { label: 'Yesterday', threads: [] },
    { label: 'Last 7 days', threads: [] },
    { label: 'Older', threads: [] },
  ];

  threads
    .slice()
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .forEach(thread => {
      const stamp = new Date(thread.lastMessageAt);
      if (stamp >= startOfToday) {
        groups[0].threads.push(thread);
        return;
      }
      if (stamp >= startOfYesterday) {
        groups[1].threads.push(thread);
        return;
      }
      if (stamp >= startOfWeek) {
        groups[2].threads.push(thread);
        return;
      }
      groups[3].threads.push(thread);
    });

  return groups.filter(group => group.threads.length > 0);
};

const formatThreadDate = (value: string) => {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return 'Recent';
  return stamp.toLocaleDateString();
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  topBar: {
    minHeight: 72,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  subtitleRow: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  subtitleText: {
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },
  campaignChip: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  campaignChipLabel: {
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  campaignChipText: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  newChatButton: {
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(147,200,34,0.08)',
    borderWidth: 1,
    borderColor: '#93C822',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 6,
  },
  newChatText: {
    color: '#5D7E16',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 11,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 24,
  },
  homeHero: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 16,
    marginBottom: 16,
  },
  homeLogo: {
    width: 118,
    height: 34,
  },
  homeEyebrow: {
    marginTop: 18,
    color: '#6B8A11',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  homeTitle: {
    marginTop: 8,
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 24,
  },
  homeBody: {
    marginTop: 8,
    color: '#6B7280',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14,
    lineHeight: 22,
    maxWidth: '92%',
  },
  homeDivider: {
    marginTop: 18,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  footerStack: {
    backgroundColor: '#FFFFFF',
    paddingTop: 4,
  },
  footerStackLifted: {
    paddingBottom: 68,
  },
  errorBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#B91C1C',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
  },
  errorRetry: {
    color: '#DC2626',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 12,
  },
  noticeBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.3)',
    backgroundColor: 'rgba(147,200,34,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: {
    flex: 1,
    color: '#5D7E16',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
  },
  drawerBackdrop: {
    flex: 1,
    flexDirection: 'row',
  },
  drawerPanel: {
    width: '84%',
    backgroundColor: '#FFFFFF',
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  drawerBackdropTap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  drawerTitle: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 26,
  },
  drawerCampaignMeta: {
    marginTop: 4,
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14,
  },
  searchWrap: {
    marginTop: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: '#111827',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 15,
  },
  drawerDivider: {
    marginVertical: 16,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E7EB',
  },
  threadScroll: {
    flex: 1,
  },
  threadContent: {
    paddingBottom: 40,
  },
  groupLabel: {
    marginTop: 10,
    marginBottom: 10,
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  threadRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  threadRowSelected: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  threadBody: {
    flex: 1,
  },
  threadTitle: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 15,
  },
  threadMeta: {
    marginTop: 4,
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14,
  },
  threadMenu: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineLoading: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inlineLoadingText: {
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdropTap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  sheetPanel: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  renameBackdrop: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.24)',
  },
  renamePanel: {
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
  },
  sheetTitle: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 22,
  },
  sheetHint: {
    marginTop: 8,
    marginBottom: 12,
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 13,
  },
  switchCampaignList: {
    maxHeight: 320,
  },
  sheetAction: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sheetActionSelected: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  sheetActionBody: {
    flex: 1,
  },
  sheetActionControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetMiniAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(147,200,34,0.35)',
    backgroundColor: 'rgba(147,200,34,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sheetMiniActionDelete: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  sheetMiniActionText: {
    color: '#5D7E16',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 11,
  },
  sheetMiniActionDeleteText: {
    color: '#B91C1C',
  },
  sheetActionTitle: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 14,
  },
  sheetActionSubtitle: {
    marginTop: 2,
    color: '#71717A',
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 12,
    lineHeight: 18,
  },
  primaryActionButton: {
    height: 48,
    borderRadius: 14,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryActionText: {
    color: '#1F2937',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 14,
  },
  secondaryActionButton: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  secondaryActionText: {
    color: '#111827',
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 14,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 12,
  },
  flexFill: {
    flex: 1,
  },
  configField: {
    marginBottom: 12,
  },
  configLabel: {
    marginBottom: 6,
    color: '#374151',
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 12,
  },
  configInput: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    color: '#111827',
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 14,
  },
});

export default LiquidationCampaignScreen;
