import { ref } from 'vue';
import type { Role } from '@mushroom/contracts';
import { http } from './api';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  shedCodes: string[];
}

const stored = localStorage.getItem('user');
export const currentUser = ref<SessionUser | null>(stored ? (JSON.parse(stored) as SessionUser) : null);

export async function login(username: string, password: string) {
  const { data } = await http.post<{ accessToken: string; user: SessionUser }>('/auth/login', {
    username,
    password,
  });
  localStorage.setItem('token', data.accessToken);
  localStorage.setItem('user', JSON.stringify(data.user));
  currentUser.value = data.user;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  currentUser.value = null;
}

export function canOperate(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin' || role === 'shed_manager';
}

export function canWriteRules(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin';
}

export function canImportDevices(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin' || role === 'shed_manager';
}

export function canConfigureSheds(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin';
}
