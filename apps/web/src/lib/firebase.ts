import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyCkNnYwVvnO42yArvy4sXXBQoglO4QVEIQ",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "formulir-murid-268.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "formulir-murid-268",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "formulir-murid-268.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "187265176397",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:187265176397:web:cf749b162f9648b741dd04",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-5G2G6GMRJ1",
};

export const firebaseApp: FirebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

export async function initializeFirebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === "undefined" || !(await isSupported())) return null;
  return getAnalytics(firebaseApp);
}
