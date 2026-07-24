import React, { useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsNight } from '../hooks/useIsNight';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShadowSurface from './ui/ShadowSurface';
import { AnorhaFace } from './brand/AnorhaFace';
import { openQuickChat } from './sprout/quickChatStore';

// Order here only gates which routes render; display order follows the navigator.
const TAB_ICON: Record<string, string> = {
  Clearouts: 'home-variant-outline',
  Inventory: 'package-variant',
  Profile: 'account-outline',
};

const ACTIVE_GREEN = '#84CC16';
const ACTIVE_BG = 'rgba(132, 204, 22, 0.18)';
const ADD_GREEN = '#84CC16';
const INACTIVE_GRAY = '#9CA3AF';
// Night glass (mockup: rgba(0,0,0,0.3) over rgba(44,44,44,0.6) + backdrop blur);
// flattened since RN views can't backdrop-blur.
const NIGHT_SURFACE = 'rgba(28, 30, 24, 0.94)';
const NIGHT_INACTIVE = 'rgba(255, 255, 255, 0.85)';
const SIDE_BUTTON_SIZE = 56;
const ADD_BUTTON_SIZE = 60;
const SPROUT_GLYPH_SIZE = 18;

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
  const isNight = useIsNight();

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
  // Dark glass only on the home (Clearouts) screen — and only at night, so it
  // matches home's own day/night theme. Every other route stays light.
  const dark = isNight && focusedRouteName === 'Clearouts';

  return (
    <View style={[styles.container, containerStyle]}>
      {!isTransparentBgRoute && !dark && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView
            intensity={Platform.OS === 'ios' ? 2 : 1}
            tint={dark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={
              dark
                ? [
                    'rgba(0, 0, 0, 0)',
                    'rgba(0, 0, 0, 0.35)',
                    'rgba(0, 0, 0, 0.6)',
                    'rgba(0, 0, 0, 0.8)',
                  ]
                : [
                    'rgba(255, 255, 255, 0)',
                    'rgba(255, 255, 255, 0.25)',
                    'rgba(255, 255, 255, 0.4)',
                    'rgba(255, 255, 255, 0.5)',
                  ]
            }
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
          onPress={() => openQuickChat()}
          accessibilityRole="button"
          accessibilityLabel="Open Sprout chat"
          activeOpacity={0.9}
        >
          <View style={[styles.sideButton, dark && styles.sideButtonNight]}>
            <AnorhaFace size={SPROUT_GLYPH_SIZE} />
          </View>
        </TouchableOpacity>

        <ShadowSurface
          shadow="lg"
          clip={false}
          radius={32}
          style={styles.pillOuter}
          innerStyle={[styles.surface, surfaceStyle, dark && styles.surfaceNight]}
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

            const tint = isFocused ? (dark ? '#FFFFFF' : ACTIVE_GREEN) : dark ? NIGHT_INACTIVE : INACTIVE_GRAY;

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
                testID={options.tabBarTestID}
                onPress={onPress}
                style={styles.tabItem}
                activeOpacity={0.85}
              >
                {/* Icon-only tabs (labels intentionally disabled); the label still
                    feeds accessibility above. */}
                <View style={[styles.tabInner, isFocused && (dark ? styles.tabInnerActiveDark : styles.tabInnerActive)]}>
                  <Icon name={iconName} size={24} color={tint} />
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
          <ShadowSurface
            shadow="md"
            clip={false}
            radius={ADD_BUTTON_SIZE / 2}
            innerStyle={[styles.addButton, dark && styles.addButtonNight]}
          >
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
    paddingHorizontal: 48,
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
  sideButtonNight: {
    backgroundColor: NIGHT_SURFACE,
    borderColor: 'rgba(255, 255, 255, 0.10)',
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
  // Wins over the navigator-provided white surfaceStyle after dark (mockup glass pill).
  surfaceNight: {
    backgroundColor: NIGHT_SURFACE,
    borderColor: 'rgba(255, 255, 255, 0.08)',
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
    paddingVertical: 11,
    borderRadius: 16,
    minWidth: 64,
  },
  tabInnerActive: {
    backgroundColor: ACTIVE_BG,
  },
  // Home/night selection: translucent white pill + white icon (per design).
  tabInnerActiveDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.4)',
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
  // On home/night the + becomes dark glass like the search button (per design).
  addButtonNight: {
    backgroundColor: NIGHT_SURFACE,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
});

export default TabBar;
