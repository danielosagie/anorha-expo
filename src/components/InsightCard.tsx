import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Linking, ActivityIndicator, Image, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInUp } from 'react-native-reanimated';

// Define Prop Interfaces locally to avoid dependency loops, or import if shared properly
export interface InsightMetric {
    label: string;
    value: string;
    trend?: 'up' | 'down' | 'neutral';
    color?: string;
}

export interface InsightAction {
    label: string;
    link: string;
}

export interface DashboardInsight {
    topDIN: {
        category: string;
        headline: string;
    };
    bottomDIN: {
        title: string;
        description: string;
        metrics?: InsightMetric[];
        action?: InsightAction;
        footer?: string;
        affectedProducts?: Array<{
            id: string;
            name: string;
            sku?: string;
            quantity: number;
            price: number;
            daysSinceSale?: number;
            estimatedValue?: number;
            suggestedPrice?: number;
            discountPercent?: number;
        }>;
    };
    severity: 'good' | 'neutral' | 'warning' | 'critical';
    timestamp?: string;
    reasoning?: string;
    sources?: Array<{
        type: 'database' | 'web';
        title?: string;
        url?: string;
        snippet?: string;
        query?: string; // SQL query for database sources
    }>;
    suggestionOnly?: boolean;
    suggestionText?: string;
    timeframe?: 'short_term' | 'medium_term' | 'long_term';
    insights?: DashboardInsight[];
    // Confidence and transparency
    confidence?: 'high' | 'medium' | 'low';
    confidenceReasons?: string[];
    caveats?: string[];
}

interface InsightCardProps {
    insight: DashboardInsight | null;
    loading: boolean;
    error: string | null;
    onAction: (link: string, title?: string) => void;
    onRefresh: () => void;
    onFeedback?: (feedback: 'up' | 'down', insightHeadline: string) => void;
    cacheExpiresAt?: string; // ISO timestamp when insight cache expires (for refresh timer)
}

