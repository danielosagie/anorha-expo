import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable, Dimensions, Linking, Platform } from 'react-native';
import { ScrollView as ScrollViewHorizontal } from 'react-native-gesture-handler';
import { BarChart, LineChart } from 'react-native-chart-kit';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export interface PricingResearchModalProps {
    visible: boolean;
    onClose: () => void;
    pricingResearchResult: any;
    pricingSourcesSheetVisible: boolean;
    setPricingSourcesSheetVisible: React.Dispatch<React.SetStateAction<boolean>>;
    pricingHistoryRange: '1W' | '1M' | '3M';
    setPricingHistoryRange: React.Dispatch<React.SetStateAction<'1W' | '1M' | '3M'>>;
    selectedPricingPointIdx: number | null;
    onApplyPrice?: (price: string, metrics: { low: number; recommended: number; high: number }) => void;
}

export const PricingResearchModal: React.FC<PricingResearchModalProps> = ({
    visible,
    onClose,
    pricingResearchResult,
    pricingSourcesSheetVisible,
    setPricingSourcesSheetVisible,
    pricingHistoryRange,
    setPricingHistoryRange,
    selectedPricingPointIdx,
    onApplyPrice
}) => {
    return (
        <Modal visible={visible} transparent animationType="slide">
            <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={onClose}>
                <Pressable style={{ flex: 1, maxHeight: '90%', backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }} onPress={e => e.stopPropagation()}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>eBay Sold Prices</Text>
                        <TouchableOpacity onPress={onClose}>
                            <Icon name="close" size={24} color="#6B7280" />
                        </TouchableOpacity>
                    </View>
                    {pricingResearchResult?.error ? (
                        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                            <Text style={{ fontSize: 14, color: '#ef4444' }}>{pricingResearchResult.error}</Text>
                        </View>
                    ) : pricingResearchResult && typeof pricingResearchResult.low === 'number' ? (
                        <View style={{ flex: 1, minHeight: 0 }}>
                            <ScrollView style={{ flex: 1, maxHeight: 400 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
                                {/* Accuracy / recency + Sources toggle (expands section below) */}
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                                <Text style={{ fontSize: 13, color: '#6B7280' }}>
                                    Based on {(pricingResearchResult.sampleCount ?? pricingResearchResult.samples?.length ?? 0)} sold listings
                                    {pricingResearchResult.cachedAt
                                        ? ` · Cached ${(() => {
                                            const d = new Date(pricingResearchResult.cachedAt);
                                            const mins = Math.round((Date.now() - d.getTime()) / 60000);
                                            if (mins < 60) return `${mins}m ago`;
                                            const h = Math.floor(mins / 60);
                                            return `${h}h ago`;
                                        })()}`
                                        : ''}
                                </Text>
                                <TouchableOpacity
                                    activeOpacity={0.7}
                                    style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 12 }}
                                    onPress={() => setPricingSourcesSheetVisible((v) => !v)}
                                >
                                    <Icon name="web" size={14} color="#4B5563" />
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#4B5563', marginLeft: 4 }}>{pricingSourcesSheetVisible ? 'Hide sources' : 'Sources'}</Text>
                                </TouchableOpacity>
                            </View>
                            {/* Expandable Sources section (toggled by button above) */}
                            {pricingSourcesSheetVisible && (
                                <View style={{ marginBottom: 16, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB' }}>
                                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937', marginBottom: 8 }}>Sources</Text>
                                    {Array.isArray(pricingResearchResult?.samples) && pricingResearchResult.samples.length > 0 && (
                                        <View style={{ marginTop: 4 }}>
                                            {pricingResearchResult.samples.slice(0, 8).map((sample: any, idx: number) => (
                                                <View key={`inline-sample-${idx}`} style={{ marginBottom: 8 }}>
                                                    <Text style={{ fontSize: 12, color: '#111827' }} numberOfLines={1}>
                                                        {sample.title || 'Listing'} • ${typeof sample.price === 'number' ? sample.price.toFixed(2) : sample.price}
                                                        {typeof sample.estimatedDaysToSell === 'number' ? ` • ~${Math.round(sample.estimatedDaysToSell)}d` : ''}
                                                    </Text>
                                                    {sample.url ? (
                                                        <TouchableOpacity onPress={() => Linking.openURL(sample.url!)}>
                                                            <Text style={{ fontSize: 12, color: '#2563EB', marginTop: 1 }}>View listing</Text>
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            )}

                            {/* Three options */}
                            {(() => {
                                // Calculate timeToSell from samples to match chart data (same logic as backend)
                                const averageDaysNearTarget = (
                                    targetPrice: number,
                                    samples: Array<{ price: number; estimatedDaysToSell?: number }>,
                                ): number | undefined => {
                                    const withDays = samples.filter((s) => typeof s.estimatedDaysToSell === 'number' && Number.isFinite(s.estimatedDaysToSell));
                                    if (!withDays.length) return undefined;
                                    const sorted = withDays
                                        .map((s) => ({ ...s, dist: Math.abs(Number(s.price) - targetPrice) }))
                                        .sort((a, b) => a.dist - b.dist)
                                        .slice(0, Math.min(5, withDays.length));
                                    if (!sorted.length) return undefined;
                                    const avg = sorted.reduce((sum, s) => sum + Number(s.estimatedDaysToSell || 0), 0) / sorted.length;
                                    return Math.round(avg);
                                };
                                const samples = pricingResearchResult?.samples || [];
                                const low = pricingResearchResult?.low ?? 0;
                                const median = pricingResearchResult?.median ?? 0;
                                const recommended = pricingResearchResult?.recommended ?? median;
                                const high = pricingResearchResult?.high ?? 0;
                                const fastSaleDays = averageDaysNearTarget(low, samples);
                                const recommendedDays = averageDaysNearTarget(recommended, samples);
                                const maxProfitDays = averageDaysNearTarget(high, samples);
                                return (
                                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                                        <TouchableOpacity
                                            disabled={!onApplyPrice}
                                            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' }}
                                            onPress={() => {
                                                onApplyPrice?.(String(low.toFixed(2)), { low, recommended, high });
                                                onClose();
                                            }}
                                        >
                                            <Text style={{ fontSize: 10, color: '#6B7280' }}>Fast sale</Text>
                                            <Text style={{ fontSize: 14, fontWeight: '700' }}>${low.toFixed(2)}</Text>
                                            <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                                                ~{fastSaleDays ?? '—'}d avg
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            disabled={!onApplyPrice}
                                            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#2563EB', backgroundColor: '#EFF6FF', alignItems: 'center' }}
                                            onPress={() => {
                                                onApplyPrice?.(String(recommended.toFixed(2)), { low, recommended, high });
                                                onClose();
                                            }}
                                        >
                                            <Text style={{ fontSize: 10, color: '#1D4ED8' }}>Recommended</Text>
                                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1D4ED8' }}>${recommended.toFixed(2)}</Text>
                                            <Text style={{ fontSize: 10, color: '#1D4ED8', marginTop: 2 }}>
                                                ~{recommendedDays ?? '—'}d avg
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            disabled={!onApplyPrice}
                                            style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' }}
                                            onPress={() => {
                                                onApplyPrice?.(String(high.toFixed(2)), { low, recommended, high });
                                                onClose();
                                            }}
                                        >
                                            <Text style={{ fontSize: 10, color: '#6B7280' }}>Max profit</Text>
                                            <Text style={{ fontSize: 14, fontWeight: '700' }}>${high.toFixed(2)}</Text>
                                            <Text style={{ fontSize: 10, color: '#6B7280', marginTop: 2 }}>
                                                ~{maxProfitDays ?? '—'}d avg
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                );
                            })()}

                            </ScrollView>

                            {/* Chart section - outside vertical scroll so horizontal scroll works */}
                            <View style={{ minHeight: 260, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 24, borderTopWidth: 1, borderTopColor: '#E5E7EB' }}>
                            {(() => {
                                const marketPoints = (pricingResearchResult.samples || [])
                                    .filter((s: { estimatedDaysToSell?: number; price?: number }) => typeof s.estimatedDaysToSell === 'number' && Number.isFinite(s.estimatedDaysToSell) && typeof s.price === 'number')
                                    .sort((a: { price?: number }, b: { price?: number }) => Number(a.price) - Number(b.price));
                                const windowWidth = Dimensions.get('window').width;
                                // Ensure chart is wider than viewport so horizontal scroll works; min 60px per bar
                                const chartWidth = Math.max(marketPoints.length * 60, windowWidth + 60, 320);
                                if (marketPoints.length >= 2) {
                                    const maxLabels = 10;
                                    const step = Math.max(1, Math.floor(marketPoints.length / maxLabels));
                                    const labels = marketPoints.map((p: any, i: number) =>
                                        (i % step === 0 || i === marketPoints.length - 1) ? `$${Number(p.price).toFixed(0)}` : ''
                                    );
                                    const data = marketPoints.map((p: any) => Math.round(Number(p.estimatedDaysToSell)));
                                    const selected = selectedPricingPointIdx != null && selectedPricingPointIdx < marketPoints.length ? marketPoints[selectedPricingPointIdx] : null;

                                    // Compute std deviation curve from price data
                                    const prices = marketPoints.map((p: any) => Number(p.price));
                                    const mean = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
                                    const variance = prices.reduce((a: number, b: number) => a + Math.pow(b - mean, 2), 0) / prices.length;
                                    const stdDev = Math.sqrt(variance);
                                    // Generate normal distribution curve points mapped to chart positions
                                    const normalCurveData = stdDev > 0
                                        ? prices.map((price: number) => {
                                            const z = (price - mean) / stdDev;
                                            const density = Math.exp(-0.5 * z * z) / (stdDev * Math.sqrt(2 * Math.PI));
                                            // Scale to fit visually within chart height (max ~80% of max data value)
                                            const maxData = Math.max(...data, 1);
                                            return Math.round(density * stdDev * maxData * 2.5 * 100) / 100;
                                        })
                                        : data.map(() => 0);

                                    return (
                                        <View style={{ marginBottom: 16 }}>
                                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 4 }}>Time to sell at each price</Text>
                                            <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 6 }}>Y: Time (days to sell) · X: Price ($)</Text>
                                            <ScrollViewHorizontal
                                                horizontal
                                                showsHorizontalScrollIndicator={true}
                                                scrollEventThrottle={16}
                                                nestedScrollEnabled={Platform.OS === 'android'}
                                                style={{ marginHorizontal: -4, flexGrow: 0, width: windowWidth - 40 }}
                                                contentContainerStyle={{ paddingHorizontal: 4 }}
                                            >
                                                <View style={{ width: chartWidth }}>
                                                    <BarChart
                                                        data={{
                                                            labels,
                                                            datasets: [{ data }],
                                                        }}
                                                        width={chartWidth}
                                                        height={200}
                                                        yAxisLabel=""
                                                        yAxisSuffix="d"
                                                        chartConfig={{
                                                            backgroundColor: '#fff',
                                                            backgroundGradientFrom: '#fff',
                                                            backgroundGradientTo: '#fff',
                                                            decimalPlaces: 0,
                                                            color: (opacity = 1) => `rgba(147, 200, 34, ${opacity})`,
                                                            labelColor: () => '#6B7280',
                                                            style: { borderRadius: 12 },
                                                            barPercentage: 0.7,
                                                        }}
                                                        style={{ borderRadius: 12 }}
                                                        withInnerLines={true}
                                                        fromZero
                                                    />
                                                    {/* Std deviation curve overlay */}
                                                    {stdDev > 0 && (
                                                        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0.5 }}>
                                                            <LineChart
                                                                data={{
                                                                    labels: labels.map(() => ''),
                                                                    datasets: [{ data: normalCurveData.length >= 2 ? normalCurveData : [0, 0], color: () => 'rgba(156, 163, 175, 0.6)', strokeWidth: 2 }],
                                                                }}
                                                                width={chartWidth}
                                                                height={200}
                                                                yAxisLabel=""
                                                                yAxisSuffix=""
                                                                chartConfig={{
                                                                    backgroundColor: 'transparent',
                                                                    backgroundGradientFrom: 'transparent',
                                                                    backgroundGradientTo: 'transparent',
                                                                    decimalPlaces: 0,
                                                                    color: () => 'rgba(156, 163, 175, 0.4)',
                                                                    labelColor: () => 'transparent',
                                                                    style: { borderRadius: 12 },
                                                                    propsForBackgroundLines: { stroke: 'transparent' },
                                                                }}
                                                                style={{ borderRadius: 12 }}
                                                                withInnerLines={false}
                                                                withOuterLines={false}
                                                                withDots={false}
                                                                bezier
                                                                fromZero
                                                            />
                                                        </View>
                                                    )}
                                                </View>
                                            </ScrollViewHorizontal>
                                            <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 4, textAlign: 'center' }}>Price ($) → Swipe to see more</Text>
                                            {selected != null && (
                                                <View style={{ marginTop: 8, padding: 10, borderRadius: 10, backgroundColor: '#F9FAFB' }}>
                                                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#111827' }} numberOfLines={1}>{selected.title || 'Listing'}</Text>
                                                    <Text style={{ fontSize: 12, color: '#4B5563', marginTop: 2 }}>
                                                        ${Number(selected.price).toFixed(2)} • ~{Math.round(Number(selected.estimatedDaysToSell))}d to sell
                                                    </Text>
                                                    {selected.url ? (
                                                        <TouchableOpacity onPress={() => Linking.openURL(selected.url!)}>
                                                            <Text style={{ fontSize: 12, color: '#93C822', marginTop: 4, fontWeight: '600' }}>View listing</Text>
                                                        </TouchableOpacity>
                                                    ) : null}
                                                </View>
                                            )}
                                        </View>
                                    );
                                }

                                const points = pricingResearchResult.history?.dataPoints ?? [];
                                const rangeMs = pricingHistoryRange === '1W' ? 7 * 24 * 60 * 60 * 1000 : pricingHistoryRange === '1M' ? 30 * 24 * 60 * 60 * 1000 : 90 * 24 * 60 * 60 * 1000;
                                const cutoff = Date.now() - rangeMs;
                                const filtered = points.filter((p: any) => new Date(p.date).getTime() >= cutoff);
                                if (filtered.length < 2) {
                                    return (
                                        <View style={{ marginBottom: 16, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: '#F9FAFB', borderRadius: 12 }}>
                                            <Text style={{ fontSize: 13, color: '#6B7280' }}>Not enough points yet for trend. Tap Sources to inspect sold listing links.</Text>
                                        </View>
                                    );
                                }
                                const trendLabels = filtered.map((p: any) => {
                                    const d = new Date(p.date);
                                    return `${d.getMonth() + 1}/${d.getDate()}`;
                                });
                                const trendData = filtered.map((p: any) => p.median);
                                const trendChartWidth = Math.max(filtered.length * 60, Dimensions.get('window').width + 60, 320);
                                return (
                                    <View style={{ marginBottom: 16 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#374151' }}>Price trend (cached runs)</Text>
                                            <View style={{ flexDirection: 'row', gap: 6 }}>
                                                {(['1W', '1M', '3M'] as const).map(r => (
                                                    <TouchableOpacity
                                                        key={r}
                                                        onPress={() => setPricingHistoryRange(r)}
                                                        style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: pricingHistoryRange === r ? 'rgba(147,200,34,0.15)' : '#F3F4F6' }}
                                                    >
                                                        <Text style={{ fontSize: 12, fontWeight: '600', color: pricingHistoryRange === r ? '#93C822' : '#6B7280' }}>{r}</Text>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        </View>
                                        <ScrollViewHorizontal
                                            horizontal
                                            showsHorizontalScrollIndicator={true}
                                            scrollEventThrottle={16}
                                            nestedScrollEnabled={Platform.OS === 'android'}
                                            style={{ width: Dimensions.get('window').width - 40 }}
                                        >
                                            <View style={{ width: trendChartWidth }}>
                                            <LineChart
                                                data={{ labels: trendLabels, datasets: [{ data: trendData.length ? trendData : [0] }] }}
                                                width={trendChartWidth}
                                                height={160}
                                                chartConfig={{
                                                    backgroundColor: '#fff',
                                                    backgroundGradientFrom: '#fff',
                                                    backgroundGradientTo: '#fff',
                                                    decimalPlaces: 0,
                                                    color: (opacity = 1) => `rgba(147, 200, 34, ${opacity})`,
                                                    labelColor: () => '#6B7280',
                                                    style: { borderRadius: 12 },
                                                }}
                                                style={{ borderRadius: 12 }}
                                                withInnerLines={false}
                                                withOuterLines={true}
                                            />
                                            </View>
                                        </ScrollViewHorizontal>
                                    </View>
                                );
                            })()}
                            </View>
                        </View>
                    ) : (
                        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
                            <Text style={{ fontSize: 14, color: '#6B7280' }}>Loading...</Text>
                        </View>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
};
