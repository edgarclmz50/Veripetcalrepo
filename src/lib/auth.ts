import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser 
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { User } from '../types';

const AUTH_KEY = 'veripet_user';

export const loginWithGoogle = async (): Promise<User> => {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const firebaseUser = result.user;

  // Check if user exists in Firestore
  const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
  
  if (userDoc.exists()) {
    const userData = userDoc.data() as User;
    localStorage.setItem(AUTH_KEY, JSON.stringify(userData));
    return userData;
  } else {
    // Create new user profile
    const newUser: User = {
      id: firebaseUser.uid,
      name: firebaseUser.displayName || 'Technician',
      email: firebaseUser.email || '',
      role: firebaseUser.email === 'edgarclmz@gmail.com' ? 'admin' : 'technician',
      // Map known technicians to their ERP codes
      technicianCode: firebaseUser.email === 'edgarclmz@gmail.com' ? 'ecolmenarez' : undefined
    };
    await setDoc(doc(db, 'users', firebaseUser.uid), newUser);
    localStorage.setItem(AUTH_KEY, JSON.stringify(newUser));
    return newUser;
  }
};

export const getAuthUser = (): User | null => {
  const stored = localStorage.getItem(AUTH_KEY);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      return null;
    }
  }
  return null;
};

export const logout = async () => {
  await signOut(auth);
  localStorage.removeItem(AUTH_KEY);
  window.location.href = '/login';
};

export const subscribeToAuthChanges = (callback: (user: User | null) => void) => {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (firebaseUser) {
      // 1. Check localStorage first for immediate UI update
      const stored = localStorage.getItem(AUTH_KEY);
      if (stored) {
        try {
          const userData = JSON.parse(stored) as User;
          if (userData.id === firebaseUser.uid) {
            callback(userData);
          }
        } catch (e) {}
      }

      // 2. Always verify/sync with Firestore
      try {
        const userRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userRef);
        
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          // Force admin role for the owner if specified in rules but not in doc (for consistency)
          if (firebaseUser.email === 'edgarclmz@gmail.com' && userData.role !== 'admin') {
            userData.role = 'admin';
          }
          localStorage.setItem(AUTH_KEY, JSON.stringify(userData));
          callback(userData);
        } else {
          // If the doc doesn't exist yet, we might be in the middle of loginWithGoogle. 
          // We provide a temporary user object so App.tsx doesn't redirect them to /login while we work.
          const tempUser: User = {
            id: firebaseUser.uid,
            name: firebaseUser.displayName || 'Technician',
            email: firebaseUser.email || '',
            role: firebaseUser.email === 'edgarclmz@gmail.com' ? 'admin' : 'technician',
            technicianCode: firebaseUser.email === 'edgarclmz@gmail.com' ? 'ecolmenarez' : undefined
          };
          callback(tempUser);
        }
      } catch (error) {
        console.error('Error syncing auth user:', error);
        // If we can't get the doc (maybe rules or network), keep the local one if we have it
        // otherwise we have to keep them logged out if we can't verify identity
      }
    } else {
      localStorage.removeItem(AUTH_KEY);
      callback(null);
    }
  });
};
