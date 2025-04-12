import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import PlaceholderImage from '../components/Placeholder';
import Button from '../components/Button';
import { Platform } from 'react-native';

const MarketplaceItem = ({ item, onAddToInventory, navigation }) => {
  const theme = useTheme();
  
  return (
    <TouchableOpacity 
      style={styles.gridItem}
      onPress={() => {
        navigation.getParent()?.navigate('ProductDetail', { item });
      }}
    >
      <Card style={styles.gridItemCard}>
        <PlaceholderImage 
          size={120} 
          borderRadius={0} 
          color={getPlatformColor(item.platform)}
          type="gradient"
          icon="storefront"
          text={item.platform[0]}
          style={styles.gridItemImage}
        />
        
        <View style={styles.gridItemDetails}>
          <Text 
            style={styles.gridItemTitle} 
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {item.title}
          </Text>
          <Text style={styles.gridItemPrice}>${item.price.toFixed(2)}</Text>
          
          <View style={styles.gridItemFooter}>
            <Text 
              style={styles.sellerName} 
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.seller}
            </Text>
            <TouchableOpacity 
              style={styles.addButton}
              onPress={() => onAddToInventory(item)}
            >
              <Icon name="plus" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
};

const getPlatformColor = (platform) => {
  switch (platform) {
    case 'Shopify':
      return '#0E8F7F';
    case 'Amazon':
      return '#F17F5F';
    case 'Clover':
      return '#3CAD46';
    case 'Square':
      return '#6C757D';
    default:
      return '#555555';
  }
};

// Sample marketplace data
const mockMarketplaceItems = [
  {
    id: 1,
    title: 'Premium Caribbean Spice Collection',
    price: 49.99,
    platform: 'Shopify',
    seller: 'Island Flavors Co.',
    rating: 4.8,
    sales: 243
  },
  {
    id: 2,
    title: 'Handcrafted Wooden Serving Bowl',
    price: 65.50,
    platform: 'Amazon',
    seller: 'Caribbean Crafts',
    rating: 4.5,
    sales: 189
  },
  {
    id: 3,
    title: 'Authentic Jamaican Coffee Beans',
    price: 22.99,
    platform: 'Clover',
    seller: 'Blue Mountain Imports',
    rating: 4.9,
    sales: 412
  },
  {
    id: 4,
    title: 'Caribbean Hot Sauce Variety Pack',
    price: 27.50,
    platform: 'Square',
    seller: 'Tropical Heat',
    rating: 4.7,
    sales: 178
  },
  {
    id: 5,
    title: 'Organic Caribbean Cacao Powder',
    price: 18.99,
    platform: 'Shopify',
    seller: 'Natural Delights',
    rating: 4.6,
    sales: 156
  },
];

