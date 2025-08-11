import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { 
    View, Text, StyleSheet, Image, Dimensions, ActivityIndicator, 
    Pressable, Modal, TouchableOpacity, SafeAreaView, ScrollView, TextInput, Alert
} from 'react-native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { FlashList } from '@shopify/flash-list';
import { supabase } from '../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformButton from '../components/PlatformButton';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { LinearGradient } from 'expo-linear-gradient';
import { PackageCheck } from 'lucide-react';

// --- 1. Define Comprehensive Types (from previous step) ---
interface Price {
    value: string;
    extracted_value: number;
    currency: string;
}

interface SerpApiData {
    position: number;
    title: string;
    link: string;
    source: string;
    source_icon: string;
    thumbnail?: string;
    image?: string;
    rating?: number;
    reviews?: number;
    price?: Price;
    condition?: string;
    in_stock?: boolean;
}

interface Result {
    productIndex: number;
    serpApiData: SerpApiData[];
}

export interface Analysis {
    jobId: string;
    results: Result[];
}

export interface JobResponse {
    jobId: string;
    status: string;
    estimatedTimeMinutes: number,
    totalProducts: number,
    message: string,
}

// Payload type for generate job submission
interface GenerateJobSubmitPayload {
    products: Array<{
        productIndex: number;
        productId?: string;
        variantId?: string;
        imageUrls: string[];
        coverImageIndex: number;
        selectedMatches?: SerpApiData[];
    }>;
    selectedPlatforms: string[];
    template?: string | null;
    options?: { useScraping?: boolean };
    platformRequests?: Array<{ platform: string; fieldSources?: Record<string, string[]>; customPrompt?: string }>;
    templateSources?: string[];
}

// Template builder types
type PlatformFieldRow = {
    id: string;
    platform: string; // 'shopify' | 'amazon' | 'ebay' | ...
    field: string; // e.g., title, description, price
    sources: string[]; // preferred domains in order
};

type TemplateDraft = {
    sources: string[]; // user-added sources/domains
    fieldRows: PlatformFieldRow[];
};

// --- Helper Functions & Constants ---
const SSSYNC_API_BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
const { width: screenWidth } = Dimensions.get('window');
const GRID_PADDING = 16;
const ITEM_SPACING = 12;
const COLUMNS = 3;
const ITEM_WIDTH = (screenWidth - GRID_PADDING * 2 - ITEM_SPACING * (COLUMNS - 1)) / COLUMNS;

async function getToken() {
    const session = await supabase.auth.getSession();
    return session?.data.session?.access_token;
}

// --- Reusable Components ---

// Optimized ProductGridItem with instant feedback
const ProductGridItem = React.memo(({ item, isSelected, onSelect }: { 
    item: SerpApiData, 
    isSelected: boolean, 
    onSelect: () => void 
}) => {
    return (
        <Pressable 
            onPress={onSelect} 
            style={({ pressed }) => [
                styles.itemContainer, 
                isSelected && styles.itemSelected,
                pressed && styles.itemPressed
            ]}
        >
            <Image source={{ uri: item.thumbnail || item.image }} style={styles.itemImage} />
            {isSelected && (
                <View style={styles.selectionOverlay}>
                    <Icon name="check-circle" size={54} color="#FFFFFF" />
                </View>
            )}
            <View style={styles.itemDetails}>
                <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.itemPrice}>{item.price?.value}</Text>
                <Text style={styles.itemCondition}>{item.condition}</Text>
                <Text style={styles.itemSource}>{item.source}</Text>
            </View>
        </Pressable>
    );
});


// --- Main Screen Component ---

