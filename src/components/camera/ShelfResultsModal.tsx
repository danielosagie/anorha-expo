import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Animated, ActivityIndicator, Image } from 'react-native';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

export interface ShelfItem {
    id: string;
    query: string;
    brand: string;
    model: string;
    type: string;
    color: string;
    paraphrases: string[];
    status: 'pending' | 'searching' | 'found' | 'not_found' | 'error';
    matches?: any[];
    selectedMatch?: any;
    isLocalMatch?: boolean;
}

interface ShelfResultsModalProps {
    items: ShelfItem[];
    isProcessing: boolean;
    onClose: () => void;
    onAddToBulk: (items: ShelfItem[]) => void;
    onEditQuery?: (item: ShelfItem, newQuery: string) => void;
    onSelectMatch?: (item: ShelfItem) => void;
    onOpenLocalMatch?: (item: ShelfItem) => void;
}

export const ShelfResultsModal: React.FC<ShelfResultsModalProps> = ({
    items,
    isProcessing,
    onClose,
    onAddToBulk,
    onEditQuery,
    onSelectMatch,
    onOpenLocalMatch
}) => {
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set(items.map(i => i.id)));

    const toggleItemSelection = (id: string) => {
        setSelectedItemIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectedItems = items.filter(i => selectedItemIds.has(i.id));

    return (
        <View style={styles.container}>
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFillObject} />

            <View style={styles.content}>
                <View style={styles.header}>
                    <Text style={styles.title}>Shelf Mode</Text>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <MaterialIcons name="close" size={24} color="#FFF" />
                    </TouchableOpacity>
                </View>

                {isProcessing && items.length === 0 ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color="#4CAF50" />
                        <Text style={styles.loadingText}>Analyzing shelf objects...</Text>
                    </View>
                ) : (
                    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
                        {items.map((item) => (
                            <View key={item.id} style={[styles.itemCard, selectedItemIds.has(item.id) && styles.itemCardSelected]}>
                                <View style={styles.itemHeader}>
                                    <TouchableOpacity
                                        style={styles.checkbox}
                                        onPress={() => toggleItemSelection(item.id)}
                                    >
                                        <MaterialIcons
                                            name={selectedItemIds.has(item.id) ? "check-circle" : "radio-button-unchecked"}
                                            size={24}
                                            color={selectedItemIds.has(item.id) ? "#4CAF50" : "#888"}
                                        />
                                    </TouchableOpacity>

                                    <View style={styles.itemTitleContainer}>
                                        <Text style={styles.itemQuery}>{item.query}</Text>
                                        <Text style={styles.itemTags}>
                                            {[item.brand, item.type].filter(Boolean).join(' • ')}
                                        </Text>
                                    </View>

                                    <View style={styles.statusBadge}>
                                        {item.status === 'pending' && <ActivityIndicator size="small" color="#888" />}
                                        {item.status === 'searching' && <ActivityIndicator size="small" color="#2196F3" />}
                                        {item.status === 'found' && <MaterialIcons name="check-circle" size={16} color="#4CAF50" />}
                                        {item.status === 'not_found' && <MaterialIcons name="error-outline" size={16} color="#FF9800" />}
                                        {item.status === 'error' && <MaterialIcons name="error" size={16} color="#F44336" />}
                                    </View>
                                </View>

                                {/* Match display if found */}
                                {item.status === 'found' && item.matches && item.matches.length > 0 && (
                                    <View style={styles.matchCard}>
                                        {item.isLocalMatch && (
                                            <View style={styles.localMatchBadge}>
                                                <MaterialIcons name="inventory" size={12} color="#4CAF50" />
                                                <Text style={styles.localMatchText}>In Inventory</Text>
                                            </View>
                                        )}

                                        {item.selectedMatch ? (
                                            <View style={styles.selectedMatchRow}>
                                                <Image source={{ uri: item.selectedMatch.thumbnail || item.selectedMatch.image }} style={styles.matchImage} />
                                                <Text style={styles.matchTitle} numberOfLines={2}>{item.selectedMatch.title}</Text>
                                            </View>
                                        ) : (
                                            <TouchableOpacity style={styles.viewMatchesBtn} onPress={() => onSelectMatch && onSelectMatch(item)}>
                                                <Text style={styles.viewMatchesText}>View {item.matches.length} Matches</Text>
                                            </TouchableOpacity>
                                        )}

                                        {item.isLocalMatch && (
                                            <TouchableOpacity style={styles.updateInventoryBtn} onPress={() => onOpenLocalMatch && onOpenLocalMatch(item)}>
                                                <Text style={styles.updateInventoryText}>Update Inventory</Text>
                                                <MaterialIcons name="arrow-forward" size={16} color="#FFF" />
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                )}
                            </View>
                        ))}
                    </ScrollView>
                )}

                <View style={styles.footer}>
                    <TouchableOpacity
                        style={[styles.addBulkBtn, selectedItems.length === 0 && styles.addBulkBtnDisabled]}
                        disabled={selectedItems.length === 0 || isProcessing}
                        onPress={() => onAddToBulk(selectedItems)}
                    >
                        <MaterialIcons name="photo-library" size={24} color="#FFF" />
                        <Text style={styles.addBulkText}>
                            Add {selectedItems.length} to Bulk Items
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    content: {
        backgroundColor: '#1E1E1E',
        height: '85%',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#333',
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#FFF',
    },
    closeBtn: {
        padding: 4,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        color: '#888',
        marginTop: 16,
        fontSize: 16,
    },
    list: {
        flex: 1,
    },
    listContent: {
        padding: 16,
        gap: 12,
    },
    itemCard: {
        backgroundColor: '#2A2A2A',
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: '#333',
    },
    itemCardSelected: {
        borderColor: '#4CAF50',
    },
    itemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    checkbox: {
        marginRight: 12,
    },
    itemTitleContainer: {
        flex: 1,
    },
    itemQuery: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFF',
        marginBottom: 4,
    },
    itemTags: {
        fontSize: 12,
        color: '#888',
    },
    statusBadge: {
        marginLeft: 12,
        width: 24,
        alignItems: 'center',
    },
    matchCard: {
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: '#333',
    },
    localMatchBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginBottom: 8,
    },
    localMatchText: {
        color: '#4CAF50',
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 4,
    },
    viewMatchesBtn: {
        backgroundColor: '#333',
        paddingVertical: 10,
        borderRadius: 8,
        alignItems: 'center',
    },
    viewMatchesText: {
        color: '#2196F3',
        fontWeight: '600',
    },
    selectedMatchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#333',
        padding: 8,
        borderRadius: 8,
    },
    matchImage: {
        width: 40,
        height: 40,
        borderRadius: 6,
        backgroundColor: '#444',
        marginRight: 12,
    },
    matchTitle: {
        flex: 1,
        color: '#FFF',
        fontSize: 14,
    },
    updateInventoryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#4CAF50',
        paddingVertical: 10,
        borderRadius: 8,
        marginTop: 12,
    },
    updateInventoryText: {
        color: '#FFF',
        fontWeight: '600',
        marginRight: 8,
    },
    footer: {
        padding: 20,
        paddingBottom: 40,
        borderTopWidth: 1,
        borderTopColor: '#333',
    },
    addBulkBtn: {
        backgroundColor: '#2196F3',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 16,
        borderRadius: 12,
        gap: 12,
    },
    addBulkBtnDisabled: {
        backgroundColor: '#333',
        opacity: 0.7,
    },
    addBulkText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    }
});
