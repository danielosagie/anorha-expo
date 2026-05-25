import React, { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { styles } from './styles';

export const ModernInput = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  icon,
  rightRight, // Element to render on right
  disabled
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: any;
  icon?: any;
  rightRight?: React.ReactNode;
  disabled?: boolean;
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const IconComp = icon;

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={[
        styles.fieldLabel,
        isFocused && { color: '#93C822' } // Brand color on focus
      ]}>
        {label}
      </Text>
      <View style={[
        styles.modernInputWrapper,
        isFocused && styles.modernInputFocused,
        disabled && styles.modernInputDisabled,
        multiline && { height: 'auto', minHeight: 100 }
      ]}>
        {IconComp && (
          <View style={{ marginRight: 10 }}>
            <IconComp size={18} color={isFocused ? '#93C822' : '#9CA3AF'} />
          </View>
        )}
        <TextInput
          style={[styles.modernTextInput, multiline && { height: 100, textAlignVertical: 'top', paddingTop: 8 }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#9CA3AF"
          multiline={multiline}
          keyboardType={keyboardType}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={!disabled}
        />
        {rightRight}
      </View>
    </View>
  );
};
