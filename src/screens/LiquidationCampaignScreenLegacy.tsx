import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity, RefreshControl, SafeAreaView, StatusBar, Image, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ensureSupabaseJwt, supabase } from '../../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CampaignSelector } from '../components/CampaignSelector';
import { DateTimeline } from '../components/DateTimeline';
import InsightCard, { DashboardInsight } from '../components/InsightCard';
import { CampaignInventorySettings } from '../components/CampaignInventorySettings';
import type { CampaignItem } from '../components/CampaignInventorySettings';

// TYPES
interface AgentSession {
    id: string;
    agentType: string;
    status: string;
    goal: {
        type: string;
        targetRevenue?: number;
        timeframeDays?: number;
        deadline?: string;
        aggressiveness?: string;
        productIds?: string[];
    };
    state: {
        phase?: string;
        strategyId?: string;
        progress?: number;
        revenueGenerated?: number;
        revenueCollected?: number;
        itemsSold?: number;
        totalItems?: number;
        lastUpdate?: string;
    };
    createdAt: string;
    updatedAt: string;
}

interface AgentMessage {
    id: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
    createdAt: string;
    meta?: any;
    // New fields for approval
    type?: 'text' | 'approval_request';
    approvalStatus?: 'pending' | 'approved' | 'rejected';
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';

const LiquidationCampaignScreen = () => {
    const theme = useTheme();
    const colors = theme.colors;
    const navigation = useNavigation();
    const route = useRoute<any>();
    const initialCampaignId = (route.params as any)?.campaignId;
    const isTabRootEntry = route?.name === 'Clearouts' || (route.params as any)?.entryPoint === 'tab';

    // DATA STATE
    const [campaigns, setCampaigns] = useState<AgentSession[]>([]);
    const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(initialCampaignId || null);

    // DETAIL STATE
    const [currentSession, setCurrentSession] = useState<AgentSession | null>(null);
    const [messages, setMessages] = useState<AgentMessage[]>([]);

    // UI STATE
    const [activeTab, setActiveTab] = useState<'activity' | 'config'>('activity');
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // CHAT STATE
    const [inputText, setInputText] = useState('');
    const [sending, setSending] = useState(false);

    // TIMELINE STATE
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());

    // CONFIG TAB: real campaign items from strategy
    const [configItems, setConfigItems] = useState<CampaignItem[]>([]);
    const [loadingConfig, setLoadingConfig] = useState(false);

