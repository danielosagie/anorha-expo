import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { styles } from './styles';

/**
 * ChipsField — tag input. Used both inline (label shown) and inside a FieldSheet
 * (pass `hideLabel` so the sheet's own title is the only heading — no double title).
 */
export function ChipsField({ label, valueArray, onChangeArray, onInfo, refilled, hideLabel }: { label: string; valueArray?: string[]; onChangeArray: (arr: string[]) => void; onInfo?: () => void; refilled?: boolean; hideLabel?: boolean }) {
  const [text, setText] = useState('');
  const arr = Array.isArray(valueArray) ? valueArray : [];

  const addTag = () => {
    const t = text.trim();
    if (!t) return;
    // Skip duplicates (case-insensitive) so the list stays clean.
    if (!arr.some((x) => x.toLowerCase() === t.toLowerCase())) onChangeArray([...arr, t]);
    setText('');
  };

  return (
    <View style={{ marginBottom: 12 }}>
      {!hideLabel && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.fieldLabel}>{label}</Text>
            {refilled ? (
              <View style={{ backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ color: '#3f6212', fontSize: 10 }}>Refilled</Text>
              </View>
            ) : null}
          </View>
          {!!onInfo && (
            <TouchableOpacity onPress={onInfo}><Icon name="information-outline" size={18} color="#9CA3AF" /></TouchableOpacity>
          )}
        </View>
      )}

      {/* Input + Add — both 52px tall so the line is properly aligned. */}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
        <TextInput
          style={{ flex: 1, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, minHeight: 52, fontSize: 15, color: '#111827' }}
          value={text}
          onChangeText={setText}
          placeholder="Add a tag"
          placeholderTextColor="#9CA3AF"
          returnKeyType="done"
          onSubmitEditing={addTag}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 52, paddingHorizontal: 16, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12 }}
          onPress={addTag}
        >
          <Icon name="plus" size={16} color="#111827" />
          <Text style={{ color: '#111827', marginLeft: 6, fontWeight: '600' }}>Add</Text>
        </TouchableOpacity>
      </View>

      {/* Chips wrap onto aligned rows; tag text leads, × trails. */}
      {arr.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {arr.map((t, i) => (
            <View key={`${t}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F3F4F6', borderRadius: 999, paddingVertical: 7, paddingLeft: 12, paddingRight: 8 }}>
              <Text style={{ color: '#3F3F46', fontSize: 13, fontWeight: '500' }}>{t}</Text>
              <TouchableOpacity onPress={() => onChangeArray(arr.filter((_, idx) => idx !== i))} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}>
                <Icon name="close" size={13} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
