import axios from 'axios';
import type { CreateAlertInput } from '@mushroom/contracts';

export const http = axios.create({ baseURL: '/api/v1' });

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const url = error.config?.url || '';
      if (!url.includes('/auth/login')) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (!location.pathname.startsWith('/login')) location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);

export function errorText(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: unknown; errors?: string[] } | undefined;
    if (data?.errors?.length) return data.errors.join('；');
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.join('；');
  }
  return '请求失败';
}

export type { CreateAlertInput };
