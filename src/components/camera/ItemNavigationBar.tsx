import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { BlurView } from 'expo-blur';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ItemNavigationBarProps {
    items: Array<{ id: string; photos: any[]; isActive?: boolean }>;
    activeItemId: string | null;
    onSelectItem: (itemId: string) => void;
    onNewItem: () => void;
    onContinue: () => void;
    onDeleteItem?: (itemId: string) => void;
    matchesStore?: Record<string, { matchData: any }>;
}

export const ItemNavigationBar: React.FC<ItemNavigationBarProps> = ({
    items,
    activeItemId,
    onSelectItem,
    onNewItem,
    onContinue,
    onDeleteItem,
    matchesStore
}) => {
    const activeIndex = items.findIndex(i => i.id === activeItemId);
    const totalItems = items.length;
    const totalPhotos = items.reduce((sum, item) => sum + item.photos.length, 0);
    const hasPhotos = totalPhotos > 0;

    // Determine the continue button text (item count, not photo count, for clarity)
    const getContinueText = () => {
        if (!hasPhotos) return 'Take a photo to get started';
        if (totalItems > 1) return `Continue with ${totalItems} items`;
        return 'Manage items';
    };

    return (
        <Animated.View
            entering={SlideInUp.delay(100).springify()}
            style={styles.container}
        >
            <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
                <View style={styles.contentContainer}>

                    {/* Main Row: Arrow | Continue | Arrow/New */}
                    <View style={styles.navRow}>

                        {/* Left Arrow - Previous Item */}
                        <TouchableOpacity
                            style={[styles.arrowButton, (!hasPhotos || activeIndex <= 0) && styles.arrowButtonDisabled]}
                            onPress={() => {
                                if (activeIndex > 0) onSelectItem(items[activeIndex - 1].id);
                            }}
                            disabled={!hasPhotos || activeIndex <= 0}
                        >
                            <Icon
                                name="chevron-left"
                                size={28}
                                color={hasPhotos && activeIndex > 0 ? "#FFF" : "rgba(255,255,255,0.3)"}
                            />
                        </TouchableOpacity>

                        {/* Center - Continue Button or Item Counter */}
                        <TouchableOpacity
                            style={[
                                styles.continueButton,
                                !hasPhotos && styles.continueButtonEmpty
                            ]}
                            onPress={hasPhotos ? onContinue : undefined}
                            disabled={!hasPhotos}
                            activeOpacity={hasPhotos ? 0.8 : 1}
                        >
                            {hasPhotos && totalItems > 1 && (
                                <Text style={styles.itemIndicator}>
                                    {activeIndex + 1} / {totalItems}
                                </Text>
                            )}
                            <Text style={[
                                styles.continueButtonText,
                                !hasPhotos && styles.continueButtonTextEmpty
                            ]}>
                                {getContinueText()}
                            </Text>

                            {/* Match indicator badge */}
                            {activeItemId && matchesStore?.[activeItemId] && (
                                <Animated.View entering={FadeIn} style={styles.matchBadge}>
                                    <Icon name="check-circle" size={14} color="#000" />
                                </Animated.View>
                            )}
                        </TouchableOpacity>

                        {/* Right Arrow / New Item */}
                        {activeIndex < totalItems - 1 ? (
                            <TouchableOpacity
                                style={styles.arrowButton}
                                onPress={() => onSelectItem(items[activeIndex + 1].id)}
                            >
                                <Icon name="chevron-right" size={28} color="#FFF" />
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.arrowButton, styles.newItemButton]}
                                onPress={onNewItem}
                                disabled={!hasPhotos}
                            >
                                <Icon
                                    name="plus"
                                    size={24}
                                    color={hasPhotos ? "#000" : "rgba(255,255,255,0.3)"}
                                />
                                <Text style={[styles.newItemLabel, !hasPhotos && styles.newItemLabelDisabled]}>
                                    New item
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Dots indicator for multiple items */}
                    {totalItems > 1 && (
                        <View style={styles.dotsContainer}>
                            {items.map((item, idx) => (
                                <TouchableOpacity
                                    key={item.id}
                                    onPress={() => onSelectItem(item.id)}
                                    onLongPress={() => onDeleteItem?.(item.id)}
                                    style={[
                                        styles.dot,
                                        idx === activeIndex && styles.activeDot,
                                        matchesStore?.[item.id] && styles.matchDot
                                    ]}
                                />
                            ))}
                        </View>
                    )}
                </View>
            </BlurView>
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 100, // Above the capture button
        left: 16,
        right: 16,
        borderRadius: 28,
        overflow: 'hidden',
        zIndex: 100,
        elevation: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
    },
    blurContainer: {
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    contentContainer: {
        paddingVertical: 10,
        paddingHorizontal: 8,
    },
    navRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    arrowButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    arrowButtonDisabled: {
        opacity: 0.4,
    },
    newItemButton: {
        backgroundColor: '#93C822',
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 10,
    },
    newItemLabel: {
        color: '#000',
        fontSize: 13,
        fontWeight: '600',
    },
    newItemLabelDisabled: {
        color: 'rgba(255,255,255,0.5)',
    },
    continueButton: {
        flex: 1,
        marginHorizontal: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: '#93C822',
        borderRadius: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    continueButtonEmpty: {
        backgroundColor: 'rgba(255,255,255,0.1)',
    },
    continueButtonText: {
        color: '#000',
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
    },
    continueButtonTextEmpty: {
        color: 'rgba(255,255,255,0.6)',
        fontWeight: '500',
    },
    itemIndicator: {
        color: 'rgba(0,0,0,0.6)',
        fontSize: 12,
        fontWeight: '600',
        marginRight: 8,
        backgroundColor: 'rgba(255,255,255,0.3)',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 10,
    },
    matchBadge: {
        marginLeft: 8,
    },
    dotsContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 8,
        gap: 8,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    activeDot: {
        backgroundColor: '#FFF',
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    matchDot: {
        backgroundColor: '#93C822',
    }
});

export default ItemNavigationBar;
