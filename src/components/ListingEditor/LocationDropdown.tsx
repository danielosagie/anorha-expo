import React, { useRef, useState } from 'react';
import { Dimensions, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformLogo from '../PlatformLogo';
import { styles } from './styles';
import { AppMenu } from '../ui/AppMenu';

// Enhanced dropdown with platform logos for locations
export function LocationDropdown({
  locations,
  selectedId,
  onChange
}: {
  locations: Array<{ id: string; name: string; platformType: string }>;
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 16, width: 220 });
  const selected = locations.find(l => l.id === selectedId) || locations[0];
  const menuWidth = Math.min(280, Math.max(220, anchor.width));

  const openMenu = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const nextWidth = Math.min(280, Math.max(220, width));
      const windowWidth = Dimensions.get('window').width;
      setAnchor({
        top: y + height + 6,
        left: Math.max(12, Math.min(x, windowWidth - nextWidth - 12)),
        width: nextWidth,
      });
      setOpen(true);
    });
  };

  return (
    <View ref={triggerRef} style={{ position: 'relative', zIndex: open ? 1000 : 1, minWidth: 160 }}>
      <TouchableOpacity
        style={[styles.dropdown, { minWidth: 150, maxWidth: 200 }]}
        onPress={() => {
          if (open) {
            setOpen(false);
            return;
          }
          openMenu();
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {selected && <PlatformLogo type={selected.platformType} size={16} />}
          <Text style={{ color: '#000', fontSize: 13, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
            {selected?.name || 'Select Location'}
          </Text>
        </View>
        <Icon name="chevron-down" size={18} color="#000" style={{ marginLeft: 4 }} />
      </TouchableOpacity>
      <AppMenu
        visible={open}
        onClose={() => setOpen(false)}
        anchor={{ top: anchor.top, left: anchor.left }}
        width={menuWidth}
        sections={[
          locations.map(loc => ({
            key: loc.id,
            label: loc.name,
            icon: 'map-marker-outline',
            active: loc.id === selectedId,
            onPress: () => {
              onChange(loc.id);
              setOpen(false);
            },
          })),
        ]}
      />
    </View>
  );
}
