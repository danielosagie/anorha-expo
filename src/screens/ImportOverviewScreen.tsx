import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Alert,
    ActivityIndicator,
    Platform,
    Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { ArrowRight, Boxes, Check, CheckCircle2, ChevronLeft, Settings2, Sparkles, Store, type LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import EbaySvg from '../assets/ebay.svg';
import FacebookSvg from '../assets/facebook.svg';
import AmazonSvg from '../assets/amazon.svg';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type ImportOverviewRouteProp = RouteProp<AppStackParamList, 'ImportOverview'>;
type ImportOverviewNavProp = StackNavigationProp<AppStackParamList, 'ImportOverview'>;

const platformSvgMap: Record<string, React.ComponentType<any>> = {
    shopify: ShopifySvg,
    square: SquareSvg,
    clover: CloverSvg,
    ebay: EbaySvg,
    facebook: FacebookSvg,
    amazon: AmazonSvg,
};

const getPlatformLogoComponent = (name: string): React.ComponentType<any> | null => {
    const n = (name || '').toLowerCase();
    const match = Object.entries(platformSvgMap).find(([key]) => n.includes(key));
    return match?.[1] || null;
};

const formatCount = (count: number, singular: string, plural?: string) => {
    const label = count === 1 ? singular : (plural || `${singular}s`);
    return `${count} ${label}`;
};

// ---------------------------------------------------------------------------
// Checklist Row — rounded action card
// ---------------------------------------------------------------------------
interface ChecklistRowProps {
    icon: LucideIcon;
    iconTint: string;
    title: string;
    subtitle: string;
    statusText?: string;
    statusColor?: string;
    details?: string;
    done?: boolean;
    onPress: () => void;
}

const ChecklistRow: React.FC<ChecklistRowProps> = ({
    icon,
    iconTint,
    title,
    subtitle,
    statusText,
    statusColor,
    details,
    done,
    onPress,
}) => {
    const theme = useTheme();
    const IconComponent = icon;

    return (
        <TouchableOpacity
            style={[
                rowStyles.row,
                {
                    backgroundColor: theme.colors.surface || '#FFFFFF',
                    borderColor: done ? `${theme.colors.text}14` : '#E5E7EB',
                    opacity: done ? 0.5 : 1,
                },
            ]}
            onPress={onPress}
            activeOpacity={0.85}
        >
            <View
                style={[
                    rowStyles.iconCircle,
                    { backgroundColor: done ? theme.colors.text : `${iconTint}14` },
                ]}
            >
                {done ? (
                    <Check size={20} color="#fff" strokeWidth={2.5} />
                ) : (
                    <IconComponent size={20} color={iconTint} strokeWidth={2.2} />
                )}
            </View>
            <View style={rowStyles.copyWrap}>
                <Text style={[rowStyles.title, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                    {title}
                </Text>
                <Text style={[rowStyles.subtitle, { color: theme.colors.text }]} numberOfLines={2}>
                    {subtitle}
                    {!done && statusText ? (
                        <Text style={[rowStyles.statusText, { color: statusColor || theme.colors.textSecondary }]}>
                            {statusText}
                        </Text>
                    ) : null}
                </Text>
                {details ? (
                    <Text style={[rowStyles.details, { color: theme.colors.textSecondary }]} numberOfLines={2}>
                        {details}
                    </Text>
                ) : null}
            </View>
            <View
                style={[
                    rowStyles.trailingBadge,
                    {
                        backgroundColor: done ? `${theme.colors.text}10` : '#F8FAFC',
                        borderColor: done ? `${theme.colors.text}12` : '#E5E7EB',
                    },
                ]}
            >
                {done ? (
                    <CheckCircle2 size={18} color={theme.colors.text} strokeWidth={2.4} />
                ) : (
                    <ArrowRight size={18} color={theme.colors.textSecondary} strokeWidth={2.2} />
                )}
            </View>
        </TouchableOpacity>
    );
};

const rowStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 24,
        marginBottom: 14,
        paddingVertical: 18,
        paddingHorizontal: 18,
        borderWidth: 1,
        borderRadius: 28,
    },
    iconCircle: {
        width: 52,
        height: 52,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    copyWrap: {
        flex: 1,
        paddingRight: 12,
    },
    title: {
        fontSize: 12,
        lineHeight: 16,
        fontFamily: 'PlusJakartaSans_500Medium',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    subtitle: {
        marginTop: 6,
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'PlusJakartaSans_700Bold',
    },
    statusText: {
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'PlusJakartaSans_700Bold',
    },
    details: {
        marginTop: 6,
        fontSize: 14,
        lineHeight: 20,
        fontFamily: 'PlusJakartaSans_500Medium',
    },
    trailingBadge: {
        width: 38,
        height: 38,
        borderRadius: 19,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});



// ---------------------------------------------------------------------------
// Platform hero helpers
// ---------------------------------------------------------------------------
const getPlatformColor = (name: string): string => {
    const n = (name || '').toLowerCase();
    if (n.includes('shopify')) return '#96BF47';
    if (n.includes('square')) return '#3E4348';
    if (n.includes('clover')) return '#27AE60';
    if (n.includes('ebay')) return '#0064D2';
    if (n.includes('amazon')) return '#FF9900';
    if (n.includes('facebook')) return '#1877F2';
    return '#6B7280';
};

const ImportOverviewScreen = () => {
    const theme = useTheme();
    const route = useRoute<ImportOverviewRouteProp>();
    const navigation = useNavigation<ImportOverviewNavProp>();
    const insets = useSafeAreaInsets();

    const { connectionId, platformName } = route.params as any;
    const platformColor = getPlatformColor(platformName);

    const session = useImportSession({
        connectionId,
        platformName,
        onNavigate: (screen, params) => navigation.navigate(screen as any, params),
    });

    const {
        loading,
        totalScanned,
        matchedCount,
        reviewCount,
        mappingDone,
        settingsDone,
        syncDirection,
        poolName,
        setWizardVisible,
        submitImport,
        isSubmitting,
        counts,
        connection,
        refreshSuggestions,
    } = session;

    // Optimizer counts (separate from mapping - ProductVariants quality)
    const [optimizeCount, setOptimizeCount] = useState(0);
    const [missingPhotoCount, setMissingPhotoCount] = useState(0);
    const [missingDataCount, setMissingDataCount] = useState(0);

    const fetchOptimizerCounts = useCallback(async () => {
        const { data: variants, error } = await supabase
            .from('ProductVariants')
            .select('Id, Sku, Title, Description, ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)')
            .limit(200);
        if (!error && variants) {
            let needsOptimize = 0;
            let photosNeeded = 0;
            let productDataNeeded = 0;
            for (const v of variants) {
                const noImages = !v.ProductImages || (v.ProductImages as any[]).length === 0;
                const noSku = !v.Sku || v.Sku.trim() === '';
                const weakDescription = !v.Description || v.Description.length < 30;
                if (noImages) photosNeeded += 1;
                if (noSku || weakDescription) productDataNeeded += 1;
                if (noImages || noSku || weakDescription) needsOptimize += 1;
            }
            setOptimizeCount(needsOptimize);
            setMissingPhotoCount(photosNeeded);
            setMissingDataCount(productDataNeeded);
        }
    }, []);

    useEffect(() => {
        fetchOptimizerCounts();
    }, [fetchOptimizerCounts]);

    useEffect(() => {
        const unsub = navigation.addListener('focus', () => {
            session.refreshSuggestions();
            fetchOptimizerCounts();
        });
        return unsub;
    }, [navigation, refreshSuggestions, fetchOptimizerCounts]);

    const optimizerDone = optimizeCount === 0;
    const canComplete = mappingDone && settingsDone && optimizerDone;
    const PlatformLogo = getPlatformLogoComponent(platformName);

    const handleCompleteImport = () => {
        if (!canComplete) return;
        Alert.alert(
            'Complete Import',
            `Start syncing ${totalScanned} products with ${platformName}?`,
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', style: 'default', onPress: () => submitImport() },
            ]
        );
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    if (loading) {
        return (
            <View style={[s.container, { backgroundColor: theme.colors.background, justifyContent: 'center', alignItems: 'center' }]}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={[s.backBtnOverlay, { top: insets.top + 8, position: 'absolute', zIndex: 10 }]}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                    <ChevronLeft size={18} color={theme.colors.text} strokeWidth={2.4} />
                    <Text style={[s.backBtnText, { color: theme.colors.text }]}>Back</Text>
                </TouchableOpacity>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={{ color: theme.colors.textSecondary, marginTop: 12 }}>Loading import data…</Text>
            </View>
        );
    }

    return (
        <View style={[s.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView
                contentContainerStyle={{ flexGrow: 1 }}
                showsVerticalScrollIndicator={false}
                bounces={false}
                style={{ borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden' }}
            >
                {/* ── Hero Banner ── */}
                <View style={[s.heroBanner, { paddingTop: insets.top, marginBottom: 0 }]}>
                    {/* Oversized background circle for soft curved bottom */}
                    <View style={[s.curvedBg, { backgroundColor: `${platformColor}1A` }]}>
                        <LinearGradient
                            colors={[`#ffffff00`, `${platformColor}0F`, `${platformColor}20`]}
                            style={StyleSheet.absoluteFillObject}
                        />
                    </View>

                    {/* Back button — overlaid top-left */}
                    <TouchableOpacity
                        onPress={() => navigation.goBack()}
                        style={[s.backBtnOverlay, { top: insets.top + 8 }]}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                    >
                        <ChevronLeft size={18} color={theme.colors.text} strokeWidth={2.4} />
                        <Text style={[s.backBtnText, { color: theme.colors.text }]}>Back</Text>
                    </TouchableOpacity>

                    {/* Hero content — platform logo and total items */}
                    <View style={s.heroContent}>
                        <View style={[s.heroPlatformBadge, { backgroundColor: platformColor, shadowColor: platformColor }]}>
                            <View style={s.heroPlatformBadgeInner}>
                                {PlatformLogo ? (
                                    <PlatformLogo width={42} height={42} />
                                ) : (
                                    <Store size={36} color={platformColor} strokeWidth={2.2} />
                                )}
                            </View>
                        </View>

                        <Text style={s.heroTotalItems}>
                            {totalScanned} Total Items
                        </Text>
                    </View>
                </View>
                
                <View style={{ backgroundColor: "#FFF", borderTopLeftRadius: 32, borderTopRightRadius: 32, overflow: 'hidden', marginTop: -20 }}>

                    {/* ── Welcome Title ── */}
                    <View style={s.titleSection}>
                        <Text style={[s.welcomeTitle, { color: theme.colors.text }]}>
                            Import from {platformName}
                        </Text>
                    </View>

                    {/* ── Checklist Rows ── */}
                    <View style={s.checklistSection}>
                        <ChecklistRow
                            icon={Boxes}
                            iconTint={theme.colors.primary}
                            title="Mapping Review"
                            subtitle="Link each imported item to the right catalog product."
                            statusText={reviewCount > 0 ? ` (Need to map ${formatCount(reviewCount, 'item')})` : undefined}
                            statusColor="#EF4444"
                            details={
                                mappingDone
                                    ? `${formatCount(totalScanned, 'item')} ready to sync`
                                    : `${formatCount(matchedCount, 'item')} already matched`
                            }
                            done={mappingDone}
                            onPress={() =>
                                navigation.navigate('MappingReview', {
                                    connectionId,
                                    platformName,
                                })
                            }
                        />

                        <ChecklistRow
                            icon={Sparkles}
                            iconTint="#F59E0B"
                            title="Listing Optimization"
                            subtitle="Fill in missing photos and product data before this import goes live."
                            statusText={optimizeCount > 0 ? ` (Optimize ${formatCount(optimizeCount, 'item')})` : undefined}
                            statusColor="#F59E0B"
                            details={
                                optimizerDone
                                    ? 'All listings have the photos and product data they need'
                                    : `${formatCount(missingPhotoCount, 'photo')} needed, data for ${formatCount(missingDataCount, 'item')} needed`
                            }
                            done={optimizerDone}
                            onPress={() => navigation.navigate('BackfillOptimizer', { source: 'import' })}
                        />

                        <ChecklistRow
                            icon={Settings2}
                            iconTint={platformColor}
                            title="Import Settings"
                            subtitle="Choose the import direction, pool assignment, and sync behavior."
                            statusText={!settingsDone ? ' (Finish setup)' : undefined}
                            statusColor={platformColor}
                            details={
                                settingsDone
                                    ? `${syncDirection} • ${poolName}`
                                    : 'Open the setup wizard to finish your import configuration'
                            }
                            done={settingsDone}
                            onPress={() => {
                                session.setWizardStep(0);
                                setWizardVisible(true);
                            }}
                            />
                        </View>

                        {/* Spacer */}
                        <View style={{ flex: 1 }} />
                    </View>
            </ScrollView>

            {/* ── Bottom CTA ── */}
            <View style={[s.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
                <TouchableOpacity
                    style={[
                        s.completeBtn,
                        { backgroundColor: canComplete ? theme.colors.text : theme.colors.text },
                        !canComplete && { opacity: 0.35 },
                    ]}
                    onPress={handleCompleteImport}
                    disabled={!canComplete || isSubmitting}
                    activeOpacity={0.8}
                >
                    {isSubmitting ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <Text style={s.completeBtnText}>
                            {canComplete ? 'Complete Import' : 'Complete Import'}
                        </Text>
                    )}
                </TouchableOpacity>
            
            </View>

            <ImportWizardSheet
                visible={session.wizardVisible}
                onClose={() => session.setWizardVisible(false)}
                platformName={platformName}
                connection={connection}
                counts={counts}
                session={session}
                showReselectMatches={false}
            />
        </View>
    );
};

const s = StyleSheet.create({
    container: { flex: 1 },

    // ── Hero ──
    heroBanner: {
        width: '100%',
        minHeight: 200,
        position: 'relative',
    },
    curvedBg: {
        position: 'absolute',
        top: -(SCREEN_WIDTH * 1.5) + 230,
        left: -(SCREEN_WIDTH * 0.25),
        width: SCREEN_WIDTH * 1.5,
        height: SCREEN_WIDTH * 1.65,
        overflow: 'hidden',
    },
    backBtnOverlay: {
        position: 'absolute',
        left: 16,
        zIndex: 99,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        height: 42,
        borderRadius: 21,
        backgroundColor: 'rgba(255,255,255,0.95)',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6 },
            android: { elevation: 10 },
        }),
    },
    backBtnText: {
        fontSize: 14,
        lineHeight: 18,
        fontFamily: 'PlusJakartaSans_500Medium',
    },
    heroContent: {
        alignItems: 'center',
        paddingTop: 40,
        paddingHorizontal: 24,
        paddingBottom: 36,
    },
    heroPlatformBadge: {
        width: 92,
        height: 92,
        borderRadius: 46,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
    },
    heroPlatformBadgeInner: {
        width: 72,
        height: 72,
        borderRadius: 42,
        backgroundColor: '#FFFFFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    heroTotalItems: {
        fontSize: 16,
        fontFamily: 'PlusJakartaSans_500Medium',
        color: '#6B7280',
        letterSpacing: 0.5,
        marginBottom: 20,
    },

    // ── Title ──
    titleSection: {
        minWidth: "90%",
        paddingHorizontal: 24,
        paddingTop: 32,
        paddingBottom: 8,
        justifyContent: 'center',
    },
    welcomeTitle: {
        fontSize: 28,
        fontFamily: 'PlusJakartaSans_700Bold',
        letterSpacing: -0.3,
        lineHeight: 36,
        textAlign: "center"
    },

    // ── Checklist ──
    checklistSection: {
        paddingTop: 12,
        paddingBottom: 8,
    },

    // ── Bottom ──
    bottomBar: {
        paddingHorizontal: 24,
        paddingTop: 12,
    },
    completeBtn: {
        height: 54,
        borderRadius: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    completeBtnText: {
        color: '#fff',
        fontSize: 17,
        fontFamily: 'PlusJakartaSans_700Bold',
        letterSpacing: 0.2,
    },
});

export default ImportOverviewScreen;
