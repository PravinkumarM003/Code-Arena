import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from '../config/firebase';
import { disconnectSocket } from '../lib/socket';
import toast from 'react-hot-toast';

const COLLEGE_DOMAIN = import.meta.env.VITE_COLLEGE_EMAIL_DOMAIN || 'bitsathy.ac.in';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Client-side domain check (server re-checks this independently)
        if (!firebaseUser.email?.endsWith(`@${COLLEGE_DOMAIN}`)) {
          await signOut(auth);
          toast.error(`Only @${COLLEGE_DOMAIN} accounts are allowed.`);
          setUser(null);
        } else {
          // Check for admin custom claim
          const tokenResult = await firebaseUser.getIdTokenResult();
          setIsAdmin(tokenResult.claims.admin === true);
          setUser(firebaseUser);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signInWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const email = result.user.email || '';

      if (!email.endsWith(`@${COLLEGE_DOMAIN}`)) {
        await signOut(auth);
        toast.error(`Only @${COLLEGE_DOMAIN} accounts are allowed.`);
        return;
      }

      // Register/update user in TiDB so Socket.IO can authenticate them
      const token = await result.user.getIdToken();
      const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';
      await fetch(`${BACKEND_URL}/auth/login`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      toast.success(`Welcome, ${result.user.displayName}!`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      if (!msg.includes('popup-closed-by-user')) {
        toast.error('Sign in failed. Please try again.');
      }
    }
  };

  const logout = async () => {
    await signOut(auth);
    await disconnectSocket();
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
