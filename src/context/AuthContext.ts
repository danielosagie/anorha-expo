import React from 'react';

// Define the shape of the context value
export interface AuthContextType {
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (token: string) => Promise<void>;
}

// Create and export the context
export const AuthContext = React.createContext<AuthContextType | null>(null); 