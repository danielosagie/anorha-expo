import React, { ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { X, Info } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

const SCREEN_H = Dimensions.get('window').height;

/**
 * FieldSheet — the single bottom-sheet shell every listing field opens into.
 *
 * grabber → header [title (+ optional platform chip) · ✕ in a circle] → scroll
 * content → green primary footer button. Modeled on the Anorha field-edit sheet
 * idiom (design.md §3) and the existing in-component <Modal> presentation so it
 * needs no new sheet library. One sheet = one decision.
 */
export interface FieldSheetProps {
  visible: boolean;
  title: string;
  /** Small pill next to the title, e.g. a platform name ("eBay") or scope ("All channels"). */
  badge?: string;
  badgeTone?: 'brand' | 'neutral';
  onClose: () => void;
  /** Optional info affordance in the header (e.g. open field version history / sources). */
  onInfo?: () => void;
  /** When provided, renders the sticky footer primary button. */
  onSave?: () => void;
  saveLabel?: string;
  saveDisabled?: boolean;
  saving?: boolean;
  /** Optional extra footer node rendered above the primary button (e.g. a soft exit). */
  footerExtra?: ReactNode;
  /** Wrap children in a ScrollView (default true). Set false for sheets that own their own scroll. */
  scroll?: boolean;
  maxHeightPct?: number;
  /** Minimum sheet height as a % of the screen, so even short fields feel comfortable. */
  minHeightPct?: number;
  children: ReactNode;
}

export default function FieldSheet({
  visible,
  title,
  badge,
  badgeTone = 'neutral',
  onClose,
  onInfo,
  onSave,
  saveLabel = 'Save',
  saveDisabled = false,
  saving = false,
  footerExtra,
  scroll = true,
  maxHeightPct = 92,
  minHeightPct = 55,
  children,
}: FieldSheetProps) {
  const insets = useSafeAreaInsets();

  const Body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[styles.content, { flexGrow: 1 }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { flex: 1 }]}>{children}</View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <View style={[styles.sheet, { maxHeight: `${maxHeightPct}%`, minHeight: SCREEN_H * (minHeightPct / 100) }]}>
            <View style={styles.grabber} />

            <View style={styles.header}>
              <View style={styles.titleRow}>
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
                {!!badge && (
                  <View style={[styles.badge, badgeTone === 'brand' && styles.badgeBrand]}>
                    <Text style={[styles.badgeText, badgeTone === 'brand' && styles.badgeTextBrand]}>
                      {badge}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.headerActions}>
                {!!onInfo && (
                  <TouchableOpacity
                    style={styles.closeCircle}
                    onPress={onInfo}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Info size={17} color={CHAT_COLORS.dim} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeCircle}
                  onPress={onClose}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <X size={18} color={CHAT_COLORS.dim} />
                </TouchableOpacity>
              </View>
            </View>

            {Body}

            {(onSave || footerExtra) && (
              <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                {footerExtra}
                {onSave && (
                  <TouchableOpacity
                    style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
                    onPress={onSave}
                    disabled={saveDisabled || saving}
                    activeOpacity={0.85}
                  >
                    {saving ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text style={styles.saveLabel}>{saveLabel}</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: CHAT_COLORS.scrim,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    backgroundColor: CHAT_COLORS.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 8,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.border,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 12,
  },
  title: {
    fontSize: 19,
    fontFamily: CHAT_FONT.bold,
    fontWeight: '700',
    color: CHAT_COLORS.ink,
    flexShrink: 1,
  },
  badge: {
    backgroundColor: CHAT_COLORS.bubble,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeBrand: {
    backgroundColor: CHAT_COLORS.brandSoft,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    color: CHAT_COLORS.dim,
  },
  badgeTextBrand: {
    color: CHAT_COLORS.brandDeep,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: CHAT_COLORS.bubble,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CHAT_COLORS.divider,
    backgroundColor: CHAT_COLORS.white,
  },
  saveBtn: {
    height: 54,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#D4D4D8',
  },
  saveLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: CHAT_FONT.bold,
    fontWeight: '700',
  },
});
