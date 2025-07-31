import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { 
    View, Text, StyleSheet, Image, Dimensions, ActivityIndicator, 
    Pressable, Modal, TouchableOpacity, SafeAreaView, ScrollView
} from 'react-native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { FlashList } from '@shopify/flash-list';
import { supabase } from '../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformButton from '../components/PlatformButton';
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
    // ... other fields
}

export interface Analysis {
    jobId: string;
    results: Result[];
    // ... other fields
}

// --- Helper Functions & Constants ---
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';
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

// Template data with favorites and recents
const TEMPLATE_DATA = {
    favorites: [
        { id: 'amazon', name: 'Amazon', icon: 'package-variant' },
        { id: 'previewsworld', name: 'Previewsworld.com/search?', icon: 'web' },
        { id: 'amazon-fda', name: 'Amazon + FDA + 2 more...', icon: 'package-variant' },
    ],
    recents: [
        { id: 'amazon-fda-recent', name: 'Amazon + FDA + 2 more...', icon: 'package-variant' },
    ]
};

// --- Main Screen Component ---

function MatchSelectionScreen({ route }: { route: RouteProp<AppStackParamList, 'MatchSelectionScreen'> }) {
    const navigation = useNavigation();
    const { jobId } = route.params.response;

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
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

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
    }, [jobId]);

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

    const handleGenerate = useCallback(() => {
        // TODO: Implement the final generation logic
        console.log('Generating with:', {
            selectedProducts: selectedIndices.map(i => analysisData?.results[0]?.serpApiData[i]),
            template: selectedTemplate,
            platforms: selectedPlatforms,
        });
        // Example: navigation.navigate('AnotherScreen', { ... });
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
        <SafeAreaView style={styles.container}>
            

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

            {/* --- Enhanced Bottom Navigation Bar --- */}
            <LinearGradient colors={['rgb(255, 255, 255)', 'rgba(255, 255, 255, 0)']} style={{}}>
                
                {/* Empty State */}
                {bottomNavState === 'empty' && selectedCount === 0 && (
                    <View style={styles.emptyButtonSolo}>
                        <TouchableOpacity style={styles.mainEmptyButton} onPress={handleShowSelection}>
                                <Icon name="package-variant-closed" size={20} color="#000" style={{marginRight: 8}}/>
                                <Text style={styles.secondaryButtonText}>Select Product Matches</Text>
                            </TouchableOpacity>
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
                            <Text style={styles.dropdownSelectText}>Select a Template</Text>
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
                                <Text style={styles.dropdownSelectText}>Select a Template</Text>
                                <Icon name="chevron-down" size={20} color="#000" style={{marginRight: 8}}/>
                            </TouchableOpacity>
                            {/* Continue Button (Not used anymore)
                            <TouchableOpacity style={styles.secondaryButton} onPress={() => handleTemplateSelect(null)}>
                                <Text style={styles.secondaryButtonText}>Continue w/o Template</Text>
                            </TouchableOpacity>*/}
                            
                        </View>
                    
                        
                    
                 
                        
                        <View style={{flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 12}}>
                            <View style={styles.platformHeader}>
                                {/*
                                <TouchableOpacity style={styles.backIconButton} onPress={handleBackToTemplate}>
                                    <Icon name="arrow-left" size={20} color="#000" />
                                </TouchableOpacity>*/}
                                <Text style={styles.platformHeaderText}>Which Platforms?</Text>
                                <View style={{width: 24}} />
                            </View>
                            <View style={styles.platformGrid}>
                                <PlatformButton 
                                    platform={'shopify'} 
                                    isSelected={selectedPlatforms.includes('shopify')} 
                                    onPress={() => handlePlatformSelect('shopify')}
                                    isConnected={true}
                                />
                                <PlatformButton 
                                    platform={'amazon'} 
                                    isSelected={selectedPlatforms.includes('amazon')} 
                                    onPress={() => handlePlatformSelect('amazon')}
                                    isConnected={true}
                                />
                                <PlatformButton 
                                    platform={'ebay'} 
                                    isSelected={selectedPlatforms.includes('ebay')} 
                                    onPress={() => handlePlatformSelect('ebay')}
                                    isConnected={false}
                                />
                                <PlatformButton 
                                    platform={'clover'} 
                                    isSelected={selectedPlatforms.includes('clover')} 
                                    onPress={() => handlePlatformSelect('clover')}
                                    isConnected={true}
                                />
                                <PlatformButton 
                                    platform={'square'} 
                                    isSelected={selectedPlatforms.includes('square')} 
                                    onPress={() => handlePlatformSelect('square')}
                                    isConnected={false}
                                />
                                <PlatformButton 
                                    platform={'facebook'} 
                                    isSelected={selectedPlatforms.includes('facebook')} 
                                    onPress={() => handlePlatformSelect('facebook')}
                                    isConnected={true}
                                />
                            </View>
                            <TouchableOpacity 
                                style={[styles.mainButton, selectedPlatforms.length === 0 && styles.disabledButton]}
                                disabled={selectedPlatforms.length === 0}
                                onPress={handleGenerate}
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
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <TouchableOpacity 
                                style={styles.modalCloseButton} 
                                onPress={() => setTemplateModalVisible(false)}
                            >
                                <Icon name="close" size={24} color="#000" />
                            </TouchableOpacity>
                            <Text style={styles.modalTitle}>Templates</Text>
                            <View style={{width: 24}} />
                        </View>

                        <ScrollView style={styles.templateScrollView}>
                            {/* Favorites Section */}
                            <View style={styles.templateSection}>
                                <Text style={styles.sectionTitle}>Favorites</Text>
                                {TEMPLATE_DATA.favorites.map(template => (
                                    <TouchableOpacity 
                                        key={template.id} 
                                        style={styles.templateOption} 
                                        onPress={() => handleTemplateSelect(template.name)}
                                    >
                                        <View style={styles.templateRow}>
                                            <Icon name={template.icon} size={20} color="#fff" />
                                            <Text style={styles.templateOptionText}>{template.name}</Text>
                                            <Icon name="star" size={20} color="#FFD700" />
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <View style={{height: 1, backgroundColor: '#E5E5E5', marginBottom: 12, marginLeft: 20, marginRight: 20}}></View>

                            {/* Recents Section */}
                            <View style={styles.templateSection}>
                                <Text style={styles.sectionTitle}>Recents</Text>
                                {TEMPLATE_DATA.recents.map(template => (
                                    <TouchableOpacity 
                                        key={template.id} 
                                        style={styles.templateOption} 
                                        onPress={() => handleTemplateSelect(template.name)}
                                    >
                                        <View style={styles.templateRow}>
                                            <Icon name={template.icon} size={20} color="#fff" />
                                            <Text style={styles.templateOptionText}>{template.name}</Text>
                                            <Icon name="star-outline" size={20} color="#71717A" />
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Create New Section */}
                            <View style={styles.createTemplateContainer}>
                                <TouchableOpacity 
                                    style={[styles.templateOption, styles.createNewOption]} 
                                    onPress={() => {
                                        setTemplateModalVisible(false);
                                        // TODO: Navigate to create template screen
                                    }}
                                >
                                </TouchableOpacity>
                            </View>
                        </ScrollView>

                        <TouchableOpacity 
                            style={styles.createNewTemplateButton} 
                            onPress={() => handleTemplateSelect(null)}
                        >
                            <Icon name="plus" size={20} color="#FFFFFF" />
                            <Text style={styles.createNewTemplateButtonText}>Create New Template</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

export default MatchSelectionScreen;

// --- Enhanced Stylesheet ---
const styles = StyleSheet.create({
    container: { 
        flex: 1, 
        backgroundColor: 'rgb(255, 255, 255)' 
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
        flex: 1
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
        justifyContent: 'space-between',
        paddingRight: 20,
        gap: 12
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