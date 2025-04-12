import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { mockInventoryItems } from '../data/mockData';
import PlaceholderImage from '../components/Placeholder';

const InventoryItem = ({ item }) => {
  const theme = useTheme();
  
  return (
    <Card style={styles.itemCard}>
      <View style={styles.itemContainer}>
        {item.usePlaceholder ? 
          <PlaceholderImage size={60} borderRadius={8} /> :
          <Image source={item.image} style={styles.itemImage} />
        }
        
        <View style={styles.itemDetails}>
          <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
          
          <View style={styles.itemMeta}>
            <View style={styles.priceQuantityContainer}>
              <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
              <Text style={styles.itemQuantity}>{item.quantity} in stock</Text>
            </View>
            
            <View style={styles.platformsContainer}>
              {item.platforms.map(platform => (
                <View 
                  key={platform} 
                  style={[
                    styles.platformBadge,
                    { backgroundColor: getPlatformColor(platform, theme) }
                  ]}
                >
                  <Text style={styles.platformBadgeText}>
                    {platform[0].toUpperCase()}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        
        <TouchableOpacity style={styles.itemMenu}>
          <Icon name="dots-vertical" size={20} color="#777" />
        </TouchableOpacity>
      </View>
    </Card>
  );
};

const getPlatformColor = (platform, theme) => {
  switch (platform) {
    case 'shopify':
      return theme.colors.primary;
    case 'amazon':
      return theme.colors.secondary;
    case 'clover':
      return theme.colors.accent;
    case 'square':
      return '#6C757D';
    default:
      return theme.colors.primary;
  }
};

const InventoryScreen = () => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date');
  
  const filteredItems = mockInventoryItems.filter(item => {
    // Search filter
    if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Platform filter
    if (filter !== 'all' && !item.platforms.includes(filter)) {
      return false;
    }
    
    return true;
  });
  
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (sort === 'price-high') return b.price - a.price;
    if (sort === 'price-low') return a.price - b.price;
    if (sort === 'quantity') return b.quantity - a.quantity;
    // Default to date
    return new Date(b.date) - new Date(a.date);
  });
  
  const renderSortLabel = () => {
    switch (sort) {
      case 'date':
        return 'Newest First';
      case 'price-high':
        return 'Price: High to Low';
      case 'price-low':
        return 'Price: Low to High';
      case 'quantity':
        return 'Most Stock';
      default:
        return 'Sort by';
    }
  };
  
  return (
    <View style={styles.container}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Inventory</Text>
        
        <Card style={styles.searchCard}>
          <View style={styles.searchContainer}>
            <Icon name="magnify" size={20} color="#777" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search inventory..."
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close" size={20} color="#777" />
              </TouchableOpacity>
            ) : null}
          </View>
          
          <View style={styles.filterContainer}>
            <Text style={styles.filterLabel}>Platform:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {['all', 'shopify', 'amazon', 'clover', 'square'].map((platform) => (
                <TouchableOpacity
                  key={platform}
                  style={[
                    styles.filterChip,
                    filter === platform && { backgroundColor: theme.colors.primary }
                  ]}
                  onPress={() => setFilter(platform)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      filter === platform && { color: 'white' }
                    ]}
                  >
                    {platform === 'all' ? 'All' : platform.charAt(0).toUpperCase() + platform.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          
          <View style={styles.sortContainer}>
            <Text style={styles.sortLabel}>Sort by:</Text>
            <TouchableOpacity
              style={styles.sortButton}
              onPress={() => {
                // Cycle through sort options
                if (sort === 'date') setSort('price-high');
                else if (sort === 'price-high') setSort('price-low');
                else if (sort === 'price-low') setSort('quantity');
                else setSort('date');
              }}
            >
              <Text style={styles.sortButtonText}>{renderSortLabel()}</Text>
              <Icon name="chevron-down" size={16} color="#777" />
            </TouchableOpacity>
          </View>
        </Card>
      </Animated.View>
      
      <FlatList
        data={sortedItems}
        keyExtractor={(item) => item.id.toString()}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInUp.delay(100 + index * 50).duration(300)}>
            <InventoryItem item={item} />
          </Animated.View>
        )}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Card>
            <Text style={styles.emptyText}>No items found</Text>
          </Card>
        }
        ListFooterComponent={<View style={styles.listFooter} />}
      />
      
      <View style={styles.fab}>
        <TouchableOpacity 
          style={[styles.fabButton, { backgroundColor: theme.colors.primary }]}
          onPress={() => {/* Navigate to Add Listing */}}
        >
          <Icon name="plus" size={24} color="white" />
        </TouchableOpacity>
      </View>
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
    marginVertical: 16,
  },
  searchCard: {
    marginBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  filterContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 14,
    color: '#555',
    marginRight: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 14,
    color: '#555',
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortLabel: {
    fontSize: 14,
    color: '#555',
    marginRight: 8,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sortButtonText: {
    fontSize: 14,
    color: '#555',
    marginRight: 4,
  },
  itemCard: {
    marginBottom: 8,
    padding: 12,
  },
  itemContainer: {
    flexDirection: 'row',
  },
  itemImage: {
    width: 70,
    height: 70,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
  },
  itemDetails: {
    flex: 1,
    marginLeft: 12,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  itemMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  priceQuantityContainer: {
    flex: 1,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  itemQuantity: {
    fontSize: 14,
    color: '#777',
    marginTop: 4,
  },
  platformsContainer: {
    flexDirection: 'row',
  },
  platformBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },
  platformBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  itemMenu: {
    marginLeft: 8,
    justifyContent: 'center',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    color: '#777',
    padding: 24,
  },
  listFooter: {
    height: 80,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default InventoryScreen; 