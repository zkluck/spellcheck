import { registerRole, hasRole } from '@/lib/roles/registry';
import { basicRole } from '@/lib/roles/builtin/basicRole';
import { reviewerRole } from '@/lib/roles/builtin/reviewerRole';

/**
 * 注册内置角色。可在后端 API 启动时调用一次。
 */
export function registerBuiltinRoles() {
  if (!hasRole(basicRole.id)) registerRole(basicRole);
  if (!hasRole(reviewerRole.id)) registerRole(reviewerRole);
}
