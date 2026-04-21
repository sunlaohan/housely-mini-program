module.exports = {
  mode: 'auto',
  provider: 'MinerU',
  requestTimeoutMs: 120000,
  fallbackToMockOnFailure: true,
  service: {
    endpoint: 'http://YOUR_SERVER_IP:9000/parse',
    bearerToken: 'replace-me'
  }
};
