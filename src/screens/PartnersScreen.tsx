import React, { useState, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    ActivityIndicator,
    TouchableOpacity,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    Switch,
    StatusBar
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import {
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle2,
    ChevronRight,
    Folder,
    Handshake,
    Inbox,
    Info,
    Package,
    Pause,
    Play,
    Send,
    Store,
    Tag,
    Unlink,
    UserPlus,
    X
} from 'lucide-react-native';
import { ensureSupabaseJwt } from '../lib/supabase';
import { showMessage } from 'react-native-flash-message';
import { capture, AnalyticsEvents } from '../lib/analytics';
import * as Clipboard from 'expo-clipboard';
import { useOrg } from '../context/OrgContext';
import { PartnerAcceptModal } from '../components/PartnerAcceptModal';
import { API_BASE_URL } from '../config/env';
import BaseModal from '../components/BaseModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageHeader } from '../components/ui/PageHeader';
import { createLogger } from '../utils/logger';
const log = createLogger('PartnersScreen');


const SSSYNC_API_BASE_URL = API_BASE_URL;

const requireOk = async (response: Response, fallback: string): Promise<Response> => {
    if (response.ok) return response;
    const message = await response.text().catch(() => '');
    throw new Error(message || `${fallback} (${response.status})`);
};

export interface Partnership {
    id: string;
    partnerOrgName?: string;
    partnerEmail: string;
    poolName: string;
    productCount: number;
    isPaused?: boolean;
    direction: 'sent' | 'received';
    shareType?: 'consignment' | 'wholesale' | 'sync';
    canTerminate?: boolean;
}

interface PendingInvite {
    id: string;
    email: string;
    poolName: string;
    expiresAt: string;
    inviteLink: string;
}

interface ReceivedInvite {
    id: string;
    sourceOrgName: string;
    sourcePoolName: string;
    shareType: 'consignment' | 'wholesale' | 'sync';
    productCount: number;
    variantCount: number;
    expiresAt: string;
    token: string;
}

export default function PartnersScreen() {
    const theme = useTheme();
    const navigation = useNavigation<any>();
    const { currentOrg } = useOrg();
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [partnerships, setPartnerships] = useState<Partnership[]>([]);
    const [activeTab, setActiveTab] = useState<'active' | 'requests'>('active');

    // Requests/Invites State
    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [receivedInvites, setReceivedInvites] = useState<ReceivedInvite[]>([]);

    // Invite Modal State
    const [inviteModalVisible, setInviteModalVisible] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [invitePoolId, setInvitePoolId] = useState('');
    const [inviteCanRevoke, setInviteCanRevoke] = useState(true); // true = consignment (can revoke), false = partnership
    const [pools, setPools] = useState<any[]>([]);
    const [sendingInvite, setSendingInvite] = useState(false);

    // Accept State
    const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);
    const [acceptModalVisible, setAcceptModalVisible] = useState(false);
    const [selectedInvite, setSelectedInvite] = useState<ReceivedInvite | null>(null);
    const [acceptAvailableLocations, setAcceptAvailableLocations] = useState<Record<string, { connectionName: string; platformType: string; locations: { platformLocationId: string; locationName: string }[] }>>({});
    const [acceptLocationsLoading, setAcceptLocationsLoading] = useState(false);
    const [acceptSelectedLocationIds, setAcceptSelectedLocationIds] = useState<string[]>([]);

    // BaseModal State - for replacing Alert.alert
    const [alertModal, setAlertModal] = useState<{
        visible: boolean;
        title: string;
        message: string;
        type: 'info' | 'error' | 'success';
        onDismiss?: () => void;
    }>({ visible: false, title: '', message: '', type: 'info' });

    const [confirmModal, setConfirmModal] = useState<{
        visible: boolean;
        title: string;
        message: string;
        confirmText: string;
        confirmStyle: 'default' | 'destructive';
        onConfirm: () => void;
    }>({ visible: false, title: '', message: '', confirmText: 'Confirm', confirmStyle: 'default', onConfirm: () => { } });

    const [inviteSentModal, setInviteSentModal] = useState<{
        visible: boolean;
        inviteLink: string;
    }>({ visible: false, inviteLink: '' });

    const [onboardingModal, setOnboardingModal] = useState<{
        visible: boolean;
        message: string;
    }>({ visible: false, message: '' });

    // Helper to show simple alert modal
    const showAlertModal = (title: string, message: string, type: 'info' | 'error' | 'success' = 'info', onDismiss?: () => void) => {
        setAlertModal({ visible: true, title, message, type, onDismiss });
    };

    // Load Data
    const loadData = useCallback(async () => {
        if (!currentOrg) return;
        // Keep loading true only on initial load or manual refresh
        // Don't set loading on background updates to avoid UI flickering
    }, [currentOrg]);
    // ^ Refactored loadData usage below to be more flexible, but for now keeping existing loadData struct
    // Re-implementing loadData to be safer if needed, but primarily modifying actions.

    useEffect(() => {
        const fetchInitial = async () => {
            if (!currentOrg) return;
            try {
                setLoading(true);
                const token = await ensureSupabaseJwt();
                const orgId = currentOrg.id;

                const [partnersRes, invitesRes, poolsRes] = await Promise.all([
                    fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships?orgId=${orgId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/pending?orgId=${orgId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch(`${SSSYNC_API_BASE_URL}/api/pools/org/${orgId}`, { headers: { 'Authorization': `Bearer ${token}` } })
                ]);

                await Promise.all([
                    requireOk(partnersRes, 'Could not load partnerships'),
                    requireOk(invitesRes, 'Could not load invites'),
                    requireOk(poolsRes, 'Could not load pools'),
                ]);

                const pData = await partnersRes.json();
                setPartnerships(pData.partnerships || []);

                const iData = await invitesRes.json();
                setPendingInvites(iData.sent || []);
                setReceivedInvites((iData.received || []).map((inv: any) => ({
                        id: inv.id,
                        sourceOrgName: inv.sourceOrgName || 'Unknown Organization',
                        sourcePoolName: inv.sourcePoolName || 'Unknown Pool',
                        shareType: inv.shareType || 'consignment',
                        productCount: inv.productCount || inv.variantCount || 0,
                        variantCount: inv.variantCount || 0,
                        expiresAt: inv.expiresAt,
                        token: inv.token || inv.id,
                })));

                const poolsData = await poolsRes.json();
                setPools(poolsData);
                if (poolsData.length > 0 && !invitePoolId) {
                    setInvitePoolId(poolsData[0].id);
                }
            } catch (error: any) {
                log.error('[PartnersScreen] Error loading data:', error);
                showMessage({ message: 'Error', description: 'Failed to load partners data', type: 'danger' });
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        };

        fetchInitial();
    }, [currentOrg]);

    // Simplified refresh that re-uses the logic but we need to keep access to it
    const refreshData = async () => {
        if (!currentOrg) return;
        try {
            const token = await ensureSupabaseJwt();
            const orgId = currentOrg.id;
            // Background refresh without full screen loading
            const [partnersRes, invitesRes] = await Promise.all([
                fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships?orgId=${orgId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/pending?orgId=${orgId}`, { headers: { 'Authorization': `Bearer ${token}` } }),
            ]);

            await Promise.all([
                requireOk(partnersRes, 'Could not refresh partnerships'),
                requireOk(invitesRes, 'Could not refresh invites'),
            ]);

            const pData = await partnersRes.json();
            setPartnerships(pData.partnerships || []);
            const iData = await invitesRes.json();
            setPendingInvites(iData.sent || []);
            setReceivedInvites((iData.received || []).map((inv: any) => ({
                    id: inv.id,
                    sourceOrgName: inv.sourceOrgName || 'Unknown Organization',
                    sourcePoolName: inv.sourcePoolName || 'Unknown Pool',
                    shareType: inv.shareType || 'consignment',
                    productCount: inv.productCount || inv.variantCount || 0,
                    variantCount: inv.variantCount || 0,
                    expiresAt: inv.expiresAt,
                    token: inv.token || inv.id,
            })));
        } catch (e: any) {
            log.error('Background refresh failed', e);
            showAlertModal('Couldn’t refresh partners', e?.message || 'Please try again.', 'error');
        }
    };


    const onRefresh = () => {
        setRefreshing(true);
        refreshData().finally(() => setRefreshing(false));
    };

    // --- Actions ---

    const handleSendInvite = async () => {
        if (!inviteEmail || !invitePoolId) {
            showAlertModal('Missing Fields', 'Please select a pool and enter an email address.', 'error');
            return;
        }
        if (!currentOrg) return;

        try {
            setSendingInvite(true);
            const token = await ensureSupabaseJwt();

            const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites?orgId=${currentOrg.id}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    inviteeEmail: inviteEmail,
                    poolId: invitePoolId,
                    shareType: inviteCanRevoke ? 'consignment' : 'sync',
                    syncDirection: 'bidirectional',
                    canRevoke: inviteCanRevoke,
                })
            });

            if (res.ok) {
                const data = await res.json();
                setInviteModalVisible(false);
                setInviteEmail('');
                setInvitePoolId('');
                setInviteCanRevoke(true);
                setInviteSentModal({ visible: true, inviteLink: data.inviteLink });
                refreshData();
            } else {
                const err = await res.text();
                showAlertModal('Failed', `Could not send invite: ${err}`, 'error');
            }
        } catch (e: any) {
            showAlertModal('Error', e.message, 'error');
        } finally {
            setSendingInvite(false);
        }
    };

    const handleRevokeInvite = (inviteId: string) => {
        if (!currentOrg) return;
        setConfirmModal({
            visible: true,
            title: 'Revoke Invite',
            message: 'Are you sure you want to revoke this invite?',
            confirmText: 'Revoke',
            confirmStyle: 'destructive',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, visible: false }));
                try {
                    const token = await ensureSupabaseJwt();
                    const response = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${inviteId}?orgId=${currentOrg.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    await requireOk(response, 'Could not revoke invite');
                    await refreshData();
                    showMessage({ message: 'Invite revoked', type: 'info' });
                } catch (e: any) { showAlertModal('Couldn’t revoke invite', e?.message || 'Please try again.', 'error'); }
            }
        });
    };

    const handlePauseResume = async (p: Partnership) => {
        if (!currentOrg) return;
        const action = p.isPaused ? 'resume' : 'pause';
        setPartnerships(prev => prev.map(item => item.id === p.id ? { ...item, isPaused: !p.isPaused } : item));

        try {
            const token = await ensureSupabaseJwt();
            const response = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${p.id}/${action}?orgId=${currentOrg.id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
            await requireOk(response, `Could not ${action} partnership`);
        } catch (e: any) {
            await refreshData();
            showAlertModal(`Couldn’t ${action} partnership`, e?.message || 'Please try again.', 'error');
        }
    };

    const handleTerminate = (p: Partnership) => {
        setConfirmModal({
            visible: true,
            title: 'End Partnership',
            message: 'This will remove all shared products. Are you sure you want to continue?',
            confirmText: 'End',
            confirmStyle: 'destructive',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, visible: false }));
                try {
                    const token = await ensureSupabaseJwt();
                    const response = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${p.id}?cleanup=true`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    await requireOk(response, 'Could not end partnership');
                    await refreshData();
                    showMessage({ message: 'Partnership ended', type: 'info' });
                } catch (e: any) { showAlertModal('Couldn’t end partnership', e?.message || 'Please try again.', 'error'); }
            }
        });
    };

    // New Flow: 1. Click Accept -> Open Modal
    const handleAcceptPress = (invite: ReceivedInvite) => {
        setSelectedInvite(invite);
        setAcceptModalVisible(true);
    };

    // New Flow: 2. Confirm in Modal -> Close Modal, Show Banner, Background Job
    const confirmAcceptInvite = async () => {
        if (!selectedInvite || !currentOrg) return;

        const invite = selectedInvite;
        setAcceptModalVisible(false); // Close immediately for non-blocking UI

        // Show immediate feedback
        showMessage({
            message: 'Accepting Invitation...',
            description: 'Setting up partnership and syncing products.',
            type: 'info',
            backgroundColor: theme.colors.primary, // Green
            duration: 3000,
        });

        try {
            const token = await ensureSupabaseJwt();
            const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${invite.token}/accept?orgId=${encodeURIComponent(currentOrg.id)}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (res.ok) {
                const result = await res.json();
                setReceivedInvites(prev => prev.filter(i => i.id !== invite.id));
                capture(AnalyticsEvents.PARTNER_INVITE_ACCEPTED, { source: 'partners_screen' });

                // Check for onboarding next steps (e.g. no platform connected yet)
                if (result.onboarding?.nextStep === 'connect_platform') {
                    setOnboardingModal({
                        visible: true,
                        message: 'To start syncing products, you need to connect a selling platform (Shopify, Square, etc).'
                    });
                } else {
                    showMessage({
                        message: 'Partnership Established!',
                        description: `Connected with ${invite.sourceOrgName}. ${result.linkedCount || 0} products syncing.`,
                        type: 'success',
                        backgroundColor: theme.colors.primary,
                        duration: 4000,
                    });
                    refreshData();
                }
            } else {
                const errorData = await res.json().catch(() => ({ message: 'Failed to accept invite' }));
                // Revert optimistic update if needed or just show error
                refreshData(); // Sync back to truth

                if (errorData.code === 'EMAIL_MISMATCH') {
                    showAlertModal('Wrong Account', `This invite was sent to ${errorData.inviteeEmail}. You are logged in as ${errorData.currentEmail}.`, 'error');
                } else {
                    showAlertModal('Error', errorData.message || 'Failed to accept invite', 'error');
                }
            }
        } catch (e: any) {
            showAlertModal('Error', e.message || 'Failed to accept invite', 'error');
            refreshData();
        } finally {
            setSelectedInvite(null);
        }
    };

    const handleDeclineInvite = (invite: ReceivedInvite) => {
        setConfirmModal({
            visible: true,
            title: 'Decline Invite',
            message: `Decline invitation from ${invite.sourceOrgName}?`,
            confirmText: 'Decline',
            confirmStyle: 'destructive',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, visible: false }));
                try {
                    const token = await ensureSupabaseJwt();
                    const response = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${invite.token}/decline`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    await requireOk(response, 'Could not decline invite');
                    setReceivedInvites(prev => prev.filter(i => i.id !== invite.id));
                    showMessage({ message: 'Invite declined', type: 'info' });
                } catch (e: any) { showAlertModal('Couldn’t decline invite', e?.message || 'Please try again.', 'error'); }
            }
        });
    };

    const handlePressPartnership = (p: Partnership) => {
        navigation.navigate('PartnershipDetail', { partnership: p });
    };

    // --- Renderers ---

    const renderPartnership = (p: Partnership) => (
        <TouchableOpacity key={p.id} style={styles.card} activeOpacity={0.7} onPress={() => handlePressPartnership(p)}>
            <View style={styles.cardHeader}>
                <View style={styles.iconCircleGreen}>
                    <Store size={20} color="#43631A" />
                </View>
                <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{p.partnerOrgName || p.partnerEmail}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                        {p.direction === 'sent' ? 'Sent to Partner' : 'Received From Partner'}
                    </Text>
                </View>
                {p.isPaused ? (
                    <View style={styles.pausedBadge}>
                        <Text style={styles.pausedText}>Paused</Text>
                    </View>
                ) : (
                    <ChevronRight size={20} color="#D4D4D8" />
                )}
            </View>

            <View style={styles.chipContainer}>
                <View style={styles.chip}>
                    <Package size={13} color="#71717A" />
                    <Text style={styles.chipText}>{p.productCount} Products</Text>
                </View>
                <View style={styles.chip}>
                    <Tag size={13} color="#71717A" />
                    <Text style={[styles.chipText, { textTransform: 'capitalize' }]}>{p.shareType || 'Consignment'}</Text>
                </View>
                <View style={styles.chip}>
                    <Folder size={13} color="#71717A" />
                    <Text style={styles.chipText}>{p.poolName}</Text>
                </View>
            </View>

            <View style={styles.actionsRow}>
                <TouchableOpacity
                    style={styles.secondaryBtn}
                    activeOpacity={0.8}
                    onPress={() => handlePauseResume(p)}
                >
                    {p.isPaused ? <Play size={16} color="#18181B" /> : <Pause size={16} color="#18181B" />}
                    <Text style={styles.secondaryBtnText}>{p.isPaused ? "Resume" : "Pause"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.dangerBtn}
                    activeOpacity={0.8}
                    onPress={() => handleTerminate(p)}
                >
                    <Unlink size={16} color="#DC2626" />
                    <Text style={styles.dangerBtnText}>End</Text>
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );

    const renderReceivedInvite = (inv: ReceivedInvite) => (
        <View key={inv.id} style={[styles.card, styles.cardHighlight]}>
            <View style={styles.cardHeader}>
                <View style={styles.iconCirclePartner}>
                    <Handshake size={20} color="#A2611A" />
                </View>
                <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{inv.sourceOrgName}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>Received Request</Text>
                </View>
                <View style={styles.dateBadge}>
                    <Text style={styles.dateText}>{new Date(inv.expiresAt).toLocaleDateString()}</Text>
                </View>
            </View>

            <View style={styles.chipContainer}>
                <View style={styles.chip}>
                    <Tag size={13} color="#71717A" />
                    <Text style={[styles.chipText, { textTransform: 'capitalize' }]}>{inv.shareType}</Text>
                </View>
                <View style={styles.chip}>
                    <Package size={13} color="#71717A" />
                    <Text style={styles.chipText}>{inv.productCount} Products</Text>
                </View>
                <View style={styles.chip}>
                    <Folder size={13} color="#71717A" />
                    <Text style={styles.chipText}>{inv.sourcePoolName}</Text>
                </View>
            </View>

            <View style={styles.inviteActions}>
                <TouchableOpacity
                    style={styles.declineBtn}
                    activeOpacity={0.8}
                    onPress={() => handleDeclineInvite(inv)}
                >
                    <X size={16} color="#18181B" />
                    <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={styles.acceptBtn}
                    activeOpacity={0.8}
                    onPress={() => handleAcceptPress(inv)}
                >
                    <Check size={16} color="#FFFFFF" />
                    <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderSentInvite = (inv: PendingInvite) => (
        <View key={inv.id} style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={styles.iconCirclePartner}>
                    <Send size={20} color="#A2611A" />
                </View>
                <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{inv.email}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>Invited to {inv.poolName}</Text>
                </View>
                <TouchableOpacity onPress={() => handleRevokeInvite(inv.id)} style={styles.revokeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={16} color="#9CA3AF" />
                </TouchableOpacity>
            </View>
            <View style={styles.sentInviteFooter}>
                <Text style={styles.expiresText}>Expires: {new Date(inv.expiresAt).toLocaleDateString()}</Text>
                <TouchableOpacity onPress={() => { Clipboard.setStringAsync(inv.inviteLink); showMessage({ message: 'Link copied!', type: 'success', backgroundColor: theme.colors.primary }); }}>
                    <Text style={styles.copyLinkText}>Copy Link</Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    return (
        <View style={styles.root}>
            <StatusBar barStyle="dark-content" />

            {/* Content */}
            <ScrollView
                contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND_PRIMARY} />}
            >
                <PageHeader
                    title="Partners"
                    onBack={() => navigation.goBack()}
                    right={
                        <TouchableOpacity style={styles.invitePill} activeOpacity={0.8} onPress={() => setInviteModalVisible(true)}>
                            <UserPlus size={14} color="#FFFFFF" />
                            <Text style={styles.invitePillText}>Invite</Text>
                        </TouchableOpacity>
                    }
                />

                {/* Tabs */}
                <View style={styles.tabsTrack}>
                    <TouchableOpacity
                        style={[styles.tabBtn, activeTab === 'active' && styles.tabBtnActive]}
                        activeOpacity={0.8}
                        onPress={() => setActiveTab('active')}
                    >
                        <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>Active ({partnerships.length})</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.tabBtn, activeTab === 'requests' && styles.tabBtnActive]}
                        activeOpacity={0.8}
                        onPress={() => setActiveTab('requests')}
                    >
                        <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
                            Requests ({receivedInvites.length + pendingInvites.length})
                        </Text>
                        {receivedInvites.length > 0 && (
                            <View style={styles.requestsBadge}>
                                <Text style={styles.requestsBadgeText}>{receivedInvites.length}</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                </View>

                {activeTab === 'active' ? (
                    <>
                        {partnerships.length === 0 && !loading ? (
                            <View style={styles.emptyState}>
                                <View style={styles.emptyIconGreen}>
                                    <Store size={32} color="#43631A" />
                                </View>
                                <Text style={styles.emptyText}>No active partnerships</Text>
                                <Text style={styles.emptySubtext}>Invite a partner to start sharing inventory</Text>
                                <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85} onPress={() => setInviteModalVisible(true)}>
                                    <UserPlus size={18} color="#FFFFFF" />
                                    <Text style={styles.primaryBtnText}>Invite Partner</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            partnerships.map(renderPartnership)
                        )}
                    </>
                ) : (
                    <>
                        {receivedInvites.length > 0 && (
                            <View style={styles.sectionBlock}>
                                <Text style={styles.section}>Incoming Requests</Text>
                                {receivedInvites.map(renderReceivedInvite)}
                            </View>
                        )}

                        {pendingInvites.length > 0 && (
                            <View style={styles.sectionBlock}>
                                <Text style={styles.section}>Sent Invites</Text>
                                {pendingInvites.map(renderSentInvite)}
                            </View>
                        )}

                        {pendingInvites.length === 0 && receivedInvites.length === 0 && !loading && (
                            <View style={styles.emptyState}>
                                <View style={styles.emptyIconMuted}>
                                    <Inbox size={32} color="#9CA3AF" />
                                </View>
                                <Text style={styles.emptyText}>No pending requests</Text>
                            </View>
                        )}
                    </>
                )}

                {loading && <ActivityIndicator size="large" color={BRAND_PRIMARY} style={{ marginTop: 40 }} />}
            </ScrollView>


            {/* Invite Modal */}
            <Modal
                visible={inviteModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setInviteModalVisible(false)}
            >
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
                    <View style={styles.modalCard}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Invite Partner</Text>
                            <TouchableOpacity
                                style={styles.modalCloseBtn}
                                onPress={() => setInviteModalVisible(false)}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                                <X size={16} color="#71717A" />
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.modalLabel}>Partner Email</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="partner@example.com"
                            value={inviteEmail}
                            onChangeText={setInviteEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                            placeholderTextColor="#C7C7CC"
                        />

                        <Text style={styles.modalLabel}>Shared Pool</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.poolSelector}>
                            {pools.map(pool => (
                                <TouchableOpacity
                                    key={pool.id}
                                    style={[styles.poolChip, invitePoolId === pool.id && styles.activePoolChip]}
                                    onPress={() => setInvitePoolId(pool.id)}
                                >
                                    <Text style={[styles.poolChipText, invitePoolId === pool.id && styles.activePoolChipText]}>{pool.name}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>

                        <Text style={styles.modalLabel}>Share type</Text>
                        <View style={styles.consignmentRow}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.consignmentLabel}>{inviteCanRevoke ? 'Consignment' : 'Partnership'}</Text>
                                <Text style={styles.consignmentHint}>
                                    {inviteCanRevoke ? 'You can revoke products.' : 'Shared quantities; you can\'t revoke.'}
                                </Text>
                            </View>
                            <Switch
                                value={inviteCanRevoke}
                                onValueChange={setInviteCanRevoke}
                                trackColor={{ false: '#D4D4D8', true: 'rgba(147,200,34,0.5)' }}
                                thumbColor={inviteCanRevoke ? '#93C822' : '#F4F4F5'}
                            />
                        </View>

                        <TouchableOpacity
                            style={[styles.confirmBtn, sendingInvite && { opacity: 0.6 }]}
                            onPress={handleSendInvite}
                            disabled={sendingInvite}
                            activeOpacity={0.8}
                        >
                            {sendingInvite
                                ? <ActivityIndicator color="#FFFFFF" size="small" />
                                : <Text style={styles.confirmText}>Send Invite</Text>}
                        </TouchableOpacity>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <PartnerAcceptModal
                visible={acceptModalVisible}
                invite={selectedInvite}
                onClose={() => setAcceptModalVisible(false)}
                onConfirm={confirmAcceptInvite}
                availableLocations={acceptAvailableLocations}
                locationsLoading={acceptLocationsLoading}
                selectedLocationIds={acceptSelectedLocationIds}
                onSelectionChange={setAcceptSelectedLocationIds}
            />

            {/* Alert Modal (simple info/error messages) */}
            <BaseModal
                visible={alertModal.visible}
                containerStyle={styles.baseModalCard}
                onClose={() => {
                    setAlertModal(prev => ({ ...prev, visible: false }));
                    alertModal.onDismiss?.();
                }}
            >
                {alertModal.type === 'error'
                    ? <AlertCircle size={44} color="#DC2626" style={styles.modalIcon} />
                    : alertModal.type === 'success'
                        ? <CheckCircle2 size={44} color="#93C822" style={styles.modalIcon} />
                        : <Info size={44} color="#93C822" style={styles.modalIcon} />}
                <Text style={styles.modalAlertTitle}>{alertModal.title}</Text>
                <Text style={styles.modalAlertMessage}>{alertModal.message}</Text>
                <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonSolo, alertModal.type === 'error' ? styles.modalButtonDanger : styles.modalButtonPrimary]}
                    activeOpacity={0.8}
                    onPress={() => {
                        setAlertModal(prev => ({ ...prev, visible: false }));
                        alertModal.onDismiss?.();
                    }}
                >
                    <Text style={styles.modalButtonText}>OK</Text>
                </TouchableOpacity>
            </BaseModal>

            {/* Confirm Modal (destructive actions) */}
            <BaseModal
                visible={confirmModal.visible}
                containerStyle={styles.baseModalCard}
                onClose={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
            >
                <AlertTriangle
                    size={44}
                    color={confirmModal.confirmStyle === 'destructive' ? '#DC2626' : '#93C822'}
                    style={styles.modalIcon}
                />
                <Text style={styles.modalAlertTitle}>{confirmModal.title}</Text>
                <Text style={styles.modalAlertMessage}>{confirmModal.message}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        activeOpacity={0.8}
                        onPress={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
                    >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, confirmModal.confirmStyle === 'destructive' ? styles.modalButtonDanger : styles.modalButtonPrimary]}
                        activeOpacity={0.8}
                        onPress={confirmModal.onConfirm}
                    >
                        <Text style={styles.modalButtonText}>{confirmModal.confirmText}</Text>
                    </TouchableOpacity>
                </View>
            </BaseModal>

            {/* Invite Sent Modal */}
            <BaseModal
                visible={inviteSentModal.visible}
                containerStyle={styles.baseModalCard}
                onClose={() => setInviteSentModal({ visible: false, inviteLink: '' })}
            >
                <CheckCircle2 size={44} color="#93C822" style={styles.modalIcon} />
                <Text style={styles.modalAlertTitle}>Invite Sent!</Text>
                <Text style={styles.modalAlertMessage}>Invite link created. Share this with your partner:</Text>
                <Text style={styles.inviteLinkText} selectable numberOfLines={3}>{inviteSentModal.inviteLink}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        activeOpacity={0.8}
                        onPress={() => setInviteSentModal({ visible: false, inviteLink: '' })}
                    >
                        <Text style={styles.modalCancelText}>OK</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalButtonPrimary]}
                        activeOpacity={0.8}
                        onPress={() => {
                            Clipboard.setStringAsync(inviteSentModal.inviteLink);
                            showMessage({ message: 'Link Copied!', type: 'success', backgroundColor: theme.colors.primary });
                            setInviteSentModal({ visible: false, inviteLink: '' });
                        }}
                    >
                        <Text style={styles.modalButtonText}>Copy Link</Text>
                    </TouchableOpacity>
                </View>
            </BaseModal>

            {/* Onboarding Modal (Connect Platform) */}
            <BaseModal
                visible={onboardingModal.visible}
                containerStyle={styles.baseModalCard}
                onClose={() => {
                    setOnboardingModal({ visible: false, message: '' });
                    refreshData();
                }}
            >
                <CheckCircle2 size={44} color="#93C822" style={styles.modalIcon} />
                <Text style={styles.modalAlertTitle}>Partnership Connected!</Text>
                <Text style={styles.modalAlertMessage}>{onboardingModal.message}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        activeOpacity={0.8}
                        onPress={() => {
                            setOnboardingModal({ visible: false, message: '' });
                            refreshData();
                        }}
                    >
                        <Text style={styles.modalCancelText}>Later</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalButtonPrimary]}
                        activeOpacity={0.8}
                        onPress={() => {
                            setOnboardingModal({ visible: false, message: '' });
                            refreshData();
                            navigation.navigate('AccountSettings');
                        }}
                    >
                        <Text style={styles.modalButtonText}>Connect Now</Text>
                    </TouchableOpacity>
                </View>
            </BaseModal>

        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F6F7F4' },

    // Header action pill
    invitePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    invitePillText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

    // Tabs (segmented control)
    tabsTrack: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 999, borderWidth: 1, borderColor: '#ECEBE6', padding: 4, marginBottom: 22 },
    tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 999 },
    tabBtnActive: { backgroundColor: '#18181B' },
    tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#71717A' },
    tabTextActive: { color: '#FFFFFF' },
    requestsBadge: { backgroundColor: '#DC2626', borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
    requestsBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Inter_700Bold' },

    // Sections
    section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
    sectionBlock: { marginBottom: 24 },

    // Cards
    card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: '#ECEBE6', marginBottom: 12 },
    cardHighlight: { borderColor: 'rgba(147,200,34,0.55)' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    iconCircleGreen: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(147,200,34,0.14)' },
    iconCirclePartner: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(162,97,26,0.12)' },
    rowInfo: { flex: 1 },
    rowTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
    rowSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
    pausedBadge: { backgroundColor: 'rgba(162,97,26,0.10)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
    pausedText: { color: '#A2611A', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
    dateBadge: { backgroundColor: '#F1F1EE', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
    dateText: { fontSize: 11, color: '#71717A', fontFamily: 'Inter_500Medium' },

    // Meta chips
    chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F1F1EE' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FAFAF8', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: '#ECEBE6' },
    chipText: { fontSize: 12, color: '#71717A', fontFamily: 'Inter_500Medium' },

    // Card actions
    actionsRow: { flexDirection: 'row', marginTop: 14, gap: 10 },
    secondaryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 14, backgroundColor: '#F1F1EE' },
    secondaryBtnText: { color: '#18181B', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    dangerBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 14, backgroundColor: 'rgba(220,38,38,0.08)' },
    dangerBtnText: { color: '#DC2626', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

    inviteActions: { flexDirection: 'row', marginTop: 14, gap: 10 },
    declineBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: '#F1F1EE' },
    declineBtnText: { color: '#18181B', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
    acceptBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 14, backgroundColor: '#93C822' },
    acceptBtnText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 14 },

    revokeBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center' },
    sentInviteFooter: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F1EE', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    expiresText: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_400Regular' },
    copyLinkText: { color: '#43631A', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

    // Empty states
    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 56 },
    emptyIconGreen: { width: 72, height: 72, borderRadius: 24, backgroundColor: 'rgba(147,200,34,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    emptyIconMuted: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    emptyText: { color: '#18181B', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
    emptySubtext: { color: '#71717A', fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 6, textAlign: 'center' },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#93C822', borderRadius: 16, paddingVertical: 15, paddingHorizontal: 28, marginTop: 22 },
    primaryBtnText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15 },

    // Invite modal
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20 },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    modalTitle: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold' },
    modalCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center' },
    modalLabel: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 8 },
    input: {
        borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
        fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8',
    },
    poolSelector: { flexDirection: 'row', flexGrow: 0 },
    poolChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#FAFAF8', marginRight: 8, borderWidth: 1, borderColor: '#ECEBE6' },
    activePoolChip: { backgroundColor: 'rgba(147,200,34,0.14)', borderColor: '#93C822' },
    poolChipText: { color: '#71717A', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
    activePoolChipText: { color: '#43631A' },
    consignmentRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#FAFAF8', borderRadius: 14, borderWidth: 1, borderColor: '#ECEBE6',
    },
    consignmentLabel: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
    consignmentHint: { fontSize: 12, color: '#71717A', fontFamily: 'Inter_400Regular', marginTop: 2 },
    confirmBtn: { borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#93C822', marginTop: 22 },
    confirmText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },

    // BaseModal (alerts/confirms) children
    baseModalCard: { borderRadius: 22, padding: 20, width: '100%' },
    modalIcon: { marginBottom: 14 },
    modalAlertTitle: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 8, textAlign: 'center' },
    modalAlertMessage: { fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', textAlign: 'center', marginBottom: 20, lineHeight: 21 },
    modalButton: { flex: 1, paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    modalButtonSolo: { flex: 0, alignSelf: 'stretch' },
    modalButtonPrimary: { backgroundColor: '#93C822' },
    modalButtonDanger: { backgroundColor: '#DC2626' },
    modalButtonText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
    modalButtonRow: { flexDirection: 'row', gap: 10, width: '100%' },
    modalCancelButton: { backgroundColor: '#F1F1EE' },
    modalCancelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#18181B' },
    inviteLinkText: {
        fontSize: 13, color: '#43631A', fontFamily: 'Inter_500Medium', textAlign: 'center', lineHeight: 19,
        borderWidth: 1, borderColor: '#ECEBE6', backgroundColor: '#FAFAF8', borderRadius: 14,
        paddingHorizontal: 14, paddingVertical: 12, marginBottom: 18, width: '100%',
    },
});
