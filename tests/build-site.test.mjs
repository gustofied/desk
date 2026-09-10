import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CARD_REGISTRY } from '../src/card-registry.js';
import { buildSite } from '../scripts/build-site.mjs';

test('the public build excludes the standalone walkthrough while retaining normal site assets and data', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'desk-build-site-test-'));
  try {
    const publicFiles = new Map([
      ['.nojekyll', ''],
      ['CNAME', 'desk.example\n'],
      ['index.html', '<title>Desk</title>'],
      ['desk.js', 'console.log("Desk");'],
      ['robots.txt', 'User-agent: *\nAllow: /\n'],
      ['sitemap.xml', '<urlset/>'],
      ['styles/deal-view.css', '.deal { display: block; }'],
      ['assets/favicon.svg', '<svg/>'],
      ['assets/social/example/preview.png', 'normal card preview'],
      ['cards/example/index.html', '<title>Card preview</title>'],
      ['cli/desk', '#!/usr/bin/env node\n'],
      ['data/manifest.json', '{"version":1}'],
    ]);
    const localFiles = new Map([
      ['walkthrough/index.html', '<title>Local walkthrough</title>'],
      ['styles/walkthrough.css', '.walkthrough { display: block; }'],
      ['assets/walkthrough/player.js', 'console.log("walkthrough");'],
      ['data/equities-source.json', '{"source":"local"}'],
      ['data/v1/equity-prices.json', '{"source":"retired"}'],
    ]);
    for (const card of CARD_REGISTRY) {
      for (const file of [card.dataFile, card.dataTable?.file].filter(Boolean)) {
        if (!localFiles.has(file)) publicFiles.set(file, JSON.stringify({ fixture: file }));
      }
    }
    // Use the generated demo so the real publication validation runs unchanged.
    publicFiles.set('data/equities.json', await readFile(new URL('../data/equities.json', import.meta.url), 'utf8'));
    for (const [file, contents] of [...publicFiles, ...localFiles]) {
      const destination = join(projectRoot, file);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }

    const output = await buildSite({ projectRoot });

    assert.equal(output, join(projectRoot, '_site'));
    for (const [file, contents] of publicFiles) {
      assert.equal(await readFile(join(output, file), 'utf8'), contents, `${file} is published unchanged`);
    }
    for (const file of ['walkthrough', 'styles/walkthrough.css', 'assets/walkthrough', ...localFiles.keys()]) {
      await assert.rejects(access(join(output, file)), { code: 'ENOENT' }, `${file} is not published`);
    }
    for (const [file, contents] of localFiles) {
      assert.equal(await readFile(join(projectRoot, file), 'utf8'), contents, `${file} remains available locally`);
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
