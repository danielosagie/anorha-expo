import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Sparkles, Globe } from 'lucide-react-native';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

/**
 * SheetTextField — the text editor used inside a FieldSheet (Title, Description,
 * SKU, Brand, Barcode…). Preserves the 300ms debounce + external-update border of
 * the inline `Field` it replaces, but adopts the focused-green big-field look,
 * AI chips, char count, and scope line from the field-edit sheet idiom (design.md §3).
 */
export interface SheetTextFieldProps {
  value?: string;
  onChangeText: (t: string) => void;
  multiline?: boolean;
  keyboardType?: any;
  placeholder?: string;
  autoFocus?: boolean;
  /** Helper line under the field, e.g. "Reads well on eBay & Shopify". */
  helper?: string;
  maxLength?: number;
  showCount?: boolean;
  /** AI rewrite — maps to the existing per-field regenerate. Renders the chip row when provided. */
  onRewrite?: () => void;
  /** Scope line, e.g. "Changes everywhere" or "Only eBay". */
  scope?: string;
  externalUpdate?: boolean;
}

export default function SheetTextField({
  value,
  onChangeText,
  multiline = false,
  keyboardType,
  placeholder,
  autoFocus = false,
  helper,
  maxLength,
  showCount = false,
  onRewrite,
  scope,
  externalUpdate = false,
}: SheetTextFieldProps) {
  const [local, setLocal] = useState(value ?? '');
  const [focused, setFocused] = useState(false);
  const timeoutRef = useRef<any>(null);

  // Only adopt an external value (AI refill, realtime sync) when the user is NOT
  // actively editing — i.e. unfocused and no debounce pending. Without this guard a
  // value arriving mid-type (e.g. a finishing regenerate job) yanks the cursor to
  // the end and discards characters typed since the last commit.
  useEffect(() => {
    if (!focused && timeoutRef.current == null && value !== undefined && value !== local) {
      setLocal(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const handleChange = (text: string) => {
    setLocal(text);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onChangeText(text);
    }, 300);
  };

  return (
    <View>
      <TextInput
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          focused && styles.inputFocused,
          externalUpdate && styles.inputExternal,
        ]}
        value={local}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={CHAT_COLORS.faint}
        autoFocus={autoFocus}
        maxLength={maxLength}
      />

      {(helper || (showCount && maxLength)) && (
        <View style={styles.metaRow}>
          {!!helper && <Text style={styles.helper}>{helper}</Text>}
          {showCount && maxLength ? (
            <Text style={styles.count}>
              {local.length} / {maxLength}
            </Text>
          ) : null}
        </View>
      )}

      {!!onRewrite && (
        <View style={styles.chipRow}>
          <TouchableOpacity style={[styles.chip, styles.chipFilled]} onPress={onRewrite} activeOpacity={0.85}>
            <Sparkles size={13} color={CHAT_COLORS.brandDeep} />
            <Text style={[styles.chipText, styles.chipTextFilled]}>Rewrite</Text>
          </TouchableOpacity>
        </View>
      )}

      {!!scope && (
        <View style={styles.scopeRow}>
          <Globe size={13} color={CHAT_COLORS.dim} />
          <Text style={styles.scopeText}>{scope}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: CHAT_FONT.medium,
    color: CHAT_COLORS.ink,
    backgroundColor: CHAT_COLORS.white,
  },
  inputMultiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inputFocused: {
    borderColor: CHAT_COLORS.brand,
    borderWidth: 1.5,
  },
  inputExternal: {
    borderColor: CHAT_COLORS.brand,
    borderWidth: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  helper: {
    fontSize: 12,
    fontFamily: CHAT_FONT.regular,
    color: CHAT_COLORS.dim,
    flex: 1,
  },
  count: {
    fontSize: 12,
    fontFamily: CHAT_FONT.medium,
    color: CHAT_COLORS.faint,
    marginLeft: 8,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    backgroundColor: CHAT_COLORS.white,
  },
  chipFilled: {
    backgroundColor: CHAT_COLORS.brandSoft,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 13,
    fontFamily: CHAT_FONT.semibold,
    color: CHAT_COLORS.inkSoft,
  },
  chipTextFilled: {
    color: CHAT_COLORS.brandDeep,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  scopeText: {
    fontSize: 13,
    fontFamily: CHAT_FONT.medium,
    color: CHAT_COLORS.dim,
  },
});
