import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { STORY_CHAPTERS, STORY_DURATION, chapterAt, formatStoryTime, storyTime } from '../src/walkthrough-story.js';

test('quote walkthrough chapters can be inspected and replayed in either direction', () => {
  assert.equal(STORY_CHAPTERS[0].start, 0);
  assert.equal(new Set(STORY_CHAPTERS.map(chapter => chapter.id)).size, 6);
  for (const [index, chapter] of STORY_CHAPTERS.entries()) {
    const end = STORY_CHAPTERS[index + 1]?.start ?? STORY_DURATION;
    assert.ok(chapter.inspect >= chapter.start && chapter.inspect < end);
    assert.equal(chapterAt(chapter.start), chapter);
    assert.equal(chapterAt(chapter.inspect), chapter);
  }
  for (const chapter of [...STORY_CHAPTERS].reverse()) assert.equal(chapterAt(chapter.inspect), chapter);
  assert.equal(chapterAt(-20), STORY_CHAPTERS[0]);
  assert.equal(chapterAt(100), STORY_CHAPTERS.at(-1));
  assert.equal(storyTime(NaN), 0);
  assert.equal(storyTime(Infinity), 0);
  assert.equal(formatStoryTime(30), '00:30');
  assert.equal(formatStoryTime(STORY_DURATION), '00:40');
  assert.equal(chapterAt(29.9).id, 'quote');
  assert.equal(chapterAt(30).id, 'desk');
});

test('the walkthrough uses real catalog renderers and a quiet, accessible demo disclosure', async () => {
  const html = await readFile(new URL('../walkthrough/index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/walkthrough.js', import.meta.url), 'utf8');
  assert.match(html, /<details class="demo-note"><summary>Demo<\/summary>/);
  assert.match(html, /class="stage" aria-hidden="true" inert/);
  assert.match(html, /class="accessible-summary sr-only"/);
  assert.doesNotMatch(html, /desk-assumptions|page-note|demo-example|saved-confirmation/);
  assert.match(source, /renderWalkthroughDeskCards/);
  assert.match(source, /walkthroughDeskUrl\(location.href\)/);
  assert.match(source, /deal-view-host--catalog/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|\.on\(['"]complete/);
});
