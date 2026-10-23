const allowedOrigins = new Set([
  "https://webfidelize-saas.vercel.app",
  "https://webfidelize.com",
]);

export function authorizedDeploymentOrigin(value: string | undefined): string {
  if (!value || !allowedOrigins.has(value))
    throw new Error(
      "TEST_DEPLOYMENT_URL deve ser a origem exata autorizada: https://webfidelize-saas.vercel.app ou https://webfidelize.com.",
    );
  return value;
}
