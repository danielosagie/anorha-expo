import React, { useState, useRef, useEffect, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  SafeAreaView,
  LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  FadeIn,
} from 'react-native-reanimated';
import { ArrowRight } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import FacebookSvg from '../assets/facebook.svg';
import DepopSvg from '../assets/depop-icon.svg';

const { width } = Dimensions.get('window');

// ── Palette (app design language — matches Profile / Connections) ─────────────
const INK = '#18181B';
const SUBTLE = '#52525B';
const MUTED = '#9CA3AF';
const GREEN = '#93C822';
const STAGE = '#F4F4F2';
const HAIRLINE = '#ECEBE6';

// ───────────────────────────────────────────────────────────────────────────
//  Hero 1 — "Sync everywhere": dot grid + floating platform chips + sync packet
// ───────────────────────────────────────────────────────────────────────────
const DotGrid = memo(() => {
  const cols = 6;
  const rows = 7;
  return (
    <View style={styles.dotGrid} pointerEvents="none">
      {Array.from({ length: rows }).map((_, r) => (
        <View key={r} style={styles.dotRow}>
          {Array.from({ length: cols }).map((__, c) => (
            <View key={c} style={styles.dot} />
          ))}
        </View>
      ))}
    </View>
  );
});

const FloatChip = ({
  children,
  delay,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  style?: any;
}) => {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, true),
    );
  }, []);
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 + t.value * 12 }],
  }));
  return <Animated.View style={[styles.chip, style, anim]}>{children}</Animated.View>;
};

const HeroSync = memo(() => {
  // A green "sync packet" that travels a soft loop across the grid.
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, []);
  const packet = useAnimatedStyle(() => ({
    transform: [
      { translateX: 18 + p.value * 150 },
      { translateY: 150 - p.value * 120 },
      { scale: 0.9 + p.value * 0.3 },
    ],
    opacity: 0.55 + p.value * 0.45,
  }));

  return (
    <View style={styles.heroFill}>
      <DotGrid />
      <Animated.View style={[styles.packet, packet]} pointerEvents="none" />
      <View style={styles.chipLayer} pointerEvents="none">
        <FloatChip delay={0} style={{ top: 26, left: 24 }}>
          <ShopifySvg width={22} height={22} />
          <Text style={styles.chipText}>Shopify</Text>
        </FloatChip>
        <FloatChip delay={500} style={{ top: 96, right: 22 }}>
          <SquareSvg width={22} height={22} />
          <Text style={styles.chipText}>Square</Text>
        </FloatChip>
        <FloatChip delay={1000} style={{ bottom: 30, left: 36 }}>
          <EbaySvg width={24} height={24} />
          <Text style={styles.chipText}>eBay</Text>
        </FloatChip>
        <FloatChip delay={1500} style={{ bottom: 78, right: 40 }}>
          <CloverSvg width={22} height={22} />
          <Text style={styles.chipText}>Clover</Text>
        </FloatChip>
      </View>
    </View>
  );
});

// ───────────────────────────────────────────────────────────────────────────
//  Hero 2 — "List everywhere": two marquee rows (channels + tags)
// ───────────────────────────────────────────────────────────────────────────
const Marquee = ({
  children,
  reverse = false,
  speed = 36,
}: {
  children: React.ReactNode;
  reverse?: boolean;
  speed?: number;
}) => {
  const tx = useSharedValue(0);
  const [w, setW] = useState(0);

  useEffect(() => {
    if (!w) return;
    const duration = (w / speed) * 1000;
    if (reverse) {
      tx.value = -w;
      tx.value = withRepeat(withTiming(0, { duration, easing: Easing.linear }), -1, false);
    } else {
      tx.value = 0;
      tx.value = withRepeat(withTiming(-w, { duration, easing: Easing.linear }), -1, false);
    }
  }, [w, reverse, speed]);

  const anim = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.width;
    if (next && Math.abs(next - w) > 1) setW(next);
  };

  // Render the set twice for a seamless loop; toArray keys the duplicated nodes.
  const items = React.Children.toArray(children);
  return (
    <View style={styles.marqueeClip} pointerEvents="none">
      <Animated.View style={[styles.marqueeRow, anim]}>
        <View style={styles.marqueeRow} onLayout={onLayout}>
          {items}
        </View>
        <View style={styles.marqueeRow}>{React.Children.toArray(children)}</View>
      </Animated.View>
    </View>
  );
};

const Pill = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.pill}>{children}</View>
);

const TagPill = ({ label, accent = false }: { label: string; accent?: boolean }) => (
  <View style={styles.pill}>
    <Text style={[styles.pillText, { color: accent ? GREEN : INK }]}>{label}</Text>
  </View>
);

