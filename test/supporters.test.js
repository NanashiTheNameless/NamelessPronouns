import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSupportLinks } from '../src/supporters.js';

test('support page uses the canonical funding links', () => {
  assert.deepEqual(listSupportLinks().map(({ name, url }) => ({ name, url })), [
    { name: 'GitHub Sponsors', url: 'https://github.com/sponsors/NanashiTheNameless' },
    { name: 'Buy Me a Coffee', url: 'https://buymeacoffee.com/NamelessNanashi' },
    { name: 'Ko-fi', url: 'https://ko-fi.com/NanashiTheNameless' },
    { name: 'Liberapay', url: 'https://liberapay.com/NamelessNanashi' },
    { name: 'Throne', url: 'https://throne.com/NamelessNanashi' },
  ]);
});
