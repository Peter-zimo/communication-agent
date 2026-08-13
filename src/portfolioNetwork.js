const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isLoopbackAddress(address) {
  const normalized = String(address || '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

export function isPortfolioWriteRequest(method, pathname) {
  return WRITE_METHODS.has(String(method || '').toUpperCase())
    && String(pathname || '').startsWith('/api/portfolio/');
}
