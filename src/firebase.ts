import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyDLuHadKG1RLVwjt8YYcEN6_aEOHoK6m8E",
  authDomain: "spending-tracker-f1ea5.firebaseapp.com",
  projectId: "spending-tracker-f1ea5",
  storageBucket: "spending-tracker-f1ea5.firebasestorage.app",
  messagingSenderId: "473469146048",
  appId: "1:473469146048:web:14df2de4b00796ba32ee25",
  measurementId: "G-6LRX5MV8PL"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app);
