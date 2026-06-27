import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  SlideInRight,
  SlideOutLeft,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Line } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// anorha green family (no more muddy dark green)
const BRAND = '#93C822';
const DEEP = '#5D7E16';
const INK = '#1C1B17';
const SUB = '#8A887E';
const CARD = '#FFFFFF';
const WARM = '#FBFAF6';
const BORDER = '#EEEADE';
const TINT = 'rgba(147,200,34,0.16)';
const TINT_STRONG = 'rgba(147,200,34,0.26)';

const EBAY = require('../../assets/ebay.png');
const SHOPIFY = require('../../assets/shopify.png');
const CLOVER = require('../../assets/clover.png');
const SQUARE = require('../../assets/square.png');
const FACEBOOK = require('../../assets/facebook.png');
const ANORHA = require('../../assets/anorha_logo.png');
const ORBIT = [SQUARE, SHOPIFY, CLOVER, EBAY, FACEBOOK];

const HEADERS = [
  { icon: 'line-scan', label: 'Add product' },
  { icon: 'sync', label: 'Live network' },
  { icon: 'sprout-outline', label: 'Sprout' },
];

// ── Right column — what's happening, in plain words ───────────────────────────
type FeedItem = { logo?: any; org?: string; icon?: string; text: string };
const FEEDS: { cap: string; items: FeedItem[] }[] = [
  { cap: 'SPROUT IS LISTING IT', items: [
    { icon: 'image-search-outline', text: 'Identified it' },
    { icon: 'tag-outline', text: 'Smart-priced' },
    { icon: 'text-box-outline', text: 'Wrote title & tags' },
    { icon: 'rocket-launch-outline', text: 'Listed on 3 channels' },
  ] },
  { cap: 'LIVE ACTIVITY', items: [
    { logo: SQUARE, text: 'Sale · Square' },
    { logo: SHOPIFY, text: 'Restocked' },
    { logo: EBAY, text: 'Return · eBay' },
    { org: 'Westside', text: 'Synced everywhere' },
  ] },
  { cap: 'SPROUT DID IT', items: [
    { logo: EBAY, text: 'Repriced · eBay' },
    { logo: CLOVER, text: 'Repriced · Clover' },
    { icon: 'cash', text: '3 sold today' },
  ] },
];

const FeedCard = ({ item, index }: { item: FeedItem; index: number }) => (
  <Animated.View entering={FadeInUp.delay(index * 260).duration(480)} style={styles.feedCard}>
    <View style={styles.feedIcon}>
      {item.logo ? (
        <Image source={item.logo} style={styles.feedLogo} resizeMode="contain" />
      ) : (
        <Icon name={item.org ? 'storefront-outline' : (item.icon ?? 'check')} size={13} color={DEEP} />
      )}
    </View>
    <Text style={styles.feedText} numberOfLines={1}>{item.text}</Text>
    <Animated.View entering={FadeIn.delay(index * 260 + 340)} style={styles.feedCheck}>
      <Icon name="check" size={8} color="#fff" />
    </Animated.View>
  </Animated.View>
);

const Feed = ({ scene }: { scene: number }) => {
  const feed = FEEDS[scene] ?? FEEDS[0];
  return (
    <View key={scene} style={styles.feed}>
      <Text style={styles.feedCap}>{feed.cap}</Text>
      {feed.items.map((it, i) => <FeedCard key={i} item={it} index={i} />)}
    </View>
  );
};

// ── Phone · Scan ──────────────────────────────────────────────────────────────
const ITEMS = [
  { icon: 'shoe-sneaker', name: 'Air Max 90', price: '$72', tag: 'Sneakers' },
  { icon: 'lamp', name: 'Desk Lamp', price: '$24', tag: 'Home' },
  { icon: 'guitar-acoustic', name: 'Acoustic Guitar', price: '$140', tag: 'Music' },
];
const ScanPhone = () => {
  const [shot, setShot] = useState(0);
  const flash = useSharedValue(0);
  useEffect(() => {
    const snap = () => { flash.value = withSequence(withTiming(0.85, { duration: 80 }), withTiming(0, { duration: 460 })); };
    snap();
    const id = setInterval(() => { setShot(s => (s + 1) % ITEMS.length); snap(); }, 2100);
    return () => clearInterval(id);
  }, [flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));
  const item = ITEMS[shot];
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.viewport}>
        {[styles.brTL, styles.brTR, styles.brBL, styles.brBR].map((b, i) => <View key={i} style={[styles.bracket, b]} />)}
        <Animated.View key={shot} entering={SlideInRight.duration(360)} exiting={SlideOutLeft.duration(280)} style={styles.itemWrap}>
          <Icon name={item.icon} size={46} color="#E9E7DF" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />
        <View style={styles.cartBadge}><Icon name="cart-outline" size={10} color="#fff" /><Text style={styles.cartCount}>{shot + 1}</Text></View>
      </View>
      <View style={styles.shutter}><View style={styles.shutterInner} /></View>
      <Animated.View key={`t${shot}`} entering={FadeInDown.delay(150).duration(420)} style={styles.tagCard}>
        <View style={styles.tagThumb}><Icon name={item.icon} size={15} color={SUB} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.tagTitle} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.tagPrice}>{item.price}</Text>
        </View>
        <View style={styles.checkBadge}><Icon name="check" size={9} color="#fff" /></View>
      </Animated.View>
    </View>
  );
};

// ── Phone · Live network — anorha in the center, everything orbiting it ────────
const RADIAL = 150;
const RC = RADIAL / 2;
const ORBIT_R = 52;
const ORBIT_PTS = ORBIT.map((_, i) => {
  const a = (i / ORBIT.length) * 2 * Math.PI - Math.PI / 2;
  return { x: RC + ORBIT_R * Math.cos(a), y: RC + ORBIT_R * Math.sin(a) };
});
// A packet travelling along a spoke. Inbound (platform→anorha) then outbound
// (anorha→others), so you see an action arrive and get pushed everywhere.
const FlowDot = ({ flow, fx, fy, tx, ty, t0, t1 }: { flow: SharedValue<number>; fx: number; fy: number; tx: number; ty: number; t0: number; t1: number }) => {
  const style = useAnimatedStyle(() => {
    'worklet';
    const f = flow.value;
    if (f < t0 || f > t1) return { opacity: 0, transform: [{ translateX: fx - 3 }, { translateY: fy - 3 }] };
    const p = (f - t0) / (t1 - t0);
    return {
      opacity: Math.sin(p * Math.PI),
      transform: [{ translateX: fx + (tx - fx) * p - 3 }, { translateY: fy + (ty - fy) * p - 3 }],
    };
  });
  return <Animated.View style={[styles.flowDot, style]} />;
};

