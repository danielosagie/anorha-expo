import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, ViewStyle, StyleProp, Animated, Easing, Platform } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShadowSurface from './ui/ShadowSurface';

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
    case 'Clearouts': //Sprout Clearouts Tab Button
      return 'sprout-outline';
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
  containerStyle?: StyleProp<ViewStyle>;
  surfaceStyle?: StyleProp<ViewStyle>;
};

const TabBar: React.FC<TabBarProps> = ({ state, descriptors, navigation, containerStyle, surfaceStyle }) => {
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
    <View style={[styles.container, containerStyle]}>
      <ShadowSurface shadow="lg" clip={false} innerStyle={[styles.surface, surfaceStyle]} radius={30}>
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
                <ShadowSurface shadow="md" radius={32} style={styles.addShadowWrap} innerStyle={styles.addOuterCircle}>
                  <View style={styles.addInnerCircle}>
                    <Animated.View style={{ transform: [{ rotate: addRotate }] }}>
                      <Icon name={'plus'} size={28} color={'#FFF'} />
                    </Animated.View>
                  </View>
                </ShadowSurface>
              </TouchableOpacity>
            );
          }

          const clearoutsActiveColor = '#84CC16';
          const tintColor =
            isFocused && route.name === 'Clearouts'
              ? clearoutsActiveColor
              : (isFocused ? theme.colors.primary : '#999');

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
                color={tintColor}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: tintColor }
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ShadowSurface>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 10 : 8,
    paddingHorizontal: 8,
    height: '100%',
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
    backgroundColor: '#93C822',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: "rgba(0, 0, 0, 0.15)",
  },
  addShadowWrap: {
    marginTop: -5,
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
    lineHeight: 14,
    marginTop: 4,
    fontWeight: '500',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

export default TabBar; 
