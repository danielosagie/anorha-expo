// PrintingComplete — the shared import/optimize completion.
//
// Plays a small printer animation: the receipt "prints" out (sheet height grows)
// while the work commits, then it tears off, the printer fades away, the torn
// edge smooths, and the action buttons rise in. It's a hybrid receipt — already
// in the final card style — so the morph is a small settle, not a restyle.
//
// Reanimated drives one timeline: printH (paper feeds out) → printerOut (tear +
// fade) → morph (radius softens, stamp fades, buttons rise).

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { normalizeDisplayName } from '../../config/platforms';

const GREEN = '#93C822';
const GREEN_DARK = '#3B6300';
const GREEN_SOFT = '#EEFCE0';
const GREEN_LINE = '#BFE58A';
const INK = '#18181B';
const MUTED = '#71717A';
const FAINT = '#9CA3AF';
const LINE = '#E5E7EB';

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
  /** When false, the receipt prints but HOLDS (the work isn't done) — it tears off and
   *  morphs into the result card only once this flips true. Defaults to true (import). */
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
  const printH = useSharedValue(0);
  const printerOut = useSharedValue(0);
  const morph = useSharedValue(0);

  // Safety net: if onLayout never reports a height (rare, but the absolute
  // measure view depends on it), fall back to a sensible height so the sheet
  // still prints and the buttons still appear — never a stuck completion.
  useEffect(() => {
    if (bodyH) return;
    const t = setTimeout(() => setBodyH((h) => h || 360), 700);
    return () => clearTimeout(t);
  }, [bodyH]);

  const [printed, setPrinted] = useState(false);

  // Feed the paper out as soon as we know its height.
  useEffect(() => {
    if (!bodyH) return;
    const E = Easing.bezier(0.2, 0, 0, 1);
    printH.value = withTiming(bodyH, { duration: 2200, easing: E });
    const tp = setTimeout(() => setPrinted(true), 2200);
    return () => clearTimeout(tp);
  }, [bodyH, printH]);

  // Tear off + morph only once the paper has fully fed AND the work is done (`ready`). For
  // publish, `ready` flips true when the POST returns 2xx; until then the printed receipt
  // holds with the "syncing…" line — so we never show a false "done".
  useEffect(() => {
    if (!printed || !ready) return;
    const E = Easing.bezier(0.2, 0, 0, 1);
    printerOut.value = withTiming(1, { duration: 480, easing: E });
    const t2 = setTimeout(() => {
      morph.value = withTiming(1, { duration: 460, easing: E });
    }, 380);
    return () => clearTimeout(t2);
  }, [printed, ready, printerOut, morph]);

  const sheetStyle = useAnimatedStyle(() => ({
    height: printH.value,
    transform: [{ translateY: printerOut.value * -14 }],
    borderRadius: 3 + morph.value * 15,
    borderColor: morph.value > 0.5 ? LINE : '#ECECEC',
  }));
  const printerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: printerOut.value * -46 }],
    opacity: 1 - printerOut.value,
  }));
  const perfStyle = useAnimatedStyle(() => ({ opacity: 1 - printerOut.value }));
  const stampStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value }));
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + morph.value * 0.06 }] }));
  const actionsStyle = useAnimatedStyle(() => ({
    opacity: morph.value,
    transform: [{ translateY: (1 - morph.value) * 12 }],
  }));
  const syncingStyle = useAnimatedStyle(() => ({
    opacity: (1 - printerOut.value) * (printH.value > 0 ? 1 : 0),
  }));

  return (
    <View style={s.root}>
      <Animated.View style={[s.printer, printerStyle]}>
        <View style={s.printerMouth} />
      </Animated.View>

      <Animated.View style={[s.sheet, sheetStyle]}>
        <View
          style={s.measure}
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            if (h && !bodyH) setBodyH(h);
          }}
        >
          <Animated.View style={[s.perf, perfStyle]} />
          <View style={s.body}>
            <Animated.View style={[s.check, checkStyle]}>
              <Icon name="check" size={36} color={GREEN_DARK} />
            </Animated.View>
            <Text style={s.title}>{title}</Text>
            <Text style={s.sub}>{subtitle}</Text>
            {platforms.length > 0 && (
              <View style={s.card}>
                <Text style={s.lbl}>CHANNELS</Text>
                <View style={s.pills}>
                  {platforms.slice(0, 4).map((p) => (
                    <View key={p} style={s.pill}>
                      <View style={s.pillDot}>
                        <Icon name="check" size={11} color="#fff" />
                      </View>
                      <Text style={s.pillText} numberOfLines={1}>{normalizeDisplayName(p)}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {!!stamp && <Animated.Text style={[s.stamp, stampStyle]}>{stamp}</Animated.Text>}
          </View>
        </View>
      </Animated.View>

      <Animated.View style={[s.actions, actionsStyle]}>
        <TouchableOpacity activeOpacity={0.9} onPress={onPrimary} style={[s.btn, s.btnP]}>
          <Text style={s.btnPText}>{primaryLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.85} onPress={onSecondary} style={[s.btn, s.btnS]}>
          <Text style={s.btnSText}>{secondaryLabel}</Text>
        </TouchableOpacity>
      </Animated.View>

      <Animated.Text style={[s.syncing, syncingStyle]}>{syncingLabel}</Animated.Text>
    </View>
  );
};

const SHEET_W = 256;

const s = StyleSheet.create({
  root: { alignItems: 'center', alignSelf: 'stretch' },

  printer: {
    position: 'absolute',
    top: 0,
    width: SHEET_W + 28,
    height: 34,
    borderRadius: 18,
    backgroundColor: '#1B1B1D',
    zIndex: 3,
  },
  printerMouth: { position: 'absolute', left: 14, right: 14, top: 9, height: 15, backgroundColor: '#fff', borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },

  sheet: {
    marginTop: 30,
    width: SHEET_W,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ECECEC',
    overflow: 'hidden',
    zIndex: 1,
  },
  // Absolute so its measured height is the content's natural height regardless
  // of the clipping sheet's animated height.
  measure: { position: 'absolute', top: 0, left: 0, width: SHEET_W },
  perf: { height: 0, borderTopWidth: 1.5, borderColor: '#D6D6D6', borderStyle: 'dashed', marginHorizontal: 6 },

  body: { paddingHorizontal: 18, paddingTop: 24, paddingBottom: 18, alignItems: 'center' },
  check: { width: 70, height: 70, borderRadius: 35, backgroundColor: GREEN_SOFT, borderWidth: 1, borderColor: GREEN_LINE, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: INK, letterSpacing: -0.4, marginTop: 15 },
  sub: { fontSize: 13.5, fontWeight: '500', color: MUTED, marginTop: 4, textAlign: 'center' },

  card: { alignSelf: 'stretch', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 13, marginTop: 16 },
  lbl: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: FAINT, marginBottom: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: GREEN_LINE, backgroundColor: '#F6FCEC', borderRadius: 999, paddingVertical: 5, paddingLeft: 7, paddingRight: 10 },
  pillDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 12, fontWeight: '600', color: INK },

  stamp: { fontSize: 10.5, fontWeight: '500', letterSpacing: 1, color: '#B8B8B8', marginTop: 14 },

  actions: { alignSelf: 'stretch', marginTop: 22, gap: 9 },
  btn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnP: { backgroundColor: GREEN },
  btnPText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  btnS: { backgroundColor: '#F3F4F6' },
  btnSText: { fontSize: 15, fontWeight: '700', color: MUTED },

  syncing: { fontSize: 12.5, fontWeight: '500', color: FAINT, marginTop: 18 },
});

export default PrintingComplete;
