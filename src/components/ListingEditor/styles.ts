import { StyleSheet } from 'react-native';

// Styles co-located for the ListingEditor leaf components extracted from
// ListingEditorForm.tsx. Keys mirror the originals (duplicated by design so
// each component is self-contained); the visual output is identical.
export const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modernInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffffff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  modernInputFocused: {
    borderColor: '#93C822',
    backgroundColor: '#FFFFFF',
    shadowColor: '#93C822',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  modernInputDisabled: {
    backgroundColor: '#F3F4F6',
    borderColor: '#E5E7EB',
  },
  modernTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 16,
    height: '100%',
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  sectionIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 12,
    fontSize: 15,
    backgroundColor: '#fff',
    color: '#000',
  },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  dropdown: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownMenu: { backgroundColor: 'white', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginTop: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 3 },
  dropdownItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  qtyInput: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, width: 100, color: '#000' },
});
