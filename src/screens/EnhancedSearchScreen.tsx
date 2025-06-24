import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

interface SearchTemplate {
  id: string;
  name: string;
  category: string;
  description?: string;
  searchPrompt: string;
  suggestedSites: string[];
  extractionSchema: Record<string, string>;
  searchKeywords: string[];
  isDefault: boolean;
  isPublic: boolean;
  usageCount: number;
}

interface SearchPill {
  id: string;
  type: 'url' | 'site' | 'query' | 'image' | 'barcode';
  label: string;
  value: string;
  status: 'pending' | 'searching' | 'complete' | 'error';
  results?: any[];
}

interface SearchResult {
  type: 'product_match' | 'existing_inventory' | 'web_data';
  confidence: number;
  data: any;
  source: string;
  title: string;
  price?: number;
  image?: string;
  existingProductId?: string;
  existingVariantId?: string;
}

export default function EnhancedSearchScreen({ navigation, route }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<SearchTemplate | null>(null);
  const [templates, setTemplates] = useState<SearchTemplate[]>([]);
  const [searchPills, setSearchPills] = useState<SearchPill[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCreateTemplateModal, setShowCreateTemplateModal] = useState(false);
  const [isTemplateRequired, setIsTemplateRequired] = useState(true);

  // New template creation state
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: '',
    description: '',
    searchPrompt: '',
    suggestedSites: [''],
    searchKeywords: ['']
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('SearchTemplates')
        .select('*')
        .or(`UserId.eq.${user.id},IsPublic.eq.true`)
        .order('IsDefault', { ascending: false })
        .order('UsageCount', { ascending: false });

      if (error) {
        console.error('Error loading templates:', error);
        return;
      }

      const formattedTemplates: SearchTemplate[] = data?.map(template => ({
        id: template.Id,
        name: template.Name,
        category: template.Category,
        description: template.Description,
        searchPrompt: template.SearchPrompt,
        suggestedSites: template.SuggestedSites || [],
        extractionSchema: template.ExtractionSchema || {},
        searchKeywords: template.SearchKeywords || [],
        isDefault: template.IsDefault,
        isPublic: template.IsPublic,
        usageCount: template.UsageCount
      })) || [];

      setTemplates(formattedTemplates);
      
      // Auto-select general products template if available
      const generalTemplate = formattedTemplates.find(t => t.name === 'General Products');
      if (generalTemplate && !selectedTemplate) {
        setSelectedTemplate(generalTemplate);
      }
    } catch (error) {
      console.error('Error in loadTemplates:', error);
    }
  };

  const detectSearchType = (input: string): string => {
    if (input.startsWith('http://') || input.startsWith('https://')) return 'url';
    if (/^\d{8,14}$/.test(input.replace(/\s/g, ''))) return 'barcode';
    if (input.includes('.com') || input.includes('.org')) return 'site';
    return 'text';
  };

  const addSearchPill = (input: string, type?: string) => {
    const detectedType = type || detectSearchType(input);
    const pill: SearchPill = {
      id: Date.now().toString(),
      type: detectedType as any,
      label: detectedType === 'url' ? new URL(input).hostname : input,
      value: input,
      status: 'pending'
    };

    setSearchPills(prev => [...prev, pill]);
    setSearchQuery('');
  };

  const removePill = (pillId: string) => {
    setSearchPills(prev => prev.filter(p => p.id !== pillId));
  };

  const handleImagePicker = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const pill: SearchPill = {
        id: Date.now().toString(),
        type: 'image',
        label: 'Image Search',
        value: result.assets[0].uri,
        status: 'pending'
      };
      setSearchPills(prev => [...prev, pill]);
    }
  };

  const performSearch = async () => {
    if (!selectedTemplate && isTemplateRequired) {
      Alert.alert('Template Required', 'Please select a template before searching.');
      return;
    }

    if (searchPills.length === 0 && !searchQuery.trim()) {
      Alert.alert('Search Required', 'Please add search terms, URLs, or images.');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      // Add current query as pill if exists
      if (searchQuery.trim()) {
        addSearchPill(searchQuery.trim());
      }

      // Update template usage count
      if (selectedTemplate) {
        await supabase
          .from('SearchTemplates')
          .update({ UsageCount: selectedTemplate.usageCount + 1 })
          .eq('Id', selectedTemplate.id);
      }

      // Process each search pill
      const allResults: SearchResult[] = [];
      
      for (const pill of searchPills) {
        try {
          setSearchPills(prev => prev.map(p => 
            p.id === pill.id ? { ...p, status: 'searching' } : p
          ));

          let results: SearchResult[] = [];

          if (pill.type === 'url') {
            // Extract from URL
            results = await extractFromUrl(pill.value);
          } else if (pill.type === 'image') {
            // Visual search
            results = await performVisualSearch(pill.value);
          } else if (pill.type === 'barcode') {
            // Barcode search
            results = await searchByBarcode(pill.value);
          } else {
            // Text search
            results = await performTextSearch(pill.value);
          }

          setSearchPills(prev => prev.map(p => 
            p.id === pill.id ? { ...p, status: 'complete', results } : p
          ));

          allResults.push(...results);
        } catch (error) {
          console.error(`Search failed for pill ${pill.id}:`, error);
          setSearchPills(prev => prev.map(p => 
            p.id === pill.id ? { ...p, status: 'error' } : p
          ));
        }
      }

      setSearchResults(allResults);
    } catch (error) {
      console.error('Search failed:', error);
      Alert.alert('Search Failed', 'An error occurred while searching. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const extractFromUrl = async (url: string): Promise<SearchResult[]> => {
    // Implementation for URL extraction
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const response = await fetch('https://api.sssync.app/api/products/extract-from-urls', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        urls: [url],
        businessTemplate: selectedTemplate?.id || 'general_products',
        customPrompt: selectedTemplate?.searchPrompt || 'Extract product information'
      })
    });

    const data = await response.json();
    return data.results || [];
  };

  const performVisualSearch = async (imageUri: string): Promise<SearchResult[]> => {
    // Implementation for visual search
    // This would call your existing visual search API
    return [];
  };

  const searchByBarcode = async (barcode: string): Promise<SearchResult[]> => {
    // Implementation for barcode search
    // This would check inventory first, then search web
    return [];
  };

  const performTextSearch = async (query: string): Promise<SearchResult[]> => {
    // Implementation for text search
    // This would use your enhanced search capabilities
    return [];
  };

  const createNewTemplate = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const templateData = {
        UserId: user.id,
        Name: newTemplate.name,
        Category: newTemplate.category,
        Description: newTemplate.description,
        SearchPrompt: newTemplate.searchPrompt,
        SuggestedSites: newTemplate.suggestedSites.filter(site => site.trim()),
        SearchKeywords: newTemplate.searchKeywords.filter(keyword => keyword.trim()),
        IsDefault: false,
        IsPublic: false,
        UsageCount: 0
      };

      const { error } = await supabase
        .from('SearchTemplates')
        .insert([templateData]);

      if (error) {
        console.error('Error creating template:', error);
        Alert.alert('Error', 'Failed to create template. Please try again.');
        return;
      }

      setShowCreateTemplateModal(false);
      setNewTemplate({
        name: '',
        category: '',
        description: '',
        searchPrompt: '',
        suggestedSites: [''],
        searchKeywords: ['']
      });
      
      loadTemplates();
      Alert.alert('Success', 'Template created successfully!');
    } catch (error) {
      console.error('Error in createNewTemplate:', error);
      Alert.alert('Error', 'Failed to create template. Please try again.');
    }
  };

  const selectResult = (result: SearchResult) => {
    // Navigate back to AddListingScreen with selected result
    navigation.navigate('AddListing', {
      enhancedSearchResult: result,
      selectedTemplate: selectedTemplate
    });
  };

  const renderTemplateModal = () => (
    <Modal visible={showTemplateModal} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Select Template</Text>
          <TouchableOpacity onPress={() => setShowTemplateModal(false)}>
            <MaterialIcons name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.templateList}>
          {templates.map((template) => (
            <TouchableOpacity
              key={template.id}
              style={[
                styles.templateItem,
                selectedTemplate?.id === template.id && styles.selectedTemplate
              ]}
              onPress={() => {
                setSelectedTemplate(template);
                setShowTemplateModal(false);
              }}
            >
              <View style={styles.templateHeader}>
                <Text style={styles.templateName}>{template.name}</Text>
                <Text style={styles.templateCategory}>{template.category}</Text>
              </View>
              {template.description && (
                <Text style={styles.templateDescription}>{template.description}</Text>
              )}
              <Text style={styles.templateUsage}>Used {template.usageCount} times</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={styles.createTemplateButton}
          onPress={() => {
            setShowTemplateModal(false);
            setShowCreateTemplateModal(true);
          }}
        >
          <MaterialIcons name="add" size={20} color="#fff" />
          <Text style={styles.createTemplateButtonText}>Create New Template</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );

  const renderCreateTemplateModal = () => (
    <Modal visible={showCreateTemplateModal} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Create Template</Text>
          <TouchableOpacity onPress={() => setShowCreateTemplateModal(false)}>
            <MaterialIcons name="close" size={24} color="#000" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.createTemplateForm}>
          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Template Name *</Text>
            <TextInput
              style={styles.textInput}
              value={newTemplate.name}
              onChangeText={(text) => setNewTemplate(prev => ({ ...prev, name: text }))}
              placeholder="e.g., Vintage Books"
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Category *</Text>
            <TextInput
              style={styles.textInput}
              value={newTemplate.category}
              onChangeText={(text) => setNewTemplate(prev => ({ ...prev, category: text }))}
              placeholder="e.g., Books & Literature"
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              value={newTemplate.description}
              onChangeText={(text) => setNewTemplate(prev => ({ ...prev, description: text }))}
              placeholder="Brief description of this template"
              multiline
              numberOfLines={3}
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Search Instructions *</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              value={newTemplate.searchPrompt}
              onChangeText={(text) => setNewTemplate(prev => ({ ...prev, searchPrompt: text }))}
              placeholder="Extract book details: title, author, ISBN, publication year, condition, edition..."
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Suggested Websites</Text>
            {newTemplate.suggestedSites.map((site, index) => (
              <View key={index} style={styles.arrayInputRow}>
                <TextInput
                  style={[styles.textInput, styles.arrayInput]}
                  value={site}
                  onChangeText={(text) => {
                    const updated = [...newTemplate.suggestedSites];
                    updated[index] = text;
                    setNewTemplate(prev => ({ ...prev, suggestedSites: updated }));
                  }}
                  placeholder="e.g., abebooks.com"
                />
                <TouchableOpacity
                  onPress={() => {
                    const updated = newTemplate.suggestedSites.filter((_, i) => i !== index);
                    setNewTemplate(prev => ({ ...prev, suggestedSites: updated }));
                  }}
                  style={styles.removeButton}
                >
                  <MaterialIcons name="remove-circle" size={20} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setNewTemplate(prev => ({ 
                ...prev, 
                suggestedSites: [...prev.suggestedSites, ''] 
              }))}
            >
              <MaterialIcons name="add" size={16} color="#007AFF" />
              <Text style={styles.addButtonText}>Add Website</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Search Keywords</Text>
            {newTemplate.searchKeywords.map((keyword, index) => (
              <View key={index} style={styles.arrayInputRow}>
                <TextInput
                  style={[styles.textInput, styles.arrayInput]}
                  value={keyword}
                  onChangeText={(text) => {
                    const updated = [...newTemplate.searchKeywords];
                    updated[index] = text;
                    setNewTemplate(prev => ({ ...prev, searchKeywords: updated }));
                  }}
                  placeholder="e.g., book, isbn, author"
                />
                <TouchableOpacity
                  onPress={() => {
                    const updated = newTemplate.searchKeywords.filter((_, i) => i !== index);
                    setNewTemplate(prev => ({ ...prev, searchKeywords: updated }));
                  }}
                  style={styles.removeButton}
                >
                  <MaterialIcons name="remove-circle" size={20} color="#ff4444" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => setNewTemplate(prev => ({ 
                ...prev, 
                searchKeywords: [...prev.searchKeywords, ''] 
              }))}
            >
              <MaterialIcons name="add" size={16} color="#007AFF" />
              <Text style={styles.addButtonText}>Add Keyword</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        <View style={styles.modalActions}>
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => setShowCreateTemplateModal(false)}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!newTemplate.name.trim() || !newTemplate.category.trim() || !newTemplate.searchPrompt.trim()) && styles.disabledButton
            ]}
            onPress={createNewTemplate}
            disabled={!newTemplate.name.trim() || !newTemplate.category.trim() || !newTemplate.searchPrompt.trim()}
          >
            <Text style={styles.saveButtonText}>Create Template</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Enhanced Search</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Template Selection */}
      <View style={styles.templateSection}>
        <Text style={styles.sectionTitle}>Search Template *</Text>
        <TouchableOpacity
          style={styles.templateSelector}
          onPress={() => setShowTemplateModal(true)}
        >
          <Text style={styles.templateSelectorText}>
            {selectedTemplate ? selectedTemplate.name : 'Select template...'}
          </Text>
          <MaterialIcons name="keyboard-arrow-down" size={24} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchSection}>
        <View style={styles.searchInputContainer}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Enter product name, URL, barcode, or description..."
            multiline
          />
          <View style={styles.inputActions}>
            <TouchableOpacity style={styles.actionButton} onPress={handleImagePicker}>
              <MaterialIcons name="photo-camera" size={20} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => addSearchPill(searchQuery)}
              disabled={!searchQuery.trim()}
            >
              <MaterialIcons name="add" size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Search Pills */}
      {searchPills.length > 0 && (
        <ScrollView 
          horizontal 
          style={styles.pillsContainer}
          showsHorizontalScrollIndicator={false}
        >
          {searchPills.map((pill) => (
            <View key={pill.id} style={[styles.pill, styles[`pill${pill.status}`]]}>
              <Text style={styles.pillText}>{pill.label}</Text>
              {pill.status === 'searching' && (
                <ActivityIndicator size="small" color="#fff" style={styles.pillLoader} />
              )}
              <TouchableOpacity onPress={() => removePill(pill.id)}>
                <MaterialIcons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Search Button */}
      <TouchableOpacity
        style={[styles.searchButton, isSearching && styles.searchButtonDisabled]}
        onPress={performSearch}
        disabled={isSearching}
      >
        {isSearching ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <MaterialIcons name="search" size={24} color="#fff" />
        )}
        <Text style={styles.searchButtonText}>
          {isSearching ? 'Searching...' : 'Search'}
        </Text>
      </TouchableOpacity>

      {/* Results */}
      <ScrollView style={styles.resultsContainer}>
        {searchResults.map((result, index) => (
          <TouchableOpacity
            key={index}
            style={styles.resultItem}
            onPress={() => selectResult(result)}
          >
            <View style={styles.resultHeader}>
              <Text style={styles.resultTitle}>{result.title}</Text>
              <Text style={styles.resultConfidence}>{Math.round(result.confidence * 100)}%</Text>
            </View>
            <Text style={styles.resultSource}>{result.source}</Text>
            {result.price && (
              <Text style={styles.resultPrice}>${result.price}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {renderTemplateModal()}
      {renderCreateTemplateModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  templateSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
  },
  templateSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#f9f9f9',
  },
  templateSelectorText: {
    fontSize: 16,
    color: '#333',
  },
  searchSection: {
    padding: 20,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    maxHeight: 100,
  },
  inputActions: {
    flexDirection: 'row',
    marginLeft: 10,
  },
  actionButton: {
    padding: 5,
    marginLeft: 5,
  },
  pillsContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  pillpending: {
    backgroundColor: '#007AFF',
  },
  pillsearching: {
    backgroundColor: '#FF9500',
  },
  pillcomplete: {
    backgroundColor: '#34C759',
  },
  pillerror: {
    backgroundColor: '#FF3B30',
  },
  pillText: {
    color: '#fff',
    fontSize: 14,
    marginRight: 8,
  },
  pillLoader: {
    marginRight: 8,
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  searchButtonDisabled: {
    backgroundColor: '#ccc',
  },
  searchButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  resultsContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  resultItem: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 10,
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  resultConfidence: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  resultSource: {
    fontSize: 14,
    color: '#666',
    marginBottom: 5,
  },
  resultPrice: {
    fontSize: 16,
    color: '#34C759',
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  templateList: {
    flex: 1,
    padding: 20,
  },
  templateItem: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginBottom: 10,
  },
  selectedTemplate: {
    borderColor: '#007AFF',
    backgroundColor: '#f0f8ff',
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  templateName: {
    fontSize: 16,
    fontWeight: '600',
  },
  templateCategory: {
    fontSize: 14,
    color: '#666',
  },
  templateDescription: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  templateUsage: {
    fontSize: 12,
    color: '#999',
  },
  createTemplateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    marginVertical: 20,
    paddingVertical: 15,
    borderRadius: 8,
  },
  createTemplateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  createTemplateForm: {
    flex: 1,
    padding: 20,
  },
  formField: {
    marginBottom: 20,
  },
  fieldLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: '#333',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  arrayInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  arrayInput: {
    flex: 1,
    marginRight: 8,
  },
  removeButton: {
    padding: 4,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  addButtonText: {
    color: '#007AFF',
    fontSize: 14,
    marginLeft: 4,
  },
  modalActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 15,
    marginRight: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 15,
    marginLeft: 10,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
  },
  disabledButton: {
    backgroundColor: '#ccc',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
}); 