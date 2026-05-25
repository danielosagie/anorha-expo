import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShopifySvg from '../../assets/shopify.svg';
import AmazonSvg from '../../assets/amazon.svg';
import FacebookSvg from '../../assets/facebook.svg';
import EbaySvg from '../../assets/ebay.svg';
import CloverSvg from '../../assets/clover.svg';
import SquareSvg from '../../assets/square.svg';
import { styles } from './styles';

// Logo map for platform types
const platformLogoMap: Record<string, any> = {
  shopify: ShopifySvg,
  amazon: AmazonSvg,
  facebook: FacebookSvg,
  ebay: EbaySvg,
  clover: CloverSvg,
  square: SquareSvg
};

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
  const selected = locations.find(l => l.id === selectedId) || locations[0];
  const Logo = selected ? platformLogoMap[selected.platformType] : null;

  console.log(`[LocationDropdown RENDER] selectedId=${selectedId}, selected=${selected?.name}, locCount=${locations.length}, hasLogo=${!!Logo}, items=${locations.map(l => l.name).join(', ')}`);

  return (
    <View style={{ position: 'relative', zIndex: open ? 1000 : 1, minWidth: 160 }}>
      <TouchableOpacity
        style={[styles.dropdown, { minWidth: 150, maxWidth: 200 }]}
        onPress={() => setOpen(o => !o)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {Logo && <Logo width={16} height={16} />}
          <Text style={{ color: '#000', fontSize: 13, flexShrink: 1 }} numberOfLines={1} ellipsizeMode="tail">
            {selected?.name || 'Select Location'}
          </Text>
        </View>
        <Icon name="chevron-down" size={18} color="#000" style={{ marginLeft: 4 }} />
      </TouchableOpacity>
      {open && (
        <View style={[styles.dropdownMenu, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, marginTop: 0, maxHeight: 200 }]}>
          <ScrollView nestedScrollEnabled>
            {locations.map(loc => {
              const LocLogo = platformLogoMap[loc.platformType];
              return (
                <TouchableOpacity
                  key={loc.id}
                  style={[styles.dropdownItem, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
                  onPress={() => { onChange(loc.id); setOpen(false); }}
                >
                  {LocLogo && <LocLogo width={16} height={16} />}
                  <Text style={{ color: '#000', flex: 1 }} numberOfLines={1}>{loc.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
