// SHA-256 in the browser (src/lib/sha256.ts): the router's page is plain
// HTTP by default, where browsers don't offer WebCrypto's digest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@/lib/sha256';

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

test('the FIPS 180-2 test vectors', () => {
  assert.equal(hex(sha256(bytes(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(bytes('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    hex(sha256(bytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('lengths around a block boundary (55, 56, 64 bytes) and a million a’s', () => {
  assert.equal(hex(sha256(bytes('a'.repeat(55)))), '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318');
  assert.equal(hex(sha256(bytes('a'.repeat(56)))), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a');
  assert.equal(hex(sha256(bytes('a'.repeat(64)))), 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb');
  assert.equal(hex(sha256(bytes('a'.repeat(1_000_000)))), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
});
