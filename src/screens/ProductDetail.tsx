import React from 'react';
import { View, Text, StyleSheet, ScrollView, Image } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const ProductDetailScreen = ({ route, navigation }) => {
  const { item } = route.params || { item: {} };
  const theme = useTheme();
  
  return (
    <View style={styles.container} paddingTop={60}>
      <ScrollView>
        <View style={styles.header}>
          <Icon 
            name="arrow-left" 
            size={24} 
            color="#333" 
            onPress={() => navigation.goBack()} 
          />
          <Text style={styles.headerTitle}>Product Details</Text>
          <Icon name="dots-vertical" size={24} color="#333" />
        </View>
        
        <View style={styles.productImageContainer}>
          <Image 
            source={{ uri: item.image || 'https://via.placeholder.com/400' }} 
            style={styles.productImage} 
            resizeMode="cover" 
          />
        </View>
        
        <View style={styles.productInfo}>
          <Text style={styles.productTitle}>{item.title || "Product Title"}</Text>
          <Text style={styles.productPrice}>${item.price?.toFixed(2) || "0.00"}</Text>
          
          <View style={styles.platformInfo}>
            <Icon name="shopping" size={18} color="#0E8F7F" />
            <Text style={styles.platformText}>{item.platform || "Platform"}</Text>
          </View>
          
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.sales || 0}</Text>
              <Text style={styles.statLabel}>Sales</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.rating || "0.0"}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{item.views || 0}</Text>
              <Text style={styles.statLabel}>Views</Text>
            </View>
          </View>
          
          <View style={styles.actionButtons}>
            <Button 
              title="Edit Listing" 
              icon="pencil" 
              outlined 
              style={{ flex: 1, marginRight: 8 }} 
            />
            <Button 
              title="View Analytics" 
              icon="chart-line" 
              style={{ flex: 1, marginLeft: 8 }} 
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  productImageContainer: {
    width: '100%',
    height: 300,
    backgroundColor: '#f5f5f5',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    padding: 16,
  },
  productTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  productPrice: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0E8F7F',
    marginBottom: 16,
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  platformText: {
    fontSize: 16,
    marginLeft: 8,
    color: '#555',
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    padding: 16,
    marginBottom: 24,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },
  actionButtons: {
    flexDirection: 'row',
    marginTop: 8,
  },
});

export default ProductDetailScreen; 