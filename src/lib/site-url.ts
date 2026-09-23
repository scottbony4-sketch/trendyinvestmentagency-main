import { resolveSiteUrl as resolveSiteUrlHelper } from "./site-url-helper.js";

export function resolveSiteUrl(options?: {
  env?: Record<string, string | undefined>;
  location?: { origin?: string };
}) {
  return resolveSiteUrlHelper(options as never);
}

export function getSiteUrl() {
  return resolveSiteUrl();
}

export function getResetPasswordRedirectUrl() {
  const siteUrl = getSiteUrl();
  return siteUrl ? `${siteUrl}/reset-password` : "/reset-password";
}
