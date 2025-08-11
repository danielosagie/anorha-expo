import React from 'react';
import {Text, View} from 'react-native'


function ProductForm () {
    return (
        console.log(`[renderFormReview] Starting render with active tab: ${activeFormTab}`);
        // console.log("[renderFormReview] Current form data:", JSON.stringify(formData, null, 2));
        // console.log("[renderFormReview] Selected platforms:", selectedPlatforms);
        // console.log("[renderFormReview] Route params:", JSON.stringify(route.params, null, 2));

        const currentPlatformKey = activeFormTab?.toLowerCase();

        // Only show loading if we're actually waiting for data
        if (!formData || !currentPlatformKey || !formData[currentPlatformKey]) {
        console.warn("[renderFormReview] Missing form data:", {
            hasFormData: !!formData,
            currentPlatformKey,
            hasPlatformData: currentPlatformKey ? !!formData?.[currentPlatformKey] : false,
            initialData: route.params?.initialData
        });

        // If we have initial data but no form data, something went wrong
        if (route.params?.initialData?.platformDetails) {
            console.error("[renderFormReview] Form data not set despite having initial data. Initial data:", 
            JSON.stringify(route.params.initialData.platformDetails, null, 2));
            setError("Failed to load product data. Please try again.");
            return (
            <View style={styles.errorContainer}>
                <Icon name="alert-circle-outline" size={40} color="#D8000C" />
                <Text style={styles.errorText}>{error || "Failed to load product data"}</Text>
                <Button 
                title="Back to Past Scans" 
                onPress={() => navigation.goBack()} 
                style={styles.retryButton}
                />
            </View>
            );
        }

        return (
            <Animated.View style={styles.stageContainer} entering={FadeIn}>
            <Text style={styles.stageTitle}>Loading Details...</Text>
            <ActivityIndicator size="small" color="#666" />
            <View style={styles.navigationButtons}>
                <Button 
                title="Back to Past Scans" 
                onPress={() => navigation.goBack()} 
                outlined 
                style={styles.navButton}
                />
            </View>
            </Animated.View>
        );
        }

        const currentPlatformData = formData[currentPlatformKey] || {};

        // Add after the fetchShopifyLocations function
        const handleLocationToggle = (location: ShopifyLocation) => {
        setSelectedLocations(prev => {
            const isSelected = prev.some(l => l.id === location.id);
            if (isSelected) {
            return prev.filter(l => l.id !== location.id);
            } else {
            return [...prev, { ...location, quantity: 0 }];
            }
        });
        };

        const handleLocationQuantityChange = (locationId: string, quantity: string) => {
        setSelectedLocations(prev => 
            prev.map(loc => 
            loc.id === locationId 
                ? { ...loc, quantity: parseInt(quantity) || 0 }
                : loc
            )
        );
        };

        const renderLocationsSection = () => {
        if (currentPlatformKey !== 'shopify') return null;

        // Removed nested fetchShopifyLocations.
        // This section now relies on the main fetchShopifyLocations function (called by handlePublish)
        // and the state variables: shopifyLocations, isLoadingLocations, selectedLocations.

        console.log("[renderLocationsSection] Rendering locations section");
        // console.log("[renderLocationsSection] Current platform key:", currentPlatformKey); // Can be verbose
        // console.log("[renderLocationsSection] Shopify locations from state:", shopifyLocations); // Very verbose
        // console.log("[renderLocationsSection] Selected locations from state:", selectedLocations); // Very verbose
        console.log("[renderLocationsSection] Is loading locations:", isLoadingLocations);


        return (
            <View style={styles.formSection}>
            <Text style={styles.sectionTitle}>Inventory Locations</Text>
            {isLoadingLocations ? (
                <ActivityIndicator size="small" color="#666" style={{ marginVertical: 10 }} />
            ) : shopifyLocations.length === 0 ? (
                <Text style={styles.noLocationsText}>No locations available for the selected connection.</Text>
            ) : (
                <View style={styles.locationsDropdown}>
                {shopifyLocations.map((location: ShopifyLocation) => {
                    const isSelected = selectedLocations.some(l => l.id === location.id);
                    const selectedLocation = selectedLocations.find(l => l.id === location.id) as ShopifyLocationWithQuantity | undefined;
                    
                    return (
                    <View key={location.id} style={styles.locationItem}>
                        <View style={styles.locationHeader}>
                        <Checkbox
                            status={isSelected ? 'checked' : 'unchecked'}
                            onPress={() => handleLocationToggle(location)}
                            color="#4CAF50"
                        />
                        <View style={styles.locationInfo}>
                            <Text style={styles.locationName}>{location.name}</Text>
                            <Text style={styles.locationAddress}>
                            {[location.address1, location.city, location.province, location.zip].filter(Boolean).join(', ')}
                            </Text>
                        </View>
                        </View>
                        {isSelected && selectedLocation && (
                        <View style={styles.quantityInputContainer}>
                            <Text style={styles.quantityLabel}>Quantity:</Text>
                            <TextInput
                            style={styles.quantityInput}
                            keyboardType="numeric"
                            value={selectedLocation.quantity === 0 ? '0' : String(selectedLocation.quantity)} // Display blank if 0
                            onChangeText={(value) => updateLocationQuantity(location.id, value)} // Use updated function
                            placeholder="0"
                            />
                        </View>
                        )}
                    </View>
                    );
                })}
                </View>
            )}
            </View>
        );
        };

        <View style={styles.formReviewContainer}>
            {/* Media Preview Section */}
            <View style={styles.mediaPreviewContainer}>
            <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false} 
                contentContainerStyle={styles.mediaPreviewScrollContent}
            >
                {uploadedImageUrls.map((uri, index) => (
                <TouchableOpacity 
                    key={uri} 
                    style={[styles.mediaPreviewItem, coverImageIndex === index && styles.mediaPreviewItemCover]}
                    onPress={() => handleSetCover(index)}
                    activeOpacity={0.8}
                >
                    <Image source={{ uri }} style={styles.mediaPreviewImage} />
                    {coverImageIndex === index && (
                    <View style={styles.coverBadge}>
                        <Icon name="star" size={12} color="white" />
                    </View>
                    )}
                </TouchableOpacity>
                ))}
                {uploadedImageUrls.length < 10 && (
                <TouchableOpacity 
                    style={styles.addMediaButton}
                    onPress={() => {
                    Alert.alert(
                        "Add Media",
                        "Choose how to add media",
                        [
                        { text: "Camera", onPress: () => setShowCameraSection(true) },
                        { text: "Library", onPress: pickImagesFromLibrary },
                        { text: "Cancel", style: "cancel" }
                        ]
                    );
                    }}
                >
                    <Icon name="plus" size={24} color="#666" />
                </TouchableOpacity>
                )}
            </ScrollView>
            <Text style={styles.mediaHint}>Tap to set cover image</Text>
            </View>

            {/* Platform Selection Tabs */}
            <View style={styles.platformTabsContainer}>
            <ScrollView 
                horizontal 
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.platformTabsScroll}
            >
                {selectedPlatforms.map(platformKey => (
                <TouchableOpacity
                    key={platformKey}
                    style={[styles.platformTab, activeFormTab === platformKey && styles.platformTabActive]}
                    onPress={() => setActiveFormTab(platformKey)}
                >
                    {React.createElement(platformImageMap[platformKey], {
                    width: 40,
                    height: 40,
                    style: styles.platformTabIcon
                    })}
                    <Text style={[styles.platformTabText, activeFormTab === platformKey && styles.platformTabTextActive]}>
                    {AVAILABLE_PLATFORMS.find(p => p.key === platformKey)?.name || platformKey}
                    </Text>
                </TouchableOpacity>
                ))}
                <TouchableOpacity
                style={styles.addPlatformButton}
                onPress={() => setIsAddPlatformModalVisible(true)} // <-- UPDATED
                >
                <Icon name="plus" size={20} color="#666" />
                <Text style={styles.addPlatformText}>Add Platform</Text>
                </TouchableOpacity>
            </ScrollView>
            </View>

            {/* Form Content */}
            <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.formKeyboardAvoid}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
            >
            <ScrollView 
                style={styles.formScrollView}
                contentContainerStyle={styles.formScrollContent}
                showsVerticalScrollIndicator={true}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.formFieldsContainer}>
                {/* Add locations field first - This remains if needed for Shopify */}
                {currentPlatformKey === 'shopify' && renderLocationsSection()}
                
                {/* --- NEW: Explicit Form Fields --- */}
                {currentPlatformData && (
                    <>
                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Title</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.title || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'title', text)}
                        placeholder="Enter product title"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Description</Text>
                        <TextInput
                        style={styles.formInputMultiline}
                        value={String(currentPlatformData.description || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'description', text)}
                        multiline
                        numberOfLines={4}
                        placeholder="Enter product description"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Price</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.price === undefined ? '' : currentPlatformData.price)}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'price', text)}
                        placeholder="0.00"
                        keyboardType="numeric"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Compare At Price</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.compareAtPrice === undefined ? '' : currentPlatformData.compareAtPrice)}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'compareAtPrice', text)}
                        placeholder="0.00"
                        keyboardType="numeric"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>SKU (Stock Keeping Unit)</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.sku || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'sku', text)}
                        placeholder="Enter SKU"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Barcode (GTIN, UPC, EAN, ISBN)</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.barcode || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'barcode', text)}
                        placeholder="Enter barcode"
                        />
                    </View>
                    
                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Status</Text>
                        {/* TODO: Consider a Picker/Switch for status: active, draft, archived */}
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.status || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'status', text)}
                        placeholder="e.g., active, draft"
                        />
                    </View>

                    {currentPlatformKey === 'shopify' && (
                        <>
                        <View style={styles.formField}>
                            <Text style={styles.formLabel}>Vendor (Shopify)</Text>
                            <TextInput
                            style={styles.formInput}
                            value={String(currentPlatformData.vendor || '')}
                            onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'vendor', text)}
                            placeholder="Enter vendor"
                            />
                        </View>

                        <View style={styles.formField}>
                            <Text style={styles.formLabel}>Product Type (Shopify)</Text>
                            <TextInput
                            style={styles.formInput}
                            value={String(currentPlatformData.productType || '')}
                            onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'productType', text)}
                            placeholder="Enter product type"
                            />
                        </View>

                        <View style={styles.formField}>
                            <Text style={styles.formLabel}>Tags (Shopify, comma-separated)</Text>
                            <TextInput
                            style={styles.formInput}
                            value={Array.isArray(currentPlatformData.tags) ? currentPlatformData.tags.join(', ') : String(currentPlatformData.tags || '')}
                            onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'tags', text)}
                            placeholder="e.g., vintage, cotton, summer"
                            />
                        </View>
                        </>
                    )}

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Category Suggestion</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.categorySuggestion || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'categorySuggestion', text)}
                        placeholder="e.g., Electronics > TV"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Brand</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.brand || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'brand', text)}
                        placeholder="Enter brand name"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Condition</Text>
                        {/* TODO: Consider a Picker for condition */}
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.condition || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'condition', text)}
                        placeholder="e.g., New, Used - Like New"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Weight</Text>
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.weight === undefined ? '' : currentPlatformData.weight)}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'weight', text)}
                        placeholder="e.g., 0.5"
                        keyboardType="numeric"
                        />
                    </View>

                    <View style={styles.formField}>
                        <Text style={styles.formLabel}>Weight Unit</Text>
                        {/* TODO: Consider a Picker for weightUnit: kg, lb, oz, g */}
                        <TextInput
                        style={styles.formInput}
                        value={String(currentPlatformData.weightUnit || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, 'weightUnit', text)}
                        placeholder="e.g., kg, lb, oz, g"
                        />
                    </View>
                    </>
                )}
                {/* --- END NEW: Explicit Form Fields --- */}

                {/* Fallback for any other fields, or remove if all fields are explicit now */}
                {/* 
                {Object.entries(currentPlatformData).map(([field, value]) => (
                    // This old loop might render fields already explicitly handled above
                    // Or it might render fields not yet explicitly handled, review carefully.
                    // Consider removing if all desired fields are now explicitly laid out.
                    <View key={field} style={styles.formField}>
                    <Text style={styles.formLabel}>
                        {field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                    </Text>
                    
                    {field.toLowerCase().includes('quantity') ? (
                        // ... quantity input ... (already handled by locations section if this refers to inventory quantity)
                    ) : field === 'description' || field === 'returnPolicy' ? (
                        <TextInput
                        style={styles.formInputMultiline}
                        value={String(value || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                        multiline
                        numberOfLines={4}
                        placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                        />
                    ) : typeof value === 'boolean' ? (
                        <Switch
                        value={value}
                        onValueChange={(newValue) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, newValue)}
                        trackColor={{ false: "#767577", true: "#81b0ff" }}
                        thumbColor={value ? "#4CAF50" : "#f4f3f4"}
                        />
                    ) : Array.isArray(value) ? (
                        <TextInput
                        style={styles.formInput}
                        value={value.join(', ')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                        placeholder={`Enter ${field.replace(/_/g, ' ')} (comma-separated)`}
                        />
                    ) : (
                        <TextInput
                        style={styles.formInput}
                        value={String(value || '')}
                        onChangeText={(text) => handleFormUpdate(currentPlatformKey!, field as keyof GeneratedPlatformDetails, text)}
                        placeholder={`Enter ${field.replace(/_/g, ' ')}`}
                        />
                    )}
                    </View>
                ))}
                */}
                </View>
                
                {/* Add debug options right before the bottom buttons */}
                {renderDebugOptions()}
                
            </ScrollView>
            </KeyboardAvoidingView>

            {/* --- NEW Bottom Action Buttons --- */}
            <View style={styles.formReviewBottomActionsContainer}>
            <TouchableOpacity
                style={[styles.formReviewActionButton, styles.formReviewBackButton]}
                onPress={() => {
                // Simplified back logic: always go to VisualMatch if available, else PlatformSelection
                if (analysisResponse) { // analysisResponse is set when VisualMatch stage was reached
                    setCurrentStage(ListingStage.VisualMatch);
                } else {
                    setCurrentStage(ListingStage.PlatformSelection);
                }
                }}
            >
                <Icon name="arrow-left" size={20} color={theme.colors.text} />
                <Text style={styles.formReviewActionButtonText}>Back</Text>
            </TouchableOpacity>

                <TouchableOpacity
                style={[styles.formReviewActionButton, styles.formReviewSaveButton]}
                onPress={handleSaveDraft} // Assuming handleSaveDraft is implemented
            >
                <Icon name="content-save-outline" size={20} color={theme.colors.primary} />
                <Text style={[styles.formReviewActionButtonText, { color: theme.colors.primary }]}>Save Draft</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.formReviewActionButton, styles.formReviewPublishButton]}
                onPress={handlePublish} // This opens the publish modal
                >
                <Icon name="cloud-upload-outline" size={20} color='#FFFFFF' />
                <Text style={[styles.formReviewActionButtonText, { color: '#FFFFFF' }]}>Publish</Text>
                </TouchableOpacity>
            </View>
            {/* --- END NEW Bottom Action Buttons --- */}

        </View>
    )
  }