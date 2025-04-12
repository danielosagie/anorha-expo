import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const getTabIcon = (routeName) => {
  switch (routeName) {
    case 'Dashboard':
      return 'view-dashboard-outline';
    case 'Inventory':
      return 'cube-outline';
    case 'Marketplace':
      return 'store-outline';
    case 'AddListing':
      return 'plus-circle';
    case 'Profile':
      return 'account-outline';
    default:
      return 'circle';
  }
};

const TabBar = ({ state, descriptors, navigation }) => {
  const theme = useTheme();
  
  return (
    <View style={[styles.tabBar, theme.shadows.small]}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label = options.tabBarLabel || route.name;
        const isFocused = state.index === index;
        
        const icon = getTabIcon(route.name);
        const isAddButton = route.name === 'AddListing';
        
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        
        return (
          <TouchableOpacity
            key={index}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarTestID}
            onPress={onPress}
            style={[
              styles.tabItem,
              isAddButton && styles.addButton,
              isAddButton && { backgroundColor: theme.colors.primary }
            ]}
          >
            <Icon 
              name={icon} 
              size={isAddButton ? 32 : 24} 
              color={
                isAddButton 
                  ? 'white' 
                  : isFocused 
                  ? theme.colors.primary 
                  : '#999'
              } 
            />
            {!isAddButton && (
              <Text 
                style={[
                  styles.tabLabel, 
                  { color: isFocused ? theme.colors.primary : '#999' }
                ]}
              >
                {label}
              </Text>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'white',
    height: 90,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingBottom: Platform.OS === 'ios' ? 25 : 15,
    paddingTop: 10,
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButton: {
    height: 60,
    width: 60,
    borderRadius: 30,
    marginTop: -40,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 6,
  },
  tabLabel: {
    fontSize: 12,
    marginTop: 4,
  },
});

export default TabBar; 