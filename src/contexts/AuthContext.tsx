import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Session {
  access_token: string;
  platformConnectionId: string;
}

interface AuthContextType {
  sessionData: {
    session: Session | null;
  };
}

const AuthContext = createContext<AuthContextType>({
  sessionData: {
    session: null
  }
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionData, setSessionData] = useState<AuthContextType>({
    session: null
  });

  useEffect(() => {
    const getSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error getting session:', error);
        return;
      }
      
      if (session) {
        setSessionData({
          session: {
            access_token: session.access_token,
            platformConnectionId: session.user?.user_metadata?.platformConnectionId || ''
          }
        });
      }
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setSessionData({
          session: {
            access_token: session.access_token,
            platformConnectionId: session.user?.user_metadata?.platformConnectionId || ''
          }
        });
      } else {
        setSessionData({ session: null });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={sessionData}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); 