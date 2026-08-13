import React, { useEffect, useRef } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { CHAT_FONT } from '../design/chatGlass';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    TouchableOpacity,
    Pressable,
    ScrollView,
    ActivityIndicator,
    Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformBrandChip from './PlatformBrandChip';
import { normalizeDisplayName } from '../config/platforms';
import { PLATFORM_META } from '../utils/platformConstants';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { createLogger } from '../utils/logger';
import { isVisiblePlatformConnection } from '../lib/platformConnectStatus';
const log = createLogger('PublishConfirmationModal');

const labelFor = (p: string) => (PLATFORM_META as any)[p]?.label || (p.charAt(0).toUpperCase() + p.slice(1));

// One-word context under each channel name: your own store vs. an open marketplace.
const STORE_PLATFORMS = new Set(['shopify', 'square', 'clover', 'woocommerce']);
const subtitleFor = (p: string) => (STORE_PLATFORMS.has(p) ? 'Your store' : 'Marketplace');

export type ChannelOptimization = { tone: 'good' | 'warn'; label: string; detail: string };

export interface PublishConfirmationModalProps {
    visible: boolean;
    onClose: () => void;
    /** Optional in-flow back action. Defaults to onClose for standalone use. */
    onBack?: () => void;
    /** opts.targetWorkerId = the linked computer the seller pinned (optional pin). */
    onConfirm: (opts: { selectedPlatforms: string[]; targetWorkerId?: string }) => void;
    readyPlatforms: string[];
    /** Listing target set. Unlike readiness, this remains stable when the seller skips a gap. */
    targetPlatforms?: string[];
    allConnections: any[];
    selectedConnectionIds: Record<string, string>;
    setSelectedConnectionIds: (ids: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
    productSummary: {
        title?: string;
        sku?: string;
        price?: number | string;
        imageUrl?: string;
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
    /** Header position when this content is hosted inside a longer wizard. */
    progress?: { current: number; total: number };
}

export type PublishConfirmationContentProps = Omit<PublishConfirmationModalProps, 'visible'> & {
    active?: boolean;
};

export function PublishConfirmationContent({
    active = true,
    onClose,
    onBack,
    onConfirm,
    readyPlatforms,
    targetPlatforms,
    allConnections,
    selectedConnectionIds,
    setSelectedConnectionIds,
    isPublishing = false,
    onSaveToInventory,
    onAddChannel,
    channelOptimization,
    onOptimize,
    progress,
    productSummary,
}: PublishConfirmationContentProps) {
    const insets = useSafeAreaInsets();
    const [summaryImageFailed, setSummaryImageFailed] = React.useState(false);

    useEffect(() => {
        setSummaryImageFailed(false);
    }, [active, productSummary.imageUrl]);

    const summaryPrice = (() => {
        if (productSummary.price === undefined || productSummary.price === null || productSummary.price === '') return 'Not set';
        const numericPrice = typeof productSummary.price === 'number'
            ? productSummary.price
            : Number(String(productSummary.price).replace(/[$,]/g, ''));
        return Number.isFinite(numericPrice) && numericPrice > 0 ? `$${numericPrice.toFixed(2)}` : 'Not set';
    })();

    // Which platforms are toggled on for publishing.
    const [selectedPlatforms, setSelectedPlatforms] = React.useState<Set<string>>(new Set());
    const selectionInitializedRef = useRef(false);

    // Group the enabled connections by platform once — used everywhere below.
    const platformGroups = React.useMemo(() => {
        const groups: Record<string, any[]> = {};
        const allowedPlatforms = new Set(targetPlatforms ?? readyPlatforms);
        allConnections.forEach((conn: any) => {
            if (!isVisiblePlatformConnection(conn)) return;
            const platform = conn.PlatformType?.toLowerCase();
            if (!platform) return;
            if (!allowedPlatforms.has(platform)) return;
            (groups[platform] = groups[platform] || []).push(conn);
        });
        return groups;
    }, [allConnections, readyPlatforms, targetPlatforms]);

    // Auto-select every connected platform once per sheet presentation. Connection context
    // can refresh while this screen is open, so depending directly on allConnections used to
    // re-select channels the seller had just unchecked.
    useEffect(() => {
        if (!active) {
            selectionInitializedRef.current = false;
            return;
        }
        if (selectionInitializedRef.current || allConnections.length === 0) return;
        selectionInitializedRef.current = true;
        log.debug('[PublishModal] opened with platforms:', Object.keys(platformGroups));
        setSelectedPlatforms(new Set(Object.keys(platformGroups)));
        const next: Record<string, string> = { ...selectedConnectionIds };
        let changed = false;
        Object.keys(platformGroups).forEach((p) => {
            if (next[p] === undefined) { next[p] = 'ALL'; changed = true; }
        });
        if (changed) setSelectedConnectionIds(next);
    }, [active, allConnections.length, platformGroups, selectedConnectionIds, setSelectedConnectionIds]);

    // This list is the publish intent. Both the CTA count and onConfirm payload
    // derive from it so a visual deselection cannot diverge from the request.
    const selectedPlatformKeys = React.useMemo(() => {
        return Object.keys(platformGroups).filter((platform) => (
            selectedPlatforms.has(platform)
            && selectedConnectionIds[platform] !== undefined
            && platformGroups[platform].length > 0
        ));
    }, [selectedConnectionIds, selectedPlatforms, platformGroups]);
    const hasSelection = selectedPlatformKeys.length > 0;

    // Facebook posts through the seller's own computer — give an honest, non-blocking
    // heads-up if FB is on and no computer is currently online (publishing still queues).
    const { computerOnline, computers } = useFacebookJobStatus(active);
    const showComputerHeadsUp = selectedPlatforms.has('facebook') && !computerOnline;

    // Optional pin: with 2+ linked computers, let the seller choose WHICH one posts
    // to Facebook (default = any available). Only pinnable computers (those with a
    // workerId) are offered; the choice rides the publish body as targetWorkerId.
    const pinnable = React.useMemo(() => computers.filter((c) => !!c.workerId), [computers]);
    const showComputerPicker = selectedPlatforms.has('facebook') && pinnable.length >= 2;
    const [targetWorker, setTargetWorker] = React.useState<string | null>(null);
    useEffect(() => { if (active) setTargetWorker(null); }, [active]);

    const togglePlatform = (platform: string) => {
        setSelectedPlatforms((prev) => {
            const next = new Set(prev);
            if (next.has(platform)) next.delete(platform);
            else next.add(platform);
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
        <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
                {/* Header: back · progress · Done */}
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backCircle} onPress={onBack || onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Icon name="chevron-left" size={22} color="#18181B" />
                    </TouchableOpacity>
                    <View style={styles.progressPill}>
                    <View style={styles.progress}>
                        {Array.from({ length: progress?.total || 2 }, (_, index) => (
                            <View
                                key={index}
                                style={[styles.progSeg, index < (progress?.current || 2) && styles.progSegOn]}
                            />
                        ))}
                    </View>
                    </View>
                    <TouchableOpacity onPress={onClose} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.doneText}>Done</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.titleBlock}>
                    <Text style={styles.title}>Where should we publish?</Text>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    <View style={styles.summaryCard}>
                        {productSummary.imageUrl && !summaryImageFailed ? (
                            <Image
                                source={{ uri: productSummary.imageUrl }}
                                style={styles.summaryImage}
                                resizeMode="cover"
                                onError={() => setSummaryImageFailed(true)}
                            />
                        ) : (
                            <View style={[styles.summaryImage, styles.summaryImageEmpty]}>
                                <Icon name="image-outline" size={22} color="#9CA3AF" />
                            </View>
                        )}
                        <View style={styles.summaryCopy}>
                            <Text style={styles.summaryTitle} numberOfLines={2}>{productSummary.title?.trim() || 'Untitled item'}</Text>
                            <Text style={styles.summaryPrice}>{summaryPrice}</Text>
                        </View>
                    </View>

                    {hasNoConnections ? (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyTitle}>No channels connected</Text>
                            <Text style={styles.emptySub}>Connect Shopify, eBay, or Facebook to publish. You can also save to inventory.</Text>
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
                            <Icon name="plus" size={22} color="#9CA3AF" />
                            <Text style={styles.addText}>Add a channel</Text>
                        </TouchableOpacity>
                    ) : null}

                    {showComputerHeadsUp ? (
                        <View style={styles.computerNotice}>
                            <Icon name="monitor" size={16} color="#BA7517" style={{ marginTop: 1 }} />
                            <Text style={styles.computerNoticeText}>Facebook posts via your computer.</Text>
                        </View>
                    ) : null}

                    {showComputerPicker ? (
                        <View style={styles.pickerBlock}>
                            <Text style={styles.pickerLabel}>Post from</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
                                <TouchableOpacity
                                    style={[styles.pickerChip, targetWorker === null && styles.pickerChipOn]}
                                    activeOpacity={0.8}
                                    onPress={() => setTargetWorker(null)}
                                >
                                    <Text style={[styles.pickerChipText, targetWorker === null && styles.pickerChipTextOn]}>Any computer</Text>
                                </TouchableOpacity>
                                {pinnable.map((c, i) => {
                                    const on = targetWorker === c.workerId;
                                    return (
                                        <TouchableOpacity
                                            key={c.id}
                                            style={[styles.pickerChip, on && styles.pickerChipOn]}
                                            activeOpacity={0.8}
                                            onPress={() => setTargetWorker(c.workerId || null)}
                                        >
                                            <View style={[styles.pickerDot, { backgroundColor: c.online ? '#43631A' : '#BA7517' }]} />
                                            <Text style={[styles.pickerChipText, on && styles.pickerChipTextOn]}>Computer {i + 1}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    ) : null}
                </ScrollView>

                <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 18) }]}>
                    <Pressable
                        style={({ pressed }) => [styles.publishBtn, (!hasSelection || isPublishing) && styles.publishBtnDisabled, pressed && hasSelection && !isPublishing && styles.pressed]}
                        onPress={() => onConfirm({
                            selectedPlatforms: selectedPlatformKeys,
                            ...(targetWorker ? { targetWorkerId: targetWorker } : {}),
                        })}
                        disabled={!hasSelection || isPublishing}
                    >
                        {isPublishing ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={styles.publishText}>Publish to {selectedPlatformKeys.length} channel{selectedPlatformKeys.length !== 1 ? 's' : ''}</Text>
                        )}
                    </Pressable>
                    {onSaveToInventory ? (
                        <Pressable onPress={onSaveToInventory} disabled={isPublishing} style={({ pressed }) => [styles.saveBtn, pressed && styles.pressed]}>
                            <Text style={styles.saveBtnText}>Just save to inventory</Text>
                        </Pressable>
                    ) : null}
                </View>
        </View>
    );
}

