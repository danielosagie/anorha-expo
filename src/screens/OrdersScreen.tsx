import React, { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import OrderListItem from '../components/OrderListItem';
import { mockOrders } from '../data/mockData';

const OrdersScreen = () => {
  const theme = useTheme();
  const [selectedPlatform, setSelectedPlatform] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Extended mock orders for a fuller list
  const extendedOrders = [...mockOrders, ...mockOrders.map((order, index) => ({
    ...order,
    id: `${1189 + index}`,
  }))];
  
  const filteredOrders = extendedOrders.filter(order => {
    // Filter by platform
    if (selectedPlatform !== 'All' && order.platform !== selectedPlatform) {
      return false;
    }
    
    // Filter by status
    if (selectedStatus !== 'All' && 
        order.status.toLowerCase() !== selectedStatus.toLowerCase()) {
      return false;
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        order.id.toLowerCase().includes(query) ||
        order.customer.toLowerCase().includes(query) ||
        order.platform.toLowerCase().includes(query) ||
        order.status.toLowerCase().includes(query)
      );
    }
    
    return true;
  });
  
  // Get unique platforms from orders
  const platforms = ['All', ...new Set(extendedOrders.map(order => order.platform))];
  
  // Get unique statuses from orders
  const statuses = ['All', ...new Set(extendedOrders.map(order => 
    order.status.charAt(0).toUpperCase() + order.status.slice(1)
  ))];
  
  return (
    <View style={styles.container}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Orders</Text>
        
        <Card>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>256</Text>
              <Text style={styles.statLabel}>Total Orders</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>$8,392</Text>
              <Text style={styles.statLabel}>Total Revenue</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>14</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
          </View>
        </Card>
        
        <Card>
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <View style={styles.searchBar}>
              <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search orders..."
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Icon name="close" size={20} color="#999" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          
          {/* Platform Filter */}
          <View style={styles.filterContainer}>
            <View style={styles.filterHeader}>
              <Text style={styles.filterLabel}>Platform:</Text>
            </View>
            
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.tabScrollView}
            >
              <View style={styles.tabContainer}>
                {platforms.map((platform) => (
                  <TouchableOpacity 
                    key={platform}
                    style={[
                      styles.tab, 
                      selectedPlatform === platform && [
                        styles.selectedTab, 
                        { borderBottomColor: theme.colors.primary }
                      ]
                    ]}
                    onPress={() => setSelectedPlatform(platform)}
                  >
                    <Text style={[
                      styles.tabText, 
                      selectedPlatform === platform 
                        ? { color: theme.colors.primary } 
                        : { color: theme.colors.textSecondary }
                    ]}>
                      {platform}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
          
          {/* Status Filter */}
          <View style={styles.filterContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.filterScrollView}
            >
              <View style={styles.filterChipsContainer}>
                {statuses.map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.filterChip,
                      selectedStatus === status && { 
                        backgroundColor: theme.colors.primary 
                      }
                    ]}
                    onPress={() => setSelectedStatus(status)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        selectedStatus === status && { color: 'white' }
                      ]}
                    >
                      {status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
          
          {/* Orders List */}
          <View style={styles.ordersListContainer}>
            {filteredOrders.length > 0 ? (
              filteredOrders.map((order, index) => (
                <Animated.View 
                  key={order.id} 
                  entering={FadeInUp.delay(50 * index).duration(300)}
                >
                  <OrderListItem order={order} />
                </Animated.View>
              ))
            ) : (
              <View style={styles.emptyState}>
                <Icon name="package-variant" size={40} color="#CCC" />
                <Text style={styles.emptyStateText}>No orders found</Text>
                <Text style={styles.emptyStateSubtext}>
                  Try changing your filters to see more orders
                </Text>
              </View>
            )}
          </View>
          
          {filteredOrders.length > 0 && (
            <View style={styles.paginationContainer}>
              <TouchableOpacity style={styles.paginationButton}>
                <Icon name="chevron-left" size={20} color="#777" />
              </TouchableOpacity>
              <Text style={styles.paginationText}>Page 1 of 4</Text>
              <TouchableOpacity style={styles.paginationButton}>
                <Icon name="chevron-right" size={20} color="#777" />
              </TouchableOpacity>
            </View>
          )}
        </Card>
      </Animated.View>
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
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#777',
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#eee',
  },
  searchContainer: {
    marginBottom: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 14,
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#555',
  },
  tabScrollView: {
    marginBottom: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  tab: {
    marginRight: 24,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  selectedTab: {
    borderBottomWidth: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  filterScrollView: {
    marginBottom: 16,
  },
  filterChipsContainer: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 13,
    color: '#555',
  },
  ordersListContainer: {
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#555',
    marginTop: 16,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#777',
    marginTop: 8,
    textAlign: 'center',
  },
  paginationContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 8,
  },
  paginationButton: {
    padding: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
  },
  paginationText: {
    marginHorizontal: 16,
    fontSize: 14,
    color: '#555',
  },
});

export default OrdersScreen; 