import React, { useEffect, useRef, useState } from 'react';
import { View, TouchableOpacity, Text, StyleSheet, ViewStyle, StyleProp, Animated, Easing, Platform, PanResponder, GestureResponderEvent, PanResponderGestureState } from 'react-native';
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
  const [barWidth, setBarWidth] = useState(0);

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

  const handleGestureTabChange = (event: GestureResponderEvent) => {
    if (!barWidth || !state?.routes?.length) return;
    const { locationX } = event.nativeEvent;
    const routes = state.routes;
    const tabWidth = barWidth / routes.length;
    let targetIndex = Math.floor(locationX / tabWidth);
    if (targetIndex < 0) targetIndex = 0;
    if (targetIndex > routes.length - 1) targetIndex = routes.length - 1;

    if (targetIndex === state.index) return;

    const targetRoute = routes[targetIndex];
    if (!targetRoute) return;

    navigation.navigate(targetRoute.name);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (evt: GestureResponderEvent, _gestureState: PanResponderGestureState) => {
        handleGestureTabChange(evt);
      },
      onPanResponderRelease: (evt: GestureResponderEvent, _gestureState: PanResponderGestureState) => {
        handleGestureTabChange(evt);
      },
    })
  ).current;

  return (
    <View
      style={[styles.container, containerStyle]}
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
    >
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
                <ShadowSurface shadow="xs" radius={32} style={styles.addShadowWrap} innerStyle={styles.addOuterCircle}>
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
              <View style={[styles.tabInner, isFocused && styles.tabInnerActive]}>
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
              </View>
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
  tabInner: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tabInnerActive: {
    backgroundColor: 'rgba(222, 247, 218, 0.4)', // gray-200 style
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
