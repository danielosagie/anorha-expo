/**
 * DeliveryShippingSheet – A unified bottom sheet for Delivery & Shipping configuration.
 *
 * Layout: platform tabs at the top, a live cost-estimate preview, then an Options
 * card with three tappable rows (Fulfillment, Package, Speed) that each expand an
 * inline picker.
 *
 * Features (scoped to the selected platform tab):
 * - Delivery method selector (Pickup / Ship / Both).
 * - eBay "Who pays shipping?" — Free shipping (default) vs Buyer pays a flat rate.
 *   The rate is written to the platform's `shippingCost`; it flows through the publish
 *   payload (GenerateDetailsScreen → platformDetails.ebay) into the eBay adapter's
 *   dynamic fulfillment policy. Free shipping leaves shippingCost empty (ships free).
 * - Facebook pickup-location trigger (Facebook tab, when pickup is enabled).
 * - Package dimensions/weight inputs. These are shared physical values, so edits are
 *   written to every platform so the canonical Weight/WeightUnit the publish payload
 *   carries stays in sync (Shopify/eBay both read them).
 * - USPS rate-matrix estimate preview whose wording adapts to who pays; the Standard /
 *   Expedited speed toggle feeds the estimate query (`speed` param).
 * - Preferences (delivery method + eBay shipping cost) persist via AsyncStorage.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
    View,
    Text,
    StyleSheet,
    Modal,
    Pressable,
    TouchableOpacity,
    TextInput,
    ScrollView,
    ActivityIndicator,
    Animated,
    LayoutAnimation,
    UIManager,
    Platform,
} from 'react-native';
import { X, Truck, Car, Package, MapPin, Scale, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppMenuSelect } from './ui/AppMenuSelect';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ── Platform brand logos ───────────────────────────────────── */
import PlatformLogo from './PlatformLogo';
import { listPlatforms, getPlatform } from '../config/platforms';

/* Platforms that support shipping / delivery settings (from the registry). */
const SHIPPING_PLATFORMS = new Set<string>(
    listPlatforms().filter((d) => d.capabilities.shipping).map((d) => d.key),
);

const STORAGE_KEY = '@anorha/shipping_prefs';

/* ── Accordion helper ──────────────────────────────────────── */
function AccordionSection({
    title,
    summaryText,
    defaultOpen = false,
    children,
}: {
    title: string;
    summaryText?: string;
    defaultOpen?: boolean;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);

    // Sync open when defaultOpen becomes true (e.g. when estimate result arrives after recalculate)
    useEffect(() => {
        if (defaultOpen) setOpen(true);
    }, [defaultOpen]);

    const toggle = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setOpen((v) => !v);
    };

    return (
        <View style={accordionStyles.container}>
            <TouchableOpacity
                onPress={toggle}
                activeOpacity={0.7}
                style={accordionStyles.header}
            >
                <View style={{ flex: 1 }}>
                    <Text style={accordionStyles.title}>{title}</Text>
                    {!open && summaryText ? (
                        <Text style={accordionStyles.summary} numberOfLines={1}>
                            {summaryText}
                        </Text>
                    ) : null}
                </View>
                {open ? (
                    <ChevronDown size={18} color="#6B7280" />
                ) : (
                    <ChevronRight size={18} color="#6B7280" />
                )}
            </TouchableOpacity>
            {open && <View style={accordionStyles.body}>{children}</View>}
        </View>
    );
}

const accordionStyles = StyleSheet.create({
    container: {
        borderWidth: 1,
        borderColor: '#F3F4F6',
        borderRadius: 12,
        backgroundColor: '#FAFAFA',
        marginTop: 12,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 12,
        paddingHorizontal: 14,
    },
    title: {
        fontSize: 13,
        fontWeight: '600',
        color: '#374151',
    },
    summary: {
        fontSize: 12,
        color: '#6B7280',
        marginTop: 2,
    },
    body: {
        paddingHorizontal: 14,
        paddingBottom: 14,
    },
});

