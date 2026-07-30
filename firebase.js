// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBgtoBruGJbU4IEFEEz5ChrkzfHAtlR87M",
  authDomain: "codearena-842a6.firebaseapp.com",
  projectId: "codearena-842a6",
  storageBucket: "codearena-842a6.firebasestorage.app",
  messagingSenderId: "209343884753",
  appId: "1:209343884753:web:8e673bae4225d43b9184f0",
  measurementId: "G-X7P5W2MQWL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);