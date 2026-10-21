export type Role = "OWNER" | "MANAGER" | "EMPLOYEE";
export function canManage(role: Role) {
  return role === "OWNER" || role === "MANAGER";
}
export function hasAccess(
  status: string,
  trialEnds: string | null,
  now = new Date(),
) {
  return (
    status === "active" ||
    (status === "trialing" &&
      trialEnds !== null &&
      new Date(trialEnds).getTime() > now.getTime())
  );
}
