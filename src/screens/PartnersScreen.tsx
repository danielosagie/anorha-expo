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
    Switch
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import Card from '../components/Card';
import { ensureSupabaseJwt } from '../lib/supabase';
import { showMessage } from 'react-native-flash-message';
import { capture, AnalyticsEvents } from '../lib/analytics';
import * as Clipboard from 'expo-clipboard';
import { useOrg } from '../context/OrgContext';
import { PartnerAcceptModal } from '../components/PartnerAcceptModal';
import BaseModal from '../components/BaseModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SSSYNC_API_BASE_URL = "https://api.sssync.app";

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
    const bottomSafePadding = 48 + insets.bottom;

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

                if (partnersRes.ok) {
                    const pData = await partnersRes.json();
                    setPartnerships(pData.partnerships || []);
                }

                if (invitesRes.ok) {
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
                }

                if (poolsRes.ok) {
                    const poolsData = await poolsRes.json();
                    setPools(poolsData);
                    if (poolsData.length > 0 && !invitePoolId) {
                        setInvitePoolId(poolsData[0].id);
                    }
                }
            } catch (error: any) {
                console.error('[PartnersScreen] Error loading data:', error);
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

            if (partnersRes.ok) {
                const pData = await partnersRes.json();
                setPartnerships(pData.partnerships || []);
            }
            if (invitesRes.ok) {
                const iData = await invitesRes.json();
                setPendingInvites(iData.sent || []);
                setReceivedInvites((iData.received || []).map((inv: any) => ({ // Map again
                    id: inv.id,
                    sourceOrgName: inv.sourceOrgName || 'Unknown Organization',
                    sourcePoolName: inv.sourcePoolName || 'Unknown Pool',
                    shareType: inv.shareType || 'consignment',
                    productCount: inv.productCount || inv.variantCount || 0,
                    variantCount: inv.variantCount || 0,
                    expiresAt: inv.expiresAt,
                    token: inv.token || inv.id,
                })));
            }
        } catch (e) { console.error("Background refresh failed", e); }
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
                    await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${inviteId}?orgId=${currentOrg.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    refreshData();
                    showMessage({ message: 'Invite revoked', type: 'info' });
                } catch (e) { console.error(e); }
            }
        });
    };

    const handlePauseResume = async (p: Partnership) => {
        if (!currentOrg) return;
        const action = p.isPaused ? 'resume' : 'pause';
        setPartnerships(prev => prev.map(item => item.id === p.id ? { ...item, isPaused: !p.isPaused } : item));

        try {
            const token = await ensureSupabaseJwt();
            await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${p.id}/${action}?orgId=${currentOrg.id}`, {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) {
            console.log(e);
            refreshData();
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
                    await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${p.id}?cleanup=true`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    refreshData();
                    showMessage({ message: 'Partnership ended', type: 'info' });
                } catch (e) { console.error(e); }
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

        // Optimistic Remove from list
        setReceivedInvites(prev => prev.filter(i => i.id !== invite.id));

        try {
            const token = await ensureSupabaseJwt();
            const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${invite.token}/accept`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });

            if (res.ok) {
                const result = await res.json();
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
                    await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/invites/${invite.token}/decline`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setReceivedInvites(prev => prev.filter(i => i.id !== invite.id));
                    showMessage({ message: 'Invite declined', type: 'info' });
                } catch (e) { console.error(e); }
            }
        });
    };

    const handlePressPartnership = (p: Partnership) => {
        navigation.navigate('PartnershipDetail', { partnership: p });
    };

    // --- Renderers ---

    const renderPartnership = (p: Partnership) => (
        <Card key={p.id} style={styles.card} onPress={() => handlePressPartnership(p)}>
            <View style={styles.cardHeader}>
                {/* Changed background to match requests style */}
                <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '20' }]}>
                    <Icon name="storefront-outline" size={24} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.partnerName}>{p.partnerOrgName || p.partnerEmail}</Text>
                    {/* Simplified subtitle */}
                    <Text style={styles.poolName}>
                        {p.direction === 'sent' ? 'Sent to Partner' : 'Received From Partner'}
                    </Text>
                </View>
                {p.isPaused ? (
                    <View style={styles.pausedBadge}>
                        <Text style={styles.pausedText}>Paused</Text>
                    </View>
                ) : (
                    <Icon name="chevron-right" size={24} color="#D1D5DB" />
                )}
            </View>

            {/* Changed from old statsRow to chipContainer for consistency */}
            <View style={styles.chipContainer}>
                <View style={styles.chip}>
                    <Icon name="cube-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.chipText}>{p.productCount} Products</Text>
                </View>
                <View style={styles.chip}>
                    <Icon name="tag-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={[styles.chipText, { textTransform: 'capitalize' }]}>{p.shareType || 'Consignment'}</Text>
                </View>
                <View style={styles.chip}>
                    <Icon name="folder-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.chipText}>{p.poolName}</Text>
                </View>
            </View>

            <View style={styles.actionsRow}>
                <TouchableOpacity
                    style={[styles.actionBtn, styles.secondaryBtn]}
                    onPress={() => handlePauseResume(p)}
                >
                    <Icon name={p.isPaused ? "play" : "pause"} size={18} color="#555" />
                    <Text style={styles.btnText}>{p.isPaused ? "Resume" : "Pause"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.actionBtn, styles.dangerBtn]}
                    onPress={() => handleTerminate(p)}
                >
                    <Icon name="link-off" size={18} color="#EF4444" />
                    <Text style={[styles.btnText, { color: '#EF4444' }]}>End</Text>
                </TouchableOpacity>
            </View>
        </Card>
    );

    const renderReceivedInvite = (inv: ReceivedInvite) => (
        <Card key={inv.id} style={[styles.card, { borderColor: theme.colors.primary + '40', borderWidth: 1 }]}>
            <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '20' }]}>
                    <Icon name="handshake-outline" size={24} color={theme.colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.partnerName}>{inv.sourceOrgName}</Text>
                    <Text style={styles.poolName}>Received Request</Text>
                </View>
                <View style={styles.dateBadge}>
                    <Text style={styles.dateText}>{new Date(inv.expiresAt).toLocaleDateString()}</Text>
                </View>
            </View>

            <View style={styles.chipContainer}>
                <View style={styles.chip}>
                    <Icon name="tag-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.chipText}>{inv.shareType}</Text>
                </View>
                <View style={styles.chip}>
                    <Icon name="cube-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.chipText}>{inv.productCount} Products</Text>
                </View>
                <View style={styles.chip}>
                    <Icon name="folder-outline" size={14} color="#6B7280" style={{ marginRight: 4 }} />
                    <Text style={styles.chipText}>{inv.sourcePoolName}</Text>
                </View>
            </View>

            <View style={styles.inviteActions}>
                <TouchableOpacity
                    style={[styles.inviteBtn, styles.declineBtn]}
                    onPress={() => handleDeclineInvite(inv)}
                >
                    <Icon name="close" size={18} color="#6B7280" />
                    <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.inviteBtn, styles.acceptBtn, { backgroundColor: theme.colors.primary }]}
                    onPress={() => handleAcceptPress(inv)}
                >
                    <Icon name="check" size={18} color="#FFF" />
                    <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
            </View>
        </Card>
    );

    const renderSentInvite = (inv: PendingInvite) => (
        <Card key={inv.id} style={styles.card}>
            <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: '#FEF3C7' }]}>
                    <Icon name="email-fast-outline" size={24} color="#D97706" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.partnerName}>{inv.email}</Text>
                    <Text style={styles.poolName}>Invited to {inv.poolName}</Text>
                </View>
                <TouchableOpacity onPress={() => handleRevokeInvite(inv.id)} style={styles.revokeBtn}>
                    <Icon name="close" size={18} color="#9CA3AF" />
                </TouchableOpacity>
            </View>
            <View style={styles.sentInviteFooter}>
                <Text style={styles.expiresText}>Expires: {new Date(inv.expiresAt).toLocaleDateString()}</Text>
                <TouchableOpacity onPress={() => { Clipboard.setStringAsync(inv.inviteLink); showMessage({ message: 'Link copied!', type: 'success', backgroundColor: theme.colors.primary }); }}>
                    <Text style={styles.copyLinkText}>Copy Link</Text>
                </TouchableOpacity>
            </View>
        </Card>
    );

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <Icon name="arrow-left" size={24} color="#111827" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Partners</Text>
                <TouchableOpacity onPress={() => setInviteModalVisible(true)} style={[styles.addBtn, { backgroundColor: theme.colors.primary }]}>
                    <Icon name="plus" size={24} color="#FFF" />
                </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'active' && { borderBottomColor: theme.colors.primary }]}
                    onPress={() => setActiveTab('active')}
                >
                    <Text style={[styles.tabText, activeTab === 'active' && { color: theme.colors.primary, fontWeight: '600' }]}>Active ({partnerships.length})</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[styles.tab, activeTab === 'requests' && { borderBottomColor: theme.colors.primary }]}
                    onPress={() => setActiveTab('requests')}
                >
                    <Text style={[styles.tabText, activeTab === 'requests' && { color: theme.colors.primary, fontWeight: '600' }]}>
                        Requests ({receivedInvites.length + pendingInvites.length})
                    </Text>
                    {receivedInvites.length > 0 && (
                        <View style={styles.requestsBadge}>
                            <Text style={styles.requestsBadgeText}>{receivedInvites.length}</Text>
                        </View>
                    )}
                </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            {/* Content */}
            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomSafePadding }]}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BRAND_PRIMARY} />}
            >
                {activeTab === 'active' ? (
                    <>
                        {partnerships.length === 0 && !loading ? (
                            <View style={styles.emptyState}>
                                <View style={[styles.iconCircle, styles.emptyIcon]}>
                                    <Icon name="store-search-outline" size={40} color="#65A30D" />
                                </View>
                                <Text style={styles.emptyText}>No active partnerships</Text>
                                <Text style={styles.emptySubtext}>Invite a partner to start sharing inventory</Text>
                                <Button title="Invite Partner" onPress={() => setInviteModalVisible(true)} style={styles.emptyBtn} />
                            </View>
                        ) : (
                            partnerships.map(renderPartnership)
                        )}
                    </>
                ) : (
                    <>
                        {receivedInvites.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Incoming Requests</Text>
                                {receivedInvites.map(renderReceivedInvite)}
                            </View>
                        )}

                        {pendingInvites.length > 0 && (
                            <View style={styles.section}>
                                <Text style={styles.sectionTitle}>Sent Invites</Text>
                                {pendingInvites.map(renderSentInvite)}
                            </View>
                        )}

                        {pendingInvites.length === 0 && receivedInvites.length === 0 && !loading && (
                            <View style={styles.emptyState}>
                                <View style={[styles.iconCircle, styles.emptyIcon]}>
                                    <Icon name="email-off-outline" size={40} color="#9CA3AF" />
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
                animationType="slide"
                onRequestClose={() => setInviteModalVisible(false)}
            >
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Invite Partner</Text>
                            <TouchableOpacity onPress={() => setInviteModalVisible(false)}>
                                <Icon name="close" size={24} color="#333" />
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
                            placeholderTextColor="#9CA3AF"
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

                        <Text style={[styles.modalLabel, { marginTop: 16 }]}>Share type</Text>
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
                                trackColor={{ false: '#d1d5db', true: theme.colors.primary + '80' }}
                                thumbColor={inviteCanRevoke ? theme.colors.primary : '#f4f4f4'}
                            />
                        </View>

                        <Button
                            title={sendingInvite ? "Sending..." : "Send Invite"}
                            onPress={handleSendInvite}
                            loading={sendingInvite}
                            style={{ marginTop: 24 }}
                        />
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
                onClose={() => {
                    setAlertModal(prev => ({ ...prev, visible: false }));
                    alertModal.onDismiss?.();
                }}
            >
                <Icon
                    name={alertModal.type === 'error' ? 'alert-circle' : alertModal.type === 'success' ? 'check-circle' : 'information'}
                    size={48}
                    color={alertModal.type === 'error' ? '#EF4444' : theme.colors.primary}
                    style={{ marginBottom: 16 }}
                />
                <Text style={styles.modalAlertTitle}>{alertModal.title}</Text>
                <Text style={styles.modalAlertMessage}>{alertModal.message}</Text>
                <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: alertModal.type === 'error' ? '#EF4444' : theme.colors.primary }]}
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
                onClose={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
            >
                <Icon
                    name="alert-outline"
                    size={48}
                    color={confirmModal.confirmStyle === 'destructive' ? '#EF4444' : theme.colors.primary}
                    style={{ marginBottom: 16 }}
                />
                <Text style={styles.modalAlertTitle}>{confirmModal.title}</Text>
                <Text style={styles.modalAlertMessage}>{confirmModal.message}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        onPress={() => setConfirmModal(prev => ({ ...prev, visible: false }))}
                    >
                        <Text style={styles.modalCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, { backgroundColor: confirmModal.confirmStyle === 'destructive' ? '#EF4444' : theme.colors.primary }]}
                        onPress={confirmModal.onConfirm}
                    >
                        <Text style={styles.modalButtonText}>{confirmModal.confirmText}</Text>
                    </TouchableOpacity>
                </View>
            </BaseModal>

            {/* Invite Sent Modal */}
            <BaseModal
                visible={inviteSentModal.visible}
                onClose={() => setInviteSentModal({ visible: false, inviteLink: '' })}
            >
                <Icon name="check-circle" size={48} color={theme.colors.primary} style={{ marginBottom: 16 }} />
                <Text style={styles.modalAlertTitle}>Invite Sent!</Text>
                <Text style={styles.modalAlertMessage}>Invite link created. Share this with your partner:</Text>
                <Text style={styles.inviteLinkText} selectable numberOfLines={3}>{inviteSentModal.inviteLink}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        onPress={() => setInviteSentModal({ visible: false, inviteLink: '' })}
                    >
                        <Text style={styles.modalCancelText}>OK</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
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
                onClose={() => {
                    setOnboardingModal({ visible: false, message: '' });
                    refreshData();
                }}
            >
                <Icon name="check-circle" size={48} color={theme.colors.primary} style={{ marginBottom: 16 }} />
                <Text style={styles.modalAlertTitle}>Partnership Connected!</Text>
                <Text style={styles.modalAlertMessage}>{onboardingModal.message}</Text>
                <View style={styles.modalButtonRow}>
                    <TouchableOpacity
                        style={[styles.modalButton, styles.modalCancelButton]}
                        onPress={() => {
                            setOnboardingModal({ visible: false, message: '' });
                            refreshData();
                        }}
                    >
                        <Text style={styles.modalCancelText}>Later</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
                        onPress={() => {
                            setOnboardingModal({ visible: false, message: '' });
                            refreshData();
                            navigation.navigate('Profile');
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
    container: {
        flex: 1,
        backgroundColor: '#F8F9FB',
    },
    header: {
        paddingTop: 60,
        paddingHorizontal: 16,
        paddingBottom: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFF',
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    backBtn: {
        padding: 8,
        marginLeft: -8,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
    },
    addBtn: {
        padding: 8,
        backgroundColor: BRAND_PRIMARY,
        borderRadius: 8,
        marginRight: -4,
    },
    tabsContainer: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 16,
        backgroundColor: '#FFF',
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
        gap: 8,
    },
    activeTab: {
        borderBottomColor: BRAND_PRIMARY,
    },
    tabText: {
        color: '#6B7280',
        fontWeight: '500',
        fontSize: 15,
    },
    activeTabText: {
        color: BRAND_PRIMARY,
        fontWeight: '600',
    },
    requestsBadge: {
        backgroundColor: '#EF4444',
        borderRadius: 10,
        paddingHorizontal: 6,
        paddingVertical: 2,
        minWidth: 20,
        alignItems: 'center',
    },
    requestsBadgeText: {
        color: '#FFF',
        fontSize: 11,
        fontWeight: '700',
    },
    divider: {
        height: 1,
        backgroundColor: '#E5E7EB',
    },
    scrollContent: {
        padding: 16,
    },
    card: {
        marginBottom: 16,
        padding: 16,
        backgroundColor: '#FFF',
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#F3F4F6',
    },
    cardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    partnerName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1F2937',
    },
    poolName: {
        fontSize: 13,
        color: '#6B7280',
        marginTop: 2,
    },
    pausedBadge: {
        backgroundColor: '#FEF3C7',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    pausedText: {
        color: '#D97706',
        fontSize: 11,
        fontWeight: '600',
    },
    statsRow: {
        flexDirection: 'row',
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    stat: {
        marginRight: 24,
    },
    statValue: {
        fontSize: 16,
        fontWeight: '700',
        color: '#111827',
    },
    statLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    actionsRow: {
        flexDirection: 'row',
        marginTop: 16,
        gap: 12,
    },
    actionBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    secondaryBtn: {
        backgroundColor: '#F9FAFB',
    },
    dangerBtn: {
        borderColor: '#FEE2E2',
        backgroundColor: '#FEF2F2',
    },
    btnText: {
        marginLeft: 6,
        fontWeight: '500',
        color: '#374151',
        fontSize: 13,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        color: '#374151',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
        marginLeft: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    inviteDetails: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
    },
    inviteDetailRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    inviteDetailLabel: {
        fontSize: 13,
        color: '#6B7280',
    },
    inviteDetailValue: {
        fontSize: 13,
        fontWeight: '600',
        color: '#111827',
    },
    inviteActions: {
        flexDirection: 'row',
        marginTop: 16,
        gap: 12,
    },
    inviteBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 10,
        borderRadius: 8,
    },
    declineBtn: {
        backgroundColor: '#F3F4F6',
    },
    declineBtnText: {
        color: '#6B7280',
        fontWeight: '600',
        fontSize: 14,
    },
    acceptBtn: {
        backgroundColor: '#16A34A',
    },
    acceptBtnText: {
        color: '#FFF',
        fontWeight: '600',
        fontSize: 14,
    },
    revokeBtn: {
        padding: 8,
    },
    sentInviteFooter: {
        marginTop: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    expiresText: {
        fontSize: 12,
        color: '#9CA3AF',
    },
    copyLinkText: {
        color: BRAND_PRIMARY,
        fontWeight: '600',
        fontSize: 13,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    emptyIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#ECFCCB',
        marginBottom: 16,
    },
    emptyText: {
        color: '#111827',
        fontSize: 18,
        fontWeight: '600',
    },
    emptySubtext: {
        color: '#6B7280',
        fontSize: 14,
        marginTop: 8,
        textAlign: 'center',
    },
    emptyBtn: {
        marginTop: 24,
        width: 200,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: 48,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
    },
    modalLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        marginTop: 16,
    },
    input: {
        backgroundColor: '#F3F4F6',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#111827',
    },
    poolSelector: {
        flexDirection: 'row',
    },
    poolChip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        backgroundColor: '#F9FAFB',
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    activePoolChip: {
        backgroundColor: '#ECFCCB',
        borderColor: BRAND_PRIMARY,
    },
    poolChipText: {
        color: '#4B5563',
        fontWeight: '600',
    },
    activePoolChipText: {
        color: '#365E09',
    },
    consignmentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 8,
        paddingVertical: 12,
        paddingHorizontal: 12,
        backgroundColor: '#F9FAFB',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    consignmentLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
    },
    consignmentHint: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    // New Styles (Consolidated)
    dateBadge: {
        backgroundColor: '#F3F4F6',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
    },
    dateText: {
        fontSize: 11,
        color: '#6B7280',
        fontWeight: '500',
    },
    chipContainer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6',
        marginBottom: 4,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F9FAFB',
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    chipText: {
        fontSize: 12,
        color: '#4B5563',
        fontWeight: '500',
    },
    // Modal Alert Styles
    modalAlertTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 8,
        textAlign: 'center',
    },
    modalAlertMessage: {
        fontSize: 15,
        color: '#6B7280',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    modalButton: {
        flex: 1,
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 100,
    },
    modalButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    modalButtonRow: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    modalCancelButton: {
        backgroundColor: '#F3F4F6',
    },
    modalCancelText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#6B7280',
    },
    inviteLinkText: {
        fontSize: 13,
        color: '#3B82F6',
        textAlign: 'center',
        marginBottom: 20,
        paddingHorizontal: 16,
        lineHeight: 20,
    },
});