    // 1. Fetch Campaign List
    const fetchCampaigns = useCallback(async () => {
        try {
            const token = await ensureSupabaseJwt();
            if (!token) return;

            const response = await fetch(`${API_BASE_URL}/api/agent/sessions?type=liquidation&status=active,waiting_user`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && Array.isArray(data.sessions)) {
                    setCampaigns(data.sessions);
                    if (!selectedCampaignId && data.sessions.length > 0) {
                        setSelectedCampaignId(data.sessions[0].id);
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching campaigns:', e);
        } finally {
            setLoadingList(false);
        }
    }, [selectedCampaignId]);

    // 2. Fetch Detail
    const fetchSessionDetail = useCallback(async () => {
        if (!selectedCampaignId) return;

        setLoadingDetail(true);
        try {
            const token = await ensureSupabaseJwt();
            const response = await fetch(`${API_BASE_URL}/api/agent/sessions/${selectedCampaignId}`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to load campaign details');

            const data = await response.json();
            if (data.success) {
                setCurrentSession(data.session);
                // Normalize messages: backend uses timestamp, UI uses createdAt
                const raw = data.messages || [];
                setMessages(raw.map((m: any) => ({
                    ...m,
                    createdAt: m.timestamp ?? m.createdAt ?? new Date().toISOString(),
                })));
                setError(null);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoadingDetail(false);
            setRefreshing(false);
        }
    }, [selectedCampaignId]);

    useEffect(() => {
        fetchCampaigns();
    }, [fetchCampaigns]);

    useEffect(() => {
        if (selectedCampaignId) {
            fetchSessionDetail();
        }
    }, [selectedCampaignId, fetchSessionDetail]);

    // 3. Fetch strategy items for Config tab when session has strategyId
    const fetchStrategyItems = useCallback(async () => {
        const strategyId = currentSession?.state?.strategyId;
        if (!strategyId) {
            setConfigItems([]);
            return;
        }
        setLoadingConfig(true);
        try {
            const token = await ensureSupabaseJwt();
            if (!token) return;
            const response = await fetch(
                `${API_BASE_URL}/api/liquidation/strategies/${strategyId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!response.ok) {
                setConfigItems([]);
                return;
            }
            const data = await response.json();
            if (!data.success || !data.strategy) {
                setConfigItems([]);
                return;
            }
            const strategy = data.strategy;
            const phases = strategy.phases ?? strategy.Strategy ?? [];
            const items: Array<{ name: string; suggestedPrice: number; quantity: number; confidence?: string; productId?: string; variantId?: string }> = [];
            for (const phase of phases) {
                const phaseItems = phase.items ?? [];
                for (const it of phaseItems) {
                    items.push({
                        name: it.name ?? 'Item',
                        suggestedPrice: it.suggestedPrice ?? it.currentPrice ?? 0,
                        quantity: it.quantity ?? 1,
                        confidence: it.confidence,
                        productId: it.productId,
                        variantId: it.variantId,
                    });
                }
            }
            const mapped: CampaignItem[] = items.map((it, idx) => ({
                id: it.variantId ?? it.productId ?? `item-${idx}`,
                name: it.name,
                sku: it.productId ?? it.variantId ?? `SKU-${idx}`,
                price: it.suggestedPrice,
                inventory: it.quantity,
                aggressiveness: (it.confidence === 'high' ? 'high' : it.confidence === 'low' ? 'low' : 'medium') as 'low' | 'medium' | 'high',
            }));
            setConfigItems(mapped);
        } catch (e) {
            console.error('Error fetching strategy items:', e);
            setConfigItems([]);
        } finally {
            setLoadingConfig(false);
        }
    }, [currentSession?.state?.strategyId]);

    useEffect(() => {
        if (activeTab === 'config' && currentSession?.state?.strategyId) {
            fetchStrategyItems();
        } else if (!currentSession?.state?.strategyId) {
            setConfigItems([]);
        }
    }, [activeTab, currentSession?.state?.strategyId, fetchStrategyItems]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchCampaigns();
        fetchSessionDetail();
    }, [fetchCampaigns, fetchSessionDetail]);

    // Send Message — POST to Nest agent API, then refetch session detail
    const handleSendMessage = async () => {
        if (!inputText.trim() || !selectedCampaignId) return;

        const content = inputText.trim();
        setInputText('');

        const tempMsg: AgentMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            createdAt: new Date().toISOString()
        };
        setMessages(prev => [tempMsg, ...prev]);
        setSending(true);
        setError(null);

        try {
            const token = await ensureSupabaseJwt();
            if (!token) {
                setError('Not authenticated');
                setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
                return;
            }

            const response = await fetch(
                `${API_BASE_URL}/api/agent/sessions/${selectedCampaignId}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ content }),
                }
            );

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.message || `Request failed: ${response.status}`);
            }

            const data = await response.json();
            if (data.success && data.response) {
                // Refetch full session so we get the real assistant message and updated state
                await fetchSessionDetail();
            }
        } catch (e: any) {
            setError(e.message ?? 'Failed to send message');
            setMessages(prev => prev.filter(m => m.id !== tempMsg.id));
        } finally {
            setSending(false);
        }
    };