function MatchSelectionScreen({ route }: { route: RouteProp<AppStackParamList, 'MatchSelectionScreen'> }) {
    const navigation = useNavigation<any>();
    const { jobId } = route.params.response;
    const { isConnected } = usePlatformConnections();

    // --- State Management ---
    const [analysisData, setAnalysisData] = useState<Analysis | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // State for the new UI flow
    const [
        selectedIndices, 
        setSelectedIndices
    ] = useState<number[]>([]);
    const [
        selectedProducts, 
        setSelectedProducts
    ] = useState<SerpApiData[]>([]);
    const [bottomNavState, setBottomNavState] = useState<'empty' | 'selection' | 'template' | 'platform'>('empty');
    const [isTemplateModalVisible, setTemplateModalVisible] = useState(false);
    const [templateModalView, setTemplateModalView] = useState<'picker' | 'create'>('picker');
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

    // Template builder state
    const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({ sources: [], fieldRows: [] });
    const [userTemplates, setUserTemplates] = useState<any[]>([]);
    const [templateOffset, setTemplateOffset] = useState(0);
    const pageSize = 20;
    const [hasMoreTemplates, setHasMoreTemplates] = useState(true);
    const [isLoadingMoreTemplates, setIsLoadingMoreTemplates] = useState(false);
    const [sourceInput, setSourceInput] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [openDropdown, setOpenDropdown] = useState<{ rowId: string | null; type: 'platform' | 'field' | null }>({ rowId: null, type: null });
    const [dropdownSearchQuery, setDropdownSearchQuery] = useState('');
    const [manageMode, setManageMode] = useState(false);
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
    const [hiddenDefaults, setHiddenDefaults] = useState<Set<string>>(new Set());
    const [unfavoritedDefaults, setUnfavoritedDefaults] = useState<Set<string>>(new Set());
    const [genResponse, setGenResponse] = useState<JobResponse | null>(null);

    // Dropdown options with icons
    const PLATFORM_OPTIONS = [
        { key: 'shopify', label: 'Shopify', icon: 'shopping' },
        { key: 'amazon', label: 'Amazon', icon: 'package' },
        { key: 'ebay', label: 'eBay', icon: 'shopping' },
        { key: 'clover', label: 'Clover', icon: 'leaf' },
        { key: 'square', label: 'Square', icon: 'square-outline' },
        { key: 'facebook', label: 'Facebook', icon: 'facebook' },
    ];

    const FIELD_OPTIONS = [
        { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description' },
        { key: 'price', label: 'Price' },
        { key: 'tags', label: 'Tags' },
        { key: 'brand', label: 'Brand' },
        { key: 'condition', label: 'Condition' },
    ];

    // Generated naming helpers for templates
    const humanizeDomain = (domain: string): string => {
        const d = (domain || '').toLowerCase();
        const first = d.split('.')[0] || '';
        if (first === 'www') return (d.split('.')[1] || 'Site').replace(/\b\w/g, c => c.toUpperCase());
        return first.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const generateNameFromSources = (sources: string[]): string => {
        if (!Array.isArray(sources) || sources.length === 0) return 'Custom Template';
        const names = sources.slice(0, 2).map(humanizeDomain);
        const remaining = Math.max(0, sources.length - names.length);
        if (remaining > 0) return `${names.join(' + ')} + ${remaining} more...`;
        return names.join(' + ');
    };

    const effectiveName = useCallback((tpl: any) => {
        const name = tpl?.Name || tpl?.name;
        if (name && String(name).trim().length > 0) return String(name).trim();
        return generateNameFromSources(tpl?.SuggestedSites || tpl?.suggestedSites || []);
    }, []);

    const favorites = useMemo(() => {
        return userTemplates
            .filter(t => t.isFavorite === true)
            .sort((a, b) => effectiveName(a).localeCompare(effectiveName(b)));
    }, [userTemplates, effectiveName]);

    const recents = useMemo(() => {
        return userTemplates
            .filter(t => !t.isFavorite)
            .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));
    }, [userTemplates]);

    const getTplId = (tpl: any): string => tpl?.Id || tpl?.id;
    function getUpdatedAt(tpl: any): number {
        return new Date(tpl?.UpdatedAt || tpl?.updated_at || 0).getTime();
    }

    const toggleManageMode = useCallback(() => {
        setManageMode(prev => !prev);
        setSelectedTemplateIds(new Set());
    }, []);

    const toggleSelectTemplate = useCallback((tplId: string) => {
        setSelectedTemplateIds(prev => {
            const next = new Set(prev);
            if (next.has(tplId)) next.delete(tplId); else next.add(tplId);
            return next;
        });
    }, []);

    const bulkDeleteSelected = useCallback(async () => {
        if (selectedTemplateIds.size === 0) return;
        try {
            Alert.alert('Delete Templates', `Delete ${selectedTemplateIds.size} selected template(s)?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                    // Split defaults vs real ids
                    const defaultIds = Array.from(selectedTemplateIds).filter(id => id.startsWith('default-'));
                    const realIds = Array.from(selectedTemplateIds).filter(id => !id.startsWith('default-'));
                    if (realIds.length > 0) {
                        await supabase.from('SearchTemplates').delete().in('Id', realIds);
                    }
                    if (defaultIds.length > 0) {
                        setHiddenDefaults(prev => new Set([...Array.from(prev), ...defaultIds]));
                    }
                    setUserTemplates(prev => prev.filter(t => !selectedTemplateIds.has(getTplId(t))));
                    setSelectedTemplateIds(new Set());
                }},
            ]);
        } catch {}
    }, [selectedTemplateIds]);

    // --- Data Fetching ---
    useEffect(() => {
        navigation.setOptions({ headerShown: false });

        const fetchAnalysis = async () => {
            try {
                const token = await getToken();
                const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/match/jobs/${jobId}/results`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error(`API Error: ${response.status}`);
                const data: Analysis = await response.json();
                setAnalysisData(data);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchAnalysis();
        // load current user for template ownership/save
        (async () => {
            try {
                const { data } = await supabase.auth.getUser();
                setCurrentUserId(data.user?.id || null);
            } catch {}
        })();
    }, [jobId]);

    const fetchTemplatesPage = useCallback(async (offset: number, replace: boolean = false) => {
        try {
            const { data, error } = await supabase
                .from('SearchTemplates')
                .select('*')
                .order('UpdatedAt', { ascending: false })
                .range(offset, offset + pageSize - 1);
            if (error) return;
            if (replace) {
                setUserTemplates(data || []);
            } else if (data && data.length) {
                setUserTemplates(prev => [...prev, ...data]);
            }
            if (!data || data.length < pageSize) {
                setHasMoreTemplates(false);
            }
        } catch {}
    }, [pageSize]);

    // Fetch user's templates when modal opens and when switching to picker
    useEffect(() => {
        if (!isTemplateModalVisible || templateModalView !== 'picker') return;
        setTemplateOffset(0);
        setHasMoreTemplates(true);
        fetchTemplatesPage(0, true);
    }, [isTemplateModalVisible, templateModalView, fetchTemplatesPage]);

    const loadMoreTemplates = useCallback(async () => {
        if (!hasMoreTemplates || isLoadingMoreTemplates) return;
        setIsLoadingMoreTemplates(true);
        const nextOffset = templateOffset + pageSize;
        await fetchTemplatesPage(nextOffset, false);
        setTemplateOffset(nextOffset);
        setIsLoadingMoreTemplates(false);
    }, [hasMoreTemplates, isLoadingMoreTemplates, templateOffset, pageSize, fetchTemplatesPage]);

    // Helpers for template
    const parseDomain = (input: string): string | null => {
        try {
            let raw = input.trim().toLowerCase();
            // strip protocol
            raw = raw.replace(/^https?:\/\//, '');
            raw = raw.replace(/\/$/, '');
            // if no dot and no spaces, assume .com
            if (!raw.includes('.') && !raw.includes(' ')) raw = `${raw}.com`;
            // if contains spaces, take the token that looks like a domain
            if (raw.includes(' ')) {
                const token = raw.split(/\s+/).find(t => t.includes('.')) || raw.split(/\s+/)[0];
                raw = token;
                if (!raw.includes('.')) raw = `${raw}.com`;
            }
            const u = new URL(`https://${raw}`);
            return u.hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    };

    const faviconFor = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;

    const addSource = useCallback(() => {
        const domain = parseDomain(sourceInput.trim());
        if (!domain) return;
        setTemplateDraft(prev => ({ ...prev, sources: Array.from(new Set([...prev.sources, domain])) }));
        setSourceInput('');
    }, [sourceInput]);

    const removeSource = useCallback((domain: string) => {
        setTemplateDraft(prev => ({ ...prev, sources: prev.sources.filter(d => d !== domain) }));
    }, []);

    const addFieldRow = useCallback(() => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: [
                ...prev.fieldRows,
                { id: `${Date.now()}`, platform: 'shopify', field: 'title', sources: prev.sources.slice(0, 1) },
            ],
        }));
    }, []);

    const updateFieldRow = useCallback((id: string, patch: Partial<PlatformFieldRow>) => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: prev.fieldRows.map(r => (r.id === id ? { ...r, ...patch } : r)),
        }));
    }, []);

    const toggleRowSource = useCallback((id: string, domain: string) => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: prev.fieldRows.map(r => {
                if (r.id !== id) return r;
                const exists = r.sources.includes(domain);
                return { ...r, sources: exists ? r.sources.filter(d => d !== domain) : [...r.sources, domain] };
            }),
        }));
    }, []);

    const deleteFieldRow = useCallback((id: string) => {
        setTemplateDraft(prev => ({ ...prev, fieldRows: prev.fieldRows.filter(r => r.id !== id) }));
    }, []);

    const buildPlatformRequests = (): Array<{ platform: string; fieldSources?: Record<string, string[]> }> => {
        const grouped: Record<string, Record<string, string[]>> = {};
        for (const row of templateDraft.fieldRows) {
            if (!grouped[row.platform]) grouped[row.platform] = {};
            grouped[row.platform][row.field] = row.sources;
        }
        return Object.entries(grouped).map(([platform, fieldSources]) => ({ platform, fieldSources }));
    };

    // --- Optimized Event Handlers ---
    const handleSelectProduct = useCallback((index: number) => {
        setSelectedIndices(prev => {
            const newSelection = prev.includes(index)
                ? prev.filter(i => i !== index)
                : [...prev, index];
            
            // Reset flow when items are deselected
            if (newSelection.length === 0) {
                setBottomNavState('empty');
                setSelectedPlatforms([]);
                setSelectedTemplate(null);
            } else if (newSelection.length > 0 && bottomNavState === 'empty') {
                // Auto-advance to template stage when first item is selected
                setBottomNavState('selection');
            }
            return newSelection;
        });
    }, [bottomNavState]);

    const handleBackToEmpty = useCallback(() => {
        setSelectedIndices([]);
        setBottomNavState('empty');
        setSelectedPlatforms([]);
        setSelectedTemplate(null);
    }, []);

    const handleBackToTemplate = useCallback(() => {
        setBottomNavState('template');
        setSelectedPlatforms([]);
    }, []);

    const handleShowTemplates = useCallback(() => {
        setBottomNavState('template');
    }, []);

    const handleShowSelection = useCallback(() => {
        setBottomNavState('selection');
    }, []);

    const handleBackToSelection = useCallback (() =>{
        setBottomNavState('selection');
        }, [bottomNavState]);

    const handleTemplateSelect = useCallback((template: string | null) => {
        setSelectedTemplate(template);
        setTemplateModalVisible(false);
        setBottomNavState('platform'); // Move to platform selection
    }, []);
    

    const handlePlatformSelect = useCallback((platform: string) => {
        setSelectedPlatforms(prev => 
            prev.includes(platform)
                ? prev.filter(p => p !== platform)
                : [...prev, platform]
        );
    }, []);

    const handleGenerate = useCallback(async () => {
        const token = await getToken();
        const serpApiData = analysisData?.results[0]?.serpApiData || [];
        const selectedMatches = selectedIndices.map(i => serpApiData[i]).filter(Boolean);

        const payload: GenerateJobSubmitPayload = {
            products: [
                {
                    productIndex: 0,
                    imageUrls: selectedMatches.length > 0 ? [selectedMatches[0].image || selectedMatches[0].thumbnail || ''] : [],
                    coverImageIndex: 0,
                    selectedMatches,
                },
            ],
            selectedPlatforms,
            template: selectedTemplate,
            options: { useScraping: true },
            templateSources: templateDraft.sources,
            platformRequests: buildPlatformRequests(),
        };

        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/generate/jobs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Submit failed (${response.status}): ${text}`);
        }

        const data = await response.json();

        return data;

    }, [selectedIndices, analysisData, selectedTemplate, selectedPlatforms]);

    // Memoize expensive computations
    const serpApiData = useMemo(() => {
        return analysisData?.results[0]?.serpApiData || [];
    }, [analysisData]);

    const selectedCount = selectedIndices.length;

    // --- Render Logic ---
    if (isLoading) return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#93C822" /></View>;
    if (error) return <View style={styles.centerContainer}><Text style={styles.errorText}>Error: {error}</Text></View>;
    if (!analysisData || analysisData.results.length === 0 || serpApiData.length === 0) {
        return <View style={styles.centerContainer}><Text style={styles.infoText}>No results found.</Text></View>;
    }

    return (
        <View style={styles.container}>

            <FlashList
                data={serpApiData}
                extraData={selectedIndices}
                numColumns={COLUMNS}
                contentContainerStyle={{ padding: GRID_PADDING }}
                keyExtractor={(item, index) => `${item.position}-${index}`}
                estimatedItemSize={ITEM_WIDTH + 60}
                renderItem={({ item, index }) => (
                    <ProductGridItem
                        item={item}
                        isSelected={selectedIndices.includes(index)}
                        onSelect={() => handleSelectProduct(index)}
                    />
                )}
                removeClippedSubviews={false}
            />

            {/* Prompt when nothing is selected */}
            {selectedCount === 0 && (
                <View style={styles.selectPromptContainer} pointerEvents="box-none">
                    <TouchableOpacity style={styles.selectPromptButton} onPress={handleShowSelection} activeOpacity={0.9}>
                        <Icon name="cursor-default-click" size={18} color="#000" style={{marginRight: 8}}/>
                        <Text style={styles.selectPromptText}>Select product matches</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* --- Enhanced Bottom Navigation Bar --- */}
            <LinearGradient colors={['rgb(255, 255, 255)', 'rgba(255, 255, 255, 0)']} style={{}}>
                
                {/* Empty State */}
                {bottomNavState === 'empty' && (
                    <View style={styles.emptyButtonSolo}>
                        {selectedCount< 1? (
                        <>
                            <TouchableOpacity style={styles.mainEmptyButton} onPress={handleShowSelection}>
                                <Icon name="package-variant-closed" size={20} color="#000" style={{marginRight: 8}}/>
                                <Text style={styles.secondaryButtonText}>Select Product Matches</Text>
                            </TouchableOpacity>
                        </>
                        ):(
                            <TouchableOpacity style={styles.mainEmptyButton} onPress={handleShowSelection}>
                                <Icon name="package-variant-closed" size={20} color="#000" style={{marginRight: 8}}/>
                                <Text style={styles.secondaryButtonText}>Select Product Matches</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {bottomNavState === 'selection' && (
                    <View style={styles.bottomNavStepContainer}>
                        {selectedCount > 0 ? (
                            <>
                                <TouchableOpacity style={styles.mainButton} onPress={handleShowTemplates}>
                                    <Icon name="check-circle" size={20} color="#fff" style={{marginRight: 8}}/>
                                    <Text style={styles.mainButtonText}>Selected {selectedCount} Match{selectedCount !== 1 ? 'es' : ''}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.backButton} onPress={handleBackToEmpty}>
                                    <Text style={styles.backButtonText}>Clear Selection</Text>
                                </TouchableOpacity>
                            </>
                        ) : (
                            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
                                <Icon name="redo-variant" size={20} color="#888" style={{marginRight: 8}}/>
                                <Text style={styles.backButtonText}>Back</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}
    
                {bottomNavState === 'template' && (
                    <View style={styles.bottomNavStepContainer}>
                        <TouchableOpacity style={styles.clearBackButton} onPress={handleBackToSelection}>
                            <Icon name="redo-variant" size={20} color="#888" style={{marginRight: 8}}/>
                            <Text style={styles.backButtonText}>Reselect Matches</Text>
                        </TouchableOpacity>
                        <Text style={styles.platformHeaderText}>Want Specific Sources?</Text>
                        <TouchableOpacity style={styles.dropdownSelect} onPress={() => setTemplateModalVisible(true)}>
                            <Text style={styles.dropdownSelectText}>{selectedTemplate ? selectedTemplate : 'Select a Template'}</Text>
                            <Icon name="chevron-down" size={20} color="#000" style={{marginRight: 8}}/>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryButton} onPress={() => handleTemplateSelect(null)}>
                            <Text style={styles.secondaryButtonText}>Continue w/o Template</Text>
                        </TouchableOpacity>
                        
                    </View>
                )}

                {bottomNavState === 'platform' && (
                    

                    <View style={styles.expandedBottomNav}>
                        <View style={{flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12}}>
                            <TouchableOpacity style={styles.clearBackButton} onPress={handleBackToSelection}>
                                <Icon name="redo-variant" size={20} color="#888" style={{marginRight: 8}}/>
                                <Text style={styles.backButtonText}>Reselect Matches</Text>
                                
                            </TouchableOpacity>
                            <Text style={styles.platformHeaderText}>Want Specific Sources?</Text>
                            <TouchableOpacity style={styles.dropdownSelect} onPress={() => setTemplateModalVisible(true)}>
                                <Text style={styles.dropdownSelectText}>
                                    {selectedTemplate ? selectedTemplate : 'Select a Template'}
                                </Text>
                                <Icon name="chevron-down" size={20} color="#000" style={{marginRight: 8}}/>
                            </TouchableOpacity>
                        </View>
                    
                        
                        <View style={{flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12, paddingVertical: 12}}>
                            <View style={styles.platformHeader}>
                    
                                <Text style={styles.platformHeaderText}>Which Platforms?</Text>
                                <View style={{width: 24}} />
                            </View>
                            <View style={styles.platformGrid}>
                                <PlatformButton 
                                    platform={'shopify'} 
                                    isSelected={selectedPlatforms.includes('shopify')} 
                                    onPress={() => handlePlatformSelect('shopify')}
                                    isConnected={isConnected('shopify')}
                                />
                                <PlatformButton 
                                    platform={'amazon'} 
                                    isSelected={selectedPlatforms.includes('amazon')} 
                                    onPress={() => handlePlatformSelect('amazon')}
                                    isConnected={isConnected('amazon')}
                                />
                                <PlatformButton 
                                    platform={'ebay'} 
                                    isSelected={selectedPlatforms.includes('ebay')} 
                                    onPress={() => handlePlatformSelect('ebay')}
                                    isConnected={isConnected('ebay')}
                                />
                                <PlatformButton 
                                    platform={'clover'} 
                                    isSelected={selectedPlatforms.includes('clover')} 
                                    onPress={() => handlePlatformSelect('clover')}
                                    isConnected={isConnected('clover')}
                                />
                                <PlatformButton 
                                    platform={'square'} 
                                    isSelected={selectedPlatforms.includes('square')} 
                                    onPress={() => handlePlatformSelect('square')}
                                    isConnected={isConnected('square')}
                                />
                                <PlatformButton 
                                    platform={'facebook'} 
                                    isSelected={selectedPlatforms.includes('facebook')} 
                                    onPress={() => handlePlatformSelect('facebook')}
                                    isConnected={isConnected('facebook')}
                                />
                            </View>
                            <TouchableOpacity 
                                style={[styles.mainButton, selectedPlatforms.length === 0 && styles.disabledButton]}
                                disabled={selectedPlatforms.length === 0}
                                onPress={async () => {
                                    console.log("Starting Generation")

                                    //take selected items images & create array.
                                    //imageUrls: selectedMatches.length > 0 ? [selectedMatches[0].image || selectedMatches[0].thumbnail || ''] : [],
                                    //const firstPhotos = bulkItems.map(item => item.photos[0]).filter(Boolean);
                                    const selectedMatches = selectedIndices.map(i => serpApiData[i]).filter(Boolean);
                                    const firstPhotos = selectedMatches.map(item => item.image || item.thumbnail || '').filter(Boolean);
                                    try {
                                        const submitResult: JobResponse = await handleGenerate();
                                        const jobId = submitResult?.jobId;
                                        
                                
                                        if (jobId) {
                                            navigation.navigate("LoadingScreen", {
                                                processType: 'generate',
                                                payload: {
                                                    jobId: jobId,
                                                    firstPhotos: firstPhotos,
                                                    //Need to add bulk items
                                                    //bulkItems: bulkItems,
                                                },
                                                onCompleteRoute: {
                                                    screen: "GenerateDetailsScreen",
                                                    params: {
                                                        jobResponse: submitResult,
                                                        jobId: jobId,
                                                    }
                                                }
                                            });
                                        } else {
                                            Alert.alert('Error', 'Failed to get valid jobId, try again later');
                                        }


                                    } catch (error) {
                                        console.log('Error starting generation');
                                        Alert.alert('Error starting generation');
                                        

                                    }

                                    }
                                }
                            >
                                <Icon name="rocket-launch-outline" size={20} color="#fff" style={{marginRight: 8}}/>
                                <Text style={styles.mainButtonText}>Generate Listings ({selectedPlatforms.length} platform{selectedPlatforms.length !== 1 ? 's' : ''})</Text>
                            </TouchableOpacity>

                        </View>
                        
                    </View>
                )}
            </LinearGradient>

            {/* --- Enhanced Template Selection Modal --- */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={isTemplateModalVisible}
                onRequestClose={() => setTemplateModalVisible(false)}
            >
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { maxHeight: '80%', height: '80%' }]}>
                        <View style={styles.modalHeader}>
                            {templateModalView === 'create' ? (
                                <TouchableOpacity 
                                    style={styles.modalCloseButton} 
                                    onPress={() => setTemplateModalView('picker')}
                                >
                                    <Icon name="arrow-left" size={24} color="#000" />
                                </TouchableOpacity>
                            ) : (
                                <View style={{width:24}} />
                            )}
                            <Text style={styles.modalTitle}>{templateModalView === 'picker' ? 'Templates' : 'Create New Template'}</Text>
                            <TouchableOpacity 
                                style={styles.modalCloseButton} 
                                onPress={() => setTemplateModalVisible(false)}
                            >
                                <Icon name="close" size={24} color="#000" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.templateScrollView} contentContainerStyle={{ paddingBottom: 120 }}>
                            {templateModalView === 'picker' && (
                            <>
                            {/* Favorites */}
                            <View style={styles.templateSection}>
                                <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
                                <Text style={styles.sectionTitle}>Favorites</Text>
                                    <View style={{flexDirection:'row', gap:8}}>
                                        <TouchableOpacity onPress={toggleManageMode} style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:8, paddingVertical:6, paddingHorizontal:10}}>
                                            <Text style={{color:'#000'}}>{manageMode ? 'Done' : 'Manage'}</Text>
                                        </TouchableOpacity>
                                        {manageMode && (
                                            <TouchableOpacity onPress={bulkDeleteSelected} style={{borderWidth:1, borderColor:'#e11d48', borderRadius:8, paddingVertical:6, paddingHorizontal:10}}>
                                                <Text style={{color:'#e11d48'}}>Delete</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </View>
                                {[{Id:'default-amazon', Name:'Amazon Default', SuggestedSites:['amazon.com']}, {Id:'default-ebay', Name:'eBay Default', SuggestedSites:['ebay.com']}]
                                  .filter(def => !hiddenDefaults.has(def.Id))
                                  .map(def => (
                                    <TouchableOpacity key={def.Name} style={styles.templateOption} onPress={() => {
                                        const autoName = generateNameFromSources(def.SuggestedSites);
                                        setSelectedTemplate(autoName);
                                        setTemplateDraft({ sources: def.SuggestedSites, fieldRows: [] });
                                        setTemplateName(autoName);
                                        setEditingTemplateId(null);
                                        setTemplateModalView('create');
                                    }}>
                                        <View style={[styles.templateRow, {alignItems:'center', paddingRight: 20, justifyContent:'space-between'}]}>
                                            <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
                                                {def.SuggestedSites.slice(0,2).map(s => (
                                                    <Image key={s} source={{ uri: faviconFor(s) }} style={{ width:18, height:18 }} />
                                                ))}
                                            </View>
                                            <Text style={styles.templateOptionText}>{generateNameFromSources(def.SuggestedSites)}</Text>
                                            <View style={{flexDirection:'row', alignItems:'center', gap:16}}>
                                                {!manageMode && (
                                                    <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}}
                                                        onPress={async ()=>{ try {
                                                            const name = generateNameFromSources(def.SuggestedSites);
                                                            const insert = await supabase.from('SearchTemplates').insert({
                                                                Name: name,
                                                                Category: 'General',
                                                                Description: 'Default starter template',
                                                                SearchPrompt: 'User-defined',
                                                                SuggestedSites: def.SuggestedSites,
                                                                ExtractionSchema: { fieldSourceMappings: {} },
                                                                IsDefault: false,
                                                                IsPublic: false,
                                                                isFavorite: false
                                                            }).select('*').single();
                                                            if (!insert.error && insert.data) {
                                                                setUserTemplates(prev => [insert.data, ...prev]);
                                                                setHiddenDefaults(prev => new Set([...Array.from(prev), def.Id]));
                                                            }
                                                        } catch {} }}>
                                                        <Icon name="star-outline" size={22} color="#71717A" />
                                                    </TouchableOpacity>
                                                )}
                                                {manageMode && (
                                                    <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={() => {
                                                        setHiddenDefaults(prev => new Set([...Array.from(prev), def.Id]));
                                                    }}>
                                                        <Icon name="delete-outline" size={22} color="#e11d48" />
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                                {favorites.map((tpl) => (
                                    <TouchableOpacity key={tpl.Id || tpl.id || tpl.Name} style={[styles.templateOption, manageMode && {backgroundColor: selectedTemplateIds.has(getTplId(tpl))? 'rgba(147,200,34,0.1)': '#fff'}]} onPress={() => {
                                        if (manageMode) { toggleSelectTemplate(getTplId(tpl)); return; }
                                        // Use template
                                        setSelectedTemplate(tpl.Name || tpl.name || 'Template');
                                        const sources = tpl.SuggestedSites || tpl.suggestedSites || [];
                                        const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                        const rows: PlatformFieldRow[] = [];
                                        Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                            Object.entries(fsObj as Record<string,string[]>).forEach(([field, srcs])=>{
                                                rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                            });
                                        });
                                        setTemplateDraft({ sources, fieldRows: rows });
                                        setTemplateModalVisible(false);
                                        setBottomNavState('platform');
                                    }}>
                                        <View style={[styles.templateItems]}>
                                            <View style={{flex:1, flexDirection:'row', alignItems:'center'}}>
                                                <View style={{flexDirection:'row', alignItems:'center', gap:6, marginRight:8}}>
                                                {Array.isArray(tpl.SuggestedSites) && tpl.SuggestedSites.slice(0,2).map((s:string) => (
                                                    <Image key={s} source={{ uri: faviconFor(s) }} style={{ width:18, height:18 }} />
                                ))}
                            </View>
                                                <Text style={styles.templateOptionText} numberOfLines={1}>
                                                    {(tpl.Name && tpl.Name.trim().length>0) ? tpl.Name : generateNameFromSources(tpl.SuggestedSites || [])}
                                                </Text>
                                            </View>
                                            {/* Buttons */}
                                            <View style={{flexDirection:'row', alignItems:'center', gap:16}}>
                                                {!manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={async ()=>{ try { await supabase.from('SearchTemplates').update({ isFavorite: false }).eq('Id', tpl.Id); setUserTemplates(prev=>prev.map(p=>p.Id===tpl.Id?{...p,isFavorite:false}:p)); } catch {} }}>
                                                    <Icon name="star" size={24} color="#FFD700" />
                                                </TouchableOpacity>)}
                                                {!manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={() => {
                                                    // Edit template (update if owned else copy)
                                                    const sources = tpl.SuggestedSites || [];
                                                    const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                    const rows: PlatformFieldRow[] = [];
                                                    Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                        Object.entries(fsObj as Record<string,string[]>).forEach(([field, srcs])=>{
                                                            rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                        });
                                                    });
                                                    setTemplateDraft({ sources, fieldRows: rows });
                                                    setSelectedTemplate(tpl.Name || '');
                                                    setTemplateName(tpl.Name || '');
                                                    setEditingTemplateId(tpl.Id || tpl.id || null);
                                                    setTemplateModalView('create');
                                                }}>
                                                    <Icon name="pencil" size={22} color="#71717A" />
                                                </TouchableOpacity>)}
                                                {/* Reordering disabled per latest request (manage = delete only) */}
                                                {manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={async ()=>{
                                                    try {
                                                        Alert.alert('Delete Template', 'Are you sure you want to delete this template?', [
                                                            { text: 'Cancel', style: 'cancel' },
                                                            { text: 'Delete', style: 'destructive', onPress: async () => {
                                                                await supabase.from('SearchTemplates').delete().eq('Id', tpl.Id);
                                                                setUserTemplates(prev => prev.filter(p => p.Id !== tpl.Id));
                                                            } }
                                                        ]);
                                                    } catch {}
                                                }}>
                                                    <Icon name="delete-outline" size={22} color="#e11d48" />
                                                </TouchableOpacity>)}
                            </View>
                                        </View>
                                    </TouchableOpacity>
                                ))}

                            </View>

                            {/* Recents + Load More */}
                            <View style={styles.templateSection}>
                                <Text style={styles.sectionTitle}>Recents</Text>
                                {recents.map((tpl) => (
                                    <TouchableOpacity key={tpl.Id || tpl.id || tpl.Name} style={[styles.templateOption, manageMode && {backgroundColor: selectedTemplateIds.has(getTplId(tpl))? 'rgba(147,200,34,0.1)': '#fff'}]} onPress={() => {
                                        if (manageMode) { toggleSelectTemplate(getTplId(tpl)); return; }
                                        setSelectedTemplate(tpl.Name || tpl.name || 'Template');
                                        const sources = tpl.SuggestedSites || tpl.suggestedSites || [];
                                        const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                        const rows: PlatformFieldRow[] = [];
                                        Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                            Object.entries(fsObj as Record<string,string[]>).forEach(([field, srcs])=>{
                                                rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                            });
                                        });
                                        setTemplateDraft({ sources, fieldRows: rows });
                                        setTemplateModalVisible(false);
                                        setBottomNavState('platform');
                                    }}>
                                        <View style={[styles.templateItems]}>
                                            <View style={{flex:1, flexDirection:'row', alignItems:'center'}}>
                                                <View style={{flexDirection:'row', alignItems:'center', gap:6, marginRight:8}}>
                                                {Array.isArray(tpl.SuggestedSites) && tpl.SuggestedSites.slice(0,2).map((s:string) => (
                                                    <Image key={s} source={{ uri: faviconFor(s) }} style={{ width:18, height:18 }} />
                                                ))}
                                                </View>
                                                <Text style={styles.templateOptionText} numberOfLines={1}>
                                                    {(tpl.Name && tpl.Name.trim().length>0) ? tpl.Name : generateNameFromSources(tpl.SuggestedSites || [])}
                                                </Text>
                                            </View>
                                            <View style={{flexDirection:'row', alignItems:'center', gap:16}}>
                                                {!manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={() => {
                                                    const sources = tpl.SuggestedSites || [];
                                                    const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                    const rows: PlatformFieldRow[] = [];
                                                    Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                        Object.entries(fsObj as Record<string,string[]>).forEach(([field, srcs])=>{
                                                            rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                        });
                                                    });
                                                    setTemplateDraft({ sources, fieldRows: rows });
                                                    setSelectedTemplate(tpl.Name || '');
                                                    setTemplateName(tpl.Name || '');
                                                    setEditingTemplateId(tpl.Id || tpl.id || null);
                                                    setTemplateModalView('create');
                                                }}>
                                                    <Icon name="pencil" size={22} color="#71717A" />
                                                </TouchableOpacity>)}
                                                {!manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={async ()=>{ try { await supabase.from('SearchTemplates').update({ isFavorite: true }).eq('Id', tpl.Id); setUserTemplates(prev=>prev.map(p=>p.Id===tpl.Id?{...p,isFavorite:true}:p)); } catch {} }}>
                                                    <Icon name="star-outline" size={24} color="#71717A" />
                                                </TouchableOpacity>)}
                                                {manageMode && (
                                                <TouchableOpacity hitSlop={{top:8,bottom:8,left:8,right:8}} onPress={async ()=>{
                                                    try {
                                                        Alert.alert('Delete Template', 'Delete this template?', [
                                                            { text: 'Cancel', style: 'cancel' },
                                                            { text: 'Delete', style: 'destructive', onPress: async () => {
                                                                await supabase.from('SearchTemplates').delete().eq('Id', tpl.Id);
                                                                setUserTemplates(prev => prev.filter(p => p.Id !== tpl.Id));
                                                            } }
                                                        ]);
                                                    } catch {}
                                                }}>
                                                    <Icon name="delete-outline" size={22} color="#e11d48" />
                                                </TouchableOpacity>)}
                                            </View>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                                {hasMoreTemplates && (
                                    <TouchableOpacity onPress={loadMoreTemplates} style={{marginTop:10, borderWidth:1, borderColor:'#E5E5E5', borderRadius:10, paddingVertical:10, alignItems:'center'}}>
                                        <Text style={{color:'#000'}}>{isLoadingMoreTemplates ? 'Loading...' : 'Load More'}</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                            </>
                            )}

                            {templateModalView === 'create' && (
                            <View style={{flex:1, minHeight: 700}}>

                            {/* Template name */}
                            <View style={styles.templateSection}>
                                <Text style={styles.sectionTitle}>Template Name</Text>
                                <View style={{}}>
                                    <TextInput
                                        style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:12, paddingHorizontal:12, paddingVertical:10, color:'#000'}}
                                        placeholder="Template name"
                                        placeholderTextColor="#888"
                                        value={templateName}
                                        onChangeText={setTemplateName}
                                    />
                                </View>
                            </View>
                            {/* Sources input */}
                            <View style={styles.templateSection}>
                                <Text style={styles.sectionTitle}>Sources</Text>
                                <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
                                    <TextInput
                                        style={{flex:1, borderWidth:1, borderColor:'#E5E5E5', borderRadius:12, paddingHorizontal:12, paddingVertical:10}}
                                        placeholder="Enter a site name or link"
                                        placeholderTextColor="#888"
                                        value={sourceInput}
                                        onChangeText={setSourceInput}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                    <TouchableOpacity onPress={addSource} style={{backgroundColor:'#93C822', borderRadius:10, padding:10}}>
                                        <Icon name="arrow-right" size={20} color="#fff"/>
                                    </TouchableOpacity>
                                </View>
                                <View style={{marginTop:10, gap:8}}>
                                    {templateDraft.sources.map((domain) => (
                                        <View key={domain} style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between', borderWidth:1, borderColor:'#E5E5E5', borderRadius:12, padding:12}}>
                                            <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
                                                <Image source={{ uri: faviconFor(domain) }} style={{ width:20, height:20 }} />
                                                <Text style={{color:'#000'}}>{domain}</Text>
                                            </View>
                                            <TouchableOpacity onPress={() => removeSource(domain)}>
                                                <Icon name="trash-can-outline" size={20} color="#e11d48"/>
                                            </TouchableOpacity>
                                        </View>
                                    ))}
                                </View>
                            </View>

                            {/* Field mappings */}
                            <View style={[styles.templateSection]}>
                                <Text style={styles.sectionTitle}>Fields</Text>
                                {templateDraft.fieldRows.map(row => (
                                    <View key={row.id} style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:12, padding:12, gap:8}}>
                                        <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
                                            <Text style={{fontWeight:'600', color:'#000'}}>Sourcing Request</Text>
                                            <TouchableOpacity onPress={()=>deleteFieldRow(row.id)}>
                                                <Icon name="trash-can-outline" size={18} color="#e11d48" />
                                            </TouchableOpacity>
                                        </View>
                                        <View style={{flexDirection:'row', gap:8}}>
                                            <View style={{flex:1}}>
                                    <TouchableOpacity 
                                                    style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:8, paddingHorizontal:8, paddingVertical:10, flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}
                                                    onPress={()=> setOpenDropdown(prev => ({ rowId: prev.rowId===row.id && prev.type==='platform' ? null : row.id, type: 'platform' }))}
                                                >
                                                    <View style={{flexDirection:'row', alignItems:'center', gap:8}}>
                                                        <Icon name={PLATFORM_OPTIONS.find(p=>p.key===row.platform)?.icon || 'store'} size={18} color="#555" />
                                                        <Text style={{color:'#000'}}>{PLATFORM_OPTIONS.find(p=>p.key===row.platform)?.label || 'Platform'}</Text>
                                        </View>
                                                    <Icon name="chevron-down" size={18} color="#000" />
                                                </TouchableOpacity>
                                                {openDropdown.rowId===row.id && openDropdown.type==='platform' && (
                                                    <View style={{position:'absolute', top:48, left:0, right:0, zIndex:1000}}>
                                                        <View style={{backgroundColor:'#fff', borderWidth:1, borderColor:'#E5E5E5', borderRadius:8, maxHeight:260}}>
                                                            <View style={{padding:8, borderBottomWidth:1, borderBottomColor:'#E5E5E5'}}>
                                                                <TextInput
                                                                    style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:6, paddingHorizontal:8, color:'#000'}}
                                                                    placeholder="Search platform..."
                                                                    placeholderTextColor="#888"
                                                                    value={dropdownSearchQuery}
                                                                    onChangeText={setDropdownSearchQuery}
                                                                />
                                                            </View>
                                                            <ScrollView style={{maxHeight:210}}>
                                                                {PLATFORM_OPTIONS.filter(opt=>opt.label.toLowerCase().includes(dropdownSearchQuery.toLowerCase())).map(opt => (
                                                                    <TouchableOpacity key={opt.key} style={{padding:10, flexDirection:'row', alignItems:'center', gap:8}} onPress={()=>{updateFieldRow(row.id,{platform: opt.key}); setOpenDropdown({rowId:null,type:null}); setDropdownSearchQuery('');}}>
                                                                        <Icon name={opt.icon} size={18} color="#555" />
                                                                        <Text style={{color:'#000'}}>{opt.label}</Text>
                                    </TouchableOpacity>
                                ))}
                                                            </ScrollView>
                            </View>
                                                    </View>
                                                )}
                                            </View>
                                            <View style={{flex:1}}>
                                                <TouchableOpacity
                                                    style={{borderWidth:1, borderColor:'#E5E5E5', borderRadius:8, paddingHorizontal:8, paddingVertical:10, flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}
                                                    onPress={()=> setOpenDropdown(prev => ({ rowId: prev.rowId===row.id && prev.type==='field' ? null : row.id, type: 'field' }))}
                                                >
                                                    <Text style={{color:'#000', fontWeight:'500'}}>{FIELD_OPTIONS.find(f=>f.key===row.field)?.label || 'Field'}</Text>
                                                    <Icon name="chevron-down" size={18} color="#000" />
                                                </TouchableOpacity>
                                                {openDropdown.rowId===row.id && openDropdown.type==='field' && (
                                                    <View style={{position:'absolute', top:48, left:0, right:0, zIndex:1000}}>
                                                        <View style={{backgroundColor:'#fff', borderWidth:1, borderColor:'#E5E5E5', borderRadius:8, maxHeight:260}}>
                                                            <View style={{padding:8, borderBottomWidth:1, borderBottomColor:'#E5E5E5'}}>
                                                                <TextInput
                                                                    style={{paddingHorizontal:8, color:'#000'}}
                                                                    placeholder="Search field..."
                                                                    placeholderTextColor="#888"
                                                                    value={dropdownSearchQuery}
                                                                    onChangeText={setDropdownSearchQuery}
                                                                />
                                                            </View>
                                                            <ScrollView style={{maxHeight:210}}>
                                                                {FIELD_OPTIONS.filter(opt=>opt.label.toLowerCase().includes(dropdownSearchQuery.toLowerCase())).map(opt => (
                                                                    <TouchableOpacity key={opt.key} style={{padding:10}} onPress={()=>{updateFieldRow(row.id,{field: opt.key}); setOpenDropdown({rowId:null,type:null}); setDropdownSearchQuery('');}}>
                                                                        <Text style={{color:'#000'}}>{opt.label}</Text>
                                                                    </TouchableOpacity>
                                                                ))}
                                                            </ScrollView>
                                                        </View>
                                                    </View>
                                                )}
                                            </View>
                                        </View>
                                        <View style={{flexDirection:'row', alignItems:'center', justifyContent:'space-between'}}>
                                            <Text style={{color:'#71717A'}}>Tap to enable a source</Text>
                                        </View>
                                        <View style={{flexDirection:'row', flexWrap:'wrap', gap:8}}>
                                            {templateDraft.sources.map((domain)=>{
                                                const active = row.sources.includes(domain);
                                                return (
                                                    <TouchableOpacity key={`${row.id}-${domain}`} onPress={()=>toggleRowSource(row.id, domain)} style={{borderWidth:1, borderColor: active? '#93C822':'#E5E5E5', backgroundColor: active? 'rgba(147,200,34,0.1)':'#fff', borderRadius:20, paddingVertical:6, paddingHorizontal:10, flexDirection:'row', alignItems:'center', gap:6}}>
                                                        <Image source={{ uri: faviconFor(domain) }} style={{ width:16, height:16 }} />
                                                        <Text style={{color:'#000'}}>{domain}</Text>
                                                    </TouchableOpacity>
                                                );
                                            })}
                                        </View>
                                    </View>
                                ))}
                            </View>
                            </View>
                            )}
                        </ScrollView>

                        {templateModalView === 'create' && (
                            <View style={{flexDirection:'row', justifyContent:'center', alignItems:'center', paddingVertical:10}}>
                                <TouchableOpacity onPress={addFieldRow} style={{borderWidth:1, borderColor:'#93C822', borderRadius:12, paddingVertical:12, paddingHorizontal:10, width:'90%', alignItems:'center'}}>
                                    <Text style={{color:'#93C822', fontWeight:'600'}}>+ Add Field</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {templateModalView === 'create' ? (
                            
                                <TouchableOpacity 
                                style={styles.createNewTemplateButton} 
                                onPress={async () => {
                                    const mappings: Record<string, Record<string, string[]>> = {};
                                    templateDraft.fieldRows.forEach(r => {
                                        if (!mappings[r.platform]) mappings[r.platform] = {};
                                        mappings[r.platform][r.field] = r.sources;
                                    });
                                    try {
                                        if (editingTemplateId && currentUserId) {
                                            // Update if owned by user; if not owned, fall back to insert copy
                                            const { data: tpl } = await supabase
                                                .from('SearchTemplates')
                                                .select('UserId')
                                                .eq('Id', editingTemplateId)
                                                .single();
                                            if (tpl && tpl.UserId === currentUserId) {
                                                await supabase.from('SearchTemplates').update({
                                                    Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                    SuggestedSites: templateDraft.sources,
                                                    ExtractionSchema: { fieldSourceMappings: mappings },
                                                }).eq('Id', editingTemplateId);
                                            } else {
                                                await supabase.from('SearchTemplates').insert({
                                                    Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                    Category: 'General',
                                                    Description: 'User-defined template',
                                                    SearchPrompt: 'User-defined',
                                                    SuggestedSites: templateDraft.sources,
                                                    ExtractionSchema: { fieldSourceMappings: mappings },
                                                    IsDefault: false,
                                                    IsPublic: false,
                                                    UserId: currentUserId,
                                                });
                                            }
                                        } else {
                                            await supabase.from('SearchTemplates').insert({
                                                Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                Category: 'General',
                                                Description: 'User-defined template',
                                                SearchPrompt: 'User-defined',
                                                SuggestedSites: templateDraft.sources,
                                                ExtractionSchema: { fieldSourceMappings: mappings },
                                                IsDefault: false,
                                                IsPublic: false,
                                                UserId: currentUserId,
                                            });
                                        }
                                    } catch {}
                                    setTemplateModalView('picker');
                                        setTemplateModalVisible(false);
                                    setBottomNavState('platform');
                                    }}
                                >
                                <Icon name="content-save" size={20} color="#FFFFFF" />
                                <Text style={styles.createNewTemplateButtonText}>Save Template</Text>
                                </TouchableOpacity>

                        ) : (
                        <TouchableOpacity 
                            style={styles.createNewTemplateButton} 
                                onPress={() => setTemplateModalView('create')}
                        >
                            <Icon name="plus" size={20} color="#FFFFFF" />
                            <Text style={styles.createNewTemplateButtonText}>Create New Template</Text>
                        </TouchableOpacity>
                        )}
                    </View>
                </View>
            </Modal>
        </View>
    );
}

export default MatchSelectionScreen;

// --- Enhanced Stylesheet ---
const styles = StyleSheet.create({
    container: { 
        flex: 1, 
        backgroundColor: 'rgb(255, 255, 255)', 
        paddingVertical: 20,
    }, 
    centerContainer: { 
        flex: 1, 
        justifyContent: 'center', 
        alignItems: 'center', 
        backgroundColor: '#FFFFFF' 
    }, 
    errorText: { 
        color: '#ff4d4d', 
        fontSize: 16, 
        textAlign: 'center', 
        padding: 20 
    }, 
    infoText: { 
        color: '#000000', 
        fontSize: 16, 
        textAlign: 'center', 
        marginTop: 50 
    }, 
    header: { 
        paddingHorizontal: 16, 
        paddingVertical: 10, 
        borderBottomWidth: 1, 
        borderBottomColor: 'rgba(228, 228, 231, 0.1)' 
    },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#000000' },
    headerSubtitle: { fontSize: 14, color: '#000000', marginTop: 4 },
    itemContainer: { 
        width: ITEM_WIDTH, 
        marginBottom: ITEM_SPACING, 
        borderRadius: 8, 
        overflow: 'hidden', 
        backgroundColor: '#FFFFFF', 
        borderWidth: 2, 
        borderColor: 'rgba(228, 228, 231, 0.5)'
    },
    itemSelected: { 
        borderColor: '#93C822', 
        borderWidth: 2, 
        borderRadius: 8 
    },
    itemPressed: {
        opacity: 0.8,
        transform: [{ scale: 0.98 }]
    },
    selectionOverlay: { 
        ...StyleSheet.absoluteFillObject, 
        backgroundColor: 'rgba(147, 200, 34, 0.3)', 
        justifyContent: 'center', 
        alignItems: 'center' 
    },
    itemImage: { width: '100%', height: ITEM_WIDTH, backgroundColor: '#333' },
    itemDetails: { padding: 8 },
    itemTitle: { fontSize: 14, fontWeight: '600', color: '#000000', height: 34 },
    itemPrice: { fontSize: 13, color: '#000000', marginTop: 2 },
    itemCondition: { fontSize: 12, color: '#666666', marginTop: 2 },
    itemSource: { fontSize: 12, color: '#000000', marginTop: 4 },
    bottomNavContainer: { 
        padding: 20, 
        borderTopWidth: 1, 
        borderTopColor: '#E5E5E5', 
        //backgroundColor: 'red',
        //backgroundColor: 'rgba(255, 255, 255, 0.9)',
        minHeight: 100,
    },
    expandedBottomNav: {
        alignItems: 'center', 
        gap: 12, 
        paddingLeft: 30,
        paddingRight: 30,
        justifyContent: 'space-between',
        marginTop: 10,
        minHeight: 550,
        maxHeight: 600,
        backgroundColor: 'rgb(255, 255, 255)'
    },
    bottomNavStepContainer: { 
        alignItems: 'center', 
        gap: 12, 
        paddingLeft: 30,
        paddingRight: 30,
        marginTop: 10,
        backgroundColor: 'rgba(255, 255, 255, 0)',
        minHeight: 100,
        paddingBottom: 12,
    },
    emptyBottomNavStepContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
        gap: 12,
        maxHeight: 100,
    
    
    },
    dropdownSelect: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        paddingVertical: 14,
        paddingHorizontal: 15,
        marginLeft: 10,
        marginRight: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%'
    }, dropdownSelectText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000000'
    },
    mainButton: { 
        flexDirection: 'row', 
        backgroundColor: '#93C822', 
        paddingVertical: 14, 
        paddingHorizontal: 30, 
        borderRadius: 12, 
        alignItems: 'center', 
        justifyContent: 'center', 
        width: '100%' 
    },
    emptyButtonSolo: {
        backgroundColor: 'green',
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        minHeight: 100,
        maxHeight: 100,
    },
    mainEmptyButton: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 210, 97, 0.5)',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.5)',
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: 12,
    },
    mainButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    secondaryButton: { 
        marginTop: 12,
        flexDirection: 'row', 
        backgroundColor: '#D9D9D9', 
        paddingVertical: 14, 
        paddingHorizontal: 30, 
        borderRadius: 12, 
        alignItems: 'center', 
        justifyContent: 'center', 
        width: '100%' 
    },
    secondaryButtonText: { color: '#888', fontSize: 16, fontWeight: '500' },
    
    
    clearBackButton: {
        flexDirection: 'row', 
        backgroundColor: 'transparent', 
        paddingVertical: 7, 
        borderRadius: 12, 
    },
    backButton: { 
        flexDirection: 'row', 
        backgroundColor: '#D9D9D9', 
        paddingVertical: 14, 
        paddingHorizontal: 30, 
        borderRadius: 12, 
        alignItems: 'center', 
        justifyContent: 'center', 
        width: '100%' 
    },
    backButtonText: { color: '#888', fontSize: 16, fontWeight: '600' },
    disabledButton: { backgroundColor: '#555' },
    selectPromptContainer: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 50,
        alignItems: 'center',
        zIndex: 999,
        elevation: 5,
        backgroundColor: 'transparent',
    },
    selectPromptButton: {
        flexDirection: 'row',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 210, 97, 0.5)',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.5)',
        borderRadius: 10,
        paddingVertical: 10,
        borderStyle: 'dashed',
    },
    selectPromptText: {
        color: '#000',
        fontSize: 14,
        fontWeight: '600',
    },
    platformHeader: { 
        flexDirection: 'row',
        width: '100%',
        marginBottom: 12 
    },
    platformHeaderText: { 
        fontSize: 24, 
        fontWeight: '500', 
        color: '#000' 
    },
    backIconButton: {
        padding: 4
    },
    platformGrid: {
        flexDirection: 'row', 
        flexWrap: 'wrap',
        justifyContent: 'center', 
        marginBottom: 16, 
        gap: 8
    },
    modalContainer: { 
        flex: 1, 
        justifyContent: 'flex-end', 
        backgroundColor: 'rgba(0, 0, 0, 0.6)' 
    },
    modalContent: { 
        backgroundColor: '#FFFFFF', 
        borderRadius: 20,
        paddingBottom: 20,
        minHeight: '50%',
        maxHeight: '70%',
        height: '70%',
        position: 'absolute',
        bottom: 90,
        left: 10,
        right: 10,
        borderWidth: 1,
        borderColor: '#E5E5E5'
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20
    },
    modalTitle: { 
        fontSize: 20, 
        fontWeight: 'bold', 
        color: '#000000'
    },
    modalCloseButton: { 
        padding: 4,
        color: '#000000'
    },
    templateScrollView: {
        flex: 1,
    },
    templateSection: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#888',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    templateOption: { 
        paddingVertical: 15, 
        borderRadius: 12,
        borderWidth: 1, 
        borderColor: '#E5E5E5' 
    },
    templateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    templateItems: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    templateOptionText: { 
        color: '#000000', 
        fontSize: 16,
        fontWeight: '500',
        flex: 1
    },
    createNewOption: {
        borderWidth: 0
    },
    noThanksButton: {
        margin: 20,
        paddingVertical: 15,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderRadius: 8,
        alignItems: 'center',
        flexDirection: 'row',
    }, 
    createTemplateContainer:{
        flexDirection: 'row',
        minHeight: 800,
        backgroundColor: 'red',

        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        color: '#93C822'
    },
    createNewTemplateButton: {
        borderWidth: 1,
        borderColor: '#93C822',
        borderRadius: 12,
        paddingVertical: 15,
        paddingHorizontal: 30,
        marginHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#93C822',
        justifyContent: 'center',
        gap: 12,
        color: '#93C822'

    }, createNewTemplateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '500'
    },
    noThanksButtonText: {
        color: '#888',
        fontSize: 16,
        fontWeight: '500'
    }
});