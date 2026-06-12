const crypto = require('crypto');

const TOKEN_BYTES = 16;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('hex');
}

function validateToken(provided, stored) {
  if (!provided || !stored) return false;
  if (provided.length !== stored.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(stored));
  } catch {
    return false;
  }
}

function parseCookie(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    cookies[name] = value;
  });
  return cookies;
}

function buildSpeakerCookie(token) {
  return `bs_speaker_token=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

module.exports = {
  generateToken,
  validateToken,
  parseCookie,
  buildSpeakerCookie
};
