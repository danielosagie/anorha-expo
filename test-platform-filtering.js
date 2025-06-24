#!/usr/bin/env node

// Simple test script to update platform flags
// Run with: node test-platform-filtering.js

const fetch = require('node-fetch');

const API_BASE_URL = 'http://localhost:3000'; // Adjust to your backend URL

async function updatePlatformFlags() {
  try {
    console.log('Calling update-platform-flags endpoint...');
    
    const response = await fetch(`${API_BASE_URL}/products/update-platform-flags`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('✅ Platform flags updated successfully:');
    console.log(`   Message: ${result.message}`);
    console.log(`   Updated Count: ${result.updatedCount}`);
    
  } catch (error) {
    console.error('❌ Error updating platform flags:', error.message);
  }
}

// Run the test
updatePlatformFlags(); 