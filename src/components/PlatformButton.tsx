import React, { useState } from 'react';
import { TouchableOpacity, StyleSheet, Text } from 'react-native';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';

const PlatformButton = ({ platform, onPress, isSelected, isConnected = false }: { platform: string, onPress: () => void, isSelected: boolean, isConnected?: boolean }) => {
    const platformComponentMap: { [key: string]: React.ComponentType<any> } = {
        shopify: ShopifySvg,
        amazon: AmazonSvg,
        facebook: FacebookSvg,
        ebay: EbaySvg,
        clover: CloverSvg,
        square: SquareSvg,
    };

    const PlatformIcon = platformComponentMap[platform];

    return (
        <TouchableOpacity 
            style={[
                styles.platformButton, 
                isSelected && styles.platformButtonSelected
            ]} 
            onPress={onPress}
            activeOpacity={0.7}
        >
            {PlatformIcon && (
                <PlatformIcon 
                    width={48} 
                    height={48} 
                    style={styles.platformIcon}
                />
            )}
        </TouchableOpacity>
    );
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
});