// AddDetailsSheet — "Wrong item / Add details" as a camera-area sheet (Cal-AI style).
//
// Reached from the preview's "Wrong item?" link or a cart row's "Add details" pill.
// Dark overlay that reads as an extension of the capture screen: the item's photo
// strip up top (remove badges + add tile, like the live top photo bar), a headline
// question, a borderless description input with the keyboard already up, plain
// Capture/Import rows, and one Continue button that re-runs the search. Rendered
// as an absoluteFill overlay inside the cart Modal (iOS can't stack Modals).

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const COLORS = {
  black: '#000000',
  panel: '#2C2C30',
  tileBorder: 'rgba(255,255,255,0.18)',
  text: '#FFFFFF',
  placeholder: 'rgba(235,235,245,0.45)',
  label: 'rgba(235,235,245,0.6)',
  chipBg: 'rgba(118,118,128,0.32)',
  removeBadge: '#FF5A3C',
  continueIdle: '#6B6B72',
  green: '#93C822',
};

export interface AddDetailsSheetProps {
  /** The item's current best title, shown so the user knows what they're refining. */
  itemTitle?: string;
  /** The item's cover photo, for the mini context thumb next to the headline. */
  photoUri?: string;
  /** All of the item's photos for the top strip. */
  photos?: Array<{ id: string; uri: string }>;
  /** Why we're asking (e.g. "We couldn't find a confident match"). */
  reason?: string;
  onBack: () => void;
  /** Remove one of the item's photos from the strip. */
  onRemovePhoto?: (photoId: string) => void;
  /** Open the live camera targeting this item to snap the product tag. */
  onCaptureTag: () => void;
  /** Open the photo library to import a picture of the tag. */
  onImportTag: () => void;
  /** Continue with the typed detail ('' if none) → host re-runs the search. */
  onContinue: (detail: string) => void;
}

export const AddDetailsSheet: React.FC<AddDetailsSheetProps> = ({
  itemTitle,
  photoUri,
  photos = [],
  reason,
  onBack,
  onRemovePhoto,
  onCaptureTag,
  onImportTag,
  onContinue,
}) => {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState('');

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.black} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Photo strip — mirrors the capture screen's top bar so this reads as
            "the camera area opened up", not a separate page. */}
        <View style={[styles.stripRow, { paddingTop: insets.top + 8 }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.stripContent}
          >
            <TouchableOpacity style={styles.addTile} activeOpacity={0.7} onPress={onCaptureTag}>
              <Icon name="plus" size={26} color={COLORS.label} />
            </TouchableOpacity>
            {photos.map((p) => (
              <View key={p.id} style={styles.tileWrap}>
                <Image source={{ uri: p.uri }} style={styles.tile} />
                {onRemovePhoto && photos.length > 1 && (
                  <TouchableOpacity
                    style={styles.removeBadge}
                    onPress={() => onRemovePhoto(p.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Icon name="minus" size={13} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={20} color={COLORS.text} />
          </TouchableOpacity>
        </View>

        {/* Dark panel */}
        <View style={styles.panel}>
          <View style={styles.chipRow}>
            <View style={styles.previewChip}>
              <Icon name="image-multiple-outline" size={13} color={COLORS.text} />
              <Text style={styles.previewChipText}>Preview</Text>
            </View>
          </View>

          <View style={styles.titleRow}>
            <Text style={styles.headline}>What are you selling?</Text>
            {photoUri ? <Image source={{ uri: photoUri }} style={styles.miniThumb} /> : null}
          </View>
          

          <TextInput
            style={styles.input}
            value={detail}
            onChangeText={setDetail}
            placeholder="Add an optional description to help with accuracy."
            placeholderTextColor={COLORS.placeholder}
            multiline
            autoFocus
            returnKeyType="default"
          />

          <TouchableOpacity style={styles.plainRow} activeOpacity={0.7} onPress={onCaptureTag}>
            <Icon name="camera-outline" size={20} color={COLORS.label} />
            <Text style={styles.plainRowText}>Snap the tag or label</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.plainRow} activeOpacity={0.7} onPress={onImportTag}>
            <Icon name="image-plus" size={20} color={COLORS.label} />
            <Text style={styles.plainRowText}>Import a tag photo</Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={[styles.continueBtn, detail.trim() ? styles.continueBtnActive : null]}
            activeOpacity={0.85}
            onPress={() => onContinue(detail.trim())}
          >
            <Text style={[styles.continueText, detail.trim() ? styles.continueTextActive : null]}>
              {detail.trim() ? 'Search again' : 'Continue'}
            </Text>
          </TouchableOpacity>
          <View style={{ height: Math.max(insets.bottom, 12) }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const TILE = 72;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.black,
  },
  stripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
  },
  stripContent: {
    paddingLeft: 16,
    paddingRight: 8,
    paddingTop: 8, // room for the remove badges to overhang the tiles
    alignItems: 'center',
  },
  addTile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: COLORS.tileBorder,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  tileWrap: {
    marginRight: 12,
  },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
  },
  removeBadge: {
    position: 'absolute',
    top: -7,
    left: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.removeBadge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(118,118,128,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    marginLeft: 4,
  },
  panel: {
    flex: 1,
    backgroundColor: COLORS.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  chipRow: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.chipBg,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  previewChipText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headline: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 0.2,
  },
  miniThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginLeft: 12,
  },
  reason: {
    fontSize: 13,
    color: COLORS.label,
    marginBottom: 4,
  },
  input: {
    fontSize: 18,
    lineHeight: 30,
    fontWeight: 500,
    color: COLORS.text,
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: 10,
    paddingBottom: 12,
    marginBottom: 8,
  },
  plainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  plainRowText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.label,
  },
  continueBtn: {
    backgroundColor: COLORS.continueIdle,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueBtnActive: {
    backgroundColor: COLORS.green,
  },
  continueText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  continueTextActive: {
    color: '#0A0A0B',
  },
});
