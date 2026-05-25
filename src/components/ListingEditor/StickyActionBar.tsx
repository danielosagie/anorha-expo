import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/* Sticky Bottom Action Bar Component */
export const StickyActionBar = ({ onSave, onPublish }: { onSave?: () => void, onPublish?: () => void }) => {
  return (
    <View style={{
      position: 'absolute',
      bottom: 20,
      left: 16,
      right: 16,
      backgroundColor: '#fff',
      borderRadius: 100,
      padding: 8,
      paddingHorizontal: 12,
      flexDirection: 'row',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 8,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <TouchableOpacity onPress={onSave} style={{ padding: 10 }}>
        <Text style={{ fontWeight: '600', color: '#4B5563' }}>Save Draft</Text>
      </TouchableOpacity>
      <View style={{ height: 20, width: 1, backgroundColor: '#E5E7EB' }} />
      <TouchableOpacity onPress={onPublish} style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontWeight: '700', color: '#93C822' }}>Publish Now</Text>
        <Icon name="arrow-right" size={16} color="#93C822" />
      </TouchableOpacity>
    </View>
  )
}