const InsightCard: React.FC<InsightCardProps> = ({ insight, loading, error, onAction, onRefresh, onFeedback, cacheExpiresAt }) => {
    const [sourcesVisible, setSourcesVisible] = useState(false);
    const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);
    const [copied, setCopied] = useState(false);

    // Copy insight + sources to clipboard
    const handleCopy = useCallback(async () => {
        if (!insight) return;

        const { topDIN, bottomDIN, reasoning, sources } = insight;

        // Build copy text with insight details and sources
        let copyText = `📊 ${topDIN.headline}\n\n`;
        copyText += `${bottomDIN.description}\n\n`;

        if (bottomDIN.affectedProducts?.length) {
            copyText += `📦 Products:\n`;
            bottomDIN.affectedProducts.forEach(p => {
                copyText += `• ${p.name} (${p.sku}) - ${p.quantity} units @ $${p.price}\n`;
                if (p.suggestedPrice) copyText += `  → Suggested: $${p.suggestedPrice} (${p.discountPercent}% off)\n`;
            });
            copyText += `\n`;
        }

        if (reasoning) {
            copyText += `💡 Why: ${reasoning}\n\n`;
        }

        if (sources?.length) {
            copyText += `📚 Sources:\n`;
            sources.forEach(s => {
                if (s.type === 'web' && s.url) {
                    copyText += `• ${s.title || 'Web'}: ${s.url}\n`;
                } else if (s.type === 'database') {
                    copyText += `• Database query (${s.query?.slice(0, 50)}...)\n`;
                }
            });
        }

        await Clipboard.setStringAsync(copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [insight]);

    // Handle thumbs feedback
    const handleFeedback = useCallback((type: 'up' | 'down') => {
        if (feedbackGiven) return; // Already gave feedback
        setFeedbackGiven(type);

        if (onFeedback && insight?.topDIN?.headline) {
            onFeedback(type, insight.topDIN.headline);
        }

        Alert.alert(
            type === 'up' ? '👍 Thanks!' : '👎 Got it',
            type === 'up'
                ? 'We\'ll find more insights like this.'
                : 'We\'ll improve future recommendations.',
            [{ text: 'OK' }]
        );
    }, [feedbackGiven, onFeedback, insight]);

    // Calculate refresh timer
    const getRefreshTimeText = useCallback(() => {
        if (!cacheExpiresAt) return null;
        const expiresAt = new Date(cacheExpiresAt);
        const now = new Date();
        const diffMs = expiresAt.getTime() - now.getTime();
        if (diffMs <= 0) return 'Ready';
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }, [cacheExpiresAt]);

    // -------------------------------------------------------------------------
    // LOADING STATE
    // -------------------------------------------------------------------------
    // Match the green card style even for loading to avoid layout shift
    if (loading) {
        return (
            <View style={styles.cardContainer}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Icon name="sprout-outline" size={20} color="#1A2E05" />
                        <Text style={styles.headerTitle}>Sprout's Insight</Text>
                    </View>
                    <Text style={styles.headerTimestamp}>Thinking...</Text>
                </View>

                <View style={[styles.contentCard, { minHeight: 180, justifyContent: 'center', alignItems: 'center' }]}>
                    <ActivityIndicator size="large" color="#84CC16" />
                    <Text style={{ marginTop: 12, color: '#6B7280', fontSize: 13 }}>Analyzing inventory & market trends...</Text>
                </View>
            </View>
        );
    }

    // -------------------------------------------------------------------------
    // ERROR STATE
    // -------------------------------------------------------------------------
    if (error || !insight) {
        return (
            <View style={[styles.cardContainer, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Icon name="alert-circle-outline" size={20} color="#DC2626" />
                        <Text style={[styles.headerTitle, { color: '#991B1B' }]}>Insight Unavailable</Text>
                    </View>
                    <TouchableOpacity onPress={onRefresh} style={styles.refreshBtnHeader}>
                        <Icon name="refresh" size={18} color="#991B1B" />
                    </TouchableOpacity>
                </View>
                <View style={styles.contentCard}>
                    <Text style={styles.headlineText}>Unable to load insights</Text>
                    <Text style={styles.descriptionText}>
                        We couldn't generate an insight right now. Please check your connection and try again.
                    </Text>
                    <TouchableOpacity onPress={onRefresh} style={[styles.actionButton, { backgroundColor: '#EF4444' }]}>
                        <Text style={styles.actionButtonText}>Retry Analysis</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // -------------------------------------------------------------------------
    // SUCCESS STATE
    // -------------------------------------------------------------------------
    const { topDIN, bottomDIN, severity, timestamp } = insight;

    // Format timestamp (e.g., "Updated 2m ago")
    const timeLabel = timestamp
        ? new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Just now';

    // Metrics Logic for comparison box
    const primaryMetric = bottomDIN.metrics?.[0]; // Current
    const secondaryMetric = bottomDIN.metrics?.[1]; // Potential/Recovery

    // Helper to get favicon for external sources
    const getFaviconUrl = (url?: string) => {
        if (!url) return null;
        try {
            const domain = new URL(url).hostname;
            return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch (e) {
            return null;
        }
    };

    return (
        <Animated.View entering={FadeInUp.duration(600).springify()} style={styles.cardContainer}>
            {/* 1. Header */}
            <View style={styles.headerRow}>
                <View style={styles.headerLeft}>
                    <Icon name="sprout-outline" size={20} color="#647653" />
                    <Text style={styles.headerTitle}>
                        {insight.timeframe === 'short_term' ? 'This Week' :
                            insight.timeframe === 'medium_term' ? 'This Month' :
                                insight.timeframe === 'long_term' ? 'This Quarter' :
                                    "Sprout's Insight"}
                    </Text>
                </View>

                <View style={styles.headerRight}>
                    <Text style={styles.headerTimestamp}>Updated {timeLabel}</Text>
                </View>
            </View>

            {/* 2. White Content Card */}
            <View style={styles.contentCard}>

                {/* Headline */}
                <Text style={styles.headlineText}>{topDIN.headline}</Text>

                {/* Description with possible links (simplified for now) */}
                <Text style={styles.descriptionText} numberOfLines={3}>
                    {bottomDIN.description}
                </Text>

                {/* Comparison Metrics Box */}
                {bottomDIN.metrics && bottomDIN.metrics.length >= 2 && (
                    <View style={styles.metricsContainer}>
                        {/* Left: Current */}
                        <View style={styles.metricColumn}>
                            <Text style={styles.metricLabel}>{primaryMetric?.label || 'Current'}</Text>
                            <Text style={styles.metricValueMain}>{primaryMetric?.value}</Text>
                            <Text style={styles.metricSub}>
                                {/* Dynamic idle days from first affected product, or fallback */}
                                {bottomDIN.affectedProducts?.[0]?.daysSinceSale
                                    ? `idle for ${bottomDIN.affectedProducts[0].daysSinceSale}d`
                                    : (primaryMetric as any)?.status === 'warning' ? 'needs attention' : ''}
                            </Text>
                        </View>

                        {/* Vertical Divider */}
                        <View style={styles.metricDivider} />

                        {/* Right: Potential */}
                        <View style={styles.metricColumn}>
                            <Text style={styles.metricLabel}>{secondaryMetric?.label || 'Projected'}</Text>
                            <View style={styles.metricValueRow}>
                                <Text style={styles.metricValueMain}>{secondaryMetric?.value}</Text>
                                {/* Dynamic discount % from products, or derive from labels */}
                                {(() => {
                                    const discountPct = bottomDIN.affectedProducts?.[0]?.discountPercent;
                                    if (discountPct) return <Text style={styles.metricGainText}> (@{discountPct}% off)</Text>;
                                    // Try to extract from label like "Expected recovery @30%"
                                    const labelMatch = secondaryMetric?.label?.match(/@(\d+)%/);
                                    if (labelMatch) return <Text style={styles.metricGainText}> (@{labelMatch[1]}%)</Text>;
                                    return null;
                                })()}
                            </View>
                            <Text style={[styles.metricSub, { color: '#84CC16' }]}>Recoverable</Text>
                        </View>
                    </View>
                )}

                {/* Recommendation Spot (Replaces Giant Button) */}
                <View style={styles.recommendationContainer}>
                    <View style={styles.recommendationHeader}>
                        <Icon name="lightbulb-on-outline" size={16} color="#854D0E" />
                        <Text style={styles.recommendationTitle}>Recommendation</Text>
                    </View>

                    <Text style={styles.recommendationText}>
                        {insight.suggestionText || bottomDIN.action?.label || 'Review these products to determine next steps.'}
                    </Text>

                    {/* Execute Action button hidden for now - suggestion only mode */}
                </View>

                {/* Footer Actions Row */}
                <View style={styles.footerRow}>
                    {/* Feedback Actions */}
                    <View style={styles.leftActions}>
                        <TouchableOpacity style={styles.iconBtn} onPress={handleCopy}>
                            <Icon name={copied ? "check" : "content-copy"} size={18} color={copied ? "#22C55E" : "#9CA3AF"} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => handleFeedback('up')}
                            disabled={feedbackGiven !== null}
                        >
                            <Icon
                                name={feedbackGiven === 'up' ? "thumb-up" : "thumb-up-outline"}
                                size={18}
                                color={feedbackGiven === 'up' ? "#22C55E" : "#9CA3AF"}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.iconBtn}
                            onPress={() => handleFeedback('down')}
                            disabled={feedbackGiven !== null}
                        >
                            <Icon
                                name={feedbackGiven === 'down' ? "thumb-down" : "thumb-down-outline"}
                                size={18}
                                color={feedbackGiven === 'down' ? "#EF4444" : "#9CA3AF"}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtnHeader}>
                            <Icon name="refresh" size={18} color="#9CA3AF" />
                            {getRefreshTimeText() && (
                                <Text style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 2 }}>
                                    {getRefreshTimeText()}
                                </Text>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Sources Toggle */}
                    <TouchableOpacity
                        style={styles.sourcesPill}
                        onPress={() => setSourcesVisible(true)}
                    >
                        <View style={styles.avatarPile}>
                            {/* Show Anorha logo for DB + Favicons for Web */}
                            <View style={[styles.avatarCircle, { backgroundColor: '#fff', zIndex: 3, borderWidth: 1, borderColor: '#E5E7EB' }]}>
                                {/* Anorha Placeholder Icon */}
                                <Icon name="leaf" size={10} color="#84CC16" />
                            </View>

                            {insight.sources?.filter(s => s.type === 'web').slice(0, 2).map((src, idx) => (
                                <View key={idx} style={[styles.avatarCircle, { zIndex: 2 - idx, marginLeft: -6, backgroundColor: '#fff' }]}>
                                    {getFaviconUrl(src.url) ? (
                                        <Image
                                            source={{ uri: getFaviconUrl(src.url) || '' }}
                                            style={{ width: 14, height: 14, borderRadius: 7 }}
                                        />
                                    ) : (
                                        <Icon name="web" size={10} color="#9CA3AF" />
                                    )}
                                </View>
                            ))}
                        </View>
                        <Text style={styles.sourcesText}>Sources</Text>
                    </TouchableOpacity>
                </View>

            </View>

            {/* ----------------------------------------------------------------- */}
            {/* SOURCES & REASONING MODAL                                         */}
            {/* ----------------------------------------------------------------- */}
            <Modal
                visible={sourcesVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setSourcesVisible(false)}
            >
                <View style={styles.modalBackdrop}>
                    <TouchableOpacity style={styles.modalDismissArea} onPress={() => setSourcesVisible(false)} />

                    <View style={styles.bottomSheet}>
                        {/* Drag Handle */}
                        <View style={styles.dragHandleContainer}>
                            <View style={styles.dragHandle} />
                        </View>

                        {/* Sheet Header */}
                        <View style={styles.sheetHeader}>
                            <Text style={styles.sheetTitle}>Sources</Text>
                            <TouchableOpacity onPress={() => setSourcesVisible(false)} style={styles.closeBtn}>
                                <Icon name="close" size={20} color="#6B7280" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.sheetScroll} contentContainerStyle={{ paddingBottom: 40 }}>

                            {/* 1. Reasoning Section */}
                            <View style={styles.sectionBlock}>
                                <View style={styles.sectionHeader}>
                                    <Icon name="thought-bubble-outline" size={18} color="#4B5563" />
                                    <Text style={styles.sectionTitleText}>AI Reasoning</Text>
                                </View>
                                <Text style={styles.reasoningText}>
                                    {insight.reasoning || "Based on your current inventory levels and average sales velocity over the past 30 days, we've identified slow-moving stock that is tying up capital."}
                                </Text>
                            </View>

                            <View style={styles.divider} />

                            {/* 2. Data Sources Section */}
                            <View style={styles.sectionBlock}>
                                <View style={styles.sectionHeader}>
                                    <Icon name="database-outline" size={18} color="#4B5563" />
                                    <Text style={styles.sectionTitleText}>Data Sources</Text>
                                </View>

                                {/* Render Internal Data Sources */}
                                <View style={styles.sourceItem}>
                                    <View style={[styles.sourceIcon, { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB', borderWidth: 1 }]}>
                                        {/* Anorha Logo / Icon */}
                                        <Icon name="leaf" size={16} color="#65A30D" />
                                    </View>
                                    <View>
                                        <Text style={styles.sourceName}>Anorha DB</Text>
                                        <Text style={styles.sourceDetail}>Synced 2m ago from Shopify</Text>
                                    </View>
                                </View>

                                {/* Render External Sources if present */}
                                {insight.sources?.map((src, idx) => (
                                    <View key={idx} style={styles.sourceItem}>
                                        <View style={[styles.sourceIcon, { backgroundColor: '#fff', borderColor: '#E5E7EB', borderWidth: 1 }]}>
                                            {getFaviconUrl(src.url) ? (
                                                <Image
                                                    source={{ uri: getFaviconUrl(src.url) || '' }}
                                                    style={{ width: 18, height: 18, borderRadius: 9 }}
                                                />
                                            ) : (
                                                <Icon name={src.type === 'web' ? 'web' : 'database'} size={16} color="#6B7280" />
                                            )}
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.sourceName} numberOfLines={1}>
                                                {src.title || (src.url ? (() => { try { return new URL(src.url).hostname; } catch { return 'External Data'; } })() : (src.type === 'database' ? 'Database Query' : 'Data Source'))}
                                            </Text>
                                            <Text style={styles.sourceDetail} numberOfLines={2}>{src.snippet || src.query || src.url || 'Internal database query'}</Text>
                                            {src.url && (
                                                <TouchableOpacity onPress={() => Linking.openURL(src.url!)}>
                                                    <Text style={styles.linkText}>View Source</Text>
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    </View>
                                ))}
                            </View>

                            {/* Affected Products Section */}
                            {bottomDIN.affectedProducts && bottomDIN.affectedProducts.length > 0 && (
                                <>
                                    <View style={styles.divider} />
                                    <View style={styles.sectionBlock}>
                                        <View style={styles.sectionHeader}>
                                            <Icon name="package-variant-closed" size={18} color="#4B5563" />
                                            <Text style={styles.sectionTitleText}>Analyzed Products ({bottomDIN.affectedProducts.length})</Text>
                                        </View>
                                        {bottomDIN.affectedProducts.slice(0, 5).map((prod, i) => (
                                            <View key={i} style={styles.productRow}>
                                                <View style={{ flex: 1 }}>
                                                    <Text style={styles.productName} numberOfLines={1}>{prod.name}</Text>
                                                    {prod.sku && <Text style={{ fontSize: 11, color: '#9CA3AF' }}>SKU: {prod.sku}</Text>}
                                                </View>
                                                <View style={{ alignItems: 'flex-end' }}>
                                                    <Text style={styles.productQty}>x{prod.quantity} @ ${prod.price?.toLocaleString() || '—'}</Text>
                                                    {prod.estimatedValue && (
                                                        <Text style={{ fontSize: 11, color: '#65A30D' }}>
                                                            ${prod.estimatedValue.toLocaleString()} value
                                                            {prod.discountPercent ? ` → ${prod.discountPercent}% off` : ''}
                                                        </Text>
                                                    )}
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                </>
                            )}

                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    // Main Container
    cardContainer: {
        backgroundColor: '#FEF4DD', // lime-50
        borderRadius: 20, // Slightly more rounded
        padding: 16,
        borderWidth: 1,
        borderColor: 'rgba(0,0,0,0.1)', // slightly darker lime-200 for better edge definition
        // Add shadow to separate from background
        shadowColor: '#rgba(0,0,0,1)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 3,
    },

    // Header
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        paddingHorizontal: 2,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: '#647653', // lime-950
        letterSpacing: -0.3,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTimestamp: {
        fontSize: 12,
        color: '#647653', // lime-600
        fontWeight: '500',
    },
    refreshBtnHeader: {
        padding: 4,
    },

    // Content Card
    contentCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16, // Match outer curve style
        padding: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    headlineText: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 8,
        lineHeight: 24,
        letterSpacing: -0.3,
    },
    descriptionText: {
        fontSize: 15,
        color: '#4B5563',
        lineHeight: 22,
        marginBottom: 20,
    },

    // Metrics Box
    metricsContainer: {
        flexDirection: 'row',
        backgroundColor: '#F9FAFB', // grey-50
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
        borderWidth: 1,
        borderColor: '#F3F4F6', // grey-100
    },
    metricColumn: {
        flex: 1,
    },
    metricDivider: {
        width: 1,
        backgroundColor: '#E5E7EB',
        marginHorizontal: 16,
    },
    metricLabel: {
        fontSize: 12,
        color: '#6B7280',
        marginBottom: 6,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    metricValueMain: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
        letterSpacing: -0.3,
    },
    metricValueRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    metricGainText: {
        fontSize: 12,
        fontWeight: '700',
        color: '#65A30D', // lime-600
    },
    metricSub: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 4,
    },

    // Recommendation Spot (New)
    recommendationContainer: {
        backgroundColor: '#FEF4DD', // yellow-50
        borderRadius: 12,
        padding: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#FEF08A', // yellow-200
    },
    recommendationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
        gap: 6,
    },
    recommendationTitle: {
        fontSize: 12,
        fontWeight: '700',
        color: '#854D0E', // yellow-900
        textTransform: 'uppercase',
    },
    recommendationText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#111827',
        lineHeight: 20,
        marginBottom: 8,
    },
    actionLink: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        marginTop: 4,
    },
    actionLinkText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#4D7C0F', // lime-700
        marginRight: 4,
    },

    // Footer & Sources
    footerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
    },
    leftActions: {
        flexDirection: 'row',
        gap: 12,
    },
    iconBtn: {
        padding: 6,
    },
    sourcesPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#F3F4F6',
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 20,
    },
    avatarPile: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 4,
    },
    avatarCircle: {
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    sourcesText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B5563',
    },

    // Action Button (Error State)
    actionButton: {
        backgroundColor: '#EF4444',
        borderRadius: 8,
        paddingVertical: 12,
        alignItems: 'center',
        marginTop: 12,
    },
    actionButtonText: {
        color: '#FFF',
        fontWeight: '600',
    },

    // -------------------------
    // MODAL / SHEET STYLES
    // -------------------------
    modalBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)', // Darker backdrop
        justifyContent: 'flex-end',
    },
    modalDismissArea: {
        flex: 1,
    },
    bottomSheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        height: '95%', // Taller
        paddingBottom: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 20,
    },
    dragHandleContainer: {
        alignItems: 'center',
        paddingVertical: 16,
    },
    dragHandle: {
        width: 48,
        height: 5,
        backgroundColor: '#E5E7EB',
        borderRadius: 2.5,
    },
    sheetHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 24,
        marginBottom: 20,
    },
    sheetTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
    },
    closeBtn: {
        padding: 8,
        backgroundColor: '#F3F4F6',
        borderRadius: 20,
    },
    sheetScroll: {
        flex: 1,
        paddingHorizontal: 24,
    },
    sectionBlock: {
        marginBottom: 8,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 16,
        gap: 10,
    },
    sectionTitleText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1F2937',
    },
    reasoningText: {
        fontSize: 16,
        color: '#4B5563',
        lineHeight: 26,
        padding: 16,
        backgroundColor: '#F9FAFB', // More neutral
        borderRadius: 12,
        borderLeftWidth: 4,
        borderLeftColor: '#9CA3AF', // Neutral gray accent
    },
    divider: {
        height: 1,
        backgroundColor: '#F3F4F6',
        marginBottom: 32,
    },
    sourceItem: {
        flexDirection: 'row',
        marginBottom: 16,
        gap: 14,
        alignItems: 'center',
    },
    sourceIcon: {
        width: 32,
        height: 32,
        borderRadius: 16, // Circle
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F9FAFB',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    sourceName: {
        fontSize: 15,
        fontWeight: '600',
        color: '#111827',
    },
    sourceDetail: {
        fontSize: 13,
        color: '#6B7280',
        marginTop: 2,
    },
    linkText: {
        fontSize: 13,
        color: '#2563EB',
        marginTop: 4,
        fontWeight: '600',
    },
    productRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 12, // More breathing room
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6',
    },
    productName: {
        fontSize: 14,
        color: '#374151',
        flex: 1,
        fontWeight: '500',
    },
    productQty: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111827',
    },
});

export default InsightCard;
