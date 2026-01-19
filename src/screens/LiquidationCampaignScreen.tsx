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
    const route = useRoute();
    const initialCampaignId = (route.params as any)?.campaignId;

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

    // 1. Fetch Campaign List
    const fetchCampaigns = useCallback(async () => {
        try {
            const token = await ensureSupabaseJwt();
            if (!token) return;

            const response = await fetch(`${API_BASE_URL}/api/agent/sessions?type=liquidation&status=active,waiting_for_user`, {
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
                // Augment messages with approval status if needed (mock for now if backend doesn't support)
                setMessages(data.messages || []);
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

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchCampaigns();
        fetchSessionDetail();
    }, [fetchCampaigns, fetchSessionDetail]);

    // Send Message
    const handleSendMessage = async () => {
        if (!inputText.trim()) return;

        const content = inputText.trim();
        setInputText('');

        // Optimistic add
        const tempMsg: AgentMessage = {
            id: `temp-${Date.now()}`,
            role: 'user',
            content,
            createdAt: new Date().toISOString()
        };
        setMessages(prev => [tempMsg, ...prev]);

        // In real app, POST to API
        // For now, simulate delay and response
        setTimeout(() => {
            const responseMsg: AgentMessage = {
                id: `resp-${Date.now()}`,
                role: 'assistant',
                content: "I've updated the plan based on your request.",
                createdAt: new Date().toISOString()
            };
            setMessages(prev => [responseMsg, ...prev]);
        }, 1500);
    };

    // Approval Action
    const handleApproval = (msgId: string, approved: boolean) => {
        Alert.alert(
            approved ? "Approve Plan" : "Reject Plan",
            approved ? "Are you sure you want to proceed with this liquidation strategy?" : "The agent will revise the strategy.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Confirm",
                    style: approved ? "default" : "destructive",
                    onPress: () => {
                        // Update local state
                        setMessages(prev => prev.map(m =>
                            m.id === msgId
                                ? { ...m, approvalStatus: approved ? 'approved' : 'rejected' }
                                : m
                        ));
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
        const revenue = state.revenueGenerated || 0;
        const target = goal.targetRevenue || 1;

        let headline = "Campaign is active.";
        if (status === 'waiting_for_user') headline = "Action required: Review strategy.";
        if (state.phase === 'analyzing') headline = "Analyzing inventory...";

        return {
            topDIN: { category: "Status", headline },
            bottomDIN: {
                title: "Update",
                description: `Generated $${revenue.toLocaleString()} (Current Pace: Normal).`,
                metrics: [
                    { label: "Revenue", value: `$${revenue.toLocaleString()}`, color: "#16a34a" },
                    { label: "Target", value: `$${target.toLocaleString()}`, color: "#6b7280" }
                ],
            },
            severity: status === 'waiting_for_user' ? 'warning' : 'good',
            timestamp: state.lastUpdate || currentSession.updatedAt,
            timeframe: 'short_term'
        };
    }, [currentSession]);

    // Mock items for config
    const mockItems: CampaignItem[] = useMemo(() => [
        { id: '1', name: 'Vintage Leather Jacket', sku: 'VLJ-001', price: 145.00, inventory: 12, aggressiveness: 'medium' },
        { id: '2', name: 'Summer Floral Dress', sku: 'SFD-042', price: 45.00, inventory: 50, aggressiveness: 'high' },
        { id: '3', name: 'Denim Jeans Classic', sku: 'DJC-109', price: 89.99, inventory: 5, aggressiveness: 'low' },
    ], []);

    // --- RENDERERS ---

    const renderMessageBubble = (msg: AgentMessage) => {
        const isAssistant = msg.role === 'assistant';
        // Check for special approval type (mock logic here, ideally comes from backend type)
        const isApprovalRequest = msg.content.includes("approve") || msg.type === 'approval_request';

        return (
            <View key={msg.id} style={[styles.bubbleWrapper, isAssistant ? styles.wrapperLeft : styles.wrapperRight]}>
                {isAssistant && (
                    <View style={styles.avatar}>
                        <Icon name="robot" size={16} color="#ffffff" />
                    </View>
                )}
                <View style={[styles.bubbleContent, isAssistant ? styles.bubbleContentLeft : styles.bubbleContentRight]}>
                    <Text style={[styles.bubbleText, !isAssistant && styles.bubbleTextRight]}>
                        {msg.content}
                    </Text>

                    {/* APPROVAL ACTIONS */}
                    {isAssistant && isApprovalRequest && (
                        <View style={styles.approvalContainer}>
                            {msg.approvalStatus ? (
                                <View style={[styles.statusBadge, msg.approvalStatus === 'approved' ? styles.badgeApproved : styles.badgeRejected]}>
                                    <Icon name={msg.approvalStatus === 'approved' ? "check" : "close"} size={14} color={msg.approvalStatus === 'approved' ? "#15803d" : "#991b1b"} />
                                    <Text style={[styles.statusText, msg.approvalStatus === 'approved' ? styles.textApproved : styles.textRejected]}>
                                        {msg.approvalStatus === 'approved' ? "Plan Approved" : "Plan Rejected"}
                                    </Text>
                                </View>
                            ) : (
                                <View style={styles.actionButtons}>
                                    <TouchableOpacity
                                        style={[styles.actionBtn, styles.btnReject]}
                                        onPress={() => handleApproval(msg.id, false)}
                                    >
                                        <Text style={styles.btnTextReject}>Reject</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.actionBtn, styles.btnApprove]}
                                        onPress={() => handleApproval(msg.id, true)}
                                    >
                                        <Text style={styles.btnTextApprove}>Approve</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </View>
                    )}

                    <Text style={[styles.bubbleTime, !isAssistant && styles.bubbleTimeRight]}>
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
                    <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 8 }}>
                        <Icon name="arrow-left" size={24} color="#111827" />
                    </TouchableOpacity>
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
                                <Text style={styles.feedDateHeader}>
                                    {selectedDate.toDateString() === new Date().toDateString()
                                        ? "Today's Conversation"
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
                                    style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
                                    disabled={!inputText.trim()}
                                    onPress={handleSendMessage}
                                >
                                    <Icon name="arrow-up" size={20} color="#ffffff" />
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>

                ) : (
                    // CONFIG TAB
                    <ScrollView style={styles.scrollView}>
                        <CampaignInventorySettings
                            items={mockItems}
                            onUpdateItemStrategy={() => { }}
                            onUpdateGlobalStrategy={() => { }}
                        />
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
    bubbleTimeRight: { color: 'rgba(255,255,255,0.6)' },

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
