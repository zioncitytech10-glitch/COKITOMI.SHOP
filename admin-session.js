export async function clearAdminSession(authClient) {
  if (!authClient?.auth?.signOut) return { remoteLogoutFailed: true };
  try {
    // Supabase clears its local session before attempting this best-effort server revocation.
    const { error } = await authClient.auth.signOut({ scope: "local" });
    return { remoteLogoutFailed: Boolean(error) };
  } catch {
    return { remoteLogoutFailed: true };
  }
}

export function getAdminLoginPath(pathname) {
  const adminSegment = pathname.lastIndexOf("/admin");

  const siteRoot = adminSegment >= 0
    ? pathname.slice(0, adminSegment + 1)
    : pathname.slice(0, pathname.lastIndexOf("/") + 1);

  return `${siteRoot}admin.html`;
}

export async function logoutAndRedirect(authClient, pathname, navigate) {
  const result = await clearAdminSession(authClient);
  const notice = result.remoteLogoutFailed ? "warning" : "success";
  const redirectPath = `${getAdminLoginPath(pathname)}?logout=${notice}`;
  navigate(redirectPath);
  return { ...result, redirectPath };
}
