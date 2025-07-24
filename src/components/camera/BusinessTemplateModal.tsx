import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal,
  SafeAreaView,
  FlatList,
  TextInput,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export interface BusinessTemplate {
  id: string;
  name: string;
  description: string;
  websites: string[];
  category: string;
  isFavorite: boolean;
  isRecent: boolean;
  createdAt: Date;
}

interface BusinessTemplateModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectTemplate: (template: BusinessTemplate) => void;
  selectedTemplate?: BusinessTemplate;
}

const BusinessTemplateModal: React.FC<BusinessTemplateModalProps> = ({
  visible,
  onClose,
  onSelectTemplate,
  selectedTemplate,
}) => {
  const [activeTab, setActiveTab] = useState<'favorites' | 'recent' | 'all'>('favorites');
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateWebsites, setNewTemplateWebsites] = useState('');

  // Mock templates - replace with actual data
  const templates: BusinessTemplate[] = [
    {
      id: 'electronics',
      name: 'Electronics',
      description: 'Best Buy, Amazon Electronics, Newegg',
      websites: ['bestbuy.com', 'amazon.com/electronics', 'newegg.com'],
      category: 'Electronics',
      isFavorite: true,
      isRecent: true,
      createdAt: new Date(),
    },
    {
      id: 'clothing',
      name: 'Fashion & Clothing',
      description: 'Zara, H&M, Nike, Adidas',
      websites: ['zara.com', 'hm.com', 'nike.com', 'adidas.com'],
      category: 'Fashion',
      isFavorite: true,
      isRecent: false,
      createdAt: new Date(),
    },
    {
      id: 'books',
      name: 'Books & Media',
      description: 'Amazon Books, Barnes & Noble, Book Depository',
      websites: ['amazon.com/books', 'barnesandnoble.com', 'bookdepository.com'],
      category: 'Books',
      isFavorite: false,
      isRecent: true,
      createdAt: new Date(),
    },
    {
      id: 'amazon',
      name: 'Amazon Only',
      description: 'Search only on Amazon',
      websites: ['amazon.com'],
      category: 'Marketplace',
      isFavorite: true,
      isRecent: false,
      createdAt: new Date(),
    },
    {
      id: 'ebay',
      name: 'eBay Only',
      description: 'Search only on eBay',
      websites: ['ebay.com'],
      category: 'Marketplace',
      isFavorite: false,
      isRecent: true,
      createdAt: new Date(),
    },
    {
      id: 'depop',
      name: 'Depop Fashion',
      description: 'Vintage and unique fashion finds',
      websites: ['depop.com'],
      category: 'Fashion',
      isFavorite: false,
      isRecent: false,
      createdAt: new Date(),
    },
  ];

  const getFilteredTemplates = () => {
    let filtered = templates;

    if (activeTab === 'favorites') {
      filtered = templates.filter(t => t.isFavorite);
    } else if (activeTab === 'recent') {
      filtered = templates.filter(t => t.isRecent);
    }

    if (searchQuery) {
      filtered = filtered.filter(t => 
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  const handleCreateTemplate = () => {
    if (!newTemplateName.trim() || !newTemplateWebsites.trim()) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    const websites = newTemplateWebsites.split(',').map(w => w.trim()).filter(w => w);
    if (websites.length === 0) {
      Alert.alert('Error', 'Please enter at least one website');
      return;
    }

    const newTemplate: BusinessTemplate = {
      id: `custom-${Date.now()}`,
      name: newTemplateName,
      description: websites.join(', '),
      websites,
      category: 'Custom',
      isFavorite: false,
      isRecent: true,
      createdAt: new Date(),
    };

    onSelectTemplate(newTemplate);
    setShowCreateForm(false);
    setNewTemplateName('');
    setNewTemplateWebsites('');
    onClose();
  };

  const renderTemplate = ({ item }: { item: BusinessTemplate }) => (
    <TouchableOpacity
      style={[
        styles.templateCard,
        selectedTemplate?.id === item.id && styles.selectedTemplate,
      ]}
      onPress={() => {
        onSelectTemplate(item);
        onClose();
      }}
    >
      <View style={styles.templateHeader}>
        <Text style={styles.templateName}>{item.name}</Text>
        <View style={styles.templateBadges}>
          {item.isFavorite && (
            <Icon name="star" size={16} color="#FFD700" />
          )}
          {item.isRecent && (
            <Icon name="clock-outline" size={16} color="#666" />
          )}
        </View>
      </View>
      <Text style={styles.templateDescription}>{item.description}</Text>
      <Text style={styles.templateCategory}>{item.category}</Text>
      <Text style={styles.websiteCount}>{item.websites.length} website{item.websites.length > 1 ? 's' : ''}</Text>
    </TouchableOpacity>
  );

  if (showCreateForm) {
    return (
      <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setShowCreateForm(false)}>
              <Icon name="arrow-left" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Create Template</Text>
            <TouchableOpacity onPress={handleCreateTemplate}>
              <Text style={styles.saveButton}>Save</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.createForm}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Template Name</Text>
              <TextInput
                style={styles.textInput}
                value={newTemplateName}
                onChangeText={setNewTemplateName}
                placeholder="e.g., My Electronics Template"
                placeholderTextColor="#999"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Websites (comma separated)</Text>
              <TextInput
                style={[styles.textInput, styles.multilineInput]}
                value={newTemplateWebsites}
                onChangeText={setNewTemplateWebsites}
                placeholder="e.g., amazon.com, ebay.com, bestbuy.com"
                placeholderTextColor="#999"
                multiline
                numberOfLines={3}
              />
              <Text style={styles.inputHint}>
                Enter website URLs separated by commas. These will be prioritized when searching for products.
              </Text>
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Icon name="close" size={24} color="#333" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Business Templates</Text>
          <TouchableOpacity onPress={() => setShowCreateForm(true)}>
            <Icon name="plus" size={24} color="#4CAF50" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchContainer}>
          <Icon name="magnify" size={20} color="#666" />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search templates..."
            placeholderTextColor="#999"
          />
        </View>

        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'favorites' && styles.activeTab]}
            onPress={() => setActiveTab('favorites')}
          >
            <Icon 
              name="star" 
              size={18} 
              color={activeTab === 'favorites' ? '#4CAF50' : '#666'} 
            />
            <Text style={[
              styles.tabText, 
              activeTab === 'favorites' && styles.activeTabText
            ]}>
              Favorites
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'recent' && styles.activeTab]}
            onPress={() => setActiveTab('recent')}
          >
            <Icon 
              name="clock-outline" 
              size={18} 
              color={activeTab === 'recent' ? '#4CAF50' : '#666'} 
            />
            <Text style={[
              styles.tabText, 
              activeTab === 'recent' && styles.activeTabText
            ]}>
              Recent
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'all' && styles.activeTab]}
            onPress={() => setActiveTab('all')}
          >
            <Icon 
              name="view-grid-outline" 
              size={18} 
              color={activeTab === 'all' ? '#4CAF50' : '#666'} 
            />
            <Text style={[
              styles.tabText, 
              activeTab === 'all' && styles.activeTabText
            ]}>
              All
            </Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={getFilteredTemplates()}
          renderItem={renderTemplate}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.templatesList}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  saveButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4CAF50',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: '#333',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  activeTab: {
    backgroundColor: '#f0f9f0',
  },
  tabText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  activeTabText: {
    color: '#4CAF50',
  },
  templatesList: {
    paddingHorizontal: 20,
  },
  templateCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedTemplate: {
    borderColor: '#4CAF50',
    backgroundColor: '#f0f9f0',
  },
  templateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  templateName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    flex: 1,
  },
  templateBadges: {
    flexDirection: 'row',
    gap: 8,
  },
  templateDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  templateCategory: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
  },
  websiteCount: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '500',
  },
  createForm: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: '#333',
    backgroundColor: 'white',
  },
  multilineInput: {
    height: 80,
    textAlignVertical: 'top',
  },
  inputHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 6,
    lineHeight: 16,
  },
});

export default BusinessTemplateModal;
export type { BusinessTemplateModalProps }; 