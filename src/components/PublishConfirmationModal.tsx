import React, { useEffect } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PLATFORM_META } from '../utils/platformConstants';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { createLogger } from '../utils/logger';
const log = createLogger('PublishConfirmationModal');

// Brand-coloured logo chips (white glyph on the platform's colour) — matches the
// "Publish where?" Paper design.
const BRAND: Record<string, { bg: string; label: string }> = {
    shopify: { bg: '#95BF47', label: 'S' },
    ebay: { bg: '#E53238', label: 'e' },
    facebook: { bg: '#1877F2', label: 'f' },
    square: { bg: '#1C1C1C', label: 'S' },
    clover: { bg: '#4B9E3F', label: 'C' },
    amazon: { bg: '#FF9900', label: 'a' },
    whatnot: { bg: '#FFC400', label: 'W' },
    etsy: { bg: '#F1641E', label: 'E' },
};
const brandFor = (p: string) => BRAND[p] || { bg: '#6B7280', label: (p[0] || '?').toUpperCase() };
const labelFor = (p: string) => (PLATFORM_META as any)[p]?.label || (p.charAt(0).toUpperCase() + p.slice(1));

interface PublishConfirmationModalProps {
    visible: boolean;
    onClose: () => void;
    onConfirm: () => void;
    readyPlatforms: string[];
    allConnections: any[];
    selectedConnectionIds: Record<string, string>;
    setSelectedConnectionIds: (ids: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
    productSummary: {
        title?: string;
        sku?: string;
        price?: number | string;
    };
    isPublishing?: boolean;
    /** When provided, shows a "Just save to inventory" option (no platform publish). */
    onSaveToInventory?: () => void;
    /** Tap "Add a channel" — typically navigates to the connections screen. */
    onAddChannel?: () => void;
}

export default function PublishConfirmationModal({
    visible,
    onClose,
    onConfirm,
    allConnections,
    selectedConnectionIds,
    setSelectedConnectionIds,
    isPublishing = false,
    onSaveToInventory,
    onAddChannel,
}: PublishConfirmationModalProps) {
    const insets = useSafeAreaInsets();

    // Which platforms are toggled on for publishing.
    const [selectedPlatforms, setSelectedPlatforms] = React.useState<Set<string>>(new Set());

    // Group the enabled connections by platform once — used everywhere below.
    const platformGroups = React.useMemo(() => {
        const groups: Record<string, any[]> = {};
        allConnections.forEach((conn: any) => {
            if (!conn.IsEnabled) return;
            const platform = conn.PlatformType?.toLowerCase();
            if (!platform) return;
            (groups[platform] = groups[platform] || []).push(conn);
        });
        return groups;
    }, [allConnections]);

    // Auto-select every connected platform when the sheet opens (default = publish to all
    // ready channels; the seller can toggle any off).
    useEffect(() => {
        if (!visible || allConnections.length === 0) return;
        log.debug('[PublishModal] opened with platforms:', Object.keys(platformGroups));
        setSelectedPlatforms(new Set(Object.keys(platformGroups)));
        const next: Record<string, string> = { ...selectedConnectionIds };
        let changed = false;
        Object.keys(platformGroups).forEach((p) => {
            if (next[p] === undefined) { next[p] = 'ALL'; changed = true; }
        });
        if (changed) setSelectedConnectionIds(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, allConnections]);

    const totalAccounts = React.useMemo(() => {
        let total = 0;
        for (const [platform, selection] of Object.entries(selectedConnectionIds)) {
            if (!selectedPlatforms.has(platform)) continue;
            const conns = platformGroups[platform] || [];
            if (conns.length === 0) continue;
            total += selection === 'ALL' ? conns.length : 1;
        }
        return total;
    }, [selectedConnectionIds, selectedPlatforms, platformGroups]);
    const hasSelection = totalAccounts > 0;

    // Facebook posts through the seller's own computer — give an honest, non-blocking
    // heads-up if FB is on and no computer is currently online (publishing still queues).
    const { computerOnline } = useFacebookJobStatus();
    const showComputerHeadsUp = selectedPlatforms.has('facebook') && !computerOnline;

    const togglePlatform = (platform: string) => {
        setSelectedPlatforms((prev) => {
            const next = new Set(prev);
            next.has(platform) ? next.delete(platform) : next.add(platform);
            return next;
        });
    };

    const platforms = Object.keys(platformGroups);
    const hasNoConnections = platforms.length === 0;

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
                {/* Header: back · "Ready to publish" · spacer */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backCircle} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="chevron-left" size={22} color="#18181B" />
                    </TouchableOpacity>
                    <View style={styles.statusPill}>
                        <Text style={styles.statusPillText}>Ready to publish</Text>
                    </View>
                    <View style={styles.backCircle} />
                </View>

                <View style={styles.titleBlock}>
                    <Text style={styles.title}>Publish where?</Text>
                    <Text style={styles.subtitle}>Pick any — 1, 2, or all. You're never forced to post somewhere.</Text>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    {hasNoConnections ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyTitle}>No channels connected</Text>
                            <Text style={styles.emptySub}>Connect Shopify, eBay, or Facebook to publish — or just save to inventory below.</Text>
                        </View>
                    ) : (
                        platforms.map((platform) => {
                            const b = brandFor(platform);
                            const selected = selectedPlatforms.has(platform);
                            const status = platform === 'facebook' ? 'optional' : 'Connected';
                            return (
                                <TouchableOpacity key={platform} style={styles.platformCard} activeOpacity={0.8} onPress={() => togglePlatform(platform)}>
                                    <View style={[styles.logoChip, { backgroundColor: b.bg }]}>
                                        <Text style={styles.logoGlyph}>{b.label}</Text>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.platformName}>{labelFor(platform)}</Text>
                                        <Text style={[styles.platformStatus, platform === 'facebook' && { color: '#9CA3AF' }]}>{status}</Text>
                                    </View>
                                    {selected ? (
                                        <View style={styles.checkOn}>
                                            <Icon name="check" size={15} color="#FFFFFF" />
                                        </View>
                                    ) : (
                                        <View style={styles.checkOff} />
                                    )}
                                </TouchableOpacity>
                            );
                        })
                    )}

                    {onAddChannel ? (
                        <TouchableOpacity style={styles.addCard} activeOpacity={0.8} onPress={onAddChannel}>
                            <View style={styles.addChip}>
                                <Icon name="plus" size={16} color="#9CA3AF" />
                            </View>
                            <Text style={styles.addText}>Add a channel</Text>
                        </TouchableOpacity>
                    ) : null}

                    {showComputerHeadsUp ? (
                        <View style={styles.computerNotice}>
                            <Icon name="monitor" size={16} color="#BA7517" style={{ marginTop: 1 }} />
                            <Text style={styles.computerNoticeText}>Facebook posts via your computer.</Text>
                        </View>
                    ) : null}
                </ScrollView>

                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 18) }]}>
                    <TouchableOpacity
                        style={[styles.publishBtn, (!hasSelection || isPublishing) && styles.publishBtnDisabled]}
                        onPress={onConfirm}
                        disabled={!hasSelection || isPublishing}
                        activeOpacity={0.9}
                    >
                        {isPublishing ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <>
                                <Text style={styles.publishText}>Publish to {totalAccounts} channel{totalAccounts !== 1 ? 's' : ''}</Text>
                                <Icon name="arrow-right" size={18} color="#FFFFFF" />
                            </>
                        )}
                    </TouchableOpacity>
                    {onSaveToInventory ? (
                        <TouchableOpacity onPress={onSaveToInventory} disabled={isPublishing} activeOpacity={0.7}>
                            <Text style={styles.saveOnly}>Just save to inventory</Text>
                        </TouchableOpacity>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#F4F4F1' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
    backCircle: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
    statusPill: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 18 },
    statusPillText: { color: '#3F3F46', fontSize: 13, fontWeight: '600' },
    titleBlock: { paddingHorizontal: 22, paddingTop: 14, gap: 7 },
    title: { color: '#18181B', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, lineHeight: 30 },
    subtitle: { color: '#6B7280', fontSize: 14, lineHeight: 20 },
    list: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 8, gap: 10 },
    platformCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 14 },
    logoChip: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    logoGlyph: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
    platformName: { color: '#18181B', fontSize: 15, fontWeight: '700', lineHeight: 18 },
    platformStatus: { color: '#6B7280', fontSize: 12, lineHeight: 16, marginTop: 2 },
    checkOn: { width: 24, height: 24, borderRadius: 7, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' },
    checkOff: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF' },
    addCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed', borderRadius: 14, padding: 14 },
    addChip: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
    addText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
    emptyCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 16, gap: 4 },
    emptyTitle: { color: '#18181B', fontSize: 15, fontWeight: '700' },
    emptySub: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
    computerNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FBF5EA', borderRadius: 12, borderWidth: 1, borderColor: '#F0E2C8' },
    computerNoticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: '#8A5A12', fontWeight: '500' },
    footer: { alignItems: 'center', gap: 14, paddingHorizontal: 22, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7E7E2' },
    publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', height: 54, borderRadius: 999, backgroundColor: BRAND_PRIMARY },
    publishBtnDisabled: { backgroundColor: '#D6D6D1' },
    publishText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    saveOnly: { color: '#71717A', fontSize: 14, fontWeight: '500' },
});
