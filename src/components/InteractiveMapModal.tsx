import React, { useRef, useState, useEffect } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Modal, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert, TextInput, FlatList } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { X, Check, Search, MapPin, Crosshair } from 'lucide-react-native';

interface InteractiveMapModalProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (location: { lat: number; lng: number; name?: string }) => void;
    initialLat?: number;
    initialLng?: number;
}

export default function InteractiveMapModal({ visible, onClose, onSelect, initialLat, initialLng }: InteractiveMapModalProps) {
    const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
    const webViewRef = useRef<WebView>(null);
    const [address, setAddress] = useState<string>('');
    const [loadingLocation, setLoadingLocation] = useState(false);

    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const timeoutRef = useRef<any>(null);

    // Default to US center if nothing else
    const fallbackLat = 37.0902;
    const fallbackLng = -95.7129;

    useEffect(() => {
        if (visible) {
            if (initialLat && initialLng) {
                setCurrentLocation({ lat: initialLat, lng: initialLng });
            } else {
                getLocation();
            }
        }
    }, [visible]);

    const getLocation = async () => {
        setLoadingLocation(true);
        try {
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission to access location was denied');
                setCurrentLocation({ lat: fallbackLat, lng: fallbackLng }); // Fallback
                return;
            }

            let location = await Location.getCurrentPositionAsync({});
            setCurrentLocation({
                lat: location.coords.latitude,
                lng: location.coords.longitude,
            });

            // Update map center if WebView is already loaded
            updateMapCenter(location.coords.latitude, location.coords.longitude);

        } catch (error) {
            console.error("Error getting location:", error);
            setCurrentLocation({ lat: fallbackLat, lng: fallbackLng });
        } finally {
            setLoadingLocation(false);
        }
    };

    const updateMapCenter = (lat: number, lng: number) => {
        webViewRef.current?.injectJavaScript(`
      if (window.updateMap) {
        window.updateMap(${lat}, ${lng});
      }
    `);
    };

    const searchPlaces = async (query: string) => {
        if (query.length < 3) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
            const data = await response.json();
            setSearchResults(data.features || []);
        } catch (e) {
            console.error('Search failed', e);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSearchChange = (text: string) => {
        setSearchQuery(text);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => searchPlaces(text), 500);
    };

    const handleSelectPlace = (feature: any) => {
        const [lng, lat] = feature.geometry.coordinates;
        const name = [feature.properties.name, feature.properties.city, feature.properties.state].filter(Boolean).join(', ');

        setCurrentLocation({ lat, lng });
        setAddress(name);
        updateMapCenter(lat, lng);
        setSearchQuery('');
        setSearchResults([]);
        setIsSearching(false);
    };

    const getCityName = async (lat: number, lng: number) => {
        try {
            const response = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`);
            const data = await response.json();
            if (data && data.features && data.features.length > 0) {
                const p = data.features[0].properties;
                return [p.city, p.state, p.country].filter(Boolean).join(', ');
            }
        } catch (e) {
            console.log('Reverse geocoding failed', e);
        }
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    const handleWebViewMessage = async (event: any) => {
        try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'location_updated') {
                setCurrentLocation({ lat: data.lat, lng: data.lng });
                // Optional: Reverse geocode here to show address in UI
                const name = await getCityName(data.lat, data.lng);
                setAddress(name);
            }
        } catch (e) {
            console.error("Error parsing webview message", e);
        }
    };

    const handleConfirm = async () => {
        if (currentLocation) {
            const name = address || await getCityName(currentLocation.lat, currentLocation.lng);
            onSelect({ ...currentLocation, name });
        }
    };

    // HTML Content for Leaflet Map
    const mapHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
        <style>
          body { margin: 0; padding: 0; }
          #map { width: 100vw; height: 100vh; }
          .center-marker {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -100%);
            z-index: 1000;
            pointer-events: none;
          }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          var map = L.map('map', { zoomControl: false }).setView([${currentLocation?.lat || fallbackLat}, ${currentLocation?.lng || fallbackLng}], 13);
          
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
          }).addTo(map);

          // 1-mile radius circle (approx 1609 meters)
          var circle = L.circle(map.getCenter(), {
            color: BRAND_PRIMARY,
            fillColor: BRAND_PRIMARY,
            fillOpacity: 0.2,
            radius: 1609
          }).addTo(map);

          // Center marker icon (using simple div or default marker at center)
          var marker = L.marker(map.getCenter(), { draggable: true }).addTo(map);
          
          // Sync marker and circle with map dragging
          map.on('move', function() {
            var center = map.getCenter();
            marker.setLatLng(center);
            circle.setLatLng(center);
          });

          map.on('moveend', function() {
            var center = map.getCenter();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'location_updated',
              lat: center.lat,
              lng: center.lng
            }));
          });
          
          // Function to update map from React Native
          window.updateMap = function(lat, lng) {
            var newLatLng = new L.LatLng(lat, lng);
            map.setView(newLatLng, 13);
            marker.setLatLng(newLatLng);
            circle.setLatLng(newLatLng);
          };

        </script>
      </body>
    </html>
  `;

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                        <X size={24} color="#000" />
                    </TouchableOpacity>
                    <Text style={styles.title}>Set Location</Text>
                    <TouchableOpacity onPress={handleConfirm} style={styles.confirmBtn}>
                        <Text style={styles.confirmText}>Done</Text>
                    </TouchableOpacity>
                </View>

                {loadingLocation && (
                    <View style={styles.loaderOverlay}>
                        <ActivityIndicator size="large" color={BRAND_PRIMARY} />
                        <Text style={{ marginTop: 10 }}>Locating you...</Text>
                    </View>
                )}

                {/* Search Bar Overlay */}
                <View style={styles.searchContainer}>
                    <View style={styles.searchBar}>
                        <Search size={20} color="#9CA3AF" />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search city, zip, or address..."
                            value={searchQuery}
                            onChangeText={handleSearchChange}
                            placeholderTextColor="#9CA3AF"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                                <X size={18} color="#9CA3AF" />
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Search Results */}
                    {searchResults.length > 0 && (
                        <View style={styles.resultsContainer}>
                            <FlatList
                                data={searchResults}
                                keyExtractor={(item, index) => index.toString()}
                                keyboardShouldPersistTaps="handled"
                                renderItem={({ item }) => {
                                    const p = item.properties;
                                    const name = [p.name, p.city, p.state, p.country].filter(Boolean).join(', ');
                                    return (
                                        <TouchableOpacity style={styles.resultItem} onPress={() => handleSelectPlace(item)}>
                                            <MapPin size={16} color="#6B7280" style={{ marginTop: 2 }} />
                                            <Text style={styles.resultText}>{name}</Text>
                                        </TouchableOpacity>
                                    );
                                }}
                            />
                        </View>
                    )}
                </View>

                {/* Only render WebView when we have a specialized initial location or after attempted location fetch */}
                <WebView
                    ref={webViewRef}
                    originWhitelist={['*']}
                    source={{ html: mapHtml }}
                    style={{ flex: 1 }}
                    onMessage={handleWebViewMessage}
                />

                <TouchableOpacity
                    style={styles.locateBtn}
                    onPress={getLocation}
                    activeOpacity={0.8}
                >
                    <Crosshair size={24} color="#000" />
                </TouchableOpacity>

                <View style={styles.footer}>
                    <Text style={styles.locationText}>{address || "Drag map to select location..."}</Text>
                    <Text style={styles.hintText}>1-mile radius shown</Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fff' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#eee',
    },
    title: { fontSize: 17, fontWeight: '600' },
    closeBtn: { padding: 4 },
    confirmBtn: { padding: 4 },
    confirmText: { color: BRAND_PRIMARY, fontSize: 17, fontWeight: '600' },
    loaderOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(255,255,255,0.9)',
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center'
    },
    footer: {
        padding: 20,
        backgroundColor: '#fff',
        borderTopWidth: 1,
        borderTopColor: '#eee',
        alignItems: 'center'
    },
    locationText: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
        textAlign: 'center'
    },
    hintText: {
        fontSize: 12,
        color: '#666'
    },
    searchContainer: {
        position: 'absolute',
        top: 70, // Below header
        left: 16,
        right: 16,
        zIndex: 20,
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
        gap: 10
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        color: '#000'
    },
    resultsContainer: {
        marginTop: 8,
        backgroundColor: '#fff',
        borderRadius: 12,
        paddingVertical: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
        maxHeight: 200
    },
    resultItem: {
        flexDirection: 'row',
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#F3F4F6'
    },
    resultText: {
        fontSize: 14,
        color: '#374151',
        flex: 1
    },
    locateBtn: {
        position: 'absolute',
        bottom: 100, // Above footer
        right: 16,
        backgroundColor: '#fff',
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 8,
        elevation: 5,
        zIndex: 10
    }
});
