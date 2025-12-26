import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Image, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface OptimizerProductDetailSheetProps {
    isVisible: boolean;
    onClose: () => void;
    product: any;
    onStartSession: () => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export const OptimizerProductDetailSheet: React.FC<OptimizerProductDetailSheetProps> = ({
    isVisible,
    onClose,
    product,
    onStartSession,
}) => {
    if (!product) return null;

    const angles = [
        { id: 'front', label: 'Front View', icon: 'box-variant-badge' },
        { id: 'side', label: 'Side Angle', icon: 'rotate-right' },
        { id: 'back', label: 'Back View', icon: 'rotate-left' },
        { id: 'detail', label: 'Detail Shot', icon: 'magnify-plus' },
    ];

    return (
        <Modal
            visible={isVisible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.overlay}>
                <TouchableOpacity style={styles.dismissArea} onPress={onClose} />
                <View style={styles.sheet}>
                    <View style={styles.handle} />

                    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                        {/* Header */}
                        <View style={styles.header}>
                            <View style={styles.titleInfo}>
                                <Text style={styles.productTitle}>{product.Title}</Text>
                                <Text style={styles.skuText}>SKU: {product.Sku || 'N/A'}</Text>
                            </View>
                            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                                <MaterialCommunityIcons name="close" size={24} color="#adb5bd" />
                            </TouchableOpacity>
                        </View>

                        {/* Existing Photos Carousel Placeholder */}
                        <View style={styles.carouselContainer}>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} pagingEnabled>
                                {product.ProductImages && product.ProductImages.length > 0 ? (
                                    product.ProductImages.map((img: any, idx: number) => (
                                        <Image key={idx} source={{ uri: img.ImageUrl }} style={styles.carouselImage} />
                                    ))
                                ) : (
                                    <View style={styles.emptyCarousel}>
                                        <MaterialCommunityIcons name="image-plus" size={48} color="#e9ecef" />
                                        <Text style={styles.emptyText}>No photos yet</Text>
                                    </View>
                                )}
                            </ScrollView>
                        </View>

                        {/* Missing Angles Diagram */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Missing Angles</Text>
                            <View style={styles.angleGrid}>
                                {angles.map((angle) => (
                                    <View key={angle.id} style={styles.angleItem}>
                                        <View style={styles.angleIconCircle}>
                                            <MaterialCommunityIcons name={angle.icon as any} size={24} color="#8cc63f" />
                                        </View>
                                        <Text style={styles.angleLabel}>{angle.label}</Text>
                                        <MaterialCommunityIcons name="checkbox-blank-outline" size={18} color="#dee2e6" />
                                    </View>
                                ))}
                            </View>
                        </View>

                        {/* Reference Examples Strip */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Good Angle Examples</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                {[1, 2, 3, 4].map((n) => (
                                    <View key={n} style={styles.exampleFrame}>
                                        <View style={styles.examplePlaceholder}>
                                            <MaterialCommunityIcons name="camera-enhance-outline" size={20} color="#adb5bd" />
                                        </View>
                                    </View>
                                ))}
                            </ScrollView>
                        </View>
                    </ScrollView>

                    {/* Action Footer */}
                    <View style={styles.footer}>
                        <TouchableOpacity style={styles.primaryBtn} onPress={onStartSession}>
                            <MaterialCommunityIcons name="camera" size={20} color="#fff" />
                            <Text style={styles.primaryBtnText}>Start Photo Session</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                            <Text style={styles.secondaryBtnText}>Remind me later</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    dismissArea: {
        flex: 1,
    },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        height: SCREEN_HEIGHT * 0.85,
        paddingTop: 12,
    },
    handle: {
        width: 40,
        height: 4,
        backgroundColor: '#e9ecef',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 8,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingBottom: 40,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    titleInfo: {
        flex: 1,
        marginRight: 12,
    },
    productTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: '#1a1a1a',
        marginBottom: 4,
    },
    skuText: {
        fontSize: 12,
        color: '#adb5bd',
        fontWeight: '700',
    },
    closeBtn: {
        padding: 4,
    },
    carouselContainer: {
        height: 200,
        backgroundColor: '#f8f9fa',
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 24,
    },
    carouselImage: {
        width: Dimensions.get('window').width - 40,
        height: 200,
        resizeMode: 'cover',
    },
    emptyCarousel: {
        width: Dimensions.get('window').width - 40,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
        color: '#adb5bd',
        fontWeight: '600',
        marginTop: 8,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#1a1a1a',
        marginBottom: 16,
    },
    angleGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
    },
    angleItem: {
        width: (Dimensions.get('window').width - 64) / 2,
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        padding: 12,
        alignItems: 'center',
    },
    angleIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    angleLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: '#495057',
        marginBottom: 8,
    },
    exampleFrame: {
        width: 100,
        height: 100,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#f1f3f5',
        marginRight: 12,
        overflow: 'hidden',
    },
    examplePlaceholder: {
        flex: 1,
        backgroundColor: '#f8f9fa',
        justifyContent: 'center',
        alignItems: 'center',
    },
    footer: {
        padding: 20,
        paddingBottom: 34,
        borderTopWidth: 1,
        borderTopColor: '#f1f3f5',
        backgroundColor: '#fff',
    },
    primaryBtn: {
        backgroundColor: '#8cc63f',
        height: 56,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        marginBottom: 12,
    },
    primaryBtnText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
    },
    secondaryBtn: {
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
    },
    secondaryBtnText: {
        color: '#adb5bd',
        fontSize: 14,
        fontWeight: '700',
    },
});