/* ── Types ──────────────────────────────────────────────────── */
export interface DeliveryShippingSheetProps {
    visible: boolean;
    onClose: () => void;
    /** The currently connected platform keys (e.g. ['ebay','facebook','shopify']) */
    platformKeys: string[];
    /** Full platforms data object */
    platforms: Record<string, any>;
    /** Mutator: replace the whole platforms map */
    onChangePlatforms: (platforms: Record<string, any>) => void;
    /** The currently active platform key in the parent ListingEditorForm */
    activePlatformKey: string;
    /** Shipping estimate state passed from parent */
    shippingEstimateResult: {
        estimatedMin: number;
        estimatedMax: number;
        midpoint: number;
        description?: string;
        error?: string;
        lowZoneCost?: number;
        midZoneCost?: number;
        highZoneCost?: number;
        expectedCost?: number;
    } | null;
    shippingEstimateLoading: boolean;
    /** Optional override: when recalculating, pass current editable values so fetch uses them immediately */
    fetchShippingEstimate: (override?: { weight: string; weightUnit: string; estimatedDimensions?: { length: number; width: number; height: number } }) => void;
    /** Editable dimensions/weight driven by parent state */
    editableDimensions: { length: string; width: string; height: string };
    setEditableDimensions: React.Dispatch<React.SetStateAction<{ length: string; width: string; height: string }>>;
    editableWeight: string;
    setEditableWeight: React.Dispatch<React.SetStateAction<string>>;
    editableWeightUnit: string;
    setEditableWeightUnit: React.Dispatch<React.SetStateAction<string>>;
    /** Shipping speed (controlled by parent so it can feed the estimate query) */
    speed: 'standard' | 'expedited';
    onChangeSpeed: (speed: 'standard' | 'expedited') => void;
    /** Location picker */
    onOpenLocationPicker: () => void;
    /** Active data for the currently selected platform in this sheet */
    getActiveData: (platformKey: string) => any;
}

