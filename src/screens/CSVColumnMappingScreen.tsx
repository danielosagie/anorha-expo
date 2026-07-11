import React, { useState, useEffect, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Modal,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '@clerk/expo';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { API_BASE_URL } from '../config/env';
import { RC, Chip, MiniProgress, Check } from '../components/resolve/ResolveKit';
import PillTabs from '../components/ui/PillTabs';
import ErrorModal from '../components/ErrorModal';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { useOrg } from '../context/OrgContext';
import { createLogger } from '../utils/logger';

const log = createLogger('CSVColumnMappingScreen');

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// Some deployments set API_BASE_URL with a trailing `/api` — normalize once so
// we never compose `/api/api/…` (matches useResolution / ConnectedPlatformItem).
const API_BASE = (() => {
    const trimmed = API_BASE_URL.replace(/\/$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
})();

// The server column brain speaks ProductField names; the mapping UI speaks
// canonical Anorha keys. Only fields both sides know are prefilled — the rest
// (variantGroup/option server-side; condition/size/etc client-side) stay manual.
const SERVER_FIELD_TO_CLIENT: Record<string, string> = {
    name: 'title',
    sku: 'sku',
    barcode: 'barcode',
    price: 'price',
    quantity: 'quantity',
    description: 'description',
    imageUrl: 'imageUrl',
    category: 'category',
    brand: 'brand',
};

interface CanonicalField {
    key: string;
    label: string;
    required: boolean;
    example: string;
    icon: IconName;
}

// Canonical Anorha fields that we map to
const CANONICAL_FIELDS: CanonicalField[] = [
    { key: 'title', label: 'Title', required: true, example: 'Nike Air Max 90', icon: 'format-title' },
    { key: 'description', label: 'Description', required: false, example: 'Classic sneaker...', icon: 'text' },
    { key: 'sku', label: 'SKU', required: true, example: 'NIKEAM90-001', icon: 'barcode' },
    { key: 'barcode', label: 'Barcode/UPC', required: false, example: '012345678901', icon: 'barcode-scan' },
    { key: 'price', label: 'Price', required: true, example: '149.99', icon: 'cash' },
    { key: 'compareAtPrice', label: 'Compare Price', required: false, example: '199.99', icon: 'tag-heart' },
    { key: 'quantity', label: 'Quantity', required: false, example: '25', icon: 'package-variant' },
    { key: 'brand', label: 'Brand', required: false, example: 'Nike', icon: 'tag-outline' },
    { key: 'category', label: 'Category', required: false, example: 'Sneakers', icon: 'shape-outline' },
    { key: 'condition', label: 'Condition', required: false, example: 'New', icon: 'star-outline' },
    { key: 'size', label: 'Size', required: false, example: '10', icon: 'ruler' },
    { key: 'color', label: 'Color', required: false, example: 'White', icon: 'palette-outline' },
    { key: 'weight', label: 'Weight', required: false, example: '1.5', icon: 'weight' },
    { key: 'cost', label: 'Cost', required: false, example: '75.00', icon: 'currency-usd' },
    { key: 'imageUrl', label: 'Image URL', required: false, example: 'https://...', icon: 'image-outline' },
];

interface RouteParams {
    csvHeaders: string[];
    csvData: any[];
    sampleRow: Record<string, string>;
    connectionName?: string;
}

type CSVColumnMappingScreenRouteProp = RouteProp<{ CSVColumnMapping: RouteParams }, 'CSVColumnMapping'>;

// Two-step confirm sequence, surfaced as real progress (not a bare spinner) so a
// large CSV never feels hung: 'creating' the pseudo-connection, then 'uploading'
// the normalized rows.
type ConfirmStage = 'idle' | 'creating' | 'uploading';

export function CSVColumnMappingScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<CSVColumnMappingScreenRouteProp>();
    const insets = useSafeAreaInsets();
    const { currentOrg } = useOrg();
    const { getToken } = useAuth();

    // Default empty params if undefined to prevent crashes
    const { csvHeaders = [], csvData = [], sampleRow = {}, connectionName = 'CSV Import' } = route.params || {};

    const [mappings, setMappings] = useState<Record<string, string>>({});
    const [stage, setStage] = useState<ConfirmStage>('idle');
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [activeTab, setActiveTab] = useState<'all' | 'required' | 'optional'>('all');

    const isProcessing = stage !== 'idle';

    // Modal state for column selection
    const [selectionModalVisible, setSelectionModalVisible] = useState(false);
    const [currentFieldKey, setCurrentFieldKey] = useState<string | null>(null);

    // Errors surface through ErrorModal (never a native alert).
    const [errorModal, setErrorModal] = useState<{ visible: boolean; title: string; message: string; type: 'error' | 'warning' | 'info' | 'success' }>({
        visible: false,
        title: '',
        message: '',
        type: 'error',
    });
    const showError = (title: string, message: string, type: 'error' | 'warning' = 'error') =>
        setErrorModal({ visible: true, title, message, type });

    // Auto-detect mappings on mount. The server column brain first: POST a
    // raw-row sample to /sync/imports/normalize (NO connectionId, so nothing is
    // created or persisted) and prefill the columns it applied confidently —
    // the same brain runs at import time, so the prefill matches what the
    // server will do. Ambiguous columns stay unmapped for the user. Falls back
    // to the legacy AI endpoint, then basic header matching.
    useEffect(() => {
        if (!csvHeaders.length) return;

        const fetchServerMappings = async (): Promise<boolean> => {
            const token = await ensureSupabaseJwt();
            if (!token) return false;
            const res = await fetch(`${API_BASE}/sync/imports/normalize`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ platformType: 'csv', rawRows: csvData.slice(0, 25) }),
            });
            if (!res.ok) return false;
            const envelope = await res.json().catch(() => null);
            const applied = envelope?.columns?.applied;
            if (!applied || typeof applied !== 'object') return false;
            const prefill: Record<string, string> = {};
            for (const [field, header] of Object.entries(applied)) {
                const clientKey = SERVER_FIELD_TO_CLIENT[field];
                if (clientKey && typeof header === 'string' && header) prefill[clientKey] = header;
            }
            if (Object.keys(prefill).length === 0) return false;
            setMappings(prefill);
            log.debug('[CSVColumnMapping] server brain mapped', Object.keys(prefill).length, 'fields');
            return true;
        };

        const fetchAIMappings = async () => {
            setIsLoadingAI(true);
            try {
                if (await fetchServerMappings()) return;
            } catch (error) {
                log.warn('[CSVColumnMapping] server column brain failed, falling back:', error);
            }
            try {
                const token = await getToken();
                if (!token) {
                    log.warn('[CSVColumnMapping] No auth token, falling back to basic matching');
                    fallbackToBasicMatching();
                    return;
                }

                const response = await fetch(`${API_BASE_URL}/api/products/csv-column-mapping`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        headers: csvHeaders,
                        sampleRow: sampleRow,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`API returned ${response.status}`);
                }

                const result = await response.json();
                setMappings(result.mappings || {});
                log.debug('[CSVColumnMapping] AI mapped', Object.keys(result.mappings || {}).length, 'fields');
            } catch (error) {
                log.error('[CSVColumnMapping] AI mapping failed:', error);
                fallbackToBasicMatching();
            }
        };

        fetchAIMappings().finally(() => setIsLoadingAI(false));
    }, [csvHeaders]);

    const fallbackToBasicMatching = () => {
        const autoMappings: Record<string, string> = {};
        CANONICAL_FIELDS.forEach(field => {
            const fieldLower = field.key.toLowerCase();
            const labelLower = field.label.toLowerCase();
            const match = csvHeaders.find(header => {
                const headerLower = header.toLowerCase().replace(/[_\-\s]/g, '');
                return (
                    headerLower === fieldLower ||
                    headerLower === labelLower.replace(/[_\-\s]/g, '') ||
                    headerLower.includes(fieldLower) ||
                    fieldLower.includes(headerLower)
                );
            });
            if (match) {
                autoMappings[field.key] = match;
            }
        });
        setMappings(autoMappings);
    };

    const handleConfirm = async () => {
        // Validate required fields (the CTA is also gated on these, so this is a
        // defensive net rather than the primary guard).
        const missingRequired = CANONICAL_FIELDS
            .filter(f => f.required && !mappings[f.key])
            .map(f => f.label);

        if (missingRequired.length > 0) {
            showError('Missing fields', `Map ${missingRequired.join(', ')} first.`, 'warning');
            return;
        }

        setStage('creating');
        try {
            const transformedData = csvData.map(row => {
                const transformed: Record<string, any> = {};
                Object.entries(mappings).forEach(([canonicalKey, csvColumn]) => {
                    if (csvColumn) {
                        transformed[canonicalKey] = row[csvColumn];
                    }
                });
                return transformed;
            });

            // Create a persistent CSV pseudo-connection in PlatformConnections.
            // ('UserPlatforms' never existed — this insert always failed and CSV
            // connections were silently never saved; the fallback below masked it.)
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { data: newConnection, error: insertError } = await supabase
                .from('PlatformConnections')
                .insert({
                    UserId: user.id,
                    OrgId: currentOrg?.id, // Add OrgId from context
                    PlatformType: 'csv',
                    DisplayName: connectionName,
                    Credentials: {}, // NOT NULL column; CSV pseudo-connections have no creds
                    Status: 'active',
                    IsEnabled: true,
                })
                .select()
                .single();

            if (insertError || !newConnection) {
                // No real connection => no server-side resolver target. The old
                // 'csv-import' magic-string path drove the client matching deck,
                // which is gone; surface the error instead of silently degrading.
                log.error('[CSVColumnMapping] Failed to create CSV connection:', insertError);
                showError('Import failed', 'Could not start the import. Try again.');
                return;
            }

            log.debug('[CSVColumnMapping] Created CSV connection:', newConnection.Id);

            // Best-effort rollback: a CSV pseudo-connection with no staged
            // mappingSuggestions is an unusable orphan, and a retry would pile up
            // duplicate active connections. Delete it before surfacing any
            // post-create failure.
            const rollbackConnection = async () => {
                const { error: delErr } = await supabase
                    .from('PlatformConnections')
                    .delete()
                    .eq('Id', newConnection.Id);
                if (delErr) log.warn('[CSVColumnMapping] Failed to roll back CSV connection:', delErr.message);
            };

            const token = await ensureSupabaseJwt();
            if (!token) {
                // No JWT => the normalize call would send `Bearer null`. Treat as an
                // auth-state problem, roll back the orphan, and ask for re-auth.
                await rollbackConnection();
                log.warn('[CSVColumnMapping] Missing Supabase JWT for import normalize');
                showError('Session expired', 'Sign in again to import.');
                return;
            }

            // Stage the rows through the SAME resolver platform scans use: POST
            // /imports/normalize persists mappingSuggestions on the connection, so
            // the sync inbox (GET /resolution) shows the auto-linked / create /
            // needs-attention buckets for this CSV exactly like a connected
            // platform — no client matching brain, no MappingReview deck. The
            // server also auto-commits the certain buckets for CSV; a failed
            // persist is a 5xx now (no more silent-200 lost imports).
            //
            // A THROWN fetch (network drop, timeout) must clean up the orphan
            // pseudo-connection exactly like a non-2xx response, so the call is
            // wrapped — either failure path rolls back before surfacing.
            setStage('uploading');
            let normRes: Response;
            try {
                normRes = await fetch(`${API_BASE}/sync/imports/normalize`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        connectionId: newConnection.Id,
                        platformType: 'csv',
                        items: transformedData,
                    }),
                });
            } catch (fetchError) {
                await rollbackConnection();
                throw fetchError;
            }
            if (!normRes.ok) {
                await rollbackConnection();
                throw new Error(`Import normalize failed: ${normRes.status}`);
            }

            // Land on the Import Hub (the "email inbox"): it shows this import's
            // progress, then "N need you — Continue". `replace` so Back doesn't
            // return to the now-consumed column-mapping screen.
            navigation.replace('ImportHub', { connectionId: newConnection.Id });
        } catch (error) {
            log.error('[CSVColumnMapping] Error processing data:', error);
            showError('Import failed', 'Could not import the file. Try again.');
        } finally {
            setStage('idle');
        }
    };

    const mappedCount = Object.values(mappings).filter(Boolean).length;
    const requiredCount = CANONICAL_FIELDS.filter(f => f.required).length;
    const mappedRequiredCount = CANONICAL_FIELDS.filter(f => f.required && mappings[f.key]).length;
    const missingRequiredLabels = CANONICAL_FIELDS.filter(f => f.required && !mappings[f.key]).map(f => f.label);
    const ready = missingRequiredLabels.length === 0;

    const filteredFields = useMemo(() => {
        if (activeTab === 'required') return CANONICAL_FIELDS.filter(f => f.required);
        if (activeTab === 'optional') return CANONICAL_FIELDS.filter(f => !f.required);
        return CANONICAL_FIELDS;
    }, [activeTab]);

    const tabs = [
        { key: 'all' as const, id: 'all' as const, label: `All` },
        { key: 'required' as const, id: 'required' as const, label: `Required` },
        { key: 'optional' as const, id: 'optional' as const, label: `Optional` },
    ];

    const openSelectionModal = (fieldKey: string) => {
        setCurrentFieldKey(fieldKey);
        setSelectionModalVisible(true);
    };

    const selectColumn = (column: string) => {
        if (currentFieldKey) {
            setMappings(prev => ({
                ...prev,
                [currentFieldKey]: column,
            }));
        }
        setSelectionModalVisible(false);
        setCurrentFieldKey(null);
    };

    return (
        <View style={styles.container}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    style={styles.circleBtn}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Go back"
                >
                    <MaterialCommunityIcons name="chevron-left" size={22} color={RC.ink} />
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle} numberOfLines={1}>Map columns</Text>
                    <Text style={styles.headerSubtitle} numberOfLines={1}>
                        {csvHeaders.length} columns · {mappedCount} mapped
                    </Text>
                </View>
                <Chip
                    label={`${mappedRequiredCount}/${requiredCount} required`}
                    tone={ready ? 'ok' : 'warn'}
                    dot={false}
                    size={12}
                />
            </View>

            {/* Auto-mapping indicator */}
            {isLoadingAI && (
                <View style={styles.aiLoadingBar}>
                    <ActivityIndicator size="small" color={RC.green} />
                    <Text style={styles.aiLoadingText}>Matching your columns…</Text>
                </View>
            )}

            {/* Tabs */}
            <View style={styles.tabsWrapper}>
                <PillTabs
                    tabs={tabs}
                    value={activeTab}
                    onChange={(k) => setActiveTab(k as any)}
                />
            </View>

            {/* List */}
            <ScrollView
                style={styles.content}
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
            >
                {filteredFields.map((field, index) => {
                    const mappedCol = mappings[field.key];
                    const isMapped = !!mappedCol;
                    const sample = isMapped ? sampleRow[mappedCol] : undefined;

                    return (
                        <Animated.View
                            key={field.key}
                            entering={FadeInUp.delay(index * 24).springify()}
                        >
                            <TouchableOpacity
                                activeOpacity={0.85}
                                onPress={() => openSelectionModal(field.key)}
                                style={[styles.row, isMapped ? styles.rowMapped : styles.rowEmpty]}
                                accessibilityLabel={`Map ${field.label}`}
                            >
                                <View style={[styles.iconBox, isMapped && styles.iconBoxMapped]}>
                                    <MaterialCommunityIcons
                                        name={field.icon}
                                        size={18}
                                        color={isMapped ? RC.greenDark : RC.muted}
                                    />
                                </View>

                                <View style={styles.rowBody}>
                                    <View style={styles.rowLabelLine}>
                                        <Text style={styles.rowLabel} numberOfLines={1}>{field.label}</Text>
                                        {field.required && !isMapped && (
                                            <Text style={styles.reqTag}>required</Text>
                                        )}
                                    </View>
                                    {isMapped ? (
                                        <Text style={styles.rowValue} numberOfLines={1}>
                                            {mappedCol}
                                            {sample ? <Text style={styles.rowSample}>{`   ${sample}`}</Text> : null}
                                        </Text>
                                    ) : (
                                        <Text style={styles.rowPlaceholder} numberOfLines={1}>Select CSV column</Text>
                                    )}
                                </View>

                                {isMapped ? (
                                    <Check on size={18} />
                                ) : (
                                    <MaterialCommunityIcons name="chevron-right" size={20} color={RC.faint} />
                                )}
                            </TouchableOpacity>
                        </Animated.View>
                    );
                })}
                <View style={{ height: 24 }} />
            </ScrollView>

            {/* Footer — confirm CTA + staged import progress */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
                {isProcessing ? (
                    <View style={styles.progressWrap}>
                        <MiniProgress
                            pct={stage === 'uploading' ? 85 : 35}
                            left={
                                stage === 'uploading'
                                    ? `Uploading ${csvData.length} item${csvData.length === 1 ? '' : 's'}…`
                                    : 'Creating import…'
                            }
                            right={stage === 'uploading' ? 'Step 2 of 2' : 'Step 1 of 2'}
                        />
                    </View>
                ) : (
                    !ready && (
                        <Text style={styles.gate}>Map {missingRequiredLabels.join(', ')} to import</Text>
                    )
                )}

                <TouchableOpacity
                    style={[styles.primaryBtn, (!ready || isProcessing) && styles.primaryBtnDim]}
                    onPress={handleConfirm}
                    disabled={!ready || isProcessing}
                    accessibilityLabel="Import products"
                >
                    {isProcessing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <MaterialCommunityIcons
                                name="tray-arrow-down"
                                size={20}
                                color={ready ? '#fff' : RC.faint}
                            />
                            <Text style={[styles.primaryBtnText, !ready && { color: RC.faint }]}>
                                Import {csvData.length} {csvData.length === 1 ? 'product' : 'products'}
                            </Text>
                        </>
                    )}
                </TouchableOpacity>
            </View>

            {/* Column Selection Modal */}
            <Modal
                visible={selectionModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setSelectionModalVisible(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 12 }]}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Select column</Text>
                            <TouchableOpacity
                                onPress={() => setSelectionModalVisible(false)}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                accessibilityLabel="Close"
                            >
                                <MaterialCommunityIcons name="close" size={22} color={RC.ink} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView style={styles.modalList}>
                            <TouchableOpacity
                                style={styles.modalItem}
                                onPress={() => selectColumn('')}
                            >
                                <Text style={[styles.modalItemText, { color: RC.danger }]}>Clear mapping</Text>
                            </TouchableOpacity>
                            {csvHeaders.map((header) => (
                                <TouchableOpacity
                                    key={header}
                                    style={styles.modalItem}
                                    onPress={() => selectColumn(header)}
                                >
                                    <Text style={styles.modalItemText} numberOfLines={1}>{header}</Text>
                                    {!!sampleRow[header] && (
                                        <Text style={styles.modalItemSample} numberOfLines={1}>
                                            {sampleRow[header]}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                </View>
            </Modal>

            <ErrorModal
                visible={errorModal.visible}
                type={errorModal.type}
                title={errorModal.title}
                message={errorModal.message}
                onClose={() => setErrorModal(prev => ({ ...prev, visible: false }))}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: RC.bg,
    },
    // ── Header ──
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: RC.line,
    },
    circleBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: RC.line,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerCenter: {
        flex: 1,
        minWidth: 0,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: RC.ink,
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        fontSize: 13,
        fontWeight: '500',
        color: RC.muted,
        marginTop: 1,
    },
    // ── AI loading strip ──
    aiLoadingBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 8,
        backgroundColor: RC.greenSoft,
    },
    aiLoadingText: {
        fontSize: 13,
        fontWeight: '600',
        color: RC.greenDark,
    },
    // ── Tabs ──
    tabsWrapper: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    // ── List ──
    content: {
        flex: 1,
    },
    contentContainer: {
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: 8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 64,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 10,
    },
    rowEmpty: {
        borderColor: RC.line,
        backgroundColor: '#fff',
    },
    rowMapped: {
        borderColor: RC.greenLine,
        backgroundColor: RC.greenSoft,
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 9,
        backgroundColor: RC.surface2,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    iconBoxMapped: {
        backgroundColor: '#fff',
    },
    rowBody: {
        flex: 1,
        minWidth: 0,
    },
    rowLabelLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rowLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: RC.ink,
        flexShrink: 1,
    },
    reqTag: {
        fontSize: 11,
        fontWeight: '700',
        color: RC.danger,
    },
    rowValue: {
        fontSize: 13,
        fontWeight: '600',
        color: RC.greenDark,
        marginTop: 2,
    },
    rowSample: {
        fontWeight: '500',
        color: RC.faint,
    },
    rowPlaceholder: {
        fontSize: 13,
        fontWeight: '500',
        color: RC.faint,
        marginTop: 2,
    },
    // ── Footer ──
    footer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: RC.line,
        backgroundColor: '#fff',
    },
    progressWrap: {
        paddingTop: 2,
        paddingBottom: 2,
    },
    gate: {
        fontSize: 13,
        fontWeight: '600',
        color: RC.danger,
        textAlign: 'center',
    },
    primaryBtn: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: RC.green,
        borderRadius: 12,
        paddingVertical: 15,
    },
    primaryBtnDim: {
        backgroundColor: RC.surface2,
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
    // ── Modal ──
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(17,24,39,0.45)',
        justifyContent: 'flex-end',
    },
    modalContainer: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: RC.line,
    },
    modalTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: RC.ink,
    },
    modalList: {},
    modalItem: {
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: RC.surface2,
    },
    modalItemText: {
        fontSize: 15,
        fontWeight: '600',
        color: RC.ink2,
    },
    modalItemSample: {
        fontSize: 13,
        fontWeight: '500',
        color: RC.faint,
        marginTop: 3,
    },
});
