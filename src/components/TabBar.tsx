import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, Platform, ViewStyle, StyleProp, Animated, Easing } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const getTabIcon = (routeName: string): string => {
  switch (routeName) {
    case 'Dashboard':
      return 'view-dashboard-outline';
    case 'Inventory':
      return 'package-variant';
    case 'Marketplace':
      return 'store-outline';
    case 'MarketplaceChat':
      return 'message-outline';
    case 'AddProduct':
      return 'plus';
    case 'ActivityFeed':
      return 'clipboard-clock-outline';
    case 'Profile':
      return 'cog-outline';
    default:
      return 'circle';
  }
};

type TabBarProps = {
  state: any;
  descriptors: Record<string, any>;
  navigation: any;
  style?: StyleProp<ViewStyle>;
};

const TabBar: React.FC<TabBarProps> = ({ state, descriptors, navigation, style }) => {
  const theme = useTheme();
  const lastNonAddRouteRef = useRef<string>('Dashboard');
  const currentRouteName = state?.routes?.[state.index]?.name;
  const isAddFocused = currentRouteName === 'AddProduct';

  // Animated rotation for the Add (+) button → × when focused
  const addRotateAnim = useRef(new Animated.Value(isAddFocused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(addRotateAnim, {
      toValue: isAddFocused ? 1 : 0,
      duration: 440,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isAddFocused, addRotateAnim]);

  const addRotate = addRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  useEffect(() => {
    if (currentRouteName && currentRouteName !== 'AddProduct') {
      lastNonAddRouteRef.current = currentRouteName;
    }
  }, [currentRouteName]);

  return (
    <View style={[styles.tabBar, style]}> 
      {state.routes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const label = options.tabBarLabel || route.name;
        const isFocused = state.index === index;
        
        const icon = getTabIcon(route.name);
        const isAddButton = route.name === 'AddProduct';
        
        const onPress = () => {
          // If the Add tab is focused, pressing it acts like a close and returns to the last tab
          if (isAddButton && isFocused) {
            navigation.navigate(lastNonAddRouteRef.current || 'Dashboard');
            return;
          }
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          } else if (isAddButton && !isFocused) {
            navigation.navigate('AddProduct');
          }
        };
        
        if (isAddButton) {
          return (
            <TouchableOpacity
              key={index}
              accessibilityRole="button"
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              style={styles.tabItem}
            >
              {/* Outer circle for drop shadow */}
              <View style={styles.addOuterCircle}>
                {/* Inner circle for subtle ring */}
                <View style={styles.addInnerCircle}>
                  <Animated.View style={{ transform: [{ rotate: addRotate }] }}>
                    <Icon name={'plus'} size={28} color={'#FFF'} />
                  </Animated.View>
                </View>
              </View>
            </TouchableOpacity>
          );
        }
        
        return (
          <TouchableOpacity
            key={index}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            accessibilityLabel={options.tabBarAccessibilityLabel}
            testID={options.tabBarTestID}
            onPress={onPress}
            style={styles.tabItem}
          >
            <Icon
              name={icon}
              size={24}
              color={isFocused && route.name === 'ActivityFeed' ? '#FF9900' : (isFocused ? theme.colors.primary : '#999')}
            />
            <Text
              style={[
                styles.tabLabel,
                { color: isFocused && route.name === 'ActivityFeed' ? '#FF9900' : (isFocused ? theme.colors.primary : '#999') }
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    height: 70,
    paddingBottom: Platform.OS === 'ios' ? 10 : 10,
    paddingTop: 8,
    paddingHorizontal: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  tabItem: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addOuterCircle: {
    height: 60,
    width: 60,
    borderRadius: 32,
    marginTop: -5,
    backgroundColor: '#93C822',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: "rgba(0, 0, 0, 0.15)",
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  addInnerCircle: {
    height: 54,
    width: 54,
    borderRadius: 28,
    backgroundColor: '#93C822',
    borderWidth: 0,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '500',
  },
});

export default TabBar; 