/* ── Component ──────────────────────────────────────────────── */
export default function DeliveryShippingSheet({
    visible,
    onClose,
    platformKeys,
    platforms,
    onChangePlatforms,
    activePlatformKey,
    shippingEstimateResult,
    shippingEstimateLoading,
    fetchShippingEstimate,
    editableDimensions,
    setEditableDimensions,
    editableWeight,
    setEditableWeight,
    editableWeightUnit,
    setEditableWeightUnit,
    speed,
    onChangeSpeed,
    onOpenLocationPicker,
    getActiveData,
}: DeliveryShippingSheetProps) {
    /* ── Platform tabs ────────────────────────────────────────── */
    const shippingCapablePlatforms = useMemo(
        () => platformKeys.filter((k) => SHIPPING_PLATFORMS.has(k.toLowerCase())),
        [platformKeys],
    );

    // Default to the currently active platform, or the first shipping-capable one
    const [selectedTab, setSelectedTab] = useState<string>(
        shippingCapablePlatforms.includes(activePlatformKey.toLowerCase())
            ? activePlatformKey.toLowerCase()
            : shippingCapablePlatforms[0] || '',
    );

    // Single-sheet layout: which OPTIONS row's inline picker is open (one at a time).
    const [expandedRow, setExpandedRow] = useState<null | 'fulfillment' | 'package' | 'speed'>(null);
    // Who pays eBay shipping: 'free' (ships free — the default) or 'buyer' (flat rate).
    const [shippingPayer, setShippingPayer] = useState<'free' | 'buyer'>('free');

    // Sync selectedTab + reset to first step when the sheet opens
    useEffect(() => {
        if (visible) {
            const preferred = shippingCapablePlatforms.includes(activePlatformKey.toLowerCase())
                ? activePlatformKey.toLowerCase()
                : shippingCapablePlatforms[0] || '';
            setSelectedTab(preferred);
            setExpandedRow(null);
        }
    }, [visible, activePlatformKey, shippingCapablePlatforms]);

    // Initialize the "who pays" toggle from the selected tab's persisted shipping cost
    // whenever the tab changes or the sheet (re)opens. Keyed on tab/visibility only —
    // NOT on the live cost value — so clearing the input doesn't kick you out of "Buyer pays".
    useEffect(() => {
        const cost = Number(getActiveData(selectedTab)?.shippingCost);
        setShippingPayer(Number.isFinite(cost) && cost > 0 ? 'buyer' : 'free');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTab, visible]);

    /* ── Preference persistence ────────────────────────────────── */
    // Load persisted shipping prefs on mount
    useEffect(() => {
        (async () => {
            try {
                const raw = await AsyncStorage.getItem(STORAGE_KEY);
                if (!raw) return;
                const prefs = JSON.parse(raw) as Record<string, { deliveryMethod?: string; shippingCost?: string }>;
                // Apply persisted preferences to platforms that don't already have values set
                const nextPlatforms = { ...platforms };
                let changed = false;
                for (const [pk, pref] of Object.entries(prefs)) {
                    if (!nextPlatforms[pk]) continue;
                    const data = nextPlatforms[pk];
                    const key = pk.toLowerCase();
                    if (key === 'facebook') {
                        if (!data.pickupLocation?.deliveryMethod && pref.deliveryMethod) {
                            nextPlatforms[pk] = {
                                ...data,
                                pickupLocation: { ...data.pickupLocation, deliveryMethod: pref.deliveryMethod },
                            };
                            changed = true;
                        }
                    } else {
                        // Restore persisted delivery method + flat-rate shipping cost when the
                        // item doesn't already carry its own (completes the shippingCost round-trip).
                        const patch: Record<string, any> = {};
                        if (!data.deliveryMethod && pref.deliveryMethod) patch.deliveryMethod = pref.deliveryMethod;
                        if ((data.shippingCost == null || data.shippingCost === '') && pref.shippingCost) patch.shippingCost = pref.shippingCost;
                        if (Object.keys(patch).length > 0) {
                            nextPlatforms[pk] = { ...data, ...patch };
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    onChangePlatforms(nextPlatforms);
                }
            } catch {
                // Ignore storage read errors
            }
        })();
    }, []); // Run once on mount

    // Save shipping prefs whenever delivery method changes
    const persistPrefs = useCallback(async () => {
        try {
            const prefs: Record<string, { deliveryMethod?: string; shippingCost?: string }> = {};
            for (const pk of platformKeys) {
                const data = platforms[pk];
                if (!data) continue;
                const key = pk.toLowerCase();
                if (key === 'facebook') {
                    prefs[pk] = { deliveryMethod: data.pickupLocation?.deliveryMethod };
                } else {
                    prefs[pk] = { deliveryMethod: data.deliveryMethod, shippingCost: data.shippingCost?.toString() };
                }
            }
            await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch {
            // Ignore storage write errors
        }
    }, [platformKeys, platforms]);

    /* ── Active tab data ──────────────────────────────────────── */
    const tabData = useMemo(() => getActiveData(selectedTab), [selectedTab, platforms]);
    const tabKeyLower = selectedTab.toLowerCase();

    const currentDeliveryMethod = tabKeyLower === 'facebook'
        ? tabData?.pickupLocation?.deliveryMethod
        : tabData?.deliveryMethod;

    const showsShipping = currentDeliveryMethod === 'shipping' || currentDeliveryMethod === 'both';
    const showsPickup = currentDeliveryMethod === 'in_person' || currentDeliveryMethod === 'both';

    /* ── Summary text helpers for accordions ──────────────────── */
    const dimsSummary = useMemo(() => {
        const l = editableDimensions.length;
        const w = editableDimensions.width;
        const h = editableDimensions.height;
        const wt = editableWeight;
        const parts: string[] = [];
        if (l && w && h) parts.push(`${l}×${w}×${h} in`);
        if (wt) parts.push(`${wt} ${editableWeightUnit}`);
        return parts.length > 0 ? parts.join(' · ') : 'Not set';
    }, [editableDimensions, editableWeight, editableWeightUnit]);

    const rateSummary = useMemo(() => {
        if (shippingEstimateLoading) return 'Calculating…';
        if (shippingEstimateResult && typeof shippingEstimateResult.estimatedMin === 'number' && !shippingEstimateResult.error) {
            const r = shippingEstimateResult;
            if (typeof r.expectedCost === 'number') {
                return `Usually ~$${r.expectedCost.toFixed(1)} · Range $${r.estimatedMin.toFixed(1)}–$${r.estimatedMax.toFixed(1)}`;
            }
            return `USPS Ground · $${r.estimatedMin.toFixed(2)}–$${r.estimatedMax.toFixed(2)}`;
        }
        return 'No estimate';
    }, [shippingEstimateLoading, shippingEstimateResult]);

    /* ── Delivery method change (per-platform, with persist) ─── */
    const handleDeliveryMethodChange = (method: 'in_person' | 'shipping' | 'both') => {
        const next = { ...platforms };
        const data = { ...(next[selectedTab] || {}) };
        if (tabKeyLower === 'facebook') {
            data.pickupLocation = { ...data.pickupLocation, deliveryMethod: method };
        } else {
            data.deliveryMethod = method;
        }
        next[selectedTab] = data;
        onChangePlatforms(next);
        // Persist after a tick
        setTimeout(() => persistPrefs(), 100);
    };

    /* ── Who-pays-shipping change (eBay flat rate, per-platform) ─ */
    // Writes to the selected tab's `shippingCost`. The publish payload spreads this into
    // platformDetails.ebay, and the eBay adapter turns a positive value into a flat-rate
    // fulfillment policy (0/empty ⇒ ships free — the prior default behaviour).
    const setTabShippingCost = (value: string) => {
        const next = { ...platforms };
        const data = { ...(next[selectedTab] || {}) };
        data.shippingCost = value;
        next[selectedTab] = data;
        onChangePlatforms(next);
        setTimeout(() => persistPrefs(), 100);
    };

    const handlePayerChange = (payer: 'free' | 'buyer') => {
        setShippingPayer(payer);
        // Free shipping clears the cost so the adapter falls back to freeShipping=true.
        if (payer === 'free') setTabShippingCost('');
    };

    const handleShippingCostChange = (text: string) => {
        // Numeric, single decimal point.
        const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
        setTabShippingCost(cleaned);
    };

    /* ── Recalculate handler ──────────────────────────────────── */
    const handleRecalculate = () => {
        const w = parseFloat(editableWeight);
        const l = parseFloat(editableDimensions.length);
        const wd = parseFloat(editableDimensions.width);
        const h = parseFloat(editableDimensions.height);
        const hasValidDims = Number.isFinite(l) && Number.isFinite(wd) && Number.isFinite(h);
        const hasValidWeight = Number.isFinite(w) && w > 0;

        // Weight & dimensions are physical properties of the item, shared across every
        // platform. Write them to ALL platform data objects (not just the active one) so
        // the canonical Weight/WeightUnit the publish payload reads — displayedPlatforms
        // [shopify].weight — stays in sync no matter which tab is selected.
        if (hasValidWeight || hasValidDims) {
            const next = { ...platforms };
            for (const pk of Object.keys(next)) {
                const data = { ...(next[pk] || {}) };
                if (hasValidWeight) {
                    data.weight = editableWeight;
                    data.weightUnit = editableWeightUnit;
                }
                if (hasValidDims) {
                    data.estimatedDimensions = { length: l, width: wd, height: h, unit: 'in' };
                }
                next[pk] = data;
            }
            onChangePlatforms(next);
        }

        // Immediate fetch with editable values so user sees result in sheet without waiting for debounce
        if (hasValidWeight) {
            fetchShippingEstimate({
                weight: editableWeight,
                weightUnit: editableWeightUnit,
                estimatedDimensions: hasValidDims ? { length: l, width: wd, height: h } : undefined,
            });
        }
    };

    /* ── Render ────────────────────────────────────────────────── */
    if (shippingCapablePlatforms.length === 0) return null;

    return (
        <Modal visible={visible} transparent animationType="slide">
            <Pressable
                style={s.backdrop}
                onPress={onClose}
            >
                <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
                    {/* Handle bar */}
                    <View style={s.handleBarRow}>
                        <View style={s.handleBar} />
                    </View>

                    <ScrollView
                        contentContainerStyle={s.content}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Header */}
                        <View style={s.headerRow}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                <View style={s.headerIcon}>
                                    <Truck size={20} color={BRAND_PRIMARY} />
                                </View>
                                <Text style={s.headerTitle}>Shipping</Text>
                            </View>
                            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <X size={22} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        {/* Platforms */}
                        <Text style={[s.sectionLabel, { marginTop: 14 }]}>Platforms</Text>
                        {shippingCapablePlatforms.length > 0 && (
                            <View style={s.tabRow}>
                                {shippingCapablePlatforms.map((pk) => {
                                    const isActive = pk.toLowerCase() === selectedTab.toLowerCase();
                                    return (
                                        <TouchableOpacity
                                            key={pk}
                                            onPress={() => setSelectedTab(pk.toLowerCase())}
                                            activeOpacity={0.75}
                                            style={[s.tab, isActive && s.tabActive]}
                                        >
                                            <PlatformLogo type={pk} size={18} />
                                            <Text style={[s.tabText, isActive && s.tabTextActive]}>
                                                {getPlatform(pk)?.label || pk}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                        {/* ── PREVIEW — the auto cost estimate leads ──────────── */}
                        <Text style={[s.sectionLabel, { marginTop: 18 }]}>Preview</Text>
                        {shippingEstimateLoading ? (
                            <View style={[s.previewCard, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
                                <ActivityIndicator size="small" color="#93C822" />
                                <Text style={{ fontSize: 13, color: '#6B7280' }}>Estimating…</Text>
                            </View>
                        ) : (shippingEstimateResult && typeof shippingEstimateResult.estimatedMin === 'number' && !shippingEstimateResult.error) ? (() => {
                            const r = shippingEstimateResult;
                            // Seller's estimated cost, from the USPS rate matrix. The bar + labels
                            // always reflect this (it's the seller's real cost distribution).
                            const estimate = typeof r.expectedCost === 'number' ? r.expectedCost : (typeof r.midpoint === 'number' ? r.midpoint : (r.estimatedMin + r.estimatedMax) / 2);
                            const span = r.estimatedMax - r.estimatedMin;
                            const markerPct = span > 0 ? Math.max(0, Math.min(100, ((estimate - r.estimatedMin) / span) * 100)) : 50;
                            // eBay is the only platform that charges the buyer a flat shipping rate.
                            const buyerCost = tabKeyLower === 'ebay' ? Number(tabData?.shippingCost) : NaN;
                            const buyerPays = Number.isFinite(buyerCost) && buyerCost > 0;
                            // Hero shows the number that matters most: the buyer's flat charge if set,
                            // otherwise the seller's estimated cost.
                            const hero = buyerPays ? buyerCost : estimate;
                            return (
                                <View style={s.previewCard}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                        <Text style={s.heroPrice}>{buyerPays ? `$${hero.toFixed(2)}` : `~$${hero.toFixed(2)}`}</Text>
                                        <View style={{ flex: 1 }} />
                                        <View style={s.carrierPill}>
                                            <Truck size={14} color="#6B7280" />
                                            <Text style={s.carrierPillText}>{buyerPays ? 'Buyer pays' : 'USPS Ground'}</Text>
                                        </View>
                                    </View>
                                    <Text style={s.previewSub}>
                                        {buyerPays
                                            ? `Buyer pays this flat rate · ships for ~$${estimate.toFixed(2)} to you`
                                            : `Ships free to buyer · costs you about $${r.estimatedMin.toFixed(0)}–$${r.estimatedMax.toFixed(0)} by destination`}
                                    </Text>
                                    <View style={s.rateBar}>
                                        <View style={[s.rateBarFill, { width: `${markerPct}%` }]} />
                                        <View style={[s.rateBarMarker, { left: `${markerPct}%` }]} />
                                    </View>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                        <Text style={s.rateBarLabel}>${r.estimatedMin.toFixed(0)} low</Text>
                                        <Text style={[s.rateBarLabel, { color: '#5D7E16', fontWeight: '700' }]}>${estimate.toFixed(2)} your cost</Text>
                                        <Text style={s.rateBarLabel}>${r.estimatedMax.toFixed(0)} high</Text>
                                    </View>
                                </View>
                            );
                        })() : (
                            <View style={s.previewCard}>
                                <Text style={{ fontSize: 13, color: '#9CA3AF' }}>Add a weight below to see an estimate.</Text>
                            </View>
                        )}

                        {/* ── OPTIONS — three tappable rows, each opens an inline picker ── */}
                        <Text style={[s.sectionLabel, { marginTop: 22 }]}>Options</Text>
                        <View style={s.optionsCard}>
                            {/* Fulfillment */}
                            <TouchableOpacity style={s.optionRow} activeOpacity={0.7} onPress={() => setExpandedRow((rr) => rr === 'fulfillment' ? null : 'fulfillment')}>
                                <Text style={s.optionLabel}>{tabKeyLower === 'facebook' ? 'Handoff' : 'Fulfillment'}</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={s.optionValue}>{currentDeliveryMethod === 'in_person' ? 'Pickup' : currentDeliveryMethod === 'both' ? 'Both (Ship + Pickup)' : 'Ship'}</Text>
                                <Icon name={expandedRow === 'fulfillment' ? 'chevron-down' : 'chevron-right'} size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                            {expandedRow === 'fulfillment' && (
                                <View style={s.pickerBody}>
                                    <View style={s.methodRow}>
                                        {(['in_person', 'shipping', 'both'] as const).map((method) => {
                                            const isActive = currentDeliveryMethod === method;
                                            const config = { in_person: { label: 'Pickup', IconComp: Car }, shipping: { label: 'Ship', IconComp: Package }, both: { label: 'Both', IconComp: Truck } }[method];
                                            const { IconComp } = config;
                                            return (
                                                <TouchableOpacity key={method} activeOpacity={0.8} style={[s.methodCard, isActive && s.methodCardActive]} onPress={() => handleDeliveryMethodChange(method)}>
                                                    <IconComp size={22} color={isActive ? BRAND_PRIMARY : '#6B7280'} strokeWidth={2} />
                                                    <Text style={[s.methodLabel, isActive && s.methodLabelActive]}>{config.label}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                    {tabKeyLower === 'facebook' && showsPickup && (
                                        <TouchableOpacity activeOpacity={0.8} style={[s.locationCard, { marginTop: 12 }]} onPress={onOpenLocationPicker}>
                                            <View style={s.locationIconBg}><MapPin size={18} color={BRAND_PRIMARY} /></View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={{ color: tabData?.pickupLocation?.locationName ? '#111827' : '#9CA3AF', fontSize: 15, fontWeight: tabData?.pickupLocation?.locationName ? '600' : '400' }}>
                                                    {tabData?.pickupLocation?.locationName || 'Tap to set location…'}
                                                </Text>
                                            </View>
                                            <Icon name="chevron-right" size={20} color="#9CA3AF" />
                                        </TouchableOpacity>
                                    )}
                                    {/* eBay: who pays shipping? Free (ships free — default) vs Buyer pays a flat rate. */}
                                    {tabKeyLower === 'ebay' && showsShipping && (
                                        <View style={{ marginTop: 14 }}>
                                            <Text style={s.dimLabel}>Who pays shipping?</Text>
                                            <View style={[s.methodRow, { marginTop: 6 }]}>
                                                {(['free', 'buyer'] as const).map((payer) => {
                                                    const isActive = shippingPayer === payer;
                                                    return (
                                                        <TouchableOpacity key={payer} activeOpacity={0.8} style={[s.methodCard, { paddingVertical: 12 }, isActive && s.methodCardActive]} onPress={() => handlePayerChange(payer)}>
                                                            <Text style={[s.methodLabel, { marginTop: 0 }, isActive && s.methodLabelActive]}>{payer === 'free' ? 'Free shipping' : 'Buyer pays'}</Text>
                                                        </TouchableOpacity>
                                                    );
                                                })}
                                            </View>
                                            {shippingPayer === 'buyer' && (
                                                <View style={{ marginTop: 12 }}>
                                                    <Text style={[s.dimLabel, { marginBottom: 6 }]}>Flat shipping charge</Text>
                                                    <View style={s.costInputRow}>
                                                        <Text style={s.costPrefix}>$</Text>
                                                        <TextInput
                                                            style={s.costInput}
                                                            value={tabData?.shippingCost != null ? String(tabData.shippingCost) : ''}
                                                            onChangeText={handleShippingCostChange}
                                                            keyboardType="decimal-pad"
                                                            placeholder="0.00"
                                                            placeholderTextColor="#C0C0C0"
                                                        />
                                                    </View>
                                                    <Text style={s.costHint}>Buyers are charged this flat rate at checkout.</Text>
                                                </View>
                                            )}
                                        </View>
                                    )}
                                </View>
                            )}
                            <View style={s.optionDivider} />
                            {/* Package */}
                            <TouchableOpacity style={s.optionRow} activeOpacity={0.7} onPress={() => { if (expandedRow === 'package') { handleRecalculate(); setExpandedRow(null); } else { setExpandedRow('package'); } }}>
                                <Text style={s.optionLabel}>Package</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={s.optionValue} numberOfLines={1}>{dimsSummary || 'Add weight'}</Text>
                                <Icon name={expandedRow === 'package' ? 'chevron-down' : 'chevron-right'} size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                            {expandedRow === 'package' && (
                                <View style={s.pickerBody}>
                                    {tabData?.shippingTierReason ? (
                                        <View style={[s.tierInfoBox, { marginBottom: 12 }]}>
                                            <Scale size={16} color="#6B7280" />
                                            <Text style={{ fontSize: 13, color: '#374151', flex: 1 }}>{tabData.shippingTierReason}</Text>
                                        </View>
                                    ) : null}
                                    <Text style={[s.dimLabel, { marginBottom: 6 }]}>Dimensions (in)</Text>
                                    <View style={s.dimsRow}>
                                        {(['length', 'width', 'height'] as const).map((dim) => (
                                            <View key={dim} style={{ flex: 1 }}>
                                                <Text style={s.dimLabel}>{dim.charAt(0).toUpperCase()}</Text>
                                                <TextInput style={s.dimInput} value={editableDimensions[dim]} onChangeText={(t2) => setEditableDimensions((prev) => ({ ...prev, [dim]: t2 }))} keyboardType="decimal-pad" placeholder="0" placeholderTextColor="#C0C0C0" />
                                            </View>
                                        ))}
                                    </View>
                                    <Text style={[s.dimLabel, { marginTop: 12, marginBottom: 6 }]}>Weight</Text>
                                    <View style={s.weightRow}>
                                        <TextInput style={[s.inputField, { flex: 1 }]} value={editableWeight} onChangeText={setEditableWeight} keyboardType="decimal-pad" placeholder="0.0" placeholderTextColor="#C0C0C0" />
                                        <View style={{ width: 96 }}>
                                            <AppMenuSelect options={['oz', 'lb', 'g', 'kg'].map((u) => ({ label: u, value: u }))} placeholder="lb" value={editableWeightUnit} onChange={(value) => setEditableWeightUnit(value)} menuWidth={120} />
                                        </View>
                                    </View>
                                    <TouchableOpacity style={[s.recalcBtn, { marginTop: 12 }]} onPress={handleRecalculate}>
                                        <RefreshCw size={14} color="#374151" />
                                        <Text style={s.recalcText}>Update estimate</Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                            <View style={s.optionDivider} />
                            {/* Speed — feeds the estimate query (Standard→Ground, Expedited→Expedited) */}
                            <TouchableOpacity style={s.optionRow} activeOpacity={0.7} onPress={() => setExpandedRow((rr) => rr === 'speed' ? null : 'speed')}>
                                <Text style={s.optionLabel}>Speed</Text>
                                <View style={{ flex: 1 }} />
                                <Text style={s.optionValue}>{speed === 'standard' ? 'Standard' : 'Expedited'}</Text>
                                <Icon name={expandedRow === 'speed' ? 'chevron-down' : 'chevron-right'} size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                            {expandedRow === 'speed' && (
                                <View style={s.pickerBody}>
                                    <View style={s.methodRow}>
                                        {(['standard', 'expedited'] as const).map((sp) => {
                                            const isActive = speed === sp;
                                            return (
                                                <TouchableOpacity key={sp} activeOpacity={0.8} style={[s.methodCard, { paddingVertical: 12 }, isActive && s.methodCardActive]} onPress={() => onChangeSpeed(sp)}>
                                                    <Text style={[s.methodLabel, { marginTop: 0 }, isActive && s.methodLabelActive]}>{sp === 'standard' ? 'Standard (2–5 days)' : 'Expedited (1–2 days)'}</Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}
                        </View>

                        {/* ── Done ──────────────────────────────────────────── */}
                        <TouchableOpacity style={[s.doneBtn, { marginTop: 18 }]} onPress={() => { handleRecalculate(); onClose(); }}>
                            <Text style={s.doneText}>Done</Text>
                        </TouchableOpacity>
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

/* ── Styles (Interface-Design Skill: subtle layering, 8px grid, token palette) ── */
const s = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: 34,
        maxHeight: '88%',
    },
    handleBarRow: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
    handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D1D5DB' },
    content: { padding: 20, paddingTop: 4 },

    /* Header */
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    headerIcon: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: 'rgba(147,200,34,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: { fontSize: 19, fontWeight: '700', color: '#111827' },

    /* Tabs */
    tabRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 20,
        paddingBottom: 4,
    },
    tab: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1.5,
        borderColor: '#E5E7EB',
        backgroundColor: '#F9FAFB',
    },
    tabActive: {
        borderColor: BRAND_PRIMARY,
        backgroundColor: 'rgba(147,200,34,0.08)',
    },
    tabText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
    tabTextActive: { color: '#3f6212', fontWeight: '700' },

    /* Section label */
    sectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: '#374151',
        marginBottom: 8,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },

    /* Method selector */
    methodRow: { flexDirection: 'row', gap: 10 },
    methodCard: {
        flex: 1,
        backgroundColor: '#F9FAFB',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: '#E5E7EB',
    },
    methodCardActive: {
        borderColor: BRAND_PRIMARY,
        backgroundColor: 'rgba(147,200,34,0.08)',
    },
    methodLabel: { marginTop: 8, color: '#374151', fontSize: 13, fontWeight: '600' },
    methodLabelActive: { color: BRAND_PRIMARY, fontWeight: '700' },

    /* Location card */
    locationCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 16,
        paddingHorizontal: 16,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
    },
    locationIconBg: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(147,200,34,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
    },

    /* Input */
    inputField: {
        borderWidth: 1,
        borderColor: '#E5E7EB',
        padding: 12,
        borderRadius: 10,
        fontSize: 14,
        backgroundColor: '#fff',
        color: '#111827',
        height: 44,
    },

    /* Tier info */
    tierInfoBox: {
        backgroundColor: '#F9FAFB',
        borderRadius: 10,
        padding: 12,
        marginBottom: 4,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },

    /* Dimensions */
    dimsRow: { flexDirection: 'row', gap: 8 },
    dimLabel: {
        fontSize: 10,
        color: '#6B7280',
        marginBottom: 4,
        textTransform: 'uppercase',
        fontWeight: '600',
    },
    dimInput: {
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 10,
        padding: 10,
        fontSize: 14,
        backgroundColor: '#fff',
        color: '#111827',
        textAlign: 'center',
        height: 44,
    },

    /* Weight */
    weightRow: { flexDirection: 'row', gap: 8 },

    /* eBay flat shipping charge input */
    costInputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 10,
        backgroundColor: '#fff',
        paddingHorizontal: 12,
        height: 44,
    },
    costPrefix: { fontSize: 15, fontWeight: '700', color: '#6B7280', marginRight: 4 },
    costInput: { flex: 1, fontSize: 15, color: '#111827', height: 44 },
    costHint: { fontSize: 11, color: '#9CA3AF', marginTop: 6 },

    /* Action buttons */
    recalcBtn: {
        backgroundColor: '#F3F4F6',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    recalcText: { fontSize: 13, fontWeight: '600', color: '#374151' },
    doneBtn: {
        backgroundColor: BRAND_PRIMARY,
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    doneText: { fontSize: 14, fontWeight: '700', color: '#fff' },

    /* ── PREVIEW cost-hero ── */
    previewCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 18, padding: 18, gap: 12 },
    heroPrice: { fontSize: 34, fontWeight: '800', color: '#18181B', letterSpacing: -0.5 },
    carrierPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F3F4F6', borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 },
    carrierPillText: { fontSize: 13, fontWeight: '600', color: '#3F3F46' },
    previewSub: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
    rateBar: { height: 8, borderRadius: 4, backgroundColor: '#F3F4F6', position: 'relative', justifyContent: 'center' },
    rateBarFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(147,200,34,0.30)', borderRadius: 4 },
    rateBarMarker: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: '#93C822', borderWidth: 2, borderColor: '#FFFFFF', marginLeft: -7 },
    rateBarLabel: { fontSize: 11, fontWeight: '600', color: '#9CA3AF' },

    /* ── OPTIONS rows ── */
    optionsCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 16, overflow: 'hidden' },
    optionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15, paddingHorizontal: 16 },
    optionLabel: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
    optionValue: { fontSize: 14, fontWeight: '600', color: '#18181B', maxWidth: 190 },
    optionDivider: { height: 1, backgroundColor: '#F1F2F4' },
    pickerBody: { paddingHorizontal: 16, paddingBottom: 16, paddingTop: 2 },
});
