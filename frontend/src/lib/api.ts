import axios from 'axios';
import { auth } from '../config/firebase';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: BACKEND_URL,
  timeout: 60_000,
});

// Attach Firebase ID token to every request
api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired — Firebase will auto-refresh on next request
      console.warn('Auth token expired, will refresh on next request');
    }
    return Promise.reject(error);
  }
);

export default api;
