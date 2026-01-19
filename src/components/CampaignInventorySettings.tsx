import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Switch, Image } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Mock types for now, will replace with real props
export interface CampaignItem {
    id: string;
    name: string;
    sku: string;
    price: number;
    inventory: number;
    aggressiveness: 'low' | 'medium' | 'high';
    imageUrl?: string;
}

interface CampaignInventorySettingsProps {
    items: CampaignItem[];
    onUpdateItemStrategy: (itemId: string, strategy: any) => void;
    onUpdateGlobalStrategy: (key: string, value: any) => void;
}

export const CampaignInventorySettings: React.FC<CampaignInventorySettingsProps> = ({
    items,
    onUpdateItemStrategy,
    onUpdateGlobalStrategy
}) => {

    // Helper to render aggressiveness pill
    const renderAggressivenessControl = (item: CampaignItem) => {
        const levels = ['low', 'medium', 'high'];
        const currentIdx = levels.indexOf(item.aggressiveness);

        return (
            <View style={styles.aggroControl}>
                <TouchableOpacity
                    style={[styles.aggroBtn, { opacity: currentIdx > 0 ? 1 : 0.3 }]}
                    disabled={currentIdx === 0}
                    onPress={() => onUpdateItemStrategy(item.id, { aggressiveness: levels[currentIdx - 1] })}
                >
                    <Icon name="minus" size={16} color="#4b5563" />
                </TouchableOpacity>

                <View style={[
                    styles.aggroBadge,
                    { backgroundColor: item.aggressiveness === 'high' ? '#fee2e2' : item.aggressiveness === 'medium' ? '#fef3c7' : '#dcfce7' }
                ]}>
                    <Text style={[
                        styles.aggroText,
                        { color: item.aggressiveness === 'high' ? '#991b1b' : item.aggressiveness === 'medium' ? '#92400e' : '#166534' }
                    ]}>
                        {item.aggressiveness.toUpperCase()}
                    </Text>
                </View>

                <TouchableOpacity
                    style={[styles.aggroBtn, { opacity: currentIdx < 2 ? 1 : 0.3 }]}
                    disabled={currentIdx === 2}
                    onPress={() => onUpdateItemStrategy(item.id, { aggressiveness: levels[currentIdx + 1] })}
                >
                    <Icon name="plus" size={16} color="#4b5563" />
                </TouchableOpacity>
            </View>
        );
    };

    const renderItem = ({ item }: { item: CampaignItem }) => (
        <View style={styles.itemCard}>
            <Image
                source={{ uri: item.imageUrl || 'https://via.placeholder.com/50' }}
                style={styles.itemImage}
            />
            <View style={styles.itemInfo}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.itemSku}>{item.sku} • {item.inventory} units</Text>
                <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
            </View>

            <View style={styles.itemControls}>
                <Text style={styles.controlLabel}>Velocity</Text>
                {renderAggressivenessControl(item)}
            </View>
        </View>
    );

    return (
        <View style={styles.container}>
            {/* Global Settings Section */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Campaign Controls</Text>
                <View style={styles.globalControlRow}>
                    <View>
                        <Text style={styles.settingLabel}>Timeline Pace</Text>
                        <Text style={styles.settingDesc}>Adjust overall selling speed</Text>
                    </View>
                    <View style={styles.segmentedControl}>
                        {/* Simplified for demo */}
                        <TouchableOpacity style={styles.segmentActive}><Text style={styles.segmentTextActive}>Normal</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.segment}><Text style={styles.segmentText}>Fast</Text></TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Inventory List */}
            <View style={styles.section}>
                <Text style={styles.sectionTitle}>Inventory Strategy ({items.length})</Text>
                <FlatList
                    data={items}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    scrollEnabled={false} // Use parent scroll
                    contentContainerStyle={styles.listContent}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        padding: 16,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 12,
        letterSpacing: -0.5,
    },
    // Global Controls
    globalControlRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    settingLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#1f2937',
    },
    settingDesc: {
        fontSize: 13,
        color: '#6b7280',
        marginTop: 2,
    },
    segmentedControl: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 8,
        padding: 2,
    },
    segment: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
    },
    segmentActive: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: '#ffffff',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 1,
        elevation: 1,
    },
    segmentText: {
        fontSize: 13,
        color: '#6b7280',
        fontWeight: '500',
    },
    segmentTextActive: {
        fontSize: 13,
        color: '#111827',
        fontWeight: '600',
    },
    // Item List
    listContent: {
        gap: 12,
    },
    itemCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#ffffff',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    itemImage: {
        width: 48,
        height: 48,
        borderRadius: 8,
        backgroundColor: '#f3f4f6',
        marginRight: 12,
    },
    itemInfo: {
        flex: 1,
    },
    itemName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#1f2937',
        marginBottom: 2,
    },
    itemSku: {
        fontSize: 12,
        color: '#9ca3af',
        marginBottom: 2,
    },
    itemPrice: {
        fontSize: 13,
        fontWeight: '500',
        color: '#111827',
    },
    itemControls: {
        alignItems: 'flex-end',
        marginLeft: 8,
    },
    controlLabel: {
        fontSize: 10,
        color: '#9ca3af',
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    aggroControl: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    aggroBtn: {
        padding: 4,
        backgroundColor: '#f3f4f6',
        borderRadius: 4,
    },
    aggroBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        minWidth: 60,
        alignItems: 'center',
    },
    aggroText: {
        fontSize: 10,
        fontWeight: '700',
    },
});
