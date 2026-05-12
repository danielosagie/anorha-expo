import React, { useRef } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShadowSurface from './ui/ShadowSurface';

const TAB_ICON: Record<string, string> = {
  Inventory: 'package-variant',
  Clearouts: 'emoticon-outline',
  Profile: 'cog-outline',
};

const ACTIVE_GREEN = '#84CC16';
const ACTIVE_BG = 'rgba(132, 204, 22, 0.18)';
const ADD_GREEN = '#84CC16';
const INACTIVE_GRAY = '#9CA3AF';
const SIDE_BUTTON_SIZE = 56;
const ADD_BUTTON_SIZE = 60;

type TabBarProps = {
  state: any;
  descriptors: Record<string, any>;
  navigation: any;
  containerStyle?: StyleProp<ViewStyle>;
  surfaceStyle?: StyleProp<ViewStyle>;
  bottomInset?: number;
  rowHeight?: number;
};

const TabBar: React.FC<TabBarProps> = ({
  state,
  descriptors,
  navigation,
  containerStyle,
  surfaceStyle,
  bottomInset = 18,
  rowHeight = 64,
}) => {
  const theme = useTheme();

  const handleSearch = () => {
    navigation.navigate('GlobalSearch');
  };

  const addRotateAnim = useRef(new Animated.Value(0)).current;
  const addRotate = addRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '135deg'],
  });

  const handleAdd = () => {
    addRotateAnim.setValue(0);
    Animated.sequence([
      Animated.timing(addRotateAnim, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
      Animated.timing(addRotateAnim, {
        toValue: 0,
        duration: 360,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    navigation.navigate('AddProduct');
  };

  const focusedRouteName = state.routes[state.index]?.name;
  const isTransparentBgRoute = focusedRouteName === 'AddProduct';

  return (
    <View style={[styles.container, containerStyle]}>
      {!isTransparentBgRoute && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={Platform.OS === 'ios' ? 2 : 1}
            tint="light"
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[
              'rgba(255, 255, 255, 0)',
              'rgba(255, 255, 255, 0.25)',
              'rgba(255, 255, 255, 0.4)',
              'rgba(255, 255, 255, 0.5)',
            ]}
            locations={[0, 0.35, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}

      <View
        style={[
          styles.row,
          { paddingBottom: bottomInset, height: rowHeight + bottomInset },
        ]}
      >
        <TouchableOpacity
          onPress={handleSearch}
          accessibilityRole="button"
          accessibilityLabel="Search"
          activeOpacity={0.85}
        >
          <ShadowSurface shadow="md" radius={SIDE_BUTTON_SIZE / 2} innerStyle={styles.sideButton}>
            <Icon name="magnify" size={22} color="#6B7280" />
          </ShadowSurface>
        </TouchableOpacity>

        <ShadowSurface
          shadow="lg"
          clip={false}
          radius={32}
          style={styles.pillOuter}
          innerStyle={[styles.surface, surfaceStyle]}
        >
          {state.routes
            .filter((route: any) => TAB_ICON[route.name])
            .map((route: any) => {
            const { options } = descriptors[route.key];
            const label = options.tabBarLabel || route.name;
            const focusedRouteName = state.routes[state.index]?.name;
            const isFocused = focusedRouteName === route.name;
            const iconName = TAB_ICON[route.name] || 'circle';

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

            const tint = isFocused ? ACTIVE_GREEN : INACTIVE_GRAY;

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarTestID}
                onPress={onPress}
                style={styles.tabItem}
                activeOpacity={0.85}
              >
                <View style={[styles.tabInner, isFocused && styles.tabInnerActive]}>
                  <Icon name={iconName} size={22} color={tint} />
                  <Text
                    numberOfLines={1}
                    allowFontScaling={false}
                    style={[
                      styles.tabLabel,
                      { color: tint, fontWeight: isFocused ? '600' : '500' },
                    ]}
                  >
                    {label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ShadowSurface>

        <TouchableOpacity
          onPress={handleAdd}
          accessibilityRole="button"
          accessibilityLabel="Add product"
          activeOpacity={0.85}
        >
          <ShadowSurface shadow="md" radius={ADD_BUTTON_SIZE / 2} innerStyle={styles.addButton}>
            <Animated.View style={{ transform: [{ rotate: addRotate }] }}>
              <Icon name="plus" size={28} color="#FFFFFF" />
            </Animated.View>
          </ShadowSurface>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  sideButton: {
    height: SIDE_BUTTON_SIZE,
    width: SIDE_BUTTON_SIZE,
    borderRadius: SIDE_BUTTON_SIZE / 2,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 0, 0, 0.07)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillOuter: {
    flex: 1,
    marginHorizontal: 10,
  },
  surface: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
  tabItem: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabInner: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    minWidth: 64,
  },
  tabInnerActive: {
    backgroundColor: ACTIVE_BG,
  },
  tabLabel: {
    fontSize: 12,
    lineHeight: 14,
    marginTop: 4,
    includeFontPadding: false,
    textAlign: 'center',
  },
  addButton: {
    height: ADD_BUTTON_SIZE,
    width: ADD_BUTTON_SIZE,
    borderRadius: ADD_BUTTON_SIZE / 2,
    backgroundColor: ADD_GREEN,
    borderWidth: 2.5,
    borderColor: 'rgba(0, 0, 0, 0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default TabBar;
