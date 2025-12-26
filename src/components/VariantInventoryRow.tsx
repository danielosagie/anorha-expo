import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

interface VariantInventoryRowProps {
    variantName: string;
    variantId: string;
    invKey: string;
    quantity: number;
    price: number;
    image?: string;

    // Logic Flags
    isGlobalPrice?: boolean; // e.g. Shopify (Inverted Style)
    isOverride?: boolean; // If true, shows yellow override style (only if isGenerationMode is true)
    isGenerationMode?: boolean; // Controls visibility of override UI

    // Callbacks
    onChangeQuantity: (qty: number) => void;
    onChangePrice: (price: number) => void;
    onSelectImage?: () => void;
}

const VariantInventoryRow: React.FC<VariantInventoryRowProps> = ({
    variantName,
    variantId,
    quantity,
    price,
    image,
    isGlobalPrice = false,
    isOverride = false,
    isGenerationMode = false,
    onChangeQuantity,
    onChangePrice,
    onSelectImage,
}) => {
    const theme = useTheme();

    // Local state for smooth typing
    const [localQty, setLocalQty] = useState(String(quantity));
    const [localPrice, setLocalPrice] = useState(String(price));

    const qtyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const priceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sync props to local state - this is critical for Shopify global pricing
    // When parent updates price for ALL locations, each row should receive new price prop
    useEffect(() => {
        if (String(quantity) !== localQty) setLocalQty(String(quantity));
    }, [quantity]);

    useEffect(() => {
        console.log(`[VariantInventoryRow] Price prop changed for variant ${variantId}: prop=${price}, localPrice=${localPrice}, willUpdate=${String(price) !== localPrice}`);
        if (String(price) !== localPrice) {
            setLocalPrice(String(price));
        }
    }, [price]);

    const handleQtyChange = (text: string) => {
        const num = text.replace(/[^0-9]/g, '');
        setLocalQty(num);
        if (qtyTimeoutRef.current) clearTimeout(qtyTimeoutRef.current);
        qtyTimeoutRef.current = setTimeout(() => {
            onChangeQuantity(Number(num || '0'));
        }, 400);
    };

    const handlePriceChange = (text: string) => {
        const num = text.replace(/[^0-9.]/g, '');
        setLocalPrice(num);
        if (priceTimeoutRef.current) clearTimeout(priceTimeoutRef.current);
        priceTimeoutRef.current = setTimeout(() => {
            onChangePrice(Number(num || '0'));
        }, 400);
    };

    const handleIncrement = () => handleQtyChange(String(Number(localQty || 0) + 1));
    const handleDecrement = () => handleQtyChange(String(Math.max(0, Number(localQty || 0) - 1)));

    // Calculate Styling

    // Override Style (Yellow): Only if isOverride AND isGenerationMode
    const showOverrideStyle = isOverride && isGenerationMode;

    // Price Input Style - BLUE for Shopify global
    const priceInputStyle = isGlobalPrice
        ? {
            backgroundColor: '#E3F2FD',
            color: '#1976D2',
            borderColor: '#1976D2',
        } // Global/Blue
        : {
            backgroundColor: '#FFF',
            color: '#000',
            borderColor: '#E5E5E5',
        }; // Standard

    const containerStyle = showOverrideStyle
        ? {
            borderWidth: 2,
            borderColor: '#FFD700',
            backgroundColor: '#FFFEF0',
        }
        : {
            borderWidth: 1,
            borderColor: '#E5E5E5',
            backgroundColor: '#FFF',
        };

    return (
        <View style={[styles.container, containerStyle]}>
            {showOverrideStyle && (
                <View style={styles.overrideBadge}>
                    <Text style={styles.overrideText}>OVERRIDE</Text>
                </View>
            )}

            <View style={styles.contentRow}>
                {/* Left: Variant Name Badge */}
                <View style={styles.leftCol}>
                    <Text style={styles.variantNameBadge}>{variantName}</Text>

                    {/* Inputs Column - 2 column layout */}
                    <View style={styles.inputsCol}>

                        {/* Quantity Row - no +/- buttons on platform tabs */}
                        <View style={styles.inputRow}>
                            <View style={styles.labelCol}>
                                <Text style={styles.label}>Quantity:</Text>
                            </View>
                            <View style={styles.inputCol}>
                                <View style={styles.priceContainer}>
                                    <Text style={[styles.currencySymbol, { color: '#ffffffff' }]}>$</Text>
                                    <TextInput
                                        style={styles.qtyInputSimple}
                                        value={localQty}
                                        onChangeText={handleQtyChange}
                                        keyboardType="number-pad"
                                        selectTextOnFocus
                                    />
                                </View>
                            </View>
                        </View>

                        {/* Price Row */}
                        <View style={styles.inputRow}>
                            <View style={styles.labelCol}>
                                <Text style={styles.label}>Price:</Text>
                            </View>
                            <View style={styles.inputCol}>
                                <View style={styles.priceContainer}>
                                    <Text style={[styles.currencySymbol, isGlobalPrice && { color: '#1976D2' }]}>$</Text>
                                    <TextInput
                                        style={[styles.priceInput, priceInputStyle]}
                                        value={localPrice}
                                        onChangeText={handlePriceChange}
                                        keyboardType="decimal-pad"
                                        selectTextOnFocus
                                    />
                                </View>
                            </View>
                        </View>

                    </View>
                </View>


                {/* Right: Inputs & Image */}
                <View style={styles.rightCol}>
                    {/* Image Slot */}
                    <TouchableOpacity onPress={onSelectImage} style={styles.imageSlot}>
                        {image ? (
                            <Image source={{ uri: image }} style={styles.image} resizeMode="cover" />
                        ) : (
                            <View style={styles.placeholderImage}>
                                <Icon name="plus" size={20} color="#CCC" />
                            </View>
                        )}
                    </TouchableOpacity>

                </View>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        borderRadius: 12,
        padding: 12,
        marginBottom: 8,
        position: 'relative',
    },
    overrideBadge: {
        position: 'absolute',
        top: -10,
        left: 12,
        backgroundColor: '#FFD700',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
        zIndex: 10,
    },
    overrideText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: '700',
    },
    contentRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    leftCol: {
        flex: 1,
        marginRight: 10,
    },
    variantNameBadge: {
        backgroundColor: '#F8F9FB',
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderRadius: 8,
        paddingVertical: 6,
        paddingHorizontal: 12,
        color: '#000',
        fontWeight: '600',
        fontSize: 13,
        marginBottom: 6,
    },
    globalTag: {
        backgroundColor: '#333',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        alignSelf: 'flex-start',
    },
    globalTagText: {
        color: '#FFF',
        fontSize: 10,
        fontWeight: '700',
    },
    rightCol: {
        gap: 12,
        alignItems: 'center',
    },
    inputsCol: {
        gap: 8,
        width: '100%',
    },
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    labelCol: {
        width: 70,
        alignItems: 'flex-end',
        paddingRight: 8,
    },
    inputCol: {
        flex: 1,
        alignItems: 'flex-start',
    },
    label: {
        fontSize: 13,
        color: '#000',
        fontWeight: '400',
    },
    globalPriceTag: {
        backgroundColor: '#E3F2FD',
        borderRadius: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: 'flex-start',
        marginBottom: 8,
    },
    globalPriceTagText: {
        fontSize: 10,
        color: '#1976D2',
        fontWeight: '600',
    },
    qtyContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderRadius: 8,
        backgroundColor: '#FFF',
        height: 36,
    },
    qtyBtn: {
        paddingHorizontal: 8,
        height: '100%',
        justifyContent: 'center',
    },
    qtyInput: {
        width: 40,
        textAlign: 'center',
        fontWeight: '600',
        fontSize: 13,
        color: '#000',
        height: '100%',
        padding: 0,
    },
    qtyInputSimple: {
        width: 60,
        textAlign: 'center',
        fontWeight: '600',
        fontSize: 13,
        color: '#000',
        height: 36,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderRadius: 8,
        backgroundColor: '#FFF',
    },
    priceContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    currencySymbol: {
        fontSize: 13,
        color: '#666',
    },
    priceInput: {
        width: 80,
        height: 36,
        textAlign: 'center',
        fontWeight: '600',
        fontSize: 13,
        borderWidth: 1,
        borderRadius: 8,
        padding: 0,
    },
    imageSlot: {
        width: 100,
        height: 100,
    },
    image: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
        backgroundColor: '#F0F0F0',
    },
    placeholderImage: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FAFAFA',
    },
});

export default VariantInventoryRow;
