import React, { useEffect } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    Pressable,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformBrandChip from './PlatformBrandChip';
import { normalizeDisplayName } from '../config/platforms';
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

// One-word context under each channel name: your own store vs. an open marketplace.
const STORE_PLATFORMS = new Set(['shopify', 'square', 'clover', 'woocommerce']);
const subtitleFor = (p: string) => (STORE_PLATFORMS.has(p) ? 'Your store' : 'Marketplace');

export type ChannelOptimization = { tone: 'good' | 'warn'; label: string; detail: string };

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
    /** Per-platform "how well set up to sell" status (Ready to rank / N boosts). */
    channelOptimization?: Record<string, ChannelOptimization>;
    /** Tap a channel's "Add" boost link — typically returns to the editor to fill specifics. */
    onOptimize?: (platform: string) => void;
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
    channelOptimization,
    onOptimize,
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

    // The seller wants to know WHICH store/account this is — show the connection's own
    // name (cleaned of the .myshopify.com suffix etc.), with a "+N" when there are several.
    // Falls back to a generic store/marketplace label when a connection has no name.
    const storeNameFor = (platform: string) => {
        const conns = platformGroups[platform] || [];
        const first = conns[0]?.DisplayName || conns[0]?.Nickname || conns[0]?.ShopName;
        const name = first ? normalizeDisplayName(String(first)) : '';
        if (!name) return subtitleFor(platform);
        return conns.length > 1 ? `${name} +${conns.length - 1}` : name;
    };

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
            <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
                {/* Header: back · progress · Done */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backCircle} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="chevron-left" size={22} color="#18181B" />
                    </TouchableOpacity>
                    <View style={styles.progress}>
                        <View style={[styles.progSeg, styles.progSegOn]} />
                        <View style={[styles.progSeg, styles.progSegOn]} />
                    </View>
                    <TouchableOpacity onPress={onClose} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.doneText}>Done</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.titleBlock}>
                    <Text style={styles.title}>Where should we publish?</Text>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    {hasNoConnections ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyTitle}>No channels connected</Text>
                            <Text style={styles.emptySub}>Connect Shopify, eBay, or Facebook to publish — or just save to inventory below.</Text>
                        </View>
                    ) : (
                        platforms.map((platform) => {
                            const selected = selectedPlatforms.has(platform);
                            const opt = channelOptimization?.[platform];
                            const warn = opt?.tone === 'warn';
                            return (
                                <View key={platform} style={styles.platformCard}>
                                    {/* Top row — selection */}
                                    <TouchableOpacity style={styles.cardRow} activeOpacity={0.8} onPress={() => togglePlatform(platform)}>
                                        <PlatformBrandChip platform={platform} size={48} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.platformName}>{labelFor(platform)}</Text>
                                            <Text style={styles.platformStatus} numberOfLines={1}>{storeNameFor(platform)}</Text>
                                        </View>
                                        {selected ? (
                                            <View style={styles.checkOn}>
                                                <Icon name="check" size={16} color="#FFFFFF" />
                                            </View>
                                        ) : (
                                            <View style={styles.checkOff} />
                                        )}
                                    </TouchableOpacity>

                                    {/* Bottom row — optimization */}
                                    {opt ? (
                                        <View style={styles.optRow}>
                                            <View style={[styles.optPill, warn ? styles.optPillWarn : styles.optPillGood]}>
                                                <Text style={[styles.optPillText, warn ? styles.optPillTextWarn : styles.optPillTextGood]}>{opt.label}</Text>
                                            </View>
                                            <Text style={styles.optDetail} numberOfLines={1}>{opt.detail}</Text>
                                            {warn && onOptimize ? (
                                                <TouchableOpacity onPress={() => onOptimize(platform)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                                    <Text style={styles.optAdd}>Add</Text>
                                                </TouchableOpacity>
                                            ) : null}
                                        </View>
                                    ) : null}
                                </View>
                            );
                        })
                    )}

                    {onAddChannel ? (
                        <TouchableOpacity style={styles.addLink} activeOpacity={0.7} onPress={onAddChannel}>
                            <Icon name="plus" size={16} color="#9CA3AF" />
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
                    <Pressable
                        style={({ pressed }) => [styles.publishBtn, (!hasSelection || isPublishing) && styles.publishBtnDisabled, pressed && hasSelection && !isPublishing && styles.pressed]}
                        onPress={onConfirm}
                        disabled={!hasSelection || isPublishing}
                    >
                        {isPublishing ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={styles.publishText}>Publish to {totalAccounts} channel{totalAccounts !== 1 ? 's' : ''}</Text>
                        )}
                    </Pressable>
                    {onSaveToInventory ? (
                        <Pressable onPress={onSaveToInventory} disabled={isPublishing} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
                            <Text style={styles.saveBtnText}>Just save to inventory</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#FFFFFF' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
    backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    progress: { flexDirection: 'row', gap: 6, flex: 1, alignItems: 'center', paddingHorizontal: 18 },
    progSeg: { flex: 1, height: 4, borderRadius: 999, backgroundColor: '#E5E7EB' },
    progSegOn: { backgroundColor: BRAND_PRIMARY },
    doneText: { color: '#18181B', fontSize: 13, fontWeight: '600' },
    titleBlock: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
    title: { color: '#18181B', fontSize: 22, fontWeight: '800', letterSpacing: -0.22, lineHeight: 28 },
    list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
    platformCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 12 },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 11 },
    platformName: { color: '#18181B', fontSize: 18, fontWeight: '700', lineHeight: 18 },
    platformStatus: { color: '#9CA3AF', fontSize: 16, fontWeight: '500', lineHeight: 16, marginTop: 1 },
    checkOn: { width: 32, height: 32, borderRadius: 7, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' },
    checkOff: { width: 32, height: 32, borderRadius: 7, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: 'transparent' },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#F1F2F4' },
    optPill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
    optPillGood: { backgroundColor: 'rgba(147,200,34,0.12)' },
    optPillWarn: { backgroundColor: 'rgba(186,117,23,0.10)' },
    optPillText: { fontSize: 11, fontWeight: '700' },
    optPillTextGood: { color: '#4A7C00' },
    optPillTextWarn: { color: '#BA7517' },
    optDetail: { flex: 1, color: '#9CA3AF', fontSize: 12, fontWeight: '500' },
    optAdd: { color: '#BA7518', fontSize: 12, fontWeight: '700' },
    addLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
    addText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
    emptyCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 16, gap: 4 },
    emptyTitle: { color: '#18181B', fontSize: 15, fontWeight: '700' },
    emptySub: { color: '#6B7280', fontSize: 13, lineHeight: 18 },
    computerNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FBF5EA', borderRadius: 12, borderWidth: 1, borderColor: '#F0E2C8' },
    computerNoticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: '#8A5A12', fontWeight: '500' },
    footer: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
    publishBtn: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 18, borderRadius: 16, backgroundColor: BRAND_PRIMARY },
    publishBtnDisabled: { backgroundColor: '#D6D6D1' },
    publishText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    saveBtn: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 18, borderRadius: 16, backgroundColor: '#EFEFEC' },
    saveBtnText: { color: '#3F3F46', fontSize: 16, fontWeight: '600' },
    pressed: { transform: [{ scale: 0.96 }], opacity: 0.96 },
});
