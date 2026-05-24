import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  notificationBanner: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  notificationBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {},
  header: {
    paddingTop: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
  },
  refreshButton: {
    padding: 8,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  savingText: {
    fontSize: 12,
    marginLeft: 4,
  },
  savedText: {
    fontSize: 12,
    marginTop: 4,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },

  // Image Section
  imageSection: {
    margin: 16,
  },
  imageSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addImageButton: {
    padding: 12,
    borderRadius: 8,
  },
  imageScroll: {
    flexDirection: 'row',
  },
  imageContainer: {
    position: 'relative',
    marginRight: 12,
  },
  productImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  primaryBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  placeholderImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    marginTop: 8,
  },

  // Form Sections
  basicSection: {
    margin: 0,
    marginTop: 0,
  },
  identitySection: {
    margin: 16,
    marginTop: 0,
  },
  shippingSection: {
    margin: 16,
    marginTop: 0,
  },

  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  formRow: {
    flexDirection: 'row',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  scanButton: {
    marginLeft: 10,
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  switchLabel: {
    fontSize: 16,
  },

  // Inventory Section
  inventorySection: {
    margin: 16,
    marginTop: 0,
  },
  platformGroup: {
    marginBottom: 20,
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformGroupTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  platformSubtitle: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  inventoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  inventoryLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    marginLeft: 6,
  },
  inventoryInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    minWidth: 80,
    textAlign: 'center',
  },
  noInventoryText: {
    textAlign: 'center',
    fontSize: 14,
    fontStyle: 'italic',
    padding: 20,
  },

  // Platform Connections
  platformsSection: {
    margin: 0,
    marginTop: 0,
  },
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformLogoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformDetails: {
    marginLeft: 12,
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
  },
  platformSku: {
    fontSize: 12,
    marginTop: 2,
  },
  platformStatus: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  platformLastSync: {
    fontSize: 11,
    marginTop: 2,
  },
  platformActions: {
    flexDirection: 'row',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  delistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  delistButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noPlatformsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noPlatformsText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  addPlatformRow: {
    marginTop: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  addPlatformText: {
    fontSize: 16,
    fontWeight: '500',
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    padding: 4,
    borderRadius: 4,
  },
  dangerZoneSection: {
    margin: 16,
    marginTop: 0,
  },
  dangerZoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  dangerZoneHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  dangerZoneContent: {
    padding: 16,
  },
  dangerZoneDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  dangerAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dangerActionInfo: {
    flex: 1,
  },
  dangerActionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  dangerActionDescription: {
    fontSize: 14,
  },
  dangerButton: {
    padding: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
});
