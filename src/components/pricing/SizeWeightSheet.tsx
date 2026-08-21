import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import {
  buildSizeWeightDraftPatch,
  normalizePackageDimensions,
  splitWeightForInputs,
  type ItemShippingDetails,
  type SizeWeightInputs,
} from '../../lib/itemShipping';

interface SizeWeightSheetProps {
  visible: boolean;
  value: ItemShippingDetails;
  onChange: (value: ItemShippingDetails) => void;
  onClose: () => void;
}

type InputKey = 'pounds' | 'ounces' | 'length' | 'width' | 'height';

const emptyInputs = (): Record<InputKey, string> => ({
  pounds: '',
  ounces: '',
  length: '',
  width: '',
  height: '',
});

const inputText = (value?: number): string => value === undefined ? '' : String(value);

export function SizeWeightSheet({ visible, value, onChange, onClose }: SizeWeightSheetProps) {
  const insets = useSafeAreaInsets();
  const [inputs, setInputs] = useState<Record<InputKey, string>>(emptyInputs);

  useEffect(() => {
    if (!visible) return;
    const weightInputs = splitWeightForInputs(value);
    const dimensions = normalizePackageDimensions(value.dimensions);
    setInputs({
      pounds: weightInputs.pounds,
      ounces: weightInputs.ounces,
      length: inputText(dimensions?.length),
      width: inputText(dimensions?.width),
      height: inputText(dimensions?.height),
    });
    // Read the current persisted values once per open. Local strings then stay stable
    // while the seller types intermediate decimal values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const updateInput = (key: InputKey, next: string) => {
    setInputs((current) => ({ ...current, [key]: next }));
  };

  const closeWithSave = () => {
    onChange(buildSizeWeightDraftPatch(inputs satisfies SizeWeightInputs));
    onClose();
  };

  const field = (key: InputKey, label: string, unit: string) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          accessibilityLabel={label}
          value={inputs[key]}
          onChangeText={(text) => updateInput(key, text)}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor="#B3B3B8"
          selectTextOnFocus
          style={styles.input}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable accessibilityLabel="Close" style={styles.scrim} onPress={closeWithSave} />
      <KeyboardAvoidingView
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>Size & weight</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              onPress={closeWithSave}
              style={styles.closeButton}
            >
              <X size={18} color={CHAT_COLORS.dim} />
            </Pressable>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={styles.sectionLabel}>Weight</Text>
            <View style={styles.row}>
              {field('pounds', 'Pounds', 'lb')}
              {field('ounces', 'Ounces', 'oz')}
            </View>

            <View style={styles.sectionGap} />
            <Text style={styles.sectionLabel}>Dimensions</Text>
            <View style={styles.row}>
              {field('length', 'Length', 'in')}
              {field('width', 'Width', 'in')}
              {field('height', 'Height', 'in')}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable accessibilityRole="button" onPress={closeWithSave} style={styles.doneButton}>
              <Text style={styles.doneText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 30, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.42)' },
  keyboardView: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    minHeight: '58%',
    maxHeight: '88%',
    backgroundColor: CHAT_COLORS.white,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderCurve: 'continuous',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D4D4D8',
    marginTop: 9,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHAT_COLORS.divider,
  },
  title: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.bold, fontSize: 20, letterSpacing: -0.3 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F4F5',
  },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 18 },
  sectionLabel: {
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.semibold,
    fontSize: 13,
    marginBottom: 9,
  },
  row: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, minWidth: 0 },
  fieldLabel: {
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.medium,
    fontSize: 11.5,
    marginBottom: 6,
  },
  inputShell: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 13,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: '#E1E1E6',
    backgroundColor: '#F7F7F8',
    paddingLeft: 12,
    paddingRight: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    color: CHAT_COLORS.ink,
    fontFamily: CHAT_FONT.semibold,
    fontSize: 16,
  },
  unit: {
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.medium,
    fontSize: 12,
    marginLeft: 4,
  },
  sectionGap: { height: 24 },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CHAT_COLORS.divider,
  },
  doneButton: {
    minHeight: 52,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CHAT_COLORS.brand,
  },
  doneText: { color: '#FFFFFF', fontFamily: CHAT_FONT.bold, fontSize: 16 },
});

export default SizeWeightSheet;
