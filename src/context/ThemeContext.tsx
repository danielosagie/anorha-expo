import React, { createContext, useContext } from 'react';

// Colors based on your dashboard screenshot
const theme = {
  colors: {
    primary: '#0E8F7F', // The teal/green from your chart
    secondary: '#F17F5F', // The orange/salmon from Amazon bar
    accent: '#3CAD46', // Green from Clover
    background: '#FFFFFF',
    surface: '#F8F9FB',
    text: '#333333',
    textSecondary: '#777777',
    success: '#28a745',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
  },
  borderRadius: {
    small: 4,
    medium: 8,
    large: 16,
    round: 999,
  },
  typography: {
    fontFamily: {
      regular: 'System',
      bold: 'System',
    },
    fontSize: {
      h1: 32,
      h2: 24,
      h3: 20,
      h4: 18,
      body: 16,
      caption: 14,
      small: 12,
    },
  },
  shadows: {
    small: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 2,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 4,
    },
  }
};

const ThemeContext = createContext(theme);

export const useTheme = () => useContext(ThemeContext);

// Add a default export for the theme object
export default theme;

export const ThemeProvider = ({ children }) => {
  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}; 