const MarketplaceScreen = ({ navigation }) => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  const categories = ['All', 'Food', 'Crafts', 'Spices', 'Accessories'];
  
  const handleAddToInventory = (item) => {
    // Add logic to add item to inventory
    console.log(`Added ${item.title} to inventory`);
    // Show a success message or navigate to the inventory screen
  };
  
  return (
    <View style={styles.container} paddingTop={60}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Marketplace</Text>
        
        <View style={styles.searchContainer}>
          <Icon name="magnify" size={24} color="#777" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search marketplace..."
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.filterButton}>
            <Icon name="filter-variant" size={24} color={theme.colors.primary} />
          </TouchableOpacity>
        </View>
        
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          style={styles.categoriesContainer}
        >
          {categories.map(category => (
            <TouchableOpacity
              key={category}
              style={[
                styles.categoryChip,
                selectedCategory === category && { 
                  backgroundColor: theme.colors.primary,
                }
              ]}
              onPress={() => setSelectedCategory(category)}
            >
              <Text 
                style={[
                  styles.categoryText, 
                  selectedCategory === category && { color: '#fff' }
                ]}
              >
                {category}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        
        <View style={styles.trendingHeader}>
          <Text style={styles.sectionTitle}>Trending Items</Text>
          <TouchableOpacity>
            <Text style={[styles.seeAllText, { color: theme.colors.primary }]}>See All</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
      
      <FlatList
        data={mockMarketplaceItems}
        renderItem={({ item }) => (
          <Animated.View 
            entering={FadeInUp.delay(200 + item.id * 100).duration(500)}
            style={styles.gridItemWrapper}
          >
            <MarketplaceItem 
              item={item} 
              onAddToInventory={handleAddToInventory}
              navigation={navigation}
            />
          </Animated.View>
        )}
        keyExtractor={(item) => item.id.toString()}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            <View style={styles.sellerStatsSection}>
              <Text style={styles.sellerStatsSectionTitle}>Top Sellers</Text>
              <View style={styles.sellerCards}>
                <TouchableOpacity style={styles.sellerCard}>
                  <View style={[styles.sellerAvatar, {backgroundColor: '#0E8F7F20'}]}>
                    <Text style={[styles.sellerInitial, {color: '#0E8F7F'}]}>J</Text>
                  </View>
                  <Text style={styles.sellerCardName}>J-Shop</Text>
                  <Text style={styles.sellerCardStat}>256 products</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sellerCard}>
                  <View style={[styles.sellerAvatar, {backgroundColor: '#F17F5F20'}]}>
                    <Text style={[styles.sellerInitial, {color: '#F17F5F'}]}>A</Text>
                  </View>
                  <Text style={styles.sellerCardName}>Amazing</Text>
                  <Text style={styles.sellerCardStat}>193 products</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sellerCard}>
                  <View style={[styles.sellerAvatar, {backgroundColor: '#3CAD4620'}]}>
                    <Text style={[styles.sellerInitial, {color: '#3CAD46'}]}>T</Text>
                  </View>
                  <Text style={styles.sellerCardName}>TechBox</Text>
                  <Text style={styles.sellerCardStat}>167 products</Text>
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.categoriesSection}>
              <Text style={styles.categoriesSectionTitle}>Browse Categories</Text>
              <View style={styles.categoriesGrid}>
                <TouchableOpacity style={styles.categoryItem}>
                  <View style={[styles.categoryIcon, {backgroundColor: '#0E8F7F20'}]}>
                    <Icon name="tag-outline" size={24} color="#0E8F7F" />
                  </View>
                  <Text style={styles.categoryName}>Clothing</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.categoryItem}>
                  <View style={[styles.categoryIcon, {backgroundColor: '#F17F5F20'}]}>
                    <Icon name="food-apple-outline" size={24} color="#F17F5F" />
                  </View>
                  <Text style={styles.categoryName}>Food</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.categoryItem}>
                  <View style={[styles.categoryIcon, {backgroundColor: '#3CAD4620'}]}>
                    <Icon name="laptop" size={24} color="#3CAD46" />
                  </View>
                  <Text style={styles.categoryName}>Electronics</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.categoryItem}>
                  <View style={[styles.categoryIcon, {backgroundColor: '#865AF020'}]}>
                    <Icon name="sofa-outline" size={24} color="#865AF0" />
                  </View>
                  <Text style={styles.categoryName}>Home</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>No items found</Text>
        }
        ListFooterComponent={<View style={styles.listFooter} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  searchIcon: {
    marginHorizontal: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
  },
  filterButton: {
    padding: 8,
  },
  categoriesContainer: {
    marginBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#EEE',
    marginRight: 8,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: '500',
  },
  trendingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  seeAllText: {
    fontSize: 14,
  },
  listContent: {
    padding: 1,
  },
  gridItemWrapper: {
    width: '50%',
    padding: 5,
  },
  gridItem: {
    flex: 1,
  },
  gridItemCard: {
    padding: 0,
    overflow: 'hidden',
    height: 264,
  },
  gridItemImage: {
    width: '100%',
    height: 170,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  gridItemDetails: {
    padding: 10,
    flex: 1,
    justifyContent: 'space-between',
  },
  gridItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
    flex: 1,
    maxWidth: '100%',
  },
  gridItemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  gridItemFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sellerName: {
    fontSize: 12,
    color: '#777',
    flex: 1,
    marginRight: 8,
  },
  addButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0E8F7F',
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoriesSection: {
    marginBottom: 16,
  },
  categoriesSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryItem: {
    width: '48%',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '500',
  },
  sellerStatsSection: {
    marginBottom: 16,
  },
  sellerStatsSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  sellerCards: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sellerCard: {
    width: '31%',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  sellerAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  sellerInitial: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  sellerCardName: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  sellerCardStat: {
    fontSize: 12,
    color: '#777',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    color: '#777',
    padding: 24,
  },
  listFooter: {
    height: 100, // Extra space at the bottom for the tab bar
  },
});

export default MarketplaceScreen; 