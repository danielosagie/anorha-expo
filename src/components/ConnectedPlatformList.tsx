import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ConnectedPlatformItem, { PlatformConnection } from './ConnectedPlatformItem';

const AVAILABLE_PLATFORMS = [
    { key: 'shopify', name: 'Shopify', icon: 'shopping' },
    { key: 'amazon', name: 'Amazon', icon: 'package' },
    { key: 'clover', name: 'Clover', icon: 'leaf' },
    { key: 'square', name: 'Square', icon: 'square-outline' },
    { key: 'ebay', name: 'eBay', icon: 'shopping' },
    { key: 'facebook', name: 'Facebook', icon: 'facebook' },
    { key: 'depop', name: 'Depop', icon: 'alpha-d' },
    { key: 'whatnot', name: 'Whatnot', icon: 'chat-processing' },
    { key: 'etsy', name: 'Etsy', icon: 'alpha-e' },
];

interface ConnectedPlatformListProps {
    connections: PlatformConnection[];
    isEditMode: boolean;
    onStartScan: (id: string, name: string, force?: boolean) => void;
    onReview: (id: string, name: string) => void;
    onReconnect: (id: string, platformKey: string, platformName: string) => void;
    onDisconnect: (id: string, name: string) => void;
    onFix: (id: string, name: string) => void;
    navigation: any;
}

const PAGE_SIZE = 3;

const ConnectedPlatformList: React.FC<ConnectedPlatformListProps> = ({
    connections,
    isEditMode,
    onStartScan,
    onReview,
    onReconnect,
    onDisconnect,
    onFix,
    navigation,
}) => {
    const [currentPage, setCurrentPage] = useState(1);

    if (connections.length === 0) {
        return <Text style={styles.noConnectionsText}>No connections yet.</Text>;
    }

    const totalPages = Math.ceil(connections.length / PAGE_SIZE);

    // Ensure current page is valid if items change
    React.useEffect(() => {
        if (currentPage > totalPages && totalPages > 0) {
            setCurrentPage(totalPages);
        }
    }, [connections.length, totalPages]);

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const visibleConnections = connections.slice(startIndex, startIndex + PAGE_SIZE);

    const handlePrev = () => {
        if (currentPage > 1) setCurrentPage(p => p - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) setCurrentPage(p => p + 1);
    };

    return (
        <View style={styles.container}>
            {visibleConnections.map((connection) => {
                let platformConfig = AVAILABLE_PLATFORMS.find((p: any) => p.key === connection.PlatformType);

                // Fallback for CSV or unknown platforms
                if (!platformConfig) {
                    // Check if it's CSV
                    if (connection.PlatformType === 'csv') {
                        platformConfig = {
                            key: 'csv',
                            name: connection.DisplayName || 'CSV Import',
                            icon: 'table' as any // Use table icon for CSV
                        };
                    } else {
                        // Generic fallback
                        platformConfig = {
                            key: connection.PlatformType,
                            name: connection.PlatformType.charAt(0).toUpperCase() + connection.PlatformType.slice(1),
                            icon: 'cube-outline' as any
                        };
                    }
                }

                return (
                    <ConnectedPlatformItem
                        key={connection.Id}
                        connection={connection}
                        platformConfig={platformConfig}
                        isEditMode={isEditMode}
                        onStartScan={onStartScan}
                        onReview={onReview}
                        onReconnect={onReconnect}
                        onDisconnect={onDisconnect}
                        onFix={onFix}
                        navigation={navigation}
                    />
                );
            })}

            {/* Pagination Controls - only show if more than 1 page */}
            {connections.length > PAGE_SIZE && (
                <View style={styles.paginationContainer}>
                    <TouchableOpacity
                        style={[
                            styles.paginationButton,
                            currentPage === 1 && styles.paginationButtonDisabled
                        ]}
                        onPress={handlePrev}
                        disabled={currentPage === 1}
                    >
                        <Text style={[
                            styles.paginationButtonText,
                            currentPage === 1 && { color: '#ccc' }
                        ]}>Prev</Text>
                    </TouchableOpacity>

                    <Text style={styles.paginationInfo}>
                        Page {currentPage} of {totalPages || 1}
                    </Text>

                    <TouchableOpacity
                        style={[
                            styles.paginationButton,
                            currentPage < totalPages && styles.nextButtonActive,
                            currentPage >= totalPages && styles.paginationButtonDisabled
                        ]}
                        onPress={handleNext}
                        disabled={currentPage >= totalPages}
                    >
                        <Text style={[
                            styles.paginationButtonText,
                            currentPage < totalPages && styles.nextButtonText,
                            currentPage >= totalPages && { color: '#ccc' }
                        ]}>Next</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    noConnectionsText: {
        textAlign: 'center',
        color: '#666',
        marginTop: 20,
        marginBottom: 20,
        fontStyle: 'italic',
    },
    paginationContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
        marginTop: 8,
    },
    paginationButton: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e0e0e0',
        minWidth: 80,
        alignItems: 'center',
    },
    nextButtonActive: {
        backgroundColor: '#4B5563', // Darker gray
        borderColor: '#4B5563',
    },
    paginationButtonDisabled: {
        opacity: 0.5,
        borderColor: '#f0f0f0',
        backgroundColor: 'transparent',
    },
    paginationButtonText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#555',
    },
    nextButtonText: {
        color: '#fff',
    },
    paginationInfo: {
        fontSize: 12,
        color: '#888',
    },
});

export default ConnectedPlatformList;
