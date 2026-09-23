export function resolveSiteUrl(options) {
  const runtimeEnv = options?.env ?? {
    ...((typeof process !== 'undefined' && process.env) ? process.env : {}),
    ...((typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {}),
  };

  const configuredSiteUrl = (runtimeEnv.VITE_SITE_URL || runtimeEnv.SITE_URL || runtimeEnv.NEXT_PUBLIC_SITE_URL || '').trim();
  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/+$/, '');
  }

  const vercelUrl = (runtimeEnv.VERCEL_URL || runtimeEnv.NEXT_PUBLIC_VERCEL_URL || runtimeEnv.VITE_VERCEL_URL || '').trim();
  if (vercelUrl) {
    return `https://${vercelUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  if (options?.location?.origin) {
    return options.location.origin;
  }

  return '';
}
