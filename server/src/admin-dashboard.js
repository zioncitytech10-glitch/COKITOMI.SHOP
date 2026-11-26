export async function authenticateAdmin({ authorization, adminUserIds, supabase }) {
  return supabase.verifyAdmin(authorization, adminUserIds);
}

export async function getAdminOverviewResponse({ authorization, adminUserIds, supabase }) {
  const admin = await authenticateAdmin({ authorization, adminUserIds, supabase });
  if (!admin) return { httpStatus: 401, body: { error: "Administrator access required" } };

  return {
    httpStatus: 200,
    body: {
      admin: { id: admin.id },
      overview: await supabase.getAdminOverview(),
    },
  };
}
