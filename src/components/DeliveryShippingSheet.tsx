/**
 * DeliveryShippingSheet – A unified bottom sheet for Delivery & Shipping configuration.
 *
 * Merges two previously separate UIs:
 *   1. Shipping estimation modal (dimensions, weight, USPS/carrier rate cards)
 *   2. Fulfillment BaseModal (delivery method selector, pickup location, flat rate cost)
 *
 * Features:
 * - Platform tabs to switch between connected shipping-capable platforms
 * - Delivery method selector (Pickup / Shipping / Both) per platform
 * - Collapsible accordion sections for flat rate, dimensions/weight, and rate estimates
 * - Facebook pickup location trigger
 * - eBay flat rate cost input
 * - Preferences persist via AsyncStorage across new items
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { AppDropdown } from './ui/AppDropdown';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* ── SVG logos ──────────────────────────────────────────────── */
import ShopifySvg from '../assets/shopify.svg';
import EbaySvg from '../assets/ebay.svg';
import FacebookSvg from '../assets/facebook.svg';

const PLATFORM_LOGOS: Record<string, any> = {
    shopify: ShopifySvg,
    ebay: EbaySvg,
    facebook: FacebookSvg,
};

const PLATFORM_LABELS: Record<string, string> = {
    shopify: 'Shopify',
    ebay: 'eBay',
    facebook: 'Facebook',
};

