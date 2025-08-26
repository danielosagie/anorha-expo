import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, Image, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';

type Props = StackScreenProps<AppStackParamList, 'PhotoUpload'>;

export default function PhotoUploadScreen({ route, navigation }: Props) {
  const { onDone } = route.params;
  const [uris, setUris] = React.useState<string[]>([]);

  const pickImages = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera roll permissions to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.9,
    });
    if (!result.canceled) {
      const assets = (result as any).assets || [];
      const next = assets.map((a:any)=>a.uri).filter(Boolean);
      setUris(prev => [...prev, ...next]);
    }
  }, []);

  const done = useCallback(() => {
    try { onDone(uris); } catch {}
    navigation.goBack();
  }, [uris, onDone, navigation]);

  return (
    <View style={styles.container}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Icon name="chevron-left" size={24} color="#000" /></TouchableOpacity>
        <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>Add Photos</Text>
        <View style={{ width: 24 }} />
      </View>
      <TouchableOpacity style={styles.pickBtn} onPress={pickImages}>
        <Icon name="image-plus" size={18} color="#000" />
        <Text style={{ color: '#000', marginLeft: 6 }}>Pick from library</Text>
      </TouchableOpacity>
      <FlatList
        data={uris}
        keyExtractor={(u, i)=>`${u}-${i}`}
        horizontal
        style={{ marginTop: 12 }}
        renderItem={({ item }) => (
          <View style={styles.thumbWrap}><Image source={{ uri: item }} style={{ width: '100%', height: '100%' }} /></View>
        )}
      />
      <TouchableOpacity disabled={uris.length === 0} style={[styles.doneBtn, uris.length === 0 && { opacity: 0.6 }]} onPress={done}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  pickBtn: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  thumbWrap: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden', marginRight: 8, borderWidth: 1, borderColor: '#E5E5E5' },
  doneBtn: { position: 'absolute', left: 16, right: 16, bottom: 24, backgroundColor: '#93C822', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});




