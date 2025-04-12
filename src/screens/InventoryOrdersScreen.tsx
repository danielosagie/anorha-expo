import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ScrollView, Image } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/PlaceholderImage';
import { mockInventoryItems } from '../data/mockData';
import { mockOrders } from '../data/mockData';
import { Platform } from 'react-native';

const InventoryOrdersScreen = () => {
  const theme = useTheme() || { colors: { primary: '#0E8F7F' } };  
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' or 'orders'
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  const renderInventoryItem = ({ item }) => (
    <TouchableOpacity style={styles.gridItem}>
      <Card style={styles.gridItemCard}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.gridItemImage} />
        ) : (
          <PlaceholderImage 
            size={120} 
            borderRadius={8} 
            type="gradient"
            icon="cube"
            color={getRandomColor(item.id)}
            style={styles.gridItemImage}
          />
        )}
        
        <View style={styles.gridItemDetails}>
          <Text style={styles.gridItemTitle} numberOfLines={2}>{item.title}</Text>
          <Text style={styles.gridItemPrice}>${item.price.toFixed(2)}</Text>
          <Text style={styles.gridItemStock}>{item.quantity} in stock</Text>
          
          <View style={styles.platformBadges}>
            {item.platforms.slice(0, 2).map(platform => (
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
            {item.platforms.length > 2 && (
              <View style={styles.platformBadgeMore}>
                <Text style={styles.platformBadgeMoreText}>+{item.platforms.length - 2}</Text>
              </View>
            )}
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );
  
  const renderOrderItem = ({ item }) => {
    const trackButtonStyle = {
      backgroundColor: theme.colors.primary + '00'
    };

    return (
      <Card style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View style={styles.orderIdContainer}>
            <Text style={styles.orderId}>#{item.id || 'Unknown'}</Text>
            <View style={[
              styles.platformBadge, 
              { backgroundColor: getPlatformColor(item.platform, theme) + '20' }
            ]}>
              <Text style={[
                styles.platformName, 
                { color: getPlatformColor(item.platform, theme) }
              ]}>
                {item.platform || 'Unknown'}
              </Text>
            </View>
          </View>
          <Text style={styles.orderDate}>{formatDate(item.date)}</Text>
        </View>
        
        <View style={styles.customerRow}>
          <View style={styles.customerInfo}>
            <Icon name="account" size={14} color="#777" style={styles.customerIcon} />
            <Text style={styles.customerName}>{item.customer || 'Unknown customer'}</Text>
          </View>
          <Text style={styles.orderItems}>
            {item.items ? `${item.items} item${item.items > 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        
        <View style={styles.orderFooter}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status, theme) + '20' }]}>
            <Icon 
              name={getStatusIcon(item.status)} 
              size={14} 
              color={getStatusColor(item.status, theme)} 
              style={styles.statusIcon} 
            />
            <Text 
              style={[styles.statusText, { color: getStatusColor(item.status, theme) }]}
            >
              {item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : 'Unknown'}
            </Text>
          </View>
          
          <Text style={styles.orderTotal}>${item.total ? item.total.toFixed(2) : '0.00'}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => console.log('View details', item.id)}
          >
            <Icon name="information-outline" size={16} color="#777" />
            <Text style={styles.actionButtonText}>Details</Text>
          </TouchableOpacity>
          
          <View style={styles.buttonDivider} />

          <TouchableOpacity 
            style={[styles.actionButton, trackButtonStyle]}
            onPress={() => console.log('Track order', item.id)}
          >
            <Icon name="truck-delivery-outline" size={16} color={theme.colors.primary} />
            <Text style={[styles.actionButtonText, {color: theme.colors.primary}]}>Track</Text>
          </TouchableOpacity>
          
          
        </View>
      </Card>
    );
  };
  
  const getPlatformColor = (platform, theme) => {
    if (!platform) return '#999';
    
    const platformLower = platform.toLowerCase();
    
    if (platformLower.includes('shopify')) return theme.colors.primary;
    if (platformLower.includes('amazon')) return '#F17F5F';
    if (platformLower.includes('ebay')) return '#E53238';
    if (platformLower.includes('clover')) return theme.colors.accent;
    if (platformLower.includes('square')) return '#6C757D';
    if (platformLower.includes('etsy')) return '#F56400';
    if (platformLower.includes('facebook')) return '#1877F2';
    
    return theme.colors.primary;
  };
  
  const getStatusIcon = (status) => {
    if (!status) return 'help-circle-outline'; // Default icon if status is undefined
    
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('pending')) return 'timer-sand';
    if (statusLower.includes('processing')) return 'progress-check';
    if (statusLower.includes('intransit') || statusLower.includes('in transit')) return 'truck-delivery';
    if (statusLower.includes('delivered') || statusLower.includes('completed')) return 'check-circle';
    if (statusLower.includes('returned')) return 'keyboard-return';
    if (statusLower.includes('offloaded') || statusLower.includes('off-loaded')) return 'package-variant';
    
    return 'help-circle-outline'; // Default icon
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return 'No date';
    
    const date = new Date(dateString);
    const now = new Date();
    
    // Check if date is today
    if (date.toDateString() === now.toDateString()) {
      return 'Today';
    }
    
    // Check if date is yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    // Otherwise return formatted date
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };
  
  const getStatusColor = (status, theme) => {
    switch (status) {
      case 'Delivered':
        return theme.colors.success;
      case 'In Transit':
        return theme.colors.primary;
      case 'Processing':
        return theme.colors.secondary;
      case 'Returned':
        return theme.colors.error;
      default:
        return theme.colors.text;
    }
  };
  
  const getRandomColor = (id) => {
    const colors = ['#4B0082', '#1E90FF', '#32CD32', '#FF8C00', '#8A2BE2', '#20B2AA'];
    return colors[id % colors.length];
  };
  
  const filteredInventory = mockInventoryItems.filter(item => 
    item.title.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const filteredOrders = mockOrders.filter(order => 
    filterStatus === 'all' || order.status === filterStatus
  );
  
  return (
    <View style={styles.container} paddingTop={60}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {activeTab === 'inventory' ? 'Inventory' : 'Orders'}
        </Text>
        
        {/* Tab Selector */}
        <View style={styles.tabSelector}>
          <TouchableOpacity 
            style={[
              styles.tab, 
              activeTab === 'inventory' && [styles.activeTab, { backgroundColor: theme.colors.primary + '20' }]
            ]}
            onPress={() => setActiveTab('inventory')}
          >
            <Icon 
              name="cube-outline" 
              size={20} 
              color={activeTab === 'inventory' ? theme.colors.primary : '#777'} 
              style={styles.tabIcon}
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'inventory' ? theme.colors.primary : '#777' }
            ]}>Inventory</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={[
              styles.tab, 
              activeTab === 'orders' && [styles.activeTab, { backgroundColor: theme.colors.primary + '20' }]
            ]}
            onPress={() => setActiveTab('orders')}
          >
            <Icon 
              name="shopping-outline" 
              size={20} 
              color={activeTab === 'orders' ? theme.colors.primary : '#777'} 
              style={styles.tabIcon}
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'orders' ? theme.colors.primary : '#777' }
            ]}>Orders</Text>
          </TouchableOpacity>
        </View>
        
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${activeTab === 'inventory' ? 'products' : 'orders'}...`}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close" size={20} color="#999" />
              </TouchableOpacity>
            ) : null}
          </View>
          
          <TouchableOpacity style={styles.filterButton}>
            <Icon name="filter-variant" size={20} color="#777" />
          </TouchableOpacity>
        </View>
      </Animated.View>
      
      {/* Inventory List */}
      {activeTab === 'inventory' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          <FlatList
            data={filteredInventory}
            renderItem={renderInventoryItem}
            keyExtractor={item => item.id.toString()}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersContainer}>
                  {['all', 'Delivered', 'In Transit', 'Processing', 'Returned'].map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.filterChip,
                        filterStatus === status && { backgroundColor: theme.colors.primary + '20' }
                      ]}
                      onPress={() => setFilterStatus(status)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          filterStatus === status && { color: theme.colors.primary }
                        ]}
                      >
                        {status === 'all' ? 'All' : status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                
                {/* Categories section */}
                <View style={styles.categoriesSection}>
                  <Text style={styles.categoriesSectionTitle}>Categories</Text>
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
                
                <View style={styles.sellerStatsSection}>
                  <Text style={styles.sellerStatsSectionTitle}>Your Activity</Text>
                  <View style={styles.sellerStatsRow}>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>42</Text>
                      <Text style={styles.sellerStatLabel}>Products Listed</Text>
                    </View>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>18</Text>
                      <Text style={styles.sellerStatLabel}>Active Listings</Text>
                    </View>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>86%</Text>
                      <Text style={styles.sellerStatLabel}>Response Rate</Text>
                    </View>
                  </View>
                </View>
              </>
            }
            ListFooterComponent={<View style={styles.listFooter} />}
          />
        </Animated.View>
      )}
      
      {/* Orders List */}
      {activeTab === 'orders' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersContainer}>
            {['all', 'Delivered', 'In Transit', 'Processing', 'Returned'].map(status => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.filterChip,
                  filterStatus === status && { backgroundColor: theme.colors.primary + '20' }
                ]}
                onPress={() => setFilterStatus(status)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterStatus === status && { color: theme.colors.primary }
                  ]}
                >
                  {status === 'all' ? 'All' : status}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          <FlatList
            data={filteredOrders}
            renderItem={renderOrderItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No orders matching your filters.</Text>
            }
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<View style={styles.listFooter} />}
          />
        </Animated.View>
      )}
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
  tabSelector: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: 'white',
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
  },
  filterButton: {
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    marginLeft: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  filtersContainer: {
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#EEE',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
  },
  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  gridRow: {
    justifyContent: 'space-between',
    width: '100%',
  },
  gridItem: {
    width: '48%',
    marginBottom: 12,
  },
  gridItemCard: {
    padding: 0,
    overflow: 'hidden',
  },
  gridItemImage: {
    width: '100%',
    height: 120,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  gridItemDetails: {
    padding: 10,
  },
  gridItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  gridItemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  gridItemStock: {
    fontSize: 12,
    color: '#777',
    marginBottom: 4,
  },
  platformBadges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  platformBadgeText: {
    fontSize: 10,
    color: 'white',
    fontWeight: 'bold',
  },
  platformBadgeMore: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    backgroundColor: '#777',
  },
  platformBadgeMoreText: {
    fontSize: 10,
    color: 'white',
    fontWeight: 'bold',
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
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sellerStatsSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  sellerStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sellerStatItem: {
    alignItems: 'center',
  },
  sellerStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0E8F7F',
  },
  sellerStatLabel: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },
  orderCard: {
    marginBottom: 12,
    borderRadius: 12,
    padding: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  orderIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderId: {
    fontSize: 15,
    fontWeight: 'bold',
    marginRight: 8,
  },
  orderDate: {
    fontSize: 13,
    color: '#777',
  },
  customerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerIcon: {
    marginRight: 4,
  },
  customerName: {
    fontSize: 14,
    color: '#444',
  },
  orderItems: {
    fontSize: 13,
    color: '#777',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  orderFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  platformBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  platformName: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderTotal: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    height: 44,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDivider: {
    width: 1,
    backgroundColor: '#f0f0f0',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
    color: '#555',
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

export default InventoryOrdersScreen; 
