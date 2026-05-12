import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

interface SearchPill {
  id: string;
  type: 'url' | 'site' | 'query';
  label: string;
  value: string;
  status: 'pending' | 'searching' | 'complete' | 'error';
  results?: SearchResult[];
}

interface SearchResult {
  type: 'product_match' | 'existing_inventory' | 'web_data';
  confidence: number;
  data: any;
  source: string;
  title: string;
  price?: number;
  image?: string;
}

interface EnhancedSearchInterfaceProps {
  onResultSelected: (result: SearchResult) => void;
  onStartOver: () => void;
  businessTemplate?: string;
}

export const EnhancedSearchInterface: React.FC<EnhancedSearchInterfaceProps> = ({
  onResultSelected,
  onStartOver,
  businessTemplate
}) => {
  const [searchValue, setSearchValue] = useState('');
  const [pills, setPills] = useState<SearchPill[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const detectInputType = (input: string): 'url' | 'barcode' | 'query' => {
    if (input.match(/^https?:\/\//)) return 'url';
    if (input.match(/^\d{8,14}$/)) return 'barcode';
    return 'query';
  };

  const addSearchPill = (value: string, type: 'url' | 'site' | 'query') => {
    const newPill: SearchPill = {
      id: Date.now().toString(),
      type,
      label: type === 'url' ? new URL(value).hostname : value,
      value,
      status: 'pending',
    };
    setPills(prev => [...prev, newPill]);
    executeSearch(newPill);
  };

  const executeSearch = async (pill: SearchPill) => {
    setPills(prev => prev.map(p => 
      p.id === pill.id ? { ...p, status: 'searching' } : p
    ));
    setIsSearching(true);

    try {
      let searchResults: SearchResult[] = [];

      switch (pill.type) {
        case 'url':
          searchResults = await searchByUrl(pill.value);
          break;
        case 'query':
          searchResults = await searchByQuery(pill.value);
          break;
        default:
          searchResults = await searchByQuery(pill.value);
      }

      setPills(prev => prev.map(p => 
        p.id === pill.id ? { ...p, status: 'complete', results: searchResults } : p
      ));
      setResults(prev => [...prev, ...searchResults]);
    } catch (error) {
      setPills(prev => prev.map(p => 
        p.id === pill.id ? { ...p, status: 'error' } : p
      ));
      Alert.alert('Search Error', 'Failed to search. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const searchByUrl = async (url: string): Promise<SearchResult[]> => {
    // Call firecrawl extract API
    const response = await fetch('/api/firecrawl/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls: [url],
        schema: getSchemaForTemplate(businessTemplate),
      }),
    });
    
    const data = await response.json();
    return [{
      type: 'web_data',
      confidence: 0.9,
      data: data[0],
      source: url,
      title: data[0]?.title || 'Extracted Product',
      price: data[0]?.price,
      image: data[0]?.image,
    }];
  };

  const searchByQuery = async (query: string): Promise<SearchResult[]> => {
    // First check existing inventory
    const inventoryResults = await searchInventory(query);
    
    // Then do web search
    const webResults = await searchWeb(query);
    
    return [...inventoryResults, ...webResults];
  };

  const searchInventory = async (query: string): Promise<SearchResult[]> => {
    // Mock - replace with actual inventory search
    return [];
  };

  const searchWeb = async (query: string): Promise<SearchResult[]> => {
    // Call firecrawl search API
    const response = await fetch('/api/firecrawl/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        limit: 5,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
        },
      }),
    });
    
    const data = await response.json();
    return data.results?.map((result: any, index: number) => ({
      type: 'web_data' as const,
      confidence: 0.8 - (index * 0.1),
      data: result,
      source: result.url,
      title: result.title,
      image: result.image,
    })) || [];
  };

  const getSchemaForTemplate = (template?: string) => {
    // Return schema based on business template
    if (template === 'comic-book') {
      return {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
          condition: { type: 'string' },
          grade: { type: 'string' },
          publisher: { type: 'string' },
          issue_number: { type: 'string' },
          creators: { type: 'array', items: { type: 'string' } },
        },
      };
    }
    
    // Default product schema
    return {
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'number' },
        description: { type: 'string' },
        brand: { type: 'string' },
        sku: { type: 'string' },
      },
    };
  };

  const handleInputSubmit = () => {
    if (!searchValue.trim()) return;
    
    const type = detectInputType(searchValue);
    addSearchPill(searchValue, type);
    setSearchValue('');
  };

  const handleImagePick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      setSelectedImage(result.assets[0].uri);
      // Start visual search
      await searchByImage(result.assets[0].uri);
    }
  };

  const searchByImage = async (imageUri: string) => {
    setIsSearching(true);
    try {
      // Call your existing image analysis API
      const formData = new FormData();
      formData.append('image', {
        uri: imageUri,
        type: 'image/jpeg',
        name: 'search.jpg',
      } as any);

      const response = await fetch('/api/products/analyze', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      
      if (data.visual_matches?.length) {
        const imageResults: SearchResult[] = data.visual_matches.map((match: any) => ({
          type: 'product_match',
          confidence: match.confidence || 0.7,
          data: match,
          source: match.source || 'Visual Search',
          title: match.title,
          price: match.price?.extracted_value,
          image: match.thumbnail,
        }));
        
        setResults(prev => [...prev, ...imageResults]);
      } else {
        Alert.alert('No Matches', 'No visual matches found. Try a text search instead.');
      }
    } catch (error) {
      Alert.alert('Search Error', 'Failed to analyze image. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const removePill = (pillId: string) => {
    setPills(prev => prev.filter(p => p.id !== pillId));
    // Optionally remove associated results
  };

  const renderPill = (pill: SearchPill) => (
    <View key={pill.id} style={[styles.pill, getPillStyle(pill.status)]}>
      <Text style={styles.pillText}>{pill.label}</Text>
      {pill.status === 'searching' && (
        <ActivityIndicator size="small" color="#666" style={{ marginLeft: 4 }} />
      )}
      <TouchableOpacity
        onPress={() => removePill(pill.id)}
        style={styles.pillRemove}
      >
        <MaterialIcons name="close" size={16} color="#666" />
      </TouchableOpacity>
    </View>
  );

  const getPillStyle = (status: SearchPill['status']) => {
    switch (status) {
      case 'searching':
        return { backgroundColor: '#FFF3E0' };
      case 'complete':
        return { backgroundColor: '#E8F5E8' };
      case 'error':
        return { backgroundColor: '#FFEBEE' };
      default:
        return {};
    }
  };

  const renderResult = (result: SearchResult, index: number) => (
    <TouchableOpacity
      key={index}
      style={styles.resultCard}
      onPress={() => onResultSelected(result)}
    >
      {result.image && (
        <Image source={{ uri: result.image }} style={styles.resultImage} />
      )}
      <View style={styles.resultContent}>
        <Text style={styles.resultTitle}>{result.title}</Text>
        <Text style={styles.resultSource}>{result.source}</Text>
        {result.price && (
          <Text style={styles.resultPrice}>${result.price}</Text>
        )}
        <View style={styles.confidenceBadge}>
          <Text style={styles.confidenceText}>
            {Math.round(result.confidence * 100)}% match
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Find Your Product</Text>
        <Text style={styles.subtitle}>
          Search by text, image, URL, or barcode
        </Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={searchValue}
          onChangeText={setSearchValue}
          placeholder="Search products, paste URL, or enter barcode..."
          multiline
          onSubmitEditing={handleInputSubmit}
          returnKeyType="search"
        />
        <View style={styles.searchActions}>
          <TouchableOpacity onPress={handleImagePick} style={styles.actionButton}>
            <MaterialIcons name="photo-camera" size={24} color="#007AFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleInputSubmit} style={styles.actionButton}>
            <MaterialIcons name="search" size={24} color="#007AFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Pills */}
      {pills.length > 0 && (
        <ScrollView horizontal style={styles.pillContainer} showsHorizontalScrollIndicator={false}>
          {pills.map(renderPill)}
        </ScrollView>
      )}

      {/* Selected Image */}
      {selectedImage && (
        <View style={styles.selectedImageContainer}>
          <Image source={{ uri: selectedImage }} style={styles.selectedImage} />
          <TouchableOpacity
            onPress={() => setSelectedImage(null)}
            style={styles.removeImageButton}
          >
            <MaterialIcons name="close" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Loading State */}
      {isSearching && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      )}

      {/* Results */}
      <ScrollView style={styles.resultsContainer}>
        {results.map(renderResult)}
        
        {results.length === 0 && !isSearching && (
          <View style={styles.emptyState}>
            <MaterialIcons name="search" size={48} color="#CCC" />
            <Text style={styles.emptyText}>
              Start by typing a product name, pasting a URL, or taking a photo
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.actionBar}>
        <TouchableOpacity onPress={onStartOver} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Start Over</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          onPress={() => {/* Navigate to manual entry */}} 
          style={styles.primaryButton}
        >
          <Text style={styles.primaryButtonText}>Manual Entry</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    padding: 20,
    paddingTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1A1A1A',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginTop: 4,
  },
  searchContainer: {
    margin: 20,
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E1E1E1',
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  searchInput: {
    flex: 1,
    padding: 16,
    fontSize: 16,
    maxHeight: 120,
  },
  searchActions: {
    flexDirection: 'row',
    padding: 8,
  },
  actionButton: {
    padding: 8,
    marginLeft: 4,
  },
  pillContainer: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
  },
  pillText: {
    fontSize: 14,
    color: '#333',
  },
  pillRemove: {
    marginLeft: 4,
  },
  selectedImageContainer: {
    margin: 20,
    position: 'relative',
  },
  selectedImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
  resultsContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  resultCard: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E1E1E1',
  },
  resultImage: {
    width: '100%',
    height: 150,
  },
  resultContent: {
    padding: 16,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  resultSource: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  resultPrice: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 8,
  },
  confidenceBadge: {
    backgroundColor: '#E8F5E8',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  confidenceText: {
    fontSize: 12,
    color: '#2E7D2E',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    color: '#999',
    marginTop: 12,
    lineHeight: 24,
  },
  actionBar: {
    flexDirection: 'row',
    padding: 20,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E1E1E1',
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginLeft: 8,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    backgroundColor: '#F0F0F0',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginRight: 8,
  },
  secondaryButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
}); 