    // Approval Action — call backend approve (and execute if approved), then refetch
    const handleApproval = (msgId: string, approved: boolean) => {
        Alert.alert(
            approved ? "Approve Plan" : "Reject Plan",
            approved ? "Are you sure you want to proceed with this liquidation strategy?" : "The agent will revise the strategy.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Confirm",
                    style: approved ? "default" : "destructive",
                    onPress: async () => {
                        setMessages(prev => prev.map(m =>
                            m.id === msgId
                                ? { ...m, approvalStatus: approved ? 'approved' : 'rejected' }
                                : m
                        ));
                        setSending(true);
                        setError(null);
                        try {
                            const token = await ensureSupabaseJwt();
                            if (!token) {
                                setError('Not authenticated');
                                return;
                            }
                            const strategyId = currentSession?.state?.strategyId;
                            if (approved && strategyId) {
                                const approveRes = await fetch(
                                    `${API_BASE_URL}/api/liquidation/strategies/${strategyId}/approve`,
                                    {
                                        method: 'POST',
                                        headers: { Authorization: `Bearer ${token}` },
                                    }
                                );
                                if (!approveRes.ok) {
                                    const errData = await approveRes.json().catch(() => ({}));
                                    throw new Error(errData.message || 'Failed to approve strategy');
                                }
                                const executeRes = await fetch(
                                    `${API_BASE_URL}/api/liquidation/strategies/${strategyId}/execute`,
                                    {
                                        method: 'POST',
                                        headers: { Authorization: `Bearer ${token}` },
                                    }
                                );
                                if (!executeRes.ok) {
                                    const errData = await executeRes.json().catch(() => ({}));
                                    throw new Error(errData.message || 'Approved but execution failed');
                                }
                            }
                            if (!approved && selectedCampaignId) {
                                await fetch(
                                    `${API_BASE_URL}/api/agent/sessions/${selectedCampaignId}/messages`,
                                    {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            Authorization: `Bearer ${token}`,
                                        },
                                        body: JSON.stringify({ content: 'Strategy rejected. Please revise the plan.' }),
                                    }
                                );
                            }
                            await fetchSessionDetail();
                        } catch (e: any) {
                            setError(e.message ?? (approved ? 'Failed to approve/execute' : 'Failed to send rejection'));
                        } finally {
                            setSending(false);
                        }
                    }
                }
            ]
        );
    };

    // --- DERIVED DATA ---
    const dailyMessages = useMemo(() => {
        if (!messages.length) return [];
        return messages.filter(m => {
            const d = new Date(m.createdAt);
            return d.toDateString() === selectedDate.toDateString();
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Newest first
    }, [messages, selectedDate]);

    const activeDates = useMemo(() => {
        const dates = new Set<string>();
        messages.forEach(m => dates.add(m.createdAt.split('T')[0]));
        return Array.from(dates);
    }, [messages]);

    const campaignInsight: DashboardInsight | null = useMemo(() => {
        if (!currentSession) return null;

        const { state, goal, status } = currentSession;
        const revenue = state.revenueGenerated ?? state.revenueCollected ?? 0;
        const target = goal.targetRevenue || 1;

        const progressPercent = Math.min(100, Math.round((revenue / target) * 100));

        let headline = "Campaign is active.";
        if (status === 'waiting_user') headline = "Action required: Review strategy.";
        if (state.phase === 'analyzing') headline = "Analyzing inventory...";

        return {
            topDIN: { category: "Status", headline },
            bottomDIN: {
                title: "Progress",
                description: `$${revenue.toLocaleString()} recovered of $${target.toLocaleString()} goal (${progressPercent}%).`,
                metrics: [
                    { label: "Revenue", value: `$${revenue.toLocaleString()}`, color: "#16a34a" },
                    { label: "Target", value: `$${target.toLocaleString()}`, color: "#6b7280" }
                ],
            },
            severity: status === 'waiting_user' ? 'warning' : 'good',
            timestamp: state.lastUpdate || currentSession.updatedAt,
            timeframe: 'short_term'
        };
    }, [currentSession]);

    // Config tab uses real campaign items from strategy (configItems); fallback to empty when no strategy
    const campaignItemsForConfig = configItems;

    // --- RENDERERS ---

    const renderMessageBubble = (msg: AgentMessage) => {
        const isAssistant = msg.role === 'assistant';
        const isApprovalRequest = msg.content.includes("approve") || msg.type === 'approval_request' || msg.content.includes("Say yes?");
        const isAction = msg.content.startsWith("↓") || msg.content.startsWith("✓");

        if (isAssistant) {
            return (
                <View key={msg.id} style={styles.agentCardWrapper}>
                    <View style={styles.agentCardHeader}>
                        <View style={styles.avatarSmall}>
                            <Icon name="robot" size={14} color="#ffffff" />
                        </View>
                        <Text style={styles.agentCardTitle}>
                            {isApprovalRequest ? "ANORA RECOMMENDS" : isAction ? "ANORA'S LAST MOVE" : "ANORA"}
                        </Text>
                        <Text style={styles.bubbleTimeRight}>
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                    </View>
                    <View style={[styles.agentCardContent, isApprovalRequest && styles.agentCardContentHighlight]}>
                        <Text style={styles.agentCardText}>{msg.content}</Text>

                        {/* APPROVAL ACTIONS */}
                        {isApprovalRequest && (
                            <View style={styles.approvalContainer}>
                                {msg.approvalStatus ? (
                                    <View style={[styles.statusBadge, msg.approvalStatus === 'approved' ? styles.badgeApproved : styles.badgeRejected]}>
                                        <Icon name={msg.approvalStatus === 'approved' ? "check" : "close"} size={14} color={msg.approvalStatus === 'approved' ? "#15803d" : "#991b1b"} />
                                        <Text style={[styles.statusText, msg.approvalStatus === 'approved' ? styles.textApproved : styles.textRejected]}>
                                            {msg.approvalStatus === 'approved' ? "Approved" : "Rejected"}
                                        </Text>
                                    </View>
                                ) : (
                                    <View style={styles.actionButtons}>
                                        <TouchableOpacity
                                            style={[styles.actionBtn, styles.btnApprove]}
                                            onPress={() => handleApproval(msg.id, true)}
                                        >
                                            <Text style={styles.btnTextApprove}>Yes, do it</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.actionBtn, styles.btnReject]}
                                            onPress={() => handleApproval(msg.id, false)}
                                        >
                                            <Text style={styles.btnTextReject}>Not yet</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        )}
                    </View>
                </View>
            );
        }

        // User message
        return (
            <View key={msg.id} style={[styles.bubbleWrapper, styles.wrapperRight]}>
                <View style={[styles.bubbleContent, styles.bubbleContentRight]}>
                    <Text style={[styles.bubbleText, styles.bubbleTextRight]}>
                        {msg.content}
                    </Text>
                    <Text style={[styles.bubbleTime, styles.bubbleTimeRight]}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: '#f9fafb' }]}>
            <StatusBar barStyle="dark-content" />

            {/* Header / Selector (Sticky) */}
            <View style={styles.headerSection}>
                <View style={styles.navRow}>
                    {isTabRootEntry ? (
                        <View style={{ width: 40 }} />
                    ) : (
                        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
                            <Icon name="arrow-left" size={24} color="#111827" />
                        </TouchableOpacity>
                    )}
                    <Text style={styles.screenTitle}>Liquidation Console</Text>
                    <View style={{ width: 40 }} />
                </View>
                <CampaignSelector
                    campaigns={campaigns}
                    selectedId={selectedCampaignId || ''}
                    onSelect={setSelectedCampaignId}
                    loading={loadingList}
                />
            </View>

            {/* TAB SELECTOR */}
            <View style={styles.tabRow}>
                <TouchableOpacity
                    style={[styles.tabBtn, activeTab === 'activity' && styles.tabBtnActive]}
                    onPress={() => setActiveTab('activity')}
                >
                    <Text style={[styles.tabText, activeTab === 'activity' && styles.tabTextActive]}>Live Activity</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tabBtn, activeTab === 'config' && styles.tabBtnActive]}
                    onPress={() => setActiveTab('config')}
                >
                    <Text style={[styles.tabText, activeTab === 'config' && styles.tabTextActive]}>Configuration</Text>
                </TouchableOpacity>
            </View>

            {currentSession && !loadingDetail ? (
                activeTab === 'activity' ? (
                    <KeyboardAvoidingView
                        behavior={Platform.OS === "ios" ? "padding" : undefined}
                        style={{ flex: 1 }}
                        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
                    >
                        <ScrollView
                            style={styles.scrollView}
                            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                            contentContainerStyle={{ paddingBottom: 20 }}
                        >
                            <View style={styles.pad16}>
                                <InsightCard
                                    insight={campaignInsight}
                                    loading={false}
                                    error={null}
                                    onAction={() => { }}
                                    onRefresh={fetchSessionDetail}
                                />
                            </View>

                            <View style={styles.timelineSection}>
                                <DateTimeline
                                    selectedDate={selectedDate}
                                    onSelectDate={setSelectedDate}
                                    activeDates={activeDates}
                                />
                            </View>

                            <View style={styles.feedSection}>
                                {/* Live Status Header */}
                                <View style={styles.liveStatusHeader}>
                                    <View style={styles.liveStatusIcon}>
                                        <Icon name="progress-clock" size={16} color="#1f2937" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.liveStatusTitle}>Anora is working</Text>
                                        <Text style={styles.liveStatusDesc}>
                                            "Watching pricing on items. Lowering overnight if no bids."
                                        </Text>
                                    </View>
                                </View>

                                <Text style={styles.feedDateHeader}>
                                    {selectedDate.toDateString() === new Date().toDateString()
                                        ? "Today's Activity"
                                        : selectedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                                </Text>

                                {dailyMessages.length > 0 ? (
                                    dailyMessages.map(renderMessageBubble)
                                ) : (
                                    <View style={styles.emptyState}>
                                        <Text style={styles.emptyText}>No activity recorded.</Text>
                                    </View>
                                )}
                            </View>
                        </ScrollView>

                        {/* CHAT INPUT */}
                        <View style={styles.inputArea}>
                            <View style={styles.inputContainer}>
                                <TextInput
                                    style={styles.inputField}
                                    placeholder="Ask about this campaign..."
                                    placeholderTextColor="#9ca3af"
                                    value={inputText}
                                    onChangeText={setInputText}
                                    multiline
                                />
                                <TouchableOpacity
                                    style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
                                    disabled={!inputText.trim() || sending}
                                    onPress={handleSendMessage}
                                >
                                    <Icon name="arrow-up" size={20} color="#ffffff" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>

                ) : (
                    // CONFIG TAB — real items from strategy API
                    <ScrollView style={styles.scrollView} refreshControl={<RefreshControl refreshing={loadingConfig} onRefresh={fetchStrategyItems} />}>
                        {currentSession?.state?.strategyId ? (
                            <CampaignInventorySettings
                                items={campaignItemsForConfig}
                                onUpdateItemStrategy={() => { }}
                                onUpdateGlobalStrategy={() => { }}
                            />
                        ) : (
                            <View style={styles.emptyState}>
                                <Text style={styles.emptyText}>No strategy yet. Create and approve a plan in Live Activity to see campaign items here.</Text>
                            </View>
                        )}
                    </ScrollView>
                )
            ) : (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={colors.primary} />
                    <Text style={styles.loadingText}>Loading campaign details...</Text>
                </View>
            )}
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollView: { flex: 1 },
    headerSection: {
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    navRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 8,
    },
    screenTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
    },
    // Tabs
    tabRow: {
        flexDirection: 'row',
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    tabBtn: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabBtnActive: {
        borderBottomColor: '#111827',
    },
    tabText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
    },
    tabTextActive: {
        color: '#111827',
    },

    // Layout
    pad16: { padding: 16 },
    timelineSection: { marginTop: 0 },
    feedSection: { padding: 16 },
    feedDateHeader: {
        fontSize: 12,
        fontWeight: '700',
        color: '#9ca3af',
        marginBottom: 16,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        alignSelf: 'center',
    },

    // Live Status Header
    liveStatusHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
    },
    liveStatusIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#f3f4f6',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    liveStatusTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1f2937',
        marginBottom: 2,
    },
    liveStatusDesc: {
        fontSize: 13,
        color: '#4b5563',
        lineHeight: 18,
    },

    // Chat Bubbles
    bubbleWrapper: {
        flexDirection: 'row',
        marginBottom: 16,
        maxWidth: '90%',
    },
    wrapperLeft: { alignSelf: 'flex-start' },
    wrapperRight: { alignSelf: 'flex-end', justifyContent: 'flex-end' },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#111827',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        marginTop: 4,
    },
    bubbleContent: {
        padding: 12,
        borderRadius: 16,
    },
    bubbleContentLeft: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 4,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 1, elevation: 1,
    },
    bubbleContentRight: {
        backgroundColor: '#111827',
        borderTopRightRadius: 4,
    },
    bubbleText: { fontSize: 15, lineHeight: 22, color: '#1f2937' },
    bubbleTextRight: { color: '#ffffff' },
    bubbleTime: { fontSize: 10, color: '#9ca3af', marginTop: 4, alignSelf: 'flex-end' },
    bubbleTimeRight: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },

    // Agent Cards
    agentCardWrapper: {
        marginBottom: 20,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        overflow: 'hidden',
    },
    agentCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: '#f9fafb',
        borderBottomWidth: 1,
        borderBottomColor: '#f3f4f6',
    },
    avatarSmall: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: '#10b981',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    agentCardTitle: {
        fontSize: 11,
        fontWeight: '700',
        color: '#6b7280',
        letterSpacing: 0.5,
        flex: 1,
    },
    agentCardContent: {
        padding: 16,
    },
    agentCardContentHighlight: {
        backgroundColor: '#fefce8', // very light yellow for recommendations
    },
    agentCardText: {
        fontSize: 15,
        lineHeight: 22,
        color: '#1f2937',
    },

    // Approval
    approvalContainer: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
    },
    actionButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    actionBtn: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    btnReject: { backgroundColor: '#fee2e2' }, // red-100
    btnApprove: { backgroundColor: '#dcfce7' }, // green-100
    btnTextReject: { color: '#991b1b', fontWeight: '600', fontSize: 12 },
    btnTextApprove: { color: '#166534', fontWeight: '600', fontSize: 12 },

    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: 8,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    badgeApproved: { backgroundColor: '#f0fdf4' },
    badgeRejected: { backgroundColor: '#fef2f2' },
    statusText: { fontSize: 12, fontWeight: '600' },
    textApproved: { color: '#15803d' },
    textRejected: { color: '#991b1b' },

    // Empty
    emptyState: { padding: 30, alignItems: 'center' },
    emptyText: { color: '#9ca3af' },

    // Input
    inputArea: {
        backgroundColor: '#ffffff',
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        padding: 12,
    },
    inputContainer: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: 6,
        alignItems: 'flex-end', // for multiline
    },
    inputField: {
        flex: 1,
        minHeight: 36,
        maxHeight: 100,
        paddingHorizontal: 8,
        paddingVertical: 8,
        fontSize: 15,
        color: '#111827',
    },
    sendBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#111827',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
    },
    sendBtnDisabled: {
        backgroundColor: '#9ca3af',
    },
    loadingContainer: { padding: 40, alignItems: 'center' },
    loadingText: { marginTop: 12, color: '#6b7280' },
});

export default LiquidationCampaignScreen;
