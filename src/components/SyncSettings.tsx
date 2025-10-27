import React, { useEffect } from 'react';




export const renderSyncRulesModal = () => (


return (
    <Modal
      visible={showSyncRules}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowSyncRules(false)}
    >
      <View style={syncRulesStyles.modalContainer}>
        <View style={syncRulesStyles.modalHeader}>
          <TouchableOpacity onPress={() => setShowSyncRules(false)}>
            <Icon name="close" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={syncRulesStyles.modalTitle}>Sync Settings</Text>
          <TouchableOpacity onPress={() => setShowSyncRules(false)}>
            <Text style={syncRulesStyles.doneButton}>Done</Text>
          </TouchableOpacity>
        </View>
        
        <ScrollView style={syncRulesStyles.modalContent}>
          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>Sync Direction</Text>
            <Text style={syncRulesStyles.sectionSubtitle}>How should data flow between SSSync and {platformName}?</Text>
            {renderSyncDirectionOption('two-way', 'Two-way sync', 'Changes flow in both directions', 'sync')}
            {renderSyncDirectionOption('push-only', 'Push to platform', 'SSSync updates your platform only', 'upload')}
            {renderSyncDirectionOption('pull-only', 'Pull from platform', 'Platform updates SSSync only', 'download')}
          </Card>

          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>Conflict Resolution</Text>
            <Text style={syncRulesStyles.sectionSubtitle}>When product details differ, which should win?</Text>
            {renderSourceOption('sssync', 'SSSync wins', 'Use SSSync data when conflicts occur', 'shield-check')}
            {renderSourceOption('platform', `${platformName} wins`, `Use ${platformName} data when conflicts occur`, 'store')}
          </Card>

          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>What to Sync</Text>
            <View style={syncRulesStyles.switchRow}>
              <View style={syncRulesStyles.switchLabelContainer}>
                <Icon name="package-variant" size={20} color={theme.colors.text} />
                <Text style={syncRulesStyles.switchLabel}>Inventory levels</Text>
              </View>
              <TouchableOpacity onPress={() => setSyncInventory(!syncInventory)}>
                <Icon 
                  name={syncInventory ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={syncInventory ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
            <View style={syncRulesStyles.switchRow}>
              <View style={syncRulesStyles.switchLabelContainer}>
                <Icon name="currency-usd" size={20} color={theme.colors.text} />
                <Text style={syncRulesStyles.switchLabel}>Pricing</Text>
              </View>
              <TouchableOpacity onPress={() => setSyncPricing(!syncPricing)}>
                <Icon 
                  name={syncPricing ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={syncPricing ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
          </Card>

          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>Inventory Buffer</Text>
            <Text style={syncRulesStyles.sectionSubtitle}>Hold back units to prevent overselling</Text>
            <View style={syncRulesStyles.inputRow}>
              <View style={syncRulesStyles.inputContainer}>
                <Text style={syncRulesStyles.inputLabel}>Units to hold back</Text>
                <TextInput
                  style={syncRulesStyles.numberInput}
                  value={globalInventoryBuffer.toString()}
                  onChangeText={(text) => setGlobalInventoryBuffer(Math.max(0, parseInt(text) || 0))}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>
            </View>
            <View style={syncRulesStyles.previewCard}>
              <View style={syncRulesStyles.previewRow}>
                <Text style={syncRulesStyles.previewLabel}>Actual Inventory:</Text>
                <Text style={syncRulesStyles.previewValue}>10 units</Text>
              </View>
              <View style={syncRulesStyles.previewRow}>
                <Text style={syncRulesStyles.previewLabel}>Buffer:</Text>
                <Text style={syncRulesStyles.previewValue}>-{globalInventoryBuffer} units</Text>
              </View>
              <View style={[syncRulesStyles.previewRow, syncRulesStyles.previewRowHighlighted]}>
                <Text style={syncRulesStyles.previewLabel}>Published to Platform:</Text>
                <Text style={syncRulesStyles.previewValueHighlighted}>{Math.max(0, 10 - globalInventoryBuffer)} units</Text>
              </View>
            </View>
            <View style={syncRulesStyles.infoBox}>
              <Icon name="lightbulb-outline" size={16} color="#856404" />
              <Text style={syncRulesStyles.infoText}>Useful for markets/events to avoid running out before restocking</Text>
            </View>
          </Card>

          <TouchableOpacity 
            style={syncRulesStyles.advancedToggle} 
            onPress={() => setShowAdvancedRules(!showAdvancedRules)}
          >
            <Icon 
              name={showAdvancedRules ? 'chevron-down' : 'chevron-right'} 
              size={22} 
              color={theme.colors.primary} 
            />
            <Text style={syncRulesStyles.advancedText}>Advanced Settings</Text>
          </TouchableOpacity>
          
          {showAdvancedRules && (
            <Card style={syncRulesStyles.ruleSection}>
              <Text style={syncRulesStyles.sectionTitle}>Automatic Actions</Text>
              <View style={syncRulesStyles.switchRow}>
                <View style={syncRulesStyles.switchLabelContainer}>
                  <Icon name="plus-circle" size={20} color={theme.colors.text} />
                  <Text style={syncRulesStyles.switchLabel}>Auto-create new products</Text>
                </View>
                <TouchableOpacity onPress={() => setAutoCreate(!autoCreate)}>
                  <Icon 
                    name={autoCreate ? 'toggle-switch' : 'toggle-switch-off'} 
                    size={32} 
                    color={autoCreate ? theme.colors.primary : theme.colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
              <View style={syncRulesStyles.switchRow}>
                <View style={syncRulesStyles.switchLabelContainer}>
                  <Icon name="update" size={20} color={theme.colors.text} />
                  <Text style={syncRulesStyles.switchLabel}>Auto-update existing products</Text>
                </View>
                <TouchableOpacity onPress={() => setAutoUpdate(!autoUpdate)}>
                  <Icon 
                    name={autoUpdate ? 'toggle-switch' : 'toggle-switch-off'} 
                    size={32} 
                    color={autoUpdate ? theme.colors.primary : theme.colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
            </Card>
          )}
        </ScrollView>
      </View>
    </Modal>
  );