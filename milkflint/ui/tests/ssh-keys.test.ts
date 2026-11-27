// SSH keys on Router access (src/features/admin-password/ssh/keys.ts):
// authorized_keys lines read as Dropbear reads them, each key's type,
// size, name and the fingerprint ssh-keygen -l prints, how well each suits
// signing in here (a suggestion: any public key can be added, and the ones
// already there stay), and the file's edits (lines it doesn't know kept as
// they are). The keys here are throwaway ones made for this test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addKeys, keysOf, parseKey, removeKey } from '@/features/admin-password/ssh/keys';

const ED = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBaaJ2hfIBm7nXi+R0q1CBQtBTdhNh/e41OEqN1Ei6Jd laptop@example';
const SK =
  'sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gAAAABHNzaDo= yubikey';
const RSA =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCxHkUVrC+Iwv9TGfQbkBEiPGT0GV1arvTY2FSocW8pU1WDrA/1XZDRuggUZMuBE0FE7UDg2SkaGbcG1RHXM+vcQJntDbxqH6LTUHzuKr3D1GtRkaTKVEMsgKOKhXLLsy2IQ3WHGeJ/NewjBsXD5bVK82dpnN/YHE+8wSEeWEhSa/TuNA48OnWURUp1MuTRhR9UxO+PAJGj9XQrK+6fdHL3hu5INONRgWTnZUUW7Y2EgkQO4vzrIPy1PhEae/GMSHADc5bBE6j6zp95S9akXzKmmvZG95EgpIkuhUWjQPFa0b/xGgZ15A8B3TEvYDF9WVMzgqr2AinWjn0zEiUAWZNRFosJARkC0sVHp9Hc9weG5VGiRKSFom/DTyVdrqfzhcrilmM+9BHIUMCoGwnWcqZgBgX31FX1rt/Ez+Dzl5/i4SGntstFPenWLj1GNfMgfgG7viP5pVRMi8xJ55uqIvYFj09+6T/cJ+uBtwZDPmnbz/Q0TxqppnlPDMeziKobops= old-rsa';
const RSA1024 =
  'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAAgQDD7w6+vAaSiINJFNxFbvS4qJy1aCYMqsWk+R72sLWdmFE3QwQYyP+qznxuiDErjFmq9rQiEeuzlgTZq1Y+V1IB9QRnBM172GxnM08pqY5f+5RfK7dRXyamiMAMBIkHgRHJzjJqwxneS1YycUTQ4jMMYlBevJkCt0pBJHi9limjdQ== tiny';
const EC =
  'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBFpFvOh5DClmTWyktKGSomdPdrzxoTkYqIqpEHkiBVEUMFpUHAgHosj6MXBeWK+3zXo8WlLU7mbf8NmWfECkFhg= phone';
// a post-quantum key's line: its type name inside, made up after it
const PQ = 'ssh-mldsa44-ed25519 AAAAE3NzaC1tbGRzYTQ0LWVkMjU1MTkAAAABAA== pq';

test('an Ed25519 key: its type, name and SHA-256 fingerprint as ssh-keygen -l prints it', () => {
  const k = parseKey(ED);
  assert.equal(k?.kind, 'ed25519');
  assert.equal(k.comment, 'laptop@example');
  assert.equal(k.fingerprint, 'SHA256:q1d8QJC72rqWrrhVYexlUbuOtPntwV6e+QFs4h9PcA0');
  assert.equal(k.options, undefined);
  assert.equal(k.fit, 'recommended');
  assert.equal(k.note, undefined);
});

test('Ed25519 on a security key, and RSA with its size', () => {
  const sk = parseKey(SK);
  assert.equal(sk?.kind, 'ed25519-sk');
  assert.equal(sk.fingerprint, 'SHA256:nX0hpi5mKbTIJ10yBq5/sLQhiI1Y0RBAqN0drDdgJWs');
  assert.equal(sk.fit, 'recommended');
  const rsa = parseKey(RSA);
  assert.equal(rsa?.kind, 'rsa');
  assert.equal(rsa.bits, 3072);
  assert.equal(rsa.fingerprint, 'SHA256:SpgXGxlXqFnFKt7ZIBzbFUFoRhsC8uyx7Qt0q/H9xIQ');
  assert.equal(rsa.fit, 'works');
  assert.equal(rsa.note, undefined);
});

test('ECDSA works; a short RSA key still signs in, flagged; DSA and post-quantum keys can’t sign in yet, and say why', () => {
  const ec = parseKey(EC);
  assert.equal(ec?.kind, 'ecdsa');
  assert.equal(ec.fingerprint, 'SHA256:L8cqOBRWDJqvsJ0mbtbiK7H1iQbZyb57jhmSqjv7Yv8');
  assert.equal(ec.fit, 'works');
  const small = parseKey(RSA1024);
  assert.equal(small?.bits, 1024);
  assert.equal(small.fit, 'weak');
  assert.match(small.note ?? '', /still signs in/);
  const pq = parseKey(PQ);
  assert.equal(pq?.kind, 'mldsa');
  assert.equal(pq.fit, 'unsupported');
  assert.match(pq.note ?? '', /post-quantum/i);
});

test('options before the key, with a quoted comma and space in them', () => {
  const k = parseKey(`from="10.0.0.0/8,192.168.1.0/24",command="echo hi there" ${ED}`);
  assert.equal(k?.kind, 'ed25519');
  assert.equal(k.options, 'from="10.0.0.0/8,192.168.1.0/24",command="echo hi there"');
  assert.equal(k.comment, 'laptop@example');
});

test('not a key: a comment, a blank, garbage, a type its base64 doesn’t name', () => {
  assert.equal(parseKey('# a comment'), undefined);
  assert.equal(parseKey('   '), undefined);
  assert.equal(parseKey('hello world'), undefined);
  assert.equal(parseKey('ssh-ed25519 !!!notbase64'), undefined);
  // an Ed25519 key's base64 under the RSA type name
  assert.equal(parseKey(ED.replace('ssh-ed25519', 'ssh-rsa')), undefined);
});

test('the file’s keys, and the lines it doesn’t know kept when one is removed', () => {
  const file = `# keys\n${ED}\nsomething odd\n\n${RSA}\n`;
  assert.deepEqual(
    keysOf(file).map((k) => k.kind),
    ['ed25519', 'rsa'],
  );
  assert.equal(removeKey(file, ED), `# keys\nsomething odd\n\n${RSA}\n`);
});

test('adding: any public key, one or more pasted, a note for one that’s weak or can’t sign in yet', () => {
  assert.deepEqual(addKeys('', ED), { text: `${ED}\n`, added: 1, notes: [] });
  assert.deepEqual(addKeys(ED, `${SK}\n\n${RSA}\n`), { text: `${ED}\n${SK}\n${RSA}\n`, added: 2, notes: [] });
  assert.deepEqual(addKeys('', EC), { text: `${EC}\n`, added: 1, notes: [] });
  const weak = addKeys('', `${RSA1024}\n${PQ}`);
  assert.equal(weak.added, 2);
  assert.equal(weak.notes.length, 2);
  // refused only when it isn't a public key, or is one already there
  assert.match(addKeys(`${ED}\n`, ED).error ?? '', /already/);
  // the same key under another name is the same key
  assert.match(addKeys(`${ED}\n`, ED.replace('laptop@example', 'other')).error ?? '', /already/);
  assert.match(addKeys('', 'not a key').error ?? '', /public key/);
  assert.match(
    addKeys('', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----').error ?? '',
    /a private key/,
  );
  assert.equal(addKeys('', '  ').added, 0);
});
