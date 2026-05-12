import React, { useCallback, useMemo, useRef } from 'react';
import { View, TextInput, StyleSheet, TouchableOpacity, Platform, AccessibilityRole } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { tokens } from '../../design/tokens';

type Props = {
  value: string;
  placeholder?: string;
  onChangeText: (val: string) => void;
  onClear?: () => void;
};

const SearchBar: React.FC<Props> = ({ value, onChangeText, onClear, placeholder }) => {
  const inputRef = useRef<TextInput>(null);

  const showClear = useMemo(() => value.length > 0, [value]);

  const handleClear = useCallback(() => {
    onChangeText('');
    onClear && onClear();
    inputRef.current?.focus();
  }, [onClear, onChangeText]);

  return (
    <View style={styles.wrapper} accessibilityRole={"search" as AccessibilityRole}>
      <Icon name="magnify" size={20} color="#9CA3AF" style={styles.icon} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || 'Search products'}
        placeholderTextColor="#9CA3AF"
        style={styles.input}
        returnKeyType="search"
        accessibilityLabel="Search products"
      />
      {showClear && (
        <TouchableOpacity onPress={handleClear} style={styles.clearBtn} accessibilityLabel="Clear search">
          <Icon name="close-circle" size={18} color="#9CA3AF" />
        </TouchableOpacity>
      )}
    </View>
  );
};

export default React.memo(SearchBar);

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: tokens.spacing.lg,
    marginTop: tokens.spacing.md,
    marginBottom: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: tokens.radii.md,
    backgroundColor: 'white',
    ...tokens.elevation(0),
  },
  icon: {
    marginRight: tokens.spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: tokens.fontSizes.md,
    color: '#111827',
  },
  clearBtn: {
    padding: tokens.spacing.xs,
  },
});


