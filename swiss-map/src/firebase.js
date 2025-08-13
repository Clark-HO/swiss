// src/firebase.js
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAuth, signInAnonymously } from 'firebase/auth'

// 你的 Firebase 設定
const firebaseConfig = {
  apiKey: "AIzaSyCezyTlf5b4r6OqaJh7B9TID8rjMT2wEdY",
  authDomain: "swisstravel-c53dc.firebaseapp.com",
  projectId: "swisstravel-c53dc",
  storageBucket: "swisstravel-c53dc.appspot.com", // 注意這裡是 appspot.com，不是 firebasestorage.app
  messagingSenderId: "760522164771",
  appId: "1:760522164771:web:e6b2762f2941571fb8ff96",
  measurementId: "G-4TND01DC1Y"
}

// 初始化
const app = initializeApp(firebaseConfig)

// 匯出 Firestore / Storage / Auth
export const db = getFirestore(app)
export const storage = getStorage(app)
export const auth = getAuth(app)

// 匿名登入
export async function ensureAuth() {
  if (!auth.currentUser) await signInAnonymously(auth)
}
