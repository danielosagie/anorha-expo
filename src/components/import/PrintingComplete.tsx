// PrintingComplete — the shared import/publish completion animation.
//
// A thermal receipt feeds out of a STATIC printer slot pinned at the top: the slot
// never moves, the paper grows downward out of it (height animates 0 → full) while the
// work commits, and once done the action buttons rise in below. No tear-off, no morph —
// the receipt is the artifact, styled like a real till receipt (monospace, dotted rules,
// line items, total, barcode, scalloped foot).
//
// `ready` gates completion: the paper prints and HOLDS with a "syncing…" line until the
// caller flips ready true (e.g. the publish POST returns 2xx) — so we never show a false
// "done". Import passes ready (default) true.

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { normalizeDisplayName } from '../../config/platforms';

const MONO = Platform.OS === 'ios' ? 'Courier' : 'monospace';
const GREEN = '#93C822';
const GREEN_DARK = '#3B6300';
const PAPER = '#FAF9F5';
const PAPER_EDGE = '#ECE9E1';
const INK = '#33322E';
const INK_SOFT = '#8E8B81';
const INK_FAINT = '#B8B5AB';
const SLOT = '#1C1C1E';

const SHEET_W = 286;
const SCALLOPS = 13;
// Deterministic barcode bar widths — fixed so it never reflows between renders.
const BARS = [3, 1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1, 2, 1, 1, 3, 1];

export interface PrintingCompleteProps {
  title: string;
  subtitle: string;
  platforms?: string[];
  stamp?: string;
  syncingLabel?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  /** When false the receipt prints but HOLDS until this flips true. Defaults true (import). */
  ready?: boolean;
}