/* Platforms that support shipping / delivery settings */
const SHIPPING_PLATFORMS = new Set(['ebay', 'facebook', 'shopify']);

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
    /** Mutators */
    patchField: (key: string, value: any) => void;
    patchPlatform: (updater: (prev: any) => any) => void;
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
    patchField,
    patchPlatform,
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

    // Sync selectedTab when the sheet opens
    useEffect(() => {
        if (visible) {
            const preferred = shippingCapablePlatforms.includes(activePlatformKey.toLowerCase())
                ? activePlatformKey.toLowerCase()
                : shippingCapablePlatforms[0] || '';
            setSelectedTab(preferred);
        }
    }, [visible, activePlatformKey, shippingCapablePlatforms]);

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
                        if (!data.deliveryMethod && pref.deliveryMethod) {
                            nextPlatforms[pk] = { ...data, deliveryMethod: pref.deliveryMethod };
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

    /* ── Recalculate handler ──────────────────────────────────── */
    const handleRecalculate = () => {
        const w = parseFloat(editableWeight);
        const l = parseFloat(editableDimensions.length);
        const wd = parseFloat(editableDimensions.width);
        const h = parseFloat(editableDimensions.height);
        const hasValidDims = Number.isFinite(l) && Number.isFinite(wd) && Number.isFinite(h);
        if (Number.isFinite(w) && w > 0) {
            patchField('weight', editableWeight);
            patchField('weightUnit', editableWeightUnit);
        }
        if (hasValidDims) {
            patchPlatform((prev: any) => ({
                ...prev,
                estimatedDimensions: { length: l, width: wd, height: h, unit: 'in' },
            }));
        }
        // Immediate fetch with editable values so user sees result in sheet without waiting for debounce
        if (Number.isFinite(w) && w > 0) {
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
                                    <Truck size={20} color="#93C822" />
                                </View>
                                <Text style={s.headerTitle}>Delivery & Shipping</Text>
                            </View>
                            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <X size={22} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        {/* Platform Tabs */}
                        {shippingCapablePlatforms.length > 1 && (
                            <View style={s.tabRow}>
                                {shippingCapablePlatforms.map((pk) => {
                                    const isActive = pk.toLowerCase() === selectedTab.toLowerCase();
                                    const Logo = PLATFORM_LOGOS[pk.toLowerCase()];
                                    return (
                                        <TouchableOpacity
                                            key={pk}
                                            onPress={() => setSelectedTab(pk.toLowerCase())}
                                            activeOpacity={0.75}
                                            style={[s.tab, isActive && s.tabActive]}
                                        >
                                            {Logo && <Logo width={18} height={18} />}
                                            <Text style={[s.tabText, isActive && s.tabTextActive]}>
                                                {PLATFORM_LABELS[pk.toLowerCase()] || pk}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}

                        {/* ── Delivery Method Selector ──────────────────── */}
                        <Text style={s.sectionLabel}>
                            {tabKeyLower === 'facebook' ? 'Handoff Method' : 'Fulfillment Method'}
                        </Text>
                        <View style={s.methodRow}>
                            {(['in_person', 'shipping', 'both'] as const).map((method) => {
                                const isActive = currentDeliveryMethod === method;
                                const config = {
                                    in_person: { label: 'Pickup', IconComp: Car },
                                    shipping: { label: 'Shipping', IconComp: Package },
                                    both: { label: 'Both', IconComp: Truck },
                                }[method];
                                const { IconComp } = config;
                                return (
                                    <TouchableOpacity
                                        key={method}
                                        activeOpacity={0.8}
                                        style={[s.methodCard, isActive && s.methodCardActive]}
                                        onPress={() => handleDeliveryMethodChange(method)}
                                    >
                                        <IconComp size={24} color={isActive ? '#93C822' : '#6B7280'} strokeWidth={2} />
                                        <Text
                                            style={[s.methodLabel, isActive && s.methodLabelActive]}
                                        >
                                            {config.label}
                                        </Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>

                        {/* ── Facebook: Pickup Location ──────────────────── */}
                        {tabKeyLower === 'facebook' && showsPickup && (
                            <View style={{ marginTop: 20 }}>
                                <Text style={s.sectionLabel}>Pickup Location</Text>
                                <TouchableOpacity
                                    activeOpacity={0.8}
                                    style={s.locationCard}
                                    onPress={onOpenLocationPicker}
                                >
                                    <View style={s.locationIconBg}>
                                        <MapPin size={18} color="#93C822" />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={{
                                                color: tabData?.pickupLocation?.locationName ? '#111827' : '#9CA3AF',
                                                fontSize: 15,
                                                fontWeight: tabData?.pickupLocation?.locationName ? '600' : '400',
                                            }}
                                        >
                                            {tabData?.pickupLocation?.locationName || 'Tap to set location…'}
                                        </Text>
                                        {tabData?.pickupLocation?.locationName && (
                                            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                                                {tabData.pickupLocation.latitude?.toFixed(4)},{' '}
                                                {tabData.pickupLocation.longitude?.toFixed(4)}
                                            </Text>
                                        )}
                                    </View>
                                    <View style={{ backgroundColor: '#F3F4F6', padding: 6, borderRadius: 8 }}>
                                        <Icon name="chevron-right" size={20} color="#9CA3AF" />
                                    </View>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* ── eBay: Flat Rate Shipping Cost (accordion) ─── */}
                        {tabKeyLower === 'ebay' && showsShipping && (
                            <AccordionSection
                                title="Flat Rate Shipping Cost"
                                summaryText={tabData?.shippingCost ? `$${tabData.shippingCost}` : 'Not set'}
                            >
                                <TextInput
                                    style={s.inputField}
                                    value={String(tabData?.shippingCost ?? '')}
                                    onChangeText={(t) => {
                                        const next = { ...platforms };
                                        next[selectedTab] = { ...(next[selectedTab] || {}), shippingCost: t };
                                        onChangePlatforms(next);
                                        setTimeout(() => persistPrefs(), 100);
                                    }}
                                    placeholder="e.g. 5.99"
                                    placeholderTextColor="#9CA3AF"
                                    keyboardType="decimal-pad"
                                />
                            </AccordionSection>
                        )}

                        {/* ── Package Dimensions & Weight (accordion) ───── */}
                        {(showsShipping || tabKeyLower === 'shopify') && (
                            <>
                                {/* Tier info — always visible */}
                                {tabData?.shippingTierReason && (
                                    <View style={[s.tierInfoBox, { marginTop: 16 }]}>
                                        <Scale size={16} color="#6B7280" />
                                        <Text style={{ fontSize: 13, color: '#374151', flex: 1 }}>{tabData.shippingTierReason}</Text>
                                    </View>
                                )}

                                <AccordionSection
                                    title="Package Dimensions & Weight"
                                    summaryText={dimsSummary}
                                >
                                    <Text style={[s.sectionLabel, { marginBottom: 6 }]}>Dimensions (in)</Text>
                                    <View style={s.dimsRow}>
                                        {(['length', 'width', 'height'] as const).map((dim) => (
                                            <View key={dim} style={{ flex: 1 }}>
                                                <Text style={s.dimLabel}>{dim.charAt(0).toUpperCase()}</Text>
                                                <TextInput
                                                    style={s.dimInput}
                                                    value={editableDimensions[dim]}
                                                    onChangeText={(t) => setEditableDimensions((prev) => ({ ...prev, [dim]: t }))}
                                                    keyboardType="decimal-pad"
                                                    placeholder="0"
                                                    placeholderTextColor="#C0C0C0"
                                                />
                                            </View>
                                        ))}
                                    </View>

                                    <Text style={[s.sectionLabel, { marginTop: 14, marginBottom: 6 }]}>Weight</Text>
                                    <View style={s.weightRow}>
                                        <TextInput
                                            style={[s.inputField, { flex: 1 }]}
                                            value={editableWeight}
                                            onChangeText={setEditableWeight}
                                            keyboardType="decimal-pad"
                                            placeholder="0.0"
                                            placeholderTextColor="#C0C0C0"
                                        />
                                        <View style={{ width: 80 }}>
                                            <AppDropdown
                                                style={[s.inputField, { paddingHorizontal: 10 }]}
                                                data={['oz', 'lb', 'g', 'kg'].map((u) => ({ label: u, value: u }))}
                                                placeholder="lb"
                                                value={editableWeightUnit}
                                                onChange={(item: any) => setEditableWeightUnit(item.value)}
                                            />
                                        </View>
                                    </View>

                                    {/* Calculate / Recalculate button inside accordion */}
                                    <TouchableOpacity style={[s.recalcBtn, { marginTop: 12 }]} onPress={handleRecalculate}>
                                        <RefreshCw size={14} color="#374151" />
                                        <Text style={s.recalcText}>
                                            {shippingEstimateResult && !shippingEstimateResult.error ? 'Recalculate' : 'Calculate'}
                                        </Text>
                                    </TouchableOpacity>
                                </AccordionSection>

                                {/* ── Shipping Rate Estimates (accordion) ────── */}
                                <AccordionSection
                                    title="Estimated Shipping Rates"
                                    summaryText={rateSummary}
                                    defaultOpen={!!shippingEstimateResult && !shippingEstimateResult.error}
                                >
                                    {shippingEstimateLoading ? (
                                        <View style={s.loadingRow}>
                                            <ActivityIndicator size="small" color="#93C822" />
                                            <Text style={{ fontSize: 13, color: '#6B7280' }}>Calculating rates…</Text>
                                        </View>
                                    ) : shippingEstimateResult &&
                                        typeof shippingEstimateResult.estimatedMin === 'number' &&
                                        !shippingEstimateResult.error ? (
                                        <View style={s.ratesContainer}>
                                            {/* USPS Ground - show typical + range */}
                                            <View style={[s.rateCard, s.rateCardActive]}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                    <Truck size={18} color="#93C822" />
                                                    <View>
                                                        <Text style={s.rateCarrier}>USPS Ground</Text>
                                                        <Text style={s.rateSpeed}>3–7 business days</Text>
                                                    </View>
                                                </View>
                                                <View style={{ alignItems: 'flex-end' }}>
                                                    {typeof shippingEstimateResult.expectedCost === 'number' ? (
                                                        <>
                                                            <Text style={s.ratePrice}>~${shippingEstimateResult.expectedCost.toFixed(2)} typical</Text>
                                                            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                                                                Range: ${shippingEstimateResult.estimatedMin.toFixed(2)}–${shippingEstimateResult.estimatedMax.toFixed(2)}
                                                            </Text>
                                                        </>
                                                    ) : (
                                                        <Text style={s.ratePrice}>
                                                            ${shippingEstimateResult.estimatedMin.toFixed(2)}–$
                                                            {shippingEstimateResult.estimatedMax.toFixed(2)}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>

                                            {/* USPS Priority (placeholder) */}
                                            <View style={[s.rateCard, s.rateCardDisabled]}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                    <Package size={18} color="#6B7280" />
                                                    <View>
                                                        <Text style={s.rateCarrier}>USPS Priority</Text>
                                                        <Text style={s.rateSpeed}>1–3 business days</Text>
                                                    </View>
                                                </View>
                                                <Text style={{ fontSize: 13, color: '#9CA3AF' }}>Coming soon</Text>
                                            </View>

                                            {/* UPS Ground (placeholder) */}
                                            <View style={[s.rateCard, s.rateCardDisabled]}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                    <Package size={18} color="#6B7280" />
                                                    <View>
                                                        <Text style={s.rateCarrier}>UPS Ground</Text>
                                                        <Text style={s.rateSpeed}>5–7 business days</Text>
                                                    </View>
                                                </View>
                                                <Text style={{ fontSize: 13, color: '#9CA3AF' }}>Coming soon</Text>
                                            </View>
                                        </View>
                                    ) : (
                                        <Text style={{ fontSize: 13, color: '#9CA3AF', paddingVertical: 8 }}>
                                            Set package dimensions and weight, then calculate to see rates.
                                        </Text>
                                    )}
                                </AccordionSection>
                            </>
                        )}

                        {/* ── Done Button ──────────────────────────────── */}
                        <View style={s.actionRow}>
                            <TouchableOpacity style={s.doneBtn} onPress={onClose}>
                                <Text style={s.doneText}>Done</Text>
                            </TouchableOpacity>
                        </View>
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
        borderColor: '#93C822',
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
        borderColor: '#93C822',
        backgroundColor: 'rgba(147,200,34,0.08)',
    },
    methodLabel: { marginTop: 8, color: '#374151', fontSize: 13, fontWeight: '600' },
    methodLabelActive: { color: '#93C822', fontWeight: '700' },

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

    /* Loading */
    loadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 16,
    },

    /* Rate cards */
    ratesContainer: {
        borderRadius: 12,
    },
    rateCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 14,
        borderWidth: 1,
        marginBottom: 8,
    },
    rateCardActive: {
        borderColor: '#93C822',
    },
    rateCardDisabled: {
        borderColor: '#E5E7EB',
        opacity: 0.55,
    },
    rateCarrier: { fontSize: 14, fontWeight: '600', color: '#111827' },
    rateSpeed: { fontSize: 11, color: '#6B7280', marginTop: 1 },
    ratePrice: { fontSize: 16, fontWeight: '700', color: '#111827' },

    /* Action buttons */
    actionRow: {
        marginTop: 24,
    },
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
        backgroundColor: '#93C822',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
    },
    doneText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
