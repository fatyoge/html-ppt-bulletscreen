const { generateToken, validateToken, parseCookie, buildSpeakerCookie, buildModeratorCookie, resolveRole } = require('../lib/speaker-auth');

describe('speaker-auth', () => {
  test('generateToken returns a 32-char hex string', () => {
    const token = generateToken();
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  test('validateToken accepts matching token', () => {
    const token = generateToken();
    expect(validateToken(token, token)).toBe(true);
  });

  test('validateToken rejects mismatched token', () => {
    const a = generateToken();
    const b = generateToken();
    expect(validateToken(a, b)).toBe(false);
  });

  test('validateToken rejects empty values', () => {
    expect(validateToken('', 'abc')).toBe(false);
    expect(validateToken('abc', '')).toBe(false);
    expect(validateToken(undefined, 'abc')).toBe(false);
  });

  test('parseCookie parses semi-colon separated cookies', () => {
    expect(parseCookie('a=1; bs_speaker_token=xyz; b=2')).toEqual({
      a: '1',
      bs_speaker_token: 'xyz',
      b: '2'
    });
  });

  test('parseCookie returns empty object for missing header', () => {
    expect(parseCookie()).toEqual({});
    expect(parseCookie('')).toEqual({});
  });

  test('buildSpeakerCookie returns expected Set-Cookie string', () => {
    expect(buildSpeakerCookie('abc123')).toBe(
      'bs_speaker_token=abc123; HttpOnly; SameSite=Strict; Path=/'
    );
  });

  test('buildModeratorCookie returns expected Set-Cookie string', () => {
    expect(buildModeratorCookie()).toBe(
      'bs_moderator=1; HttpOnly; SameSite=Strict; Path=/'
    );
  });

  test('resolveRole returns speaker for valid speaker token cookie', () => {
    const token = generateToken();
    expect(resolveRole(`bs_speaker_token=${token}`, token)).toBe('speaker');
  });

  test('resolveRole returns moderator when only moderator cookie present', () => {
    expect(resolveRole('bs_moderator=1', 'anyStoredToken')).toBe('moderator');
  });

  test('resolveRole returns audience when no role cookies', () => {
    expect(resolveRole('', 'anyStoredToken')).toBe('audience');
    expect(resolveRole(undefined, 'anyStoredToken')).toBe('audience');
  });

  test('resolveRole prefers speaker over moderator', () => {
    const token = generateToken();
    expect(resolveRole(`bs_speaker_token=${token}; bs_moderator=1`, token)).toBe('speaker');
  });

  test('resolveRole returns audience for invalid speaker token', () => {
    expect(resolveRole('bs_speaker_token=wrong', 'realToken')).toBe('audience');
  });
});
