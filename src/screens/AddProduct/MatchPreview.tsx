// MatchPreview — the "potential match found" preview / pricing-research page.
//
// Dark, full-screen page shown when the find-the-item search resolves: hero photo,
// recognized title + description, "Wrong item?" affordance, pricing guidance
// (current value range + average/median + suggested-range slider), recent comps,
// and a "Sell this item" CTA. Props-driven so it can be fed a confirmed CartItem;
// falls back to EXAMPLE_MATCH_PREVIEW for design-export / dev rendering.

import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PricingGuidanceCard, PricingGuidanceData } from '../../components/pricing/PricingGuidanceCard';
import { ProgressiveBlurView } from '../../components/ProgressiveBlurView';

const GREEN = '#93C822';
const COLORS = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  hairline: '#E8E8ED',
  track: '#E5E5EA',
  text: '#0A0A0B',
  label: '#8E8E93',
  body: '#48484A',
};

export interface MatchPreviewComp {
  title?: string;
  price?: number;
  marketplace?: string;
  condition?: string;
  imageUrl?: string;
  url?: string;
}

export interface MatchPreviewData {
  photoUri?: string;
  title: string;
  description?: string;
  // The full pricing shape the card renders (live + sold comps + history + time-to-sell).
  pricing?: PricingGuidanceData;
  // Pricing research still in flight → card shows "Finding comps…" instead of blank dashes.
  pricingLoading?: boolean;
}

export interface MatchPreviewProps {
  data?: MatchPreviewData;
  onBack?: () => void;
  onWrongItem?: () => void;
  /** User submitted correction context from the "Wrong item?" sheet → re-run the search. */
  onResearch?: (ctx: { text?: string }) => void;
  /** User chose to add a clearer photo from the "Wrong item?" sheet. */
  onAddPhoto?: () => void;
  onSell?: () => void;
  onOpenComp?: (comp: MatchPreviewComp, index: number) => void;
  sellLabel?: string;
}

export const EXAMPLE_MATCH_PREVIEW: MatchPreviewData = {
  photoUri: 'https://picsum.photos/seed/logitechlift/900/680',
  title: 'Logitech Lift Vertical Ergonomic Mouse',
  description:
    'The Logitech Lift is a wireless vertical ergonomic mouse designed for all-day comfort, specifically tailored for small to medium right hands. It features a 57-degree angled design to promote a natural handshake position, reducing wrist strain. It includes silent clicks, a SmartWheel for seamless scrolling, and connects via Bluetooth Low Energy or the Logi Bolt USB receiver.',
  pricing: {
    low: 21,
    high: 30,
    median: 26,
    average: 26,
    samples: [
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 31, marketplace: 'Ebay', condition: 'used', imageUrl: 'https://picsum.photos/seed/comp1/120' },
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 38, marketplace: 'Ebay', condition: 'used', imageUrl: 'https://picsum.photos/seed/comp2/120' },
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 40, marketplace: 'Ebay', condition: 'open box', imageUrl: 'https://picsum.photos/seed/comp3/120' },
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 40, marketplace: 'Ebay', condition: 'used', imageUrl: 'https://picsum.photos/seed/comp4/120' },
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 40, marketplace: 'Ebay', condition: 'open box', imageUrl: 'https://picsum.photos/seed/comp5/120' },
      { title: 'Logitech Lift Vertical Ergonomic Mouse', price: 40, marketplace: 'Ebay', condition: 'open box', imageUrl: 'https://picsum.photos/seed/comp6/120' },
    ],
  },
};

