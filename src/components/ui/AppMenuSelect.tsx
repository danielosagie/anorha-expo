import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, StyleProp, ViewStyle, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppMenu } from './AppMenu';

export type AppSelectOption = { label: string; value: string };

interface Props {
  value?: string | null;
  options: AppSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Style override for the trigger field. */
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Fixed menu width; defaults to the measured field width (min 200). */
  menuWidth?: number;
}

/**
 * Select field that opens the shared AppMenu popover — the SAME dropdown used to
 * switch pages in the inventory header — so every dropdown in the app looks and
 * animates identically. Measures its own anchor so the menu springs in directly
 * beneath the field.
 */
export const AppMenuSelect: React.FC<Props> = ({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  style,
  disabled,
  menuWidth,
}) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const [width, setWidth] = useState(menuWidth ?? 260);
  const ref = useRef<View>(null);
  const current = options.find((o) => o.value === value);

  const openMenu = () => {
    if (disabled) return;
    ref.current?.measureInWindow((x, y, w, h) => {
      const screenH = Dimensions.get('window').height;
      // Estimate menu height (rows ~50px + card padding) to flip above the field
      // when opening below would run off the bottom of the screen.
      const estHeight = Math.min(options.length, 6) * 50 + 16;
      const below = y + h + 6;
      const overflows = below + estHeight > screenH - 24;
      setAnchor({ top: overflows ? Math.max(24, y - estHeight - 6) : below, left: x });
      setWidth(menuWidth ?? Math.max(w, 200));
      setOpen(true);
    });
  };

  return (
    <>
      <Pressable
        ref={ref}
        onPress={openMenu}
        disabled={disabled}
        style={[styles.field, disabled && styles.disabled, style]}
      >
        <Text style={[styles.value, !current && styles.placeholder]} numberOfLines={1}>
          {current?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={20} color="#6B7280" />
      </Pressable>
      <AppMenu
        visible={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        width={width}
        sections={[
          options.map((o) => ({
            key: o.value,
            label: o.label,
            active: o.value === value,
            onPress: () => {
              onChange(o.value);
              setOpen(false);
            },
          })),
        ]}
      />
    </>
  );
};

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  disabled: { backgroundColor: '#F3F4F6' },
  value: { flex: 1, fontSize: 15, color: '#111827', marginRight: 8 },
  placeholder: { color: '#9CA3AF' },
});

export default AppMenuSelect;
