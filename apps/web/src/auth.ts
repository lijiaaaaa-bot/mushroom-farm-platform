import { ref } from 'vue';
import { isRole, type Role } from '@mushroom/contracts';
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

export function readSessionRole(): Role | null {
  const raw = localStorage.getItem('user');
  if (!raw) return null;
  try {
    const role = (JSON.parse(raw) as { role?: unknown }).role;
    return typeof role === 'string' && isRole(role) ? role : null;
  } catch {
    return null;
  }
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

/** 与 POST/PATCH /devices 相同：超管与生产管理员。 */
export function canRegisterDevices(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin';
}

export function canConfigureSheds(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin';
}

export function canCorrectHarvest(role: Role | undefined) {
  return role === 'super_admin' || role === 'production_admin' || role === 'shed_manager';
}