export default function PublishConfirmationModal({ visible, ...contentProps }: PublishConfirmationModalProps) {
    return (
        <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={contentProps.onClose}>
            <PublishConfirmationContent {...contentProps} active={visible} />
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#F5F5F7' },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
    backCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    progressPill: { flex: 1, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', justifyContent: 'center', paddingHorizontal: 14, shadowColor: '#000000', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
    progress: { flexDirection: 'row', gap: 5, alignItems: 'center' },
    progSeg: { flex: 1, height: 4, borderRadius: 999, backgroundColor: '#E5E7EB' },
    progSegOn: { backgroundColor: BRAND_PRIMARY },
    doneText: { color: '#18181B', fontSize: 13, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
    titleBlock: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
    title: { color: '#18181B', fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', letterSpacing: -0.22, lineHeight: 28 },
    list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 10 },
    summaryCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, borderCurve: 'continuous', padding: 10 },
    summaryImage: { width: 56, height: 56, borderRadius: 11, borderCurve: 'continuous', backgroundColor: '#F3F4F6' },
    summaryImageEmpty: { alignItems: 'center', justifyContent: 'center' },
    summaryCopy: { flex: 1, minWidth: 0, gap: 4 },
    summaryTitle: { color: '#18181B', fontSize: 15, lineHeight: 19, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
    summaryPrice: { color: '#3F3F46', fontSize: 14, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
    platformCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 12 },
    cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 11 },
    platformName: { color: '#18181B', fontSize: 18, fontFamily: CHAT_FONT.bold, fontWeight: '700', lineHeight: 18 },
    platformStatus: { color: '#9CA3AF', fontSize: 16, fontFamily: CHAT_FONT.medium, fontWeight: '500', lineHeight: 16, marginTop: 1 },
    checkOn: { width: 32, height: 32, borderRadius: 7, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center' },
    checkOff: { width: 32, height: 32, borderRadius: 7, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: 'transparent' },
    optRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#F1F2F4' },
    optPill: { borderRadius: 999, paddingVertical: 9, paddingHorizontal: 10 },
    optPillGood: { backgroundColor: 'rgba(147,200,34,0.12)' },
    optPillWarn: { backgroundColor: 'rgba(186,117,23,0.10)' },
    optPillText: { fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
    optPillTextGood: { color: '#4A7C00' },
    optPillTextWarn: { color: '#BA7517' },
    optDetail: { flex: 1, color: '#9CA3AF', fontSize: 16, fontFamily: CHAT_FONT.medium, fontWeight: '500' },
    optAdd: { color: '#BA7518', fontSize: 12, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
    addLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11 },
    addText: { color: '#9CA3AF', fontSize: 16, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
    emptyCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 16, gap: 4 },
    emptyTitle: { color: '#18181B', fontSize: 15, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
    emptySub: { color: '#6B7280', fontSize: 13, fontFamily: CHAT_FONT.regular, lineHeight: 18 },
    computerNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#FBF5EA', borderRadius: 12, borderWidth: 1, borderColor: '#F0E2C8' },
    computerNoticeText: { flex: 1, fontSize: 12.5, lineHeight: 17, color: '#8A5A12', fontFamily: CHAT_FONT.medium, fontWeight: '500' },
    pickerBlock: { marginTop: 2, gap: 8 },
    pickerLabel: { color: '#9CA3AF', fontSize: 13, fontFamily: CHAT_FONT.semibold, fontWeight: '600', paddingLeft: 2 },
    pickerRow: { flexDirection: 'row', gap: 8, paddingRight: 4 },
    pickerChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF' },
    pickerChipOn: { borderColor: BRAND_PRIMARY, backgroundColor: BRAND_PRIMARY },
    pickerChipText: { color: '#18181B', fontSize: 14, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
    pickerChipTextOn: { color: '#FFFFFF' },
    pickerDot: { width: 8, height: 8, borderRadius: 4 },
    footer: { alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
    publishBtn: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 18, borderRadius: 16, backgroundColor: BRAND_PRIMARY },
    publishBtnDisabled: { backgroundColor: '#D6D6D1' },
    publishText: { color: '#FFFFFF', fontSize: 16, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
    saveBtn: { alignItems: 'center', justifyContent: 'center', width: '100%', paddingVertical: 18, borderRadius: 16, backgroundColor: '#EFEFEC' },
    saveBtnText: { color: '#3F3F46', fontSize: 16, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
    pressed: { transform: [{ scale: 0.96 }], opacity: 0.96 },
});