export const MatchPreview: React.FC<MatchPreviewProps> = ({
  data = EXAMPLE_MATCH_PREVIEW,
  onBack,
  onWrongItem,
  onResearch,
  onAddPhoto,
  onSell,
  onOpenComp,
  sellLabel = 'Confirm item',
}) => {
  const insets = useSafeAreaInsets();
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const p = data.pricing ?? {};

  const handleWrongItem = () => {
    // Host wrong-item destination (the Add-details page) wins; the correction sheet is the fallback.
    if (onWrongItem) { onWrongItem(); return; }
    setCorrectionText('');
    setCorrectionOpen(true);
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 196 + insets.bottom }}
      >
        {/* Hero */}
        <View style={[styles.heroWrap, { marginTop: insets.top + 8 }]}>
          {data.photoUri ? (
            <Image source={{ uri: data.photoUri }} style={styles.hero} resizeMode="cover" />
          ) : (
            <View style={[styles.hero, styles.heroPlaceholder]}>
              <Icon name="image-off-outline" size={40} color="#C7C7CC" />
            </View>
          )}
        </View>

        {/* Title / description card (wrong-item is now a secondary button in the footer) */}
        <View style={styles.infoCard}>
          <Text style={styles.title}>{data.title}</Text>
          {!!data.description && <Text style={styles.description}>{data.description}</Text>}
        </View>

        {/* Pricing guidance + recent comps — the one shared pricing overview */}
       <View style={{marginHorizontal: 12 }}>
            <PricingGuidanceCard pricing={p} loading={data.pricingLoading} onOpenComp={onOpenComp} />
        </View>
      </ScrollView>

      {/* Back button */}
      <TouchableOpacity
        onPress={onBack}
        activeOpacity={0.7}
        style={[styles.backBtn, { top: insets.top + 12 }]}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Icon name="chevron-left" size={26} color="#FFFFFF" />
      </TouchableOpacity>

      {/* Sticky CTA — glass footer (header-style blur, flipped for the bottom) so content
          scrolls under it; Confirm item primary + Wrong item? secondary. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ProgressiveBlurView intensity={Platform.OS === 'ios' ? 50 : 28} tint="light" direction="up" />
          <LinearGradient
            colors={['rgba(242,242,247,0)', 'rgba(242,242,247,0.9)', '#F2F2F7']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <TouchableOpacity style={styles.sellBtn} activeOpacity={0.85} onPress={onSell}>
          <Text style={styles.sellLabel}>{sellLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.7} onPress={handleWrongItem}>
          <Text style={styles.secondaryLabel}>Wrong item?</Text>
        </TouchableOpacity>
      </View>

      {/* "Wrong item?" — help-us-find-it correction sheet */}
      <Modal visible={correctionOpen} transparent animationType="slide" onRequestClose={() => setCorrectionOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.correctionRoot}
        >
          <Pressable style={styles.correctionBackdrop} onPress={() => setCorrectionOpen(false)} />
          <View style={[styles.correctionCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.grabber} />
            <Text style={styles.correctionTitle}>Not the right item?</Text>
            <Text style={styles.correctionSubtitle}>
              Tell us what it actually is — or add a clearer photo — and we&apos;ll search again.
            </Text>
            <TextInput
              style={styles.correctionInput}
              value={correctionText}
              onChangeText={setCorrectionText}
              placeholder="e.g. Logitech MX Master 3S, graphite"
              placeholderTextColor="#A0A0A5"
              multiline
              autoFocus
            />
            <TouchableOpacity
              style={styles.addPhotoRow}
              activeOpacity={0.7}
              onPress={() => {
                setCorrectionOpen(false);
                onAddPhoto?.();
              }}
            >
              <Icon name="camera-plus-outline" size={20} color={COLORS.text} />
              <Text style={styles.addPhotoLabel}>Add a clearer photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.researchBtn, !correctionText.trim() && styles.researchBtnDisabled]}
              activeOpacity={0.85}
              disabled={!correctionText.trim()}
              onPress={() => {
                const t = correctionText.trim();
                setCorrectionOpen(false);
                onResearch?.({ text: t });
              }}
            >
              <Text style={styles.researchLabel}>Search again</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },

  heroWrap: { marginHorizontal: 12, borderRadius: 22, overflow: 'hidden' },
  hero: { width: '100%', aspectRatio: 1.34, backgroundColor: '#E5E5EA' },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },

  backBtn: {
    position: 'absolute',
    left: 22,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(20,20,22,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  infoCard: {
    marginHorizontal: 12,
    marginTop: 14,
    padding: 20,
    borderRadius: 22,
    backgroundColor: COLORS.card,
  },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', lineHeight: 34, letterSpacing: -0.5 },
  wrongItem: { color: COLORS.label, fontSize: 15, textDecorationLine: 'underline', marginTop: 12 },
  description: { color: COLORS.body, fontSize: 16, lineHeight: 24, marginTop: 16 },


  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 28,
    backgroundColor: 'transparent',
  },
  sellBtn: { backgroundColor: GREEN, borderRadius: 18, height: 56, alignItems: 'center', justifyContent: 'center' },
  sellLabel: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  secondaryBtn: {
    marginTop: 10,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  secondaryLabel: { color: COLORS.text, fontSize: 16, fontWeight: '700' },

  // "Wrong item?" correction sheet
  correctionRoot: { flex: 1, justifyContent: 'flex-end' },
  correctionBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  correctionCard: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: '#D8D8DD', marginBottom: 16 },
  correctionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  correctionSubtitle: { color: COLORS.label, fontSize: 15, lineHeight: 21, marginTop: 8 },
  correctionInput: {
    backgroundColor: COLORS.bg,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    color: COLORS.text,
    minHeight: 88,
    textAlignVertical: 'top',
    marginTop: 16,
  },
  addPhotoRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, marginTop: 2 },
  addPhotoLabel: { color: COLORS.text, fontSize: 16, fontWeight: '600' },
  researchBtn: { backgroundColor: GREEN, borderRadius: 16, height: 54, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  researchBtnDisabled: { backgroundColor: '#D4D4D8' },
  researchLabel: { color: '#0A0A0B', fontSize: 17, fontWeight: '800' },
});

export default MatchPreview;
