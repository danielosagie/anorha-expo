import React from 'react';
import { TouchableOpacity, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import WhatnotSvg from '../assets/whatnot.svg';
import DepopSvg from '../assets/depop-icon.svg';

type Props = {
    platform: string;
    onPress: () => void;
    isSelected: boolean;
    isConnected?: boolean;
    loading?: boolean;
    success?: boolean;
    activeCount?: number;
};

const PlatformButton = ({ platform, onPress, isSelected, isConnected = false, loading = false, success = false, activeCount = 0 }: Props) => {
    const platformSvgMap: { [key: string]: React.ComponentType<any> } = {
        shopify: ShopifySvg,
        amazon: AmazonSvg,
        facebook: FacebookSvg,
        ebay: EbaySvg,
        clover: CloverSvg,
        square: SquareSvg,
        whatnot: WhatnotSvg,
        depop: DepopSvg,
    };

    const PlatformSvg = platformSvgMap[platform];

    const content = (
        <TouchableOpacity
            style={[styles.platformButton, isSelected && styles.platformButtonSelected]}
            onPress={onPress}
            activeOpacity={0.7}
            disabled={loading}
        >
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                {loading ? (
                    <ActivityIndicator color={'#6B7280'} />
                ) : PlatformSvg ? (
                    <PlatformSvg width={34} height={34} style={styles.platformIcon} />
                ) : null
                }
                <Text style={styles.platformLabel}>
                    {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </Text>
            </View>
            {activeCount > 0 && (
                <View style={styles.countBadge}>
                    <Text style={styles.countBadgeText}>{activeCount}</Text>
                </View>
            )}
        </TouchableOpacity>
    );

    if (success) {
        // Wrap in gradient to simulate gradient border
        return (
            <LinearGradient colors={["#93C822", "#FFD700"]} start={{x:0,y:0}} end={{x:1,y:1}} style={styles.gradientWrap}>
                {content}
            </LinearGradient>
        );
    }

    return content;
};

export default PlatformButton;

const styles = StyleSheet.create({
    platformButton: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 8,
        backgroundColor: '#F5F5F5',
        margin: 4,
        width: 100,
        height: 100,
        borderWidth: 2,
        borderColor: 'transparent',
        position: 'relative',
    },
    platformButtonSelected: {
        backgroundColor: 'rgba(147, 200, 34, 0.1)',
        borderColor: '#93C822',
        borderWidth: 2,
        borderRadius: 8,
        // Keep same size - don't change width/height
    },
    platformIcon: {
        // SVG styling if needed
    },
    platformLabel: {
        marginTop: 6,
        color: '#000',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    gradientWrap: {
        padding: 2,
        borderRadius: 10,
        margin: 4,
    },
    countBadge: {
        position: 'absolute',
        top: 6,
        right: 6,
        minWidth: 20,
        height: 20,
        paddingHorizontal: 6,
        backgroundColor: '#93C822',
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    countBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
});