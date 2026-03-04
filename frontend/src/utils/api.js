import axios from 'axios';
import { auth } from '../firebase';

const BACKEND_URL = import.meta.env.PROD
  ? 'https://zealous-kindness-production-3ecb.up.railway.app'
  : '';

const api = axios.create({ baseURL: `${BACKEND_URL}/api` });

// Resolve image paths to full URLs in production (player images served from backend)
export function resolveImageUrl(path) {
  if (!path) return path;
  if (path.startsWith('http')) return path;
  return `${BACKEND_URL}${path}`;
}

api.interceptors.request.use(async (config) => {
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
