// Firebase client initialisation.
// The web config below is read from environment variables (see .env.example).
// These values identify the Firebase project and are safe to ship in the browser.
// Real secrets (Ceipal password, LLM token) never live here — they stay in Cloud Functions.

import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "PLACEHOLDER_FIREBASE_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "PLACEHOLDER_PROJECT.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "PLACEHOLDER_PROJECT",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? "PLACEHOLDER_PROJECT.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "PLACEHOLDER_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? "PLACEHOLDER_APP_ID",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || undefined,
};

const region = import.meta.env.VITE_FUNCTIONS_REGION ?? "us-central1";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app, region);
export const db = getFirestore(app);

// Analytics: only in a supported browser and never against the emulators.
// Guarded so it can never break local development.
if (firebaseConfig.measurementId && import.meta.env.VITE_USE_EMULATORS !== "true") {
  isSupported()
    .then((ok) => {
      if (ok) getAnalytics(app);
    })
    .catch(() => {
      /* analytics unavailable — ignore */
    });
}

// Point at local emulators during development when VITE_USE_EMULATORS=true.
if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

// True when the app is still running on placeholder config (helps show a friendly banner).
export const isPlaceholderConfig =
  firebaseConfig.projectId === "PLACEHOLDER_PROJECT" ||
  !import.meta.env.VITE_FIREBASE_API_KEY;
