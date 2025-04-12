import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';

const OrderListItem = ({ order }) => {
  const theme = useTheme();
  
  // Helper function to safely check status
  const getStatusColor = (status) => {
    if (!status) return '#999'; // Default gray if status is undefined
    
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('pending')) return '#FF9500';
    if (statusLower.includes('processing')) return '#0E8F7F';
    if (statusLower.includes('intransit') || statusLower.includes('in transit')) return '#007AFF';
    if (statusLower.includes('delivered') || statusLower.includes('completed')) return '#34C759';
    if (statusLower.includes('returned')) return '#FF3B30';
    if (statusLower.includes('offloaded') || statusLower.includes('off-loaded')) return '#5856D6';
    
    return '#999'; // Default gray
  };
  
  // Helper function to get status icon
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
  
  // Get platform icon
  const getPlatformIcon = (platform) => {
    if (!platform) return 'store-outline'; // Default icon if platform is undefined
    
    const platformLower = platform.toLowerCase();
    
    if (platformLower.includes('shopify')) return 'shopping';
    if (platformLower.includes('amazon')) return 'cart';
    if (platformLower.includes('ebay')) return 'tag';
    if (platformLower.includes('clover')) return 'flower';
    if (platformLower.includes('square')) return 'square';
    if (platformLower.includes('etsy')) return 'hand-heart';
    if (platformLower.includes('facebook')) return 'facebook';
    
    return 'store-outline'; // Default icon
  };
  
  // Format date to be more readable
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
  
  return (
    <TouchableOpacity style={styles.container}>
      <View style={styles.orderInfo}>
        <View style={styles.orderHeader}>
          <View style={styles.orderIdContainer}>
            <Text style={styles.orderId}>#{order.id || 'Unknown'}</Text>
            <View style={styles.platformBadge}>
              <Icon 
                name={getPlatformIcon(order.platform)} 
                size={14} 
                color="#555" 
                style={styles.platformIcon} 
              />
              <Text style={styles.platformName}>{order.platform || 'Unknown'}</Text>
            </View>
          </View>
          <Text style={styles.orderDate}>{formatDate(order.date)}</Text>
        </View>
        
        <View style={styles.customerRow}>
          <View style={styles.customerInfo}>
            <Icon name="account" size={14} color="#777" style={styles.customerIcon} />
            <Text style={styles.customerName}>{order.customer || 'Unknown customer'}</Text>
          </View>
          <Text style={styles.orderItems}>
            {order.items ? `${order.items} item${order.items > 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        
        <View style={styles.orderFooter}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.status) + '20' }]}>
            <Icon 
              name={getStatusIcon(order.status)} 
              size={14} 
              color={getStatusColor(order.status)} 
              style={styles.statusIcon} 
            />
            <Text 
              style={[styles.statusText, { color: getStatusColor(order.status) }]}
            >
              {order.status ? order.status.charAt(0).toUpperCase() + order.status.slice(1) : 'Unknown'}
            </Text>
          </View>
          
          <Text style={styles.orderTotal}>${order.total ? order.total.toFixed(2) : '0.00'}</Text>
        </View>
      </View>
      
      <Icon name="chevron-right" size={20} color="#CCC" />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  orderInfo: {
    flex: 1,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  platformIcon: {
    marginRight: 4,
  },
  platformName: {
    fontSize: 12,
    color: '#555',
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
});

export default OrderListItem; 
