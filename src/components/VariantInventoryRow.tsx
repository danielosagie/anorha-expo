import React, { useState, useEffect, useRef } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, TextInput, TouchableOpacity, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { createLogger } from '../utils/logger';
const log = createLogger('VariantInventoryRow');


interface VariantInventoryRowProps {
    variantName: string;
    variantId: string;
    invKey: string;
    quantity: number;
    price: number;
    image?: string;
    sku?: string;
    isLast?: boolean; // last row in the card → no bottom divider

    // Logic Flags
    isGlobalPrice?: boolean; // e.g. Shopify (Inverted Style)
    isOverride?: boolean; // If true, shows amber override style (only if isGenerationMode is true)
    isGenerationMode?: boolean; // Controls visibility of override UI
    externalUpdateQuantity?: boolean; // Green border when value came from external/realtime update
    externalUpdatePrice?: boolean;

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
    sku,
    isLast = false,
    isGlobalPrice = false,
    isOverride = false,
    isGenerationMode = false,
    externalUpdateQuantity = false,
    externalUpdatePrice = false,
    onChangeQuantity,
    onChangePrice,
    onSelectImage,
}) => {
    // Local state for smooth typing
    const [localQty, setLocalQty] = useState(String(quantity));
    const [localPrice, setLocalPrice] = useState(String(Number.isFinite(price) ? price : 0));

    const qtyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const priceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync props to local state - this is critical for Shopify global pricing
    // When parent updates price for ALL locations, each row should receive new price prop
    useEffect(() => {
        if (String(quantity) !== localQty) setLocalQty(String(quantity));
    }, [quantity]);

    useEffect(() => {
        log.debug(`[VariantInventoryRow] Price prop changed for variant ${variantId}: prop=${price}, localPrice=${localPrice}, willUpdate=${String(price) !== localPrice}`);
        const safe = Number.isFinite(price) ? price : 0;
        if (String(safe) !== localPrice) {
            setLocalPrice(String(safe));
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

    // Amber override hint on the price box (GenerateDetails only; never in the editor).
    const showOverrideStyle = isOverride && isGenerationMode;

    return (
        <View style={[styles.row, !isLast && styles.rowDivider]}>
            {/* Thumbnail — opens the shared Photos sheet */}
            <TouchableOpacity onPress={onSelectImage} style={styles.thumb} activeOpacity={0.8}>
                {image ? (
                    <Image source={{ uri: image }} style={styles.thumbImg} resizeMode="cover" />
                ) : (
                    <View style={styles.thumbPlaceholder}>
                        <Icon name="image-plus" size={16} color="#9CA3AF" />
                    </View>
                )}
            </TouchableOpacity>

            {/* Name + SKU */}
            <View style={styles.nameCol}>
                <Text style={styles.nameText} numberOfLines={1}>{variantName}</Text>
                {!!sku && <Text style={styles.skuText} numberOfLines={1}>{sku}</Text>}
            </View>

            {/* Price */}
            <View style={[styles.priceBox, showOverrideStyle && styles.priceBoxOverride, externalUpdatePrice && styles.fieldExternal]}>
                <Text style={styles.priceCurrency}>$</Text>
                <TextInput
                    style={styles.priceInput}
                    value={localPrice}
                    onChangeText={handlePriceChange}
                    keyboardType="decimal-pad"
                    selectTextOnFocus
                />
            </View>

            {/* Quantity stepper */}
            <View style={[styles.stepper, externalUpdateQuantity && styles.fieldExternal]}>
                <TouchableOpacity onPress={handleDecrement} style={styles.stepBtn} hitSlop={{ top: 8, bottom: 8, left: 6, right: 2 }}>
                    <Icon name="minus" size={15} color="#111827" />
                </TouchableOpacity>
                <TextInput
                    style={[styles.stepInput, externalUpdateQuantity && { color: BRAND_PRIMARY }]}
                    value={localQty}
                    onChangeText={handleQtyChange}
                    keyboardType="number-pad"
                    selectTextOnFocus
                />
                <TouchableOpacity onPress={handleIncrement} style={styles.stepBtn} hitSlop={{ top: 8, bottom: 8, left: 2, right: 6 }}>
                    <Icon name="plus" size={15} color="#111827" />
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    // One compact row per variant: [thumb] [name + sku] [price] [stepper]
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingVertical: 11,
        paddingHorizontal: 13,
    },
    rowDivider: {
        borderBottomWidth: 1,
        borderBottomColor: '#F1F2F4',
    },
    thumb: {
        width: 36,
        height: 36,
    },
    thumbImg: {
        width: 36,
        height: 36,
        borderRadius: 9,
        backgroundColor: '#ECECEF',
    },
    thumbPlaceholder: {
        width: 36,
        height: 36,
        borderRadius: 9,
        backgroundColor: '#ECECEF',
        alignItems: 'center',
        justifyContent: 'center',
    },
    nameCol: {
        flex: 1,
        minWidth: 0,
    },
    nameText: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111827',
        lineHeight: 18,
    },
    skuText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#9CA3AF',
        lineHeight: 16,
        marginTop: 1,
    },
    priceBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#D9D9D9',
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 6,
        minWidth: 64,
    },
    priceBoxOverride: {
        borderColor: '#BA7517',
    },
    priceCurrency: {
        fontSize: 13,
        fontWeight: '600',
        color: '#6B7280',
    },
    priceInput: {
        flex: 1,
        fontSize: 13,
        fontWeight: '600',
        color: '#6B7280',
        padding: 0,
        minWidth: 36,
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F4F4F4',
        borderRadius: 6,
        paddingVertical: 4,
        paddingHorizontal: 8,
        gap: 4,
    },
    stepBtn: {
        paddingHorizontal: 4,
        justifyContent: 'center',
    },
    stepInput: {
        fontSize: 14,
        fontWeight: '700',
        color: '#111827',
        minWidth: 22,
        textAlign: 'center',
        padding: 0,
    },
    fieldExternal: {
        borderWidth: 2,
        borderColor: BRAND_PRIMARY,
    },
});

export default VariantInventoryRow;
