// Story time and inspection time are separate: chapter buttons land on a
// settled composition, while continuous playback includes the handoff.
export const STORY_CHAPTERS = Object.freeze([
  { id: 'request', label: 'Request', start: 0, inspect: 4.4, title: 'Start with what you need.', description: '256 H100s in US East with InfiniBand.' },
  { id: 'window', label: 'Dates', start: 5, inspect: 9.6, title: 'Choose your two weeks.', description: '5 to 19 October. 86,016 GPU hours.' },
  { id: 'offers', label: 'Offers', start: 10, inspect: 14.3, title: 'Three offers. One request.', description: 'The same GPUs, dates and connection.' },
  { id: 'adjust', label: 'Adjust', start: 15, inspect: 20.8, title: 'Move the dates. See what changes.', description: 'Three days later, Ashburn 02 costs less.' },
  { id: 'quote', label: 'Quote', start: 22, inspect: 29.6, title: 'One quote. All your terms.', description: 'Ready to review. Nothing reserved.' },
  { id: 'desk', label: 'Desk', start: 30, inspect: 38.5, title: 'A desk built around your quote.', description: 'Your terms, market context and cost scenarios.' },
]);
export const STORY_DURATION = 40;
export function storyTime(value) {
  const time = Number(value);
  return Number.isFinite(time) ? Math.max(0, Math.min(STORY_DURATION, time)) : 0;
}
export function chapterAt(value) {
  const time = storyTime(value);
  return STORY_CHAPTERS.findLast(chapter => time >= chapter.start) ?? STORY_CHAPTERS[0];
}
export function formatStoryTime(value) {
  const seconds = Math.floor(storyTime(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
