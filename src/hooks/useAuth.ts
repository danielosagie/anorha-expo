import React from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';

// A simple hook to manage auth state
export const useAuth = () => {
  const [session, setSession] = React.useState<any>(null);
  const [user, setUser] = React.useState<any>(null);

  React.useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  return { session, user };
}; 