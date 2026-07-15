const getAdminBaseUrl = () => {
  const baseUrl = process.env.ADMIN_URL || process.env.FRONTEND_URL;

  if (!baseUrl) {
    console.error('[Admin URL] ADMIN_URL or FRONTEND_URL must be configured for admin action links.');
    return null;
  }

  return baseUrl.replace(/\/$/, '');
};

const buildAdminUrl = (path = '') => {
  const baseUrl = getAdminBaseUrl();
  if (!baseUrl) return null;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
};

module.exports = {
  getAdminBaseUrl,
  buildAdminUrl
};
