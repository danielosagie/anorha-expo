import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Analysis } from '../screens/AddProductScreen';

// This is the type for a single result within the 'analysis.results' array
type ProductResult = Analysis['results'][0];

function MatchItemButton({ result }: { result: ProductResult }) {
  if (!result) {
    return <Text>No result data available.</Text>;
  }

  return (
    <View style={styles.productGroupContainer}>
      {/* Display information about the original product */}
      <View style={styles.originalProductHeader}>
        {result.originalTargetImage ? (
          <Image
            source={{ uri: result.originalTargetImage }}
            style={styles.originalProductImage}
            onError={(e) => console.log('Image load error:', e.nativeEvent.error)}
          />
        ) : (
          <Image
            source={{ uri: 'https://placehold.co/80x80/cccccc/333333?text=No+Image' }}
            style={styles.originalProductImage}
          />
        )}
        <View style={styles.originalProductText}>
          <Text style={styles.originalProductId}>Product ID: {result.productId}</Text>
          <Text style={styles.originalProductConfidence}>Confidence: {result.confidence}</Text>
        </View>
      </View>

      {/* Iterate and render each individual serpApiData item for this product */}
      {result.serpApiData.map((serpItem, index) => (
        <View
          key={index}
          style={[styles.serpItem, index === result.serpApiData.length - 1 && styles.serpItemLast]}
        >
          {serpItem.thumbnail ? (
            <Image
              source={{ uri: serpItem.thumbnail }}
              style={styles.serpThumbnail}
              onError={(e) => console.log('Thumbnail load error:', e.nativeEvent.error)}
            />
          ) : (
            <Image
              source={{ uri: 'https://placehold.co/60x60/eeeeee/555555?text=Thumb' }}
              style={styles.serpThumbnail}
            />
          )}
          <View style={styles.serpTextContent}>
            <Text style={styles.serpTitle}>{serpItem.title || 'No Title'}</Text>
            {serpItem.source && <Text style={styles.serpSource}>Source: {serpItem.source}</Text>}
            {serpItem.price?.value && <Text style={styles.serpPrice}>Price: {serpItem.price.value}</Text>}
          </View>
          {serpItem.link && (
            <TouchableOpacity
              style={styles.serpLinkButton}
              onPress={() => Linking.openURL(serpItem.link || 'https://www.google.com')}
            >
              <Text style={styles.serpLinkButtonText}>View</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
}

export default MatchItemButton;

const styles = StyleSheet.create({
    matchContainer: {
      flex: 1,
      backgroundColor: '#f0f2f5', // Light grey background
    },
    productGroupContainer: {
      backgroundColor: '#ffffff', // White background for each product group
      marginVertical: 8,
      marginHorizontal: 16,
      borderRadius: 12,
      padding: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    originalProductHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#eee',
      paddingBottom: 10,
    },
    originalProductImage: {
      width: 80,
      height: 80,
      borderRadius: 8,
      marginRight: 12,
      backgroundColor: '#e0e0e0', // Placeholder background
    },
    originalProductText: {
      flex: 1,
    },
    originalProductId: {
      fontSize: 16,
      fontWeight: 'bold',
      color: '#333',
    },
    originalProductConfidence: {
      fontSize: 14,
      color: '#666',
      marginTop: 4,
    },
    serpItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f5f5f5',
    },
    serpItemLast: {
      borderBottomWidth: 0, // No border for the last item in the group
    },
    serpThumbnail: {
      width: 60,
      height: 60,
      borderRadius: 6,
      marginRight: 10,
      backgroundColor: '#e0e0e0', // Placeholder background
    },
    serpTextContent: {
      flex: 1,
    },
    serpTitle: {
      fontSize: 15,
      fontWeight: '500',
      color: '#222',
    },
    serpSource: {
      fontSize: 12,
      color: '#888',
      marginTop: 2,
    },
    serpPrice: {
      fontSize: 14,
      fontWeight: 'bold',
      color: '#4CAF50', // Green for price
      marginTop: 2,
    },
    serpLinkButton: {
      backgroundColor: '#007bff', // Blue button
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 5,
      marginLeft: 10,
    },
    serpLinkButtonText: {
      color: '#ffffff',
      fontSize: 12,
      fontWeight: 'bold',
    },
  });