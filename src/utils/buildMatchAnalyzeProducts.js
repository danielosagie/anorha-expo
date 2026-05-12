function buildMatchAnalyzeProducts(publicImageUrls, itemsForAnalyze, quickMatchHintsByItemId) {
  return publicImageUrls.map((url, index) => {
    const itemId = itemsForAnalyze?.[index]?.id;
    const hint = itemId ? quickMatchHintsByItemId?.[itemId] : undefined;
    const selectedIndex = typeof hint?.preSelectedIndices?.[0] === 'number'
      ? hint.preSelectedIndices[0]
      : undefined;
    const quickMatchHint = (
      hint &&
      typeof selectedIndex === 'number' &&
      Array.isArray(hint.serpApiData) &&
      hint.serpApiData[selectedIndex]
    ) ? {
      source: hint.source || 'quick_scan_auto',
      selectedIndex,
      candidates: hint.serpApiData,
      confidence: hint.confidence,
      reasoning: hint.reasoning,
    } : undefined;

    return {
      productIndex: index,
      images: [{ url }],
      quickMatchHint,
    };
  });
}

module.exports = {
  buildMatchAnalyzeProducts,
};
