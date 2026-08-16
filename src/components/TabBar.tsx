import React, { useEffect, useRef } from 'react';
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
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShadowSurface from './ui/ShadowSurface';
import { AnorhaFace } from './brand/AnorhaFace';
import { openQuickChat, setQuickChatDarkMode, useQuickChatStore } from './sprout/quickChatStore';
import { sproutDarkTheme } from '../design/sproutTheme';
import SaveStatusTag from './SaveStatusTag';

// Order here only gates which routes render; display order follows the navigator.
const TAB_ICON: Record<string, string> = {
  Clearouts: 'home-variant-outline',
  Inventory: 'package-variant',
  Profile: 'account-outline',
};

const ACTIVE_GREEN = '#93C822';
const ACTIVE_BG = 'rgba(132, 204, 22, 0.18)';
const ADD_GREEN = '#93C822';
const INACTIVE_GRAY = '#9CA3AF';
const SIDE_BUTTON_SIZE = 56;
const ADD_BUTTON_SIZE = 60;
const SPROUT_GLYPH_SIZE = 20;

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
  // Sprout's composer docks in exactly this spot. Two bottom bars stacked on each other
  // reads as a bug, so the tab row stands down while the composer is up — same slot, one
  // thing in it. The composer's own close button puts the tabs back.
  const sproutDocked = useQuickChatStore().visible;

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
  const focusedRouteKey = state.routes[state.index]?.key;
  const isTransparentBgRoute = focusedRouteName === 'AddProduct';
  // SproutHome is the only appearance-reactive entry point. It publishes this
  // explicit option so the shared tab bar and quick chat remain light elsewhere.
  const dark = focusedRouteName === 'Clearouts'
    && descriptors[focusedRouteKey]?.options?.sproutDark === true;

  useEffect(() => {
    if (sproutDocked) setQuickChatDarkMode(dark);
  }, [dark, sproutDocked]);

  if (sproutDocked) return null;

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

      {/* Save state rides above the row's centre, in the fade zone the container already
          reserves, so the tabs keep their spacing and nothing shifts when it appears. It is
          absent unless a save is in flight or just landed, so most of the time this is air. */}
      <View
        pointerEvents="none"
        style={[styles.statusSlot, { bottom: rowHeight + bottomInset + 2 }]}
      >
        <SaveStatusTag dark={dark} />
      </View>

      <View
        style={[
          styles.row,
          { paddingBottom: bottomInset, height: rowHeight + bottomInset },
        ]}
      >
        <TouchableOpacity
          onPress={() => openQuickChat({ dark })}
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

            const tint = isFocused
              ? (dark ? sproutDarkTheme.colors.text : ACTIVE_GREEN)
              : dark
                ? sproutDarkTheme.colors.textSecondary
                : INACTIVE_GRAY;

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
    paddingHorizontal: 36,
  },
  statusSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
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
    backgroundColor: sproutDarkTheme.colors.surface,
    borderColor: sproutDarkTheme.colors.border,
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
    backgroundColor: sproutDarkTheme.colors.surface,
    borderColor: sproutDarkTheme.colors.border,
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
  // Home dark selection uses the palette's elevated control surface.
  tabInnerActiveDark: {
    backgroundColor: sproutDarkTheme.chat.surfaceMuted,
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
  // On dark home the + uses the same elevated surface as the tab pill.
  addButtonNight: {
    backgroundColor: sproutDarkTheme.colors.surface,
    borderColor: sproutDarkTheme.colors.border,
  },
});

export default TabBar;
