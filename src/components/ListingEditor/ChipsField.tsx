import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Sparkles } from 'lucide-react-native';
import { styles } from './styles';

export function ChipsField({ label, valueArray, onChangeArray, onInfo, onRegenerate, refilled }: { label: string; valueArray?: string[]; onChangeArray: (arr: string[]) => void; onInfo?: () => void; onRegenerate?: () => void; refilled?: boolean }) {
  const [text, setText] = useState('');
  const arr = Array.isArray(valueArray) ? valueArray : [];
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, }}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {refilled ? (
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

      <View style={{ flexDirection: 'row', gap: 10, }}>
        <TextInput style={{ flex: 1, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' }} value={text} onChangeText={setText} placeholder="Add tag and press + Add" placeholderTextColor={"#999999"} />
        <TouchableOpacity style={styles.addTagBtn} onPress={() => { if (text.trim().length) { onChangeArray([...arr, text.trim()]); setText(''); } }}>
          <Icon name="plus" size={16} color="#000" /><Text style={{ color: '#000', marginLeft: 6 }}>Add</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 }}>
        {arr.map((t, i) => (
          <View key={`${t}-${i}`} style={[styles.tagChip, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            <TouchableOpacity onPress={() => onChangeArray(arr.filter((_, idx) => idx !== i))}>
              <Icon name="close" size={10} color="#6B7280" />
            </TouchableOpacity>
            {/* Small platform logo placeholder space for tags (if needed in future) */}
            <Text style={{ color: '#000' }}>{t}</Text>
          </View>
        ))}
      </View>

    </View>
  );
}
