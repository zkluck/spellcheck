/*
 * 角色注册表：提供注册、获取、列举角色的能力
 */
import { Role } from './types';

const registry = new Map<string, Role>();

export function registerRole(role: Role): void {
  if (!role?.id) throw new Error('registerRole: role.id is required');
  registry.set(role.id, role);
}

export function getRole(id: string): Role | undefined {
  return registry.get(id);
}

export function listRoles(): Role[] {
  return Array.from(registry.values());
}

export function hasRole(id: string): boolean {
  return registry.has(id);
}
