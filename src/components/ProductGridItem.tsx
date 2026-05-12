import React from 'react';
import { Pressable, View, Text, Image, StyleSheet } from 'react-native';
import { Icon } from 'react-native-paper';

interface SerpApiData {
    thumbnail?: string;
    image?: string;
    title: string;
    price?: { value: string };
    condition?: string;
    source: string;
}

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


export default ProductGridItem;

const styles = StyleSheet.create({
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
    itemImage: { width: '100%', height: ITEM_WIDTH, backgroundColor: '#333' },
    itemDetails: { padding: 8 },
    itemTitle: { fontSize: 14, fontWeight: '600', color: '#000000', height: 34 },
    itemPrice: { fontSize: 13, color: '#000000', marginTop: 2 },
    itemCondition: { fontSize: 12, color: '#666666', marginTop: 2 },
    itemSource: { fontSize: 12, color: '#000000', marginTop: 4 },
    selectionOverlay: { 
        ...StyleSheet.absoluteFillObject, 
        backgroundColor: 'rgba(147, 200, 34, 0.3)', 
        justifyContent: 'center', 
        alignItems: 'center' 
    },
}); 