const RadialSync = () => {
  const spin = useSharedValue(0);
  const flow = useSharedValue(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(1, { duration: 22000, easing: Easing.linear }), -1, false);
    flow.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [spin, flow]);
  const orbitStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));
  const counterStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-spin.value * 360}deg` }] }));
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: RADIAL, height: RADIAL }}>
        <Animated.View style={[StyleSheet.absoluteFill, orbitStyle]}>
          <Svg width={RADIAL} height={RADIAL} style={StyleSheet.absoluteFill}>
            {ORBIT_PTS.map((p, i) => (
              <Line key={i} x1={RC} y1={RC} x2={p.x} y2={p.y} stroke="rgba(147,200,34,0.38)" strokeWidth={1.5} />
            ))}
          </Svg>
          {/* inbound from one platform, then outbound to all the others */}
          <FlowDot flow={flow} fx={ORBIT_PTS[0].x} fy={ORBIT_PTS[0].y} tx={RC} ty={RC} t0={0} t1={0.4} />
          {ORBIT_PTS.slice(1).map((p, i) => (
            <FlowDot key={i} flow={flow} fx={RC} fy={RC} tx={p.x} ty={p.y} t0={0.5} t1={0.96} />
          ))}
          {ORBIT_PTS.map((p, i) => (
            <View key={i} style={[styles.orbitChip, { left: p.x - 13, top: p.y - 13 }]}>
              <Animated.View style={counterStyle}>
                <Image source={ORBIT[i]} style={styles.orbitLogo} resizeMode="contain" />
              </Animated.View>
            </View>
          ))}
        </Animated.View>
        <View style={styles.radialCenter}>
          <Image source={ANORHA} style={styles.radialMark} resizeMode="contain" />
        </View>
      </View>
    </View>
  );
};

// ── Phone · Chat — you ask, Sprout works, with a real inventory card ──────────
const ChatPhone = () => (
  <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }}>
      <Animated.View entering={FadeInUp.duration(380)} style={styles.userBubble}>
        <Text style={styles.userText}>Reprice my winter rack</Text>
      </Animated.View>
      <Animated.View entering={FadeInUp.delay(520).duration(380)} style={styles.sproutRow}>
        <View style={styles.sproutAvatar}><Icon name="sprout" size={11} color="#fff" /></View>
        <View style={styles.sproutBubble}><Text style={styles.sproutText}>On it — repriced 8 ✓</Text></View>
      </Animated.View>
      <Animated.View entering={FadeInUp.delay(1020).duration(420)} style={styles.prodCard}>
        <View style={styles.prodThumb}><Icon name="hanger" size={18} color={SUB} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.prodTitle} numberOfLines={1}>Wool Overcoat</Text>
          <View style={styles.prodPriceRow}>
            <Text style={styles.prodOld}>$48</Text>
            <Icon name="arrow-right-thin" size={11} color={SUB} />
            <Text style={styles.prodNew}>$39</Text>
          </View>
          <View style={styles.prodPlats}>
            {[EBAY, SHOPIFY, CLOVER].map((l, i) => (
              <View key={i} style={styles.prodPlat}><Image source={l} style={styles.prodPlatLogo} resizeMode="contain" /></View>
            ))}
            <Text style={styles.prodLive}>· live</Text>
          </View>
        </View>
      </Animated.View>
    </View>
    <View style={styles.inputBar}>
      <Text style={styles.inputPlaceholder}>Message Sprout…</Text>
      <View style={styles.sendBtn}><Icon name="arrow-up" size={12} color="#fff" /></View>
    </View>
  </View>
);

export default function WelcomeHero({ scene }: { scene: number }) {
  const h = HEADERS[scene] ?? HEADERS[0];
  return (
    <View style={styles.heroRow}>
      <View style={styles.phone}>
        <View style={styles.phoneInner}>
          <View style={styles.phoneHeader}>
            <Icon name={h.icon} size={12} color={DEEP} />
            <Text style={styles.phoneHeaderLabel}>{h.label}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {scene === 0 && <ScanPhone key="s0" />}
            {scene === 1 && <RadialSync key="s1" />}
            {scene === 2 && <ChatPhone key="s2" />}
          </View>
        </View>
      </View>
      <Feed scene={scene} />
    </View>
  );
}

const fc = { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER };

const styles = StyleSheet.create({
  heroRow: { flex: 1, flexDirection: 'row', alignItems: 'stretch', gap: 8 },

  phone: { width: 176, borderRadius: 30, padding: 6, backgroundColor: INK, shadowColor: INK, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 12 } },
  phoneInner: { flex: 1, borderRadius: 24, backgroundColor: WARM, padding: 10, overflow: 'hidden' },
  phoneHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  phoneHeaderLabel: { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: INK },

  // scan
  viewport: { height: 92, borderRadius: 12, backgroundColor: '#23241F', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  itemWrap: { alignItems: 'center', justifyContent: 'center' },
  flash: { backgroundColor: '#FFFFFF', borderRadius: 12 },
  bracket: { position: 'absolute', width: 13, height: 13, borderColor: BRAND },
  brTL: { top: 7, left: 7, borderTopWidth: 2, borderLeftWidth: 2, borderTopLeftRadius: 3 },
  brTR: { top: 7, right: 7, borderTopWidth: 2, borderRightWidth: 2, borderTopRightRadius: 3 },
  brBL: { bottom: 7, left: 7, borderBottomWidth: 2, borderLeftWidth: 2, borderBottomLeftRadius: 3 },
  brBR: { bottom: 7, right: 7, borderBottomWidth: 2, borderRightWidth: 2, borderBottomRightRadius: 3 },
  cartBadge: { position: 'absolute', top: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, height: 16, borderRadius: 999, backgroundColor: BRAND },
  cartCount: { fontSize: 8.5, fontFamily: 'Inter_700Bold', color: '#fff' },
  shutter: { alignSelf: 'center', width: 24, height: 24, borderRadius: 12, borderWidth: 2.5, borderColor: INK, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 14, height: 14, borderRadius: 7, backgroundColor: INK },
  tagCard: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, padding: 7, borderRadius: 11, ...fc },
  tagThumb: { width: 28, height: 28, borderRadius: 8, backgroundColor: '#ECE9DF', alignItems: 'center', justifyContent: 'center' },
  tagTitle: { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: INK },
  tagPrice: { fontSize: 9.5, fontFamily: 'Inter_700Bold', color: DEEP, marginTop: 1 },
  checkBadge: { width: 15, height: 15, borderRadius: 8, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },

  // radial network
  orbitChip: { position: 'absolute', width: 26, height: 26, borderRadius: 9, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  orbitLogo: { width: 16, height: 16 },
  flowDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: BRAND, shadowColor: BRAND, shadowOpacity: 0.9, shadowRadius: 3 },
  radialRing: { position: 'absolute', left: RC - 24, top: RC - 24, width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: BRAND },
  radialCenter: { position: 'absolute', left: RC - 19, top: RC - 19, width: 38, height: 38, borderRadius: 19, backgroundColor: CARD, borderWidth: 2, borderColor: BRAND, alignItems: 'center', justifyContent: 'center', shadowColor: BRAND, shadowOpacity: 0.3, shadowRadius: 8 },
  radialMark: { width: 26, height: 26 },

  // chat
  userBubble: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, borderBottomRightRadius: 3, backgroundColor: '#ECEAE3' },
  userText: { fontSize: 9.5, fontFamily: 'Inter_500Medium', color: INK },
  sproutRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, marginTop: 7 },
  sproutAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
  sproutBubble: { maxWidth: '82%', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 11, borderBottomLeftRadius: 3, backgroundColor: TINT },
  sproutText: { fontSize: 9, fontFamily: 'Inter_500Medium', color: INK },
  prodCard: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9, marginLeft: 4, padding: 8, borderRadius: 13, ...fc },
  prodThumb: { width: 38, height: 38, borderRadius: 9, backgroundColor: '#ECE9DF', alignItems: 'center', justifyContent: 'center' },
  prodTitle: { fontSize: 10.5, fontFamily: 'Inter_700Bold', color: INK },
  prodPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  prodOld: { fontSize: 9.5, fontFamily: 'Inter_500Medium', color: SUB, textDecorationLine: 'line-through' },
  prodNew: { fontSize: 10.5, fontFamily: 'Inter_800ExtraBold', color: DEEP },
  prodPlats: { flexDirection: 'row', gap: 3, marginTop: 5 },
  prodPlat: { width: 17, height: 17, borderRadius: 5, backgroundColor: WARM, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  prodPlatLogo: { width: 11, height: 11 },
  prodLive: { fontSize: 8.5, fontFamily: 'Inter_700Bold', color: DEEP, marginLeft: 3, alignSelf: 'center' },
  inputBar: { flexDirection: 'row', alignItems: 'center', height: 28, paddingLeft: 10, paddingRight: 3, borderRadius: 999, backgroundColor: '#F1EFE6', borderWidth: 1, borderColor: BORDER },
  inputPlaceholder: { flex: 1, fontSize: 9, fontFamily: 'Inter_500Medium', color: SUB },
  sendBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },

  // feed (right column)
  feed: { flex: 1, justifyContent: 'center' },
  feedCap: { fontSize: 8.5, fontFamily: 'Inter_700Bold', color: 'rgba(58,76,30,0.6)', letterSpacing: 0.6, marginBottom: 7, marginLeft: 2 },
  feedCard: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 7, marginBottom: 6, borderRadius: 11, backgroundColor: '#F4F3ED', borderWidth: 1, borderColor: '#DDD9CC' },
  feedIcon: { width: 22, height: 22, borderRadius: 7, backgroundColor: TINT_STRONG, alignItems: 'center', justifyContent: 'center' },
  feedLogo: { width: 14, height: 14 },
  feedText: { flex: 1, fontSize: 9.5, fontFamily: 'Inter_600SemiBold', color: INK },
  feedCheck: { width: 14, height: 14, borderRadius: 7, backgroundColor: BRAND, alignItems: 'center', justifyContent: 'center' },
});
