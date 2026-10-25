export default {
  async headers() {
    return [{
      source: '/:path*',
      headers: [{
        key: 'Content-Security-Policy',
        value: "connect-src 'self' https://tiles.openfreemap.org; worker-src 'self'",
      }],
    }];
  },
};
