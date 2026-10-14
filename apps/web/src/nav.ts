import type { Role } from '@mushroom/contracts';
import links from './admin-nav.json';

export interface AdminNavLink {
  to: string;
  label: string;
  roles?: Role[];
}

export const ADMIN_NAV = links as AdminNavLink[];

/** 未写 roles 的菜单所有已登录角色都看见。写了 roles 的，角色不在列表里就不出现。 */
export function visibleNav(role: Role | null | undefined): AdminNavLink[] {
  return ADMIN_NAV.filter((link) => !link.roles?.length || (role != null && link.roles.includes(role)));
}

export function navRoles(path: string): Role[] | undefined {
  const roles = ADMIN_NAV.find((link) => link.to === path)?.roles;
  return roles?.length ? roles : undefined;
}

export function roleCanOpen(role: Role | null | undefined, path: string): boolean {
  const roles = navRoles(path);
  if (!roles) return true;
  return role != null && roles.includes(role);
}
