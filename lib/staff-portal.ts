// An unlisted entry point, not a substitute for password/session authorization.
export const STAFF_PORTAL_PATH = '/heyet-g7m4q9x2k8';

export function staffPortalPath(section: '' | '/store' | '/online' = '') {
  return STAFF_PORTAL_PATH + section;
}

export function isStaffPortalPath(path: string) {
  return path === STAFF_PORTAL_PATH || path.startsWith(STAFF_PORTAL_PATH + '/');
}

export function canOpenStaffPage(role: string, path: string) {
  if (path === STAFF_PORTAL_PATH) return true;
  if (path === staffPortalPath('/store')) return role === 'admin';
  if (path === staffPortalPath('/online')) return ['admin', 'manager', 'online_manager', 'online_assistant'].includes(role);
  return false;
}