const HeroList = memo(() => (
  <View style={[styles.heroFill, { justifyContent: 'center', gap: 14 }]}>
    <Marquee speed={34}>
      <Pill>
        <ShopifySvg width={18} height={18} />
        <Text style={styles.pillText}>Shopify</Text>
      </Pill>
      <Pill>
        <AmazonSvg width={18} height={18} />
        <Text style={styles.pillText}>Amazon</Text>
      </Pill>
      <Pill>
        <EbaySvg width={20} height={20} />
        <Text style={styles.pillText}>eBay</Text>
      </Pill>
      <Pill>
        <SquareSvg width={18} height={18} />
        <Text style={styles.pillText}>Square</Text>
      </Pill>
      <Pill>
        <CloverSvg width={18} height={18} />
        <Text style={styles.pillText}>Clover</Text>
      </Pill>
      <Pill>
        <DepopSvg width={18} height={18} />
        <Text style={styles.pillText}>Depop</Text>
      </Pill>
    </Marquee>

    <Marquee reverse speed={30}>
      <TagPill label="#Sneakers" accent />
      <TagPill label="#Vintage" />
      <TagPill label="#NewDrop" accent />
      <TagPill label="#Streetwear" />
      <TagPill label="#Sale" accent />
      <TagPill label="#OneOfOne" />
      <TagPill label="#Restock" accent />
    </Marquee>

    <Marquee speed={40}>
      <Pill>
        <FacebookSvg width={18} height={18} />
        <Text style={styles.pillText}>Facebook</Text>
      </Pill>
      <Pill>
        <Icon name="storefront-outline" size={18} color={INK} />
        <Text style={styles.pillText}>Whatnot</Text>
      </Pill>
      <Pill>
        <Icon name="tag-outline" size={18} color={INK} />
        <Text style={styles.pillText}>Etsy</Text>
      </Pill>
      <Pill>
        <Icon name="cart-outline" size={18} color={INK} />
        <Text style={styles.pillText}>TikTok Shop</Text>
      </Pill>
    </Marquee>
  </View>
));

// ───────────────────────────────────────────────────────────────────────────
//  Hero 3 — "Partner & scale": central node + orbiting partner nodes
// ───────────────────────────────────────────────────────────────────────────
const OrbitNode = ({
  radius,
  duration,
  startAngle,
  children,
}: {
  radius: number;
  duration: number;
  startAngle: number;
  children: React.ReactNode;
}) => {
  const a = useSharedValue(0);
  useEffect(() => {
    a.value = withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false);
  }, []);
  const anim = useAnimatedStyle(() => {
    const angle = startAngle + a.value * Math.PI * 2;
    return {
      transform: [
        { translateX: Math.cos(angle) * radius },
        { translateY: Math.sin(angle) * radius },
      ],
    };
  });
  return <Animated.View style={[styles.orbitNode, anim]}>{children}</Animated.View>;
};

const HeroPartner = memo(() => {
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, []);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: 0.6 + pulse.value * 1.1 }],
    opacity: 0.5 - pulse.value * 0.5,
  }));

  return (
    <View style={[styles.heroFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Animated.View style={[styles.pulseRing, ring]} pointerEvents="none" />
      <View style={styles.orbitWrap} pointerEvents="none">
        <OrbitNode radius={86} duration={9000} startAngle={0}>
          <View style={styles.partnerNode}>
            <Icon name="account" size={20} color="#43631A" />
          </View>
        </OrbitNode>
        <OrbitNode radius={86} duration={9000} startAngle={2.1}>
          <View style={styles.partnerNode}>
            <Icon name="store" size={20} color="#43631A" />
          </View>
        </OrbitNode>
        <OrbitNode radius={86} duration={9000} startAngle={4.2}>
          <View style={styles.partnerNode}>
            <Icon name="handshake-outline" size={20} color="#43631A" />
          </View>
        </OrbitNode>

        <View style={styles.centerNode}>
          <Icon name="leaf" size={30} color="#FFFFFF" />
        </View>
      </View>
    </View>
  );
});

// ───────────────────────────────────────────────────────────────────────────
//  Slides
// ───────────────────────────────────────────────────────────────────────────
type Slide = {
  id: string;
  title: string;
  Hero: React.ComponentType;
  renderBody: () => React.ReactNode;
};

const Bold = ({ children, color = INK }: { children: React.ReactNode; color?: string }) => (
  <Text style={[styles.bodyStrong, { color }]}>{children}</Text>
);