const PrintingComplete: React.FC<PrintingCompleteProps> = ({
  title,
  subtitle,
  platforms = [],
  stamp,
  syncingLabel = 'Syncing…',
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  ready = true,
}) => {
  const [bodyH, setBodyH] = useState(0);
  const [printed, setPrinted] = useState(false);
  const [now] = useState(() => new Date());

  const feed = useSharedValue(0); // 0 → bodyH : paper feeding out of the slot
  const reveal = useSharedValue(0); // 0 → 1 : action buttons rise in
  const pulse = useSharedValue(0); // syncing-line breathing while holding

  // Safety net if onLayout never fires.
  useEffect(() => {
    if (bodyH) return;
    const t = setTimeout(() => setBodyH((h) => h || 460), 700);
    return () => clearTimeout(t);
  }, [bodyH]);

  // Feed the paper out as soon as we know its height.
  useEffect(() => {
    if (!bodyH) return;
    const E = Easing.bezier(0.2, 0, 0, 1);
    feed.value = withTiming(bodyH, { duration: 1700, easing: E });
    const tp = setTimeout(() => setPrinted(true), 1700);
    return () => clearTimeout(tp);
  }, [bodyH, feed]);

  // Breathe the "syncing…" line while we wait on the work.
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  // Buttons rise only once the paper is fully out AND the work is done.
  useEffect(() => {
    if (!printed || !ready) return;
    reveal.value = withTiming(1, { duration: 420, easing: Easing.bezier(0.2, 0, 0, 1) });
  }, [printed, ready, reveal]);

  const done = printed && ready;

  const paperStyle = useAnimatedStyle(() => ({ height: feed.value }));
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 12 }],
  }));
  const syncStyle = useAnimatedStyle(() => ({
    opacity: (1 - reveal.value) * (0.5 + pulse.value * 0.5),
  }));

  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const ref = (stamp && stamp.replace(/[^0-9A-Za-z]/g, '').slice(0, 6)) || pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  const channels = platforms.slice(0, 6);
  const n = channels.length;

  const dashes = '- '.repeat(21).trim();

  return (
    <View style={s.root}>
      {/* Static printer slot — never moves. */}
      <View style={s.slot}>
        <View style={s.slotLip} />
      </View>

      {/* Receipt paper, clipped, feeding downward out of the slot. */}
      <Animated.View style={[s.paperClip, paperStyle]}>
        <View
          style={s.measure}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h && !bodyH) setBodyH(h);
          }}
        >
          <View style={s.body}>
            <Text style={s.brand}>A N O R H A</Text>
            <Text style={s.head}>{title.toUpperCase()}</Text>
            {!!subtitle && <Text style={s.sub}>{subtitle}</Text>}

            <Text style={s.rule}>{dashes}</Text>

            <View style={s.metaRow}>
              <Text style={s.meta}>{dateStr}</Text>
              <Text style={s.meta}>{timeStr}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.meta}>CASHIER: ANORHA</Text>
              <Text style={s.meta}>#{ref}</Text>
            </View>

            <Text style={s.rule}>{dashes}</Text>

            {channels.length > 0 ? (
              channels.map((p) => (
                <View key={p} style={s.itemRow}>
                  <Text style={s.itemName} numberOfLines={1}>{normalizeDisplayName(p).toUpperCase()}</Text>
                  <View style={s.itemVal}>
                    <Icon name="check" size={12} color={GREEN_DARK} />
                    <Text style={s.itemValText}>LIVE</Text>
                  </View>
                </View>
              ))
            ) : (
              <View style={s.itemRow}>
                <Text style={s.itemName}>LISTING</Text>
                <Text style={s.itemValText}>READY</Text>
              </View>
            )}

            <Text style={s.rule}>{dashes}</Text>

            <View style={s.totalRow}>
              <Text style={s.totalLabel}>TOTAL</Text>
              <Text style={s.totalVal}>{n > 0 ? `${n} CHANNEL${n === 1 ? '' : 'S'}` : 'SAVED'}</Text>
            </View>

            <Text style={s.rule}>{dashes}</Text>

            <View style={s.barcode}>
              {BARS.map((w, i) => (
                <View key={i} style={{ width: w * 1.7, height: 42, marginRight: 1.6, backgroundColor: i % 2 === 0 ? INK : 'transparent' }} />
              ))}
            </View>
            <Text style={s.barNum}>4 200000 0{ref.slice(0, 4).padEnd(4, '0')}</Text>

            <Text style={s.rule}>{dashes}</Text>
            <Text style={s.thanks}>THANK YOU FOR SELLING</Text>
            <Text style={s.thanksSub}>RESTOCKS WELCOME ANYTIME</Text>
          </View>

          {/* Scalloped foot — white notches cut into the warm paper. */}
          <View style={s.scallopRow}>
            {Array.from({ length: SCALLOPS }).map((_, i) => (
              <View key={i} style={s.scallop} />
            ))}
          </View>
        </View>
      </Animated.View>

      {/* Holding line while the work commits. */}
      {!done && <Animated.Text style={[s.syncing, syncStyle]}>{syncingLabel}</Animated.Text>}

      {/* Actions rise in once printed + ready. */}
      {done && (
        <Animated.View style={[s.actions, actionsStyle]}>
          <Pressable onPress={onPrimary} style={({ pressed }) => [s.btn, s.btnP, pressed && s.pressed]}>
            <Text style={s.btnPText}>{primaryLabel}</Text>
          </Pressable>
          <Pressable onPress={onSecondary} style={({ pressed }) => [s.btn, s.btnS, pressed && s.pressed]}>
            <Text style={s.btnSText}>{secondaryLabel}</Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
};

const s = StyleSheet.create({
  root: { alignItems: 'center', alignSelf: 'stretch' },

  // Static slot
  slot: { width: SHEET_W + 18, height: 13, borderRadius: 4, backgroundColor: SLOT, zIndex: 3, marginBottom: -4, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  slotLip: { position: 'absolute', left: 12, right: 12, bottom: 3, height: 2, borderRadius: 2, backgroundColor: '#3A3A3D' },

  // Paper
  paperClip: { width: SHEET_W, overflow: 'hidden', zIndex: 1 },
  measure: { position: 'absolute', top: 0, left: 0, width: SHEET_W },
  body: { backgroundColor: PAPER, borderWidth: 1, borderColor: PAPER_EDGE, borderBottomWidth: 0, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 12 },

  brand: { fontFamily: MONO, fontSize: 17, fontWeight: '700', color: INK, textAlign: 'center', letterSpacing: 2 },
  head: { fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: INK, textAlign: 'center', letterSpacing: 1, marginTop: 8 },
  sub: { fontFamily: MONO, fontSize: 11, color: INK_SOFT, textAlign: 'center', letterSpacing: 1, marginTop: 3 },

  rule: { fontFamily: MONO, fontSize: 11, color: INK_FAINT, letterSpacing: 0, marginVertical: 9, textAlign: 'center' },

  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  meta: { fontFamily: MONO, fontSize: 11, color: INK_SOFT, letterSpacing: 0.5 },

  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 4 },
  itemName: { flex: 1, fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: INK, letterSpacing: 0.5 },
  itemVal: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemValText: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: GREEN_DARK, letterSpacing: 0.5 },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontFamily: MONO, fontSize: 16, fontWeight: '700', color: INK, letterSpacing: 1 },
  totalVal: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: INK, letterSpacing: 0.5 },

  barcode: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end', marginTop: 4 },
  barNum: { fontFamily: MONO, fontSize: 11, color: INK_SOFT, textAlign: 'center', letterSpacing: 3, marginTop: 6 },

  thanks: { fontFamily: MONO, fontSize: 11.5, fontWeight: '700', color: INK, textAlign: 'center', letterSpacing: 1 },
  thanksSub: { fontFamily: MONO, fontSize: 9.5, color: INK_FAINT, textAlign: 'center', letterSpacing: 1, marginTop: 3 },

  // Scalloped foot
  scallopRow: { flexDirection: 'row', justifyContent: 'center', height: 8, overflow: 'hidden' },
  scallop: { width: SHEET_W / SCALLOPS, height: 16, borderRadius: SHEET_W / SCALLOPS, backgroundColor: '#FFFFFF', marginTop: -8 },

  syncing: { fontFamily: MONO, fontSize: 12, color: INK_SOFT, letterSpacing: 1, marginTop: 18 },

  actions: { alignSelf: 'stretch', marginTop: 20, gap: 9 },
  btn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnP: { backgroundColor: GREEN },
  btnPText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  btnS: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  btnSText: { fontSize: 15, fontWeight: '600', color: '#3F3F46' },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.96 },
});

export default PrintingComplete;
