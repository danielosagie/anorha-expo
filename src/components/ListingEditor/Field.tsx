import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Sparkles } from 'lucide-react-native';
import { styles } from './styles';

export function Field({ label, value, onChangeText, multiline, keyboardType, onInfo, required, onRegenerate, refilled, error, externalUpdate }: { label: string; value?: string; onChangeText?: (t: string) => void; multiline?: boolean; keyboardType?: any; onInfo?: () => void; required?: boolean; onRegenerate?: () => void; refilled?: boolean; error?: boolean; externalUpdate?: boolean }) {
  // Use local state with uncontrolled input to prevent re-render issues
  const [localValue, setLocalValue] = useState(value ?? '');
  const timeoutRef = React.useRef<any>(null);


  const externalUpdateStyle = externalUpdate ? {
    borderColor: '#93C822', // iOS green
    borderWidth: 2,
  } : null;

  // Sync from parent when value changes externally (but not from our own typing)
  useEffect(() => {
    if (value !== localValue && value !== undefined) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (text: string) => {
    setLocalValue(text);

    // Debounce the callback to parent
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChangeText?.(text);
    }, 300);
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 0 }}>
          <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#ef4444' }}> *</Text> : null}</Text>
          {externalUpdate ? (
            <View style={{ backgroundColor: 'rgba(52,199,89,0.15)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#059669', fontSize: 10, fontWeight: '600' }}>Updated</Text>
            </View>
          ) : refilled ? (
            <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
            </View>
          ) : null}
          {!!onRegenerate && (
            <TouchableOpacity onPress={onRegenerate} style={{ borderWidth: 1, borderColor: '#E5E5E5', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: '#fff' }}>
              <Sparkles size={14} color={'#000'} />
            </TouchableOpacity>
          )}
        </View>
        {!!onInfo && (
          <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#999999" /></TouchableOpacity>
        )}
      </View>
      <TextInput
        style={[
          styles.input,
          multiline && { minHeight: 100, textAlignVertical: 'top' },
          error ? { borderColor: '#ef4444' } : null,
          externalUpdateStyle, // 🟢 Green border for external updates (overrides error if both present)
        ]}
        value={localValue}
        onChangeText={handleChange}
        placeholder=''
        placeholderTextColor={"#999999"}
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}