const slides: Slide[] = [
  {
    id: 'sync',
    title: 'Sync your store\neverywhere',
    Hero: HeroSync,
    renderBody: () => (
      <Text style={styles.body}>
        🔄 <Bold>Sync inventory</Bold>, 🏷️ <Bold color={GREEN}>prices</Bold> and 📦{' '}
        <Bold>orders</Bold> across Shopify, Square, eBay and more — updated in real time.
      </Text>
    ),
  },
  {
    id: 'list',
    title: 'List everywhere,\nfaster than ever',
    Hero: HeroList,
    renderBody: () => (
      <Text style={styles.body}>
        ⚡ <Bold color={GREEN}>List in a tap</Bold> with #️⃣ smart tags and AI matching — one product,
        every channel, no copy-paste.
      </Text>
    ),
  },
  {
    id: 'partner',
    title: 'Partner & scale\nyour business',
    Hero: HeroPartner,
    renderBody: () => (
      <Text style={styles.body}>
        🤝 <Bold>Partner up</Bold>, 🔁 <Bold color={GREEN}>share inventory</Bold> and 📈 grow through
        the built-in B2B marketplace.
      </Text>
    ),
  },
];

const SlideView = memo(
  ({ item, height }: { item: Slide; height: number }) => {
    const { Hero } = item;
    return (
      <View style={[styles.slide, { height }]}>
        <View style={styles.stage}>
          <Hero />
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.title}>{item.title}</Text>
          {item.renderBody()}
        </View>
      </View>
    );
  },
);

// ───────────────────────────────────────────────────────────────────────────
const OnboardingSlides = ({ navigation }: { navigation: any }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [listHeight, setListHeight] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const insets = useSafeAreaInsets();

  const isLast = currentIndex === slides.length - 1;

  const goToAuth = () => navigation.navigate('Auth');

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
      setCurrentIndex(currentIndex + 1);
    } else {
      goToAuth();
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          {!isLast ? (
            <TouchableOpacity onPress={goToAuth} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.skip}>Skip</Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
        </View>

        <View style={styles.listArea} onLayout={(e) => setListHeight(e.nativeEvent.layout.height)}>
          {listHeight > 0 && (
            <FlatList
              ref={flatListRef}
              data={slides}
              renderItem={({ item }) => <SlideView item={item} height={listHeight} />}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => item.id}
              onMomentumScrollEnd={(event) => {
                const index = Math.round(event.nativeEvent.contentOffset.x / width);
                setCurrentIndex(index);
              }}
            />
          )}
        </View>

        <View style={[styles.footer, { paddingBottom: 24 + insets.bottom }]}>
          {isLast ? (
            <Animated.View entering={FadeIn.duration(280)} style={styles.finalRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={goToAuth} activeOpacity={0.85}>
                <Text style={styles.secondaryText}>I have an account</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryPill} onPress={goToAuth} activeOpacity={0.9}>
                <Text style={styles.primaryPillText}>Get started</Text>
                <ArrowRight size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <View style={styles.footerRow}>
              <View style={styles.pagination}>
                {slides.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.pdot, index === currentIndex && styles.pdotActive]}
                  />
                ))}
              </View>
              <TouchableOpacity style={styles.primaryPill} onPress={handleNext} activeOpacity={0.9}>
                <Text style={styles.primaryPillText}>Next</Text>
                <ArrowRight size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  safeArea: { flex: 1 },
  header: {
    height: 44,
    paddingHorizontal: 24,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  skip: { color: MUTED, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  listArea: { flex: 1 },
  slide: { width, paddingHorizontal: 24, justifyContent: 'center' },

  // Hero stage
  stage: {
    height: '52%',
    backgroundColor: STAGE,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    marginBottom: 28,
  },
  heroFill: { flex: 1, position: 'relative' },

  // Text
  textBlock: { paddingHorizontal: 4 },
  title: {
    fontSize: 34,
    lineHeight: 40,
    fontFamily: 'Inter_700Bold',
    color: INK,
    letterSpacing: -0.6,
    marginBottom: 14,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: 'Inter_400Regular',
    color: SUBTLE,
  },
  bodyStrong: { fontFamily: 'Inter_700Bold' },

  // Footer
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pagination: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pdot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#D4D4D8' },
  pdotActive: { width: 22, backgroundColor: INK },

  primaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: INK,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 22,
  },
  primaryPillText: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },

  finalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E4E4E7',
  },
  secondaryText: { color: INK, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  // Dot grid (hero 1)
  dotGrid: {
    position: 'absolute',
    top: 28,
    left: 26,
    right: 26,
    bottom: 28,
    justifyContent: 'space-between',
  },
  dotRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#E0E0DC' },
  packet: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: GREEN,
  },
  chipLayer: { ...StyleSheet.absoluteFillObject },
  chip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: INK },

  // Marquee (hero 2)
  marqueeClip: { overflow: 'hidden' },
  marqueeRow: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 5,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  pillText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: INK },

  // Orbit (hero 3)
  orbitWrap: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center' },
  orbitNode: { position: 'absolute' },
  partnerNode: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: HAIRLINE,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  centerNode: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN,
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pulseRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: GREEN,
  },
});

export default OnboardingSlides;
