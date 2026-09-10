import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { QUOTE_REQUEST, rankedQuotes, quoteFor, formatUsd } from './quote-story-model.js';
import { STORY_CHAPTERS, STORY_DURATION, chapterAt, formatStoryTime, storyTime } from './walkthrough-story.js';
import { renderWalkthroughDeskCards } from './walkthrough-desk-cards.js';
import { walkthroughDeskUrl } from './walkthrough-desk-link.js';

gsap.registerPlugin(CustomEase);
CustomEase.create('desk-story', '.32,.72,0,1');

const player = document.querySelector('.player');
const stage = player.querySelector('.stage');
const q = selector => stage.querySelector(selector);
const all = selector => [...stage.querySelectorAll(selector)];
const playButton = player.querySelector('.play-button');
const replayButton = player.querySelector('.replay-button');
const scrubber = player.querySelector('#story-position');
const chapterNav = document.querySelector('.chapters');
const status = player.querySelector('.playback-status');
const initial = rankedQuotes(QUOTE_REQUEST.initialStart);
const alternate = rankedQuotes(QUOTE_REQUEST.alternateStart);
const selected = alternate[0];
const deskPresentation = renderWalkthroughDeskCards({ palette: {
  theme: 'dark', paper: '#1c1d1a', line: '#b7d07b', text: '#c0d58b',
  secondary: '#7f8c6d', area: '#b7d07b',
} });
const openRequestDesk = document.querySelector('.open-request-desk');
openRequestDesk.href = walkthroughDeskUrl(location.href);
const cents = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
const describeQuote = offer => `${offer.label}, ${formatUsd(offer.rateUsd,cents)} per GPU hour, ${formatUsd(offer.totalUsd,cents)} total.`;
const accessibleSummaries = {
  request: 'An illustrative request for 32 nodes, eight H100 SXM GPUs per node, 256 GPUs in total, in US East with InfiniBand.',
  window: '5 October 2026 at 00:00 UTC to 19 October at 00:00 UTC, an exclusive fourteen day window. 86,016 GPU hours.',
  offers: 'Illustrative offers, lowest total first. ' + initial.map(describeQuote).join(' '),
  adjust: '8 October 2026 at 00:00 UTC to 22 October at 00:00 UTC. Same quantity and duration. ' + alternate.map(describeQuote).join(' '),
  quote: 'Illustrative quote. ' + describeQuote(selected) + ' 256 H100 SXM GPUs with InfiniBand in US East, 8 October 2026 at 00:00 UTC to 22 October at 00:00 UTC. Nothing was purchased, reserved or saved to the actual Desk.',
  desk: deskPresentation.summary,
};
let timeline;
let media;
let lastChapter;
let resizeFrame;
let stageSize = '';
let requestedPlaying = false;
const forceReducedMotion = new URLSearchParams(location.search).get('motion') === 'reduce';
let reducedMotion = forceReducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

q('.node-grid').innerHTML = '<i></i>'.repeat(QUOTE_REQUEST.nodeCount);
q('.calendar-days').innerHTML = Array.from({length:31}, (_, i) => '<span><b>' + (i + 1) + '</b></span>').join('');
q('.saving-amount').textContent = formatUsd((initial[0].totalCents - selected.totalCents) / 100);
q('.offer-list').innerHTML = initial.map(offer => {
  const shifted = quoteFor(offer.id, QUOTE_REQUEST.alternateStart);
  return `<article class="offer-row" data-offer="${offer.id}">
    <div class="offer-surface"></div>
    <div class="offer-identity"><div class="offer-name">${offer.label}</div><div class="offer-region">H100 / US East</div></div>
    <div class="offer-availability">${offer.availableGpus} GPUs<small>available</small></div>
    <div class="offer-price"><span class="price-original">${formatUsd(offer.rateUsd,cents)}</span><span class="price-shifted">${formatUsd(shifted.rateUsd,cents)}</span></div>
    <span class="offer-price-unit">USD / GPU-h</span>
    <div class="offer-total"><span class="price-original">${formatUsd(offer.totalUsd,cents)}</span><span class="price-shifted">${formatUsd(shifted.totalUsd,cents)}</span></div><span class="offer-arrow">↗</span>
    ${offer.id === selected.id ? `<div class="quote-details"><div class="quote-eyebrow"><span>14 DAY TERM</span><b>DQ 024</b></div><span class="quote-rate-label">USD / GPU-h</span><div class="quote-specs"><div><span>Compute</span><strong>256 H100 SXM</strong></div><div><span>Connection</span><strong>InfiniBand</strong></div><div><span>8 to 22 Oct 2026</span><strong>86,016 GPU-hours</strong></div><div><span>Total / USD</span><strong>${formatUsd(selected.totalUsd,cents)}</strong></div></div><div class="quote-save"><span class="save-label">Save quote</span><span class="saved-label">Saved</span><span class="save-arrow">↗</span><svg class="save-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div></div>` : ''}
  </article>`;
}).join('');
chapterNav.innerHTML = STORY_CHAPTERS.map((chapter,index) => `<button type="button" data-chapter="${chapter.id}" aria-label="${index + 1}. ${chapter.label}" disabled><span>${String(index + 1).padStart(2,'0')}</span>${chapter.label}</button>`).join('');
q(`[data-offer="${selected.id}"]`).insertAdjacentHTML('beforeend', '<div class="quote-transfer-frame"></div>');
for (const card of deskPresentation.cards) {
  const frame = document.createElement('article');
  frame.className = `desk-card${card.id === 'quote' ? ' desk-quote-slot' : ''}`;
  frame.dataset.card = card.id;
  if (card.mount) {
    const host = document.createElement('div');
    host.className = 'deal-view-host deal-view-host--catalog';
    frame.append(host);
    card.mount(host);
  } else frame.innerHTML = card.svg;
  q('.desk-grid').append(frame);
}
scrubber.max = String(STORY_DURATION);

function syncPlayer(announce = false) {
  const time = timeline?.time() ?? 0;
  const chapter = chapterAt(time);
  const playing = Boolean(timeline && !timeline.paused() && time < STORY_DURATION && !document.hidden);
  player.toggleAttribute('data-playing',playing);
  playButton.setAttribute('aria-label',reducedMotion ? 'Next chapter' : playing ? 'Pause walkthrough' : time >= STORY_DURATION ? 'Replay walkthrough' : 'Play walkthrough');
  playButton.querySelector('span').textContent = reducedMotion ? 'Next' : playing ? 'Pause' : time >= STORY_DURATION ? 'Replay' : 'Play';
  scrubber.value = String(time);
  scrubber.setAttribute('aria-valuetext',`${formatStoryTime(time)} of ${formatStoryTime(STORY_DURATION)}. ${chapter.label}`);
  player.querySelector('.timecode').textContent = `${formatStoryTime(time)} / ${formatStoryTime(STORY_DURATION)}`;
  if (chapter.id !== lastChapter) {
    lastChapter = chapter.id;
    player.querySelector('.story-caption h2').textContent = chapter.title;
    player.querySelector('.accessible-summary').textContent = accessibleSummaries[chapter.id];
    chapterNav.querySelectorAll('button').forEach(button => {
      if (button.dataset.chapter === chapter.id) button.setAttribute('aria-current','step');
      else button.removeAttribute('aria-current');
    });
  }
  openRequestDesk.hidden = time < 34;
  if (announce) status.textContent = `${chapter.title} ${accessibleSummaries[chapter.id]}${reducedMotion ? ' Reduced motion: use the chapter buttons to continue.' : ''}`;
}

// One clock owns all visual state, including reverse seeks. No timed DOM swaps,
// network calls, clipboard access, orders or persistent saves are involved.
function createStory() {
  let previousTime = timeline?.time() ?? 0;
  let keepPlaying = requestedPlaying && !document.hidden;
  media?.revert();
  media = gsap.matchMedia();
  media.add({mobile:'(max-width: 700px)',reduce:'(prefers-reduced-motion: reduce)',desktop:'(min-width: 701px)'}, context => {
    const {mobile,reduce} = context.conditions;
    reducedMotion = forceReducedMotion || reduce;
    stage.dataset.motion = reducedMotion ? 'reduced' : 'full';
    const bounds = stage.getBoundingClientRect();
    const selectedRow = q(`[data-offer="${selected.id}"]`);
    const rows = all('.offer-row');
    const rowRect = selectedRow.getBoundingClientRect();
    const target = q('.quote-destination').getBoundingClientRect();
    const deskSlot = q('.desk-quote-slot').getBoundingClientRect();
    const identity = selectedRow.querySelector('.offer-identity');
    const identityRect = identity.getBoundingClientRect();
    const price = selectedRow.querySelector('.offer-price');
    const priceRect = price.getBoundingClientRect();
    const details = q('.quote-details');
    // Set the final detail layout before playback, never animate layout size.
    details.style.width = target.width + 'px';
    details.style.height = target.height + 'px';
    const catalogName = q('.desk-quote-slot .deal-view__label');
    const catalogPrice = q('.desk-quote-slot .deal-view__quote');
    const catalogNameRect = catalogName.getBoundingClientRect();
    const catalogPriceRect = catalogPrice.getBoundingClientRect();
    const transferFrame = q('.quote-transfer-frame');
    transferFrame.style.width = target.width + 'px';
    transferFrame.style.height = target.height + 'px';
    const stageStyles = getComputedStyle(stage);
    const metric = key => parseFloat(stageStyles.getPropertyValue(key));
    const padding = metric('--quote-inset');
    const name = identity.querySelector('.offer-name');
    const nameScale = metric('--quote-name-size') / parseFloat(getComputedStyle(name).fontSize);
    const priceScale = metric('--quote-rate-size') / parseFloat(getComputedStyle(price).fontSize);
    const save = q('.quote-save');
    const rowPitch = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
    const window = q('.calendar-window');
    const windowRect = window.getBoundingClientRect();
    const calendarRect = q('.calendar').getBoundingClientRect();
    const shift = calendarRect.width * 3 / 31;
    const pointer = q('.story-pointer');
    const coord = (node,fx=.5,fy=.5) => {
      const rect = node.getBoundingClientRect();
      return {x:rect.left-bounds.left+rect.width*fx,y:rect.top-bounds.top+rect.height*fy};
    };
    const point = (x,y) => ({x:x-bounds.left,y:y-bounds.top});
    const destinations = {
      fields:all('.request-field').map(node=>coord(node,.72,.62)),
      find:coord(q('.find-action'),.8,.5),
      windowStart:point(windowRect.left+4,windowRect.top+windowRect.height/2),
      windowEnd:point(windowRect.right-6,windowRect.top+windowRect.height/2),
      windowMiddle:point(windowRect.left+windowRect.width*.55,windowRect.top+windowRect.height/2),
      selected:point(rowRect.right-24,rowRect.top-(initial.findIndex(offer=>offer.id===selected.id))*rowPitch+rowRect.height/2),
      save:point(target.left+save.offsetLeft+save.offsetWidth-24,target.top+save.offsetTop+save.offsetHeight/2),
    };
    const tl = gsap.timeline({paused:true,defaults:{duration:.7,ease:'desk-story'},onUpdate:()=>syncPlayer(),onComplete:()=>{
      requestedPlaying=false;
      syncPlayer();
      status.textContent='Flow finished. An illustrative desk built around the quote. Market values and hedge scenarios are examples only. Nothing was purchased, reserved or saved to your actual desk.';
    }});
    timeline=tl;
    STORY_CHAPTERS.forEach(chapter=>tl.addLabel(chapter.id,chapter.start));
    tl.set(all('.date-panel,.offers-heading,.shift-note,.story-pointer,.quote-details,.price-shifted,.date-shifted,.saved-label,.save-check'),{opacity:0},0)
      .set(all('.desk-card,.quote-transfer-frame'),{opacity:0},0)
      .set(all('.price-original,.date-original,.save-label,.save-arrow'),{opacity:1},0)
      .set(rows,{opacity:0,x:0,y:0,zIndex:1},0)
      .set(all('.request-field i'),{opacity:0},0)
      .set(all('.node-grid>i'),{opacity:.25},0)
      .set(q('.calendar-window'),{clipPath:'inset(0 93% 0 0)',x:0},0)
      .set(q('.calendar-window>span'),{opacity:0},0)
      .set(q('.request-panel'),{x:0,y:0,opacity:1},0)
      .set(all('[data-step]'),{opacity:0,y:0},0)
      .set(q('[data-step="request"]'),{opacity:1},0)
      .set(pointer,{x:bounds.width*.72,y:bounds.height*.72,scale:1},0)
      .set(q('.story-pointer i'),{opacity:0,scale:.9},0);

    const move = (destination,at,duration=.6) => tl.to(pointer,{...destination,opacity:1,duration},at);
    const press = at => tl.to(pointer,{scale:.86,duration:.12},at)
      .to(pointer,{scale:1,duration:.22},at+.12)
      .fromTo(q('.story-pointer i'),{opacity:.5,scale:.9},{opacity:0,scale:1.5,duration:.5,immediateRender:false},at);
    const nav = (id,at) => tl.to(all('[data-step]'),{opacity:0,duration:.18},at)
      .fromTo(q(`[data-step="${id}"]`),{opacity:0,y:4},{opacity:1,y:0,duration:.35,immediateRender:false},at+.12);

    // The request is readable from frame one. Focus travels through its terms.
    all('.request-field').forEach((field,index)=>{
      const at=.3+index*.85;
      move(destinations.fields[index],at,.5);
      press(at+.48);
      tl.to(field.querySelector('i'),{opacity:.75,duration:.18},at+.48)
        .to(field.querySelector('i'),{opacity:0,duration:.5},at+.9);
    });
    tl.to(all('.node-grid>i'),{opacity:1,stagger:{each:.025,from:'start'},duration:.5},1.6);
    move(destinations.find,3.8,.6);
    press(4.5);

    // The request stays in place above the selected delivery window.
    nav('window',5);
    tl.to(q('.capacity-intro'),{opacity:0,y:12,duration:.5},5)
      .to(q('.request-heading'),{opacity:0,y:-8,duration:.4},5)
      .to(q('.request-panel'),{y:metric('--request-lift'),duration:.85},5.05)
      .fromTo(q('.date-panel'),{y:16,opacity:0},{y:0,opacity:1,duration:.8,immediateRender:false},5.35);
    move(destinations.windowStart,6.2,.65);
    tl.to(pointer,{scale:.86,duration:.16},6.9)
      .to(window,{clipPath:'inset(0 0% 0 0)',duration:1.15,ease:'power2.inOut'},7.1)
      .to(pointer,{...destinations.windowEnd,duration:1.15,ease:'power2.inOut'},7.1)
      .to(pointer,{scale:1,duration:.25},8.25)
      .to(q('.calendar-window>span'),{opacity:1,duration:.4},8.35)
      .to(pointer,{opacity:0,duration:.3},8.9);

    // Quotes enter as compact rows with rates and full, auditable totals.
    nav('offers',10);
    tl.to(q('.offers-heading'),{opacity:1,duration:.4},10.2);
    rows.forEach((row,index)=>{
      tl.fromTo(row,{y:16,opacity:0},{y:0,opacity:1,duration:.75,immediateRender:false},10.5+index*.12);
    });
    tl.to(rows[0].querySelector('.offer-surface'),{borderColor:'rgba(183,208,123,.45)',duration:.5},11.3);

    // Date flexibility changes the quote; the same rows reorder, without cuts.
    move(destinations.windowMiddle,15.2,.65);
    tl.to(pointer,{scale:.86,duration:.15},15.95)
      .to(window,{x:shift,duration:1.15,ease:'power2.inOut'},16.15)
      .to(pointer,{x:destinations.windowMiddle.x+shift,duration:1.15,ease:'power2.inOut'},16.15)
      .to(pointer,{scale:1,duration:.25},17.3)
      .to(q('.date-original'),{opacity:0,y:-6,duration:.25},17.2)
      .fromTo(q('.date-shifted'),{y:6,opacity:0},{y:0,opacity:1,duration:.35,immediateRender:false},17.2)
      .to(all('.price-original'),{opacity:0,y:-4,duration:.3},17.4)
      .fromTo(all('.price-shifted'),{y:4,opacity:0},{y:0,opacity:1,duration:.4,immediateRender:false},17.4)
      .to(pointer,{opacity:0,duration:.3},17.8)
      .to(rows[0].querySelector('.offer-surface'),{borderColor:'rgba(183,208,123,0)',duration:.4},17.5);
    rows.forEach((row,index)=>{
      const next=alternate.findIndex(offer=>offer.id===row.dataset.offer);
      tl.to(row,{y:(next-index)*rowPitch,duration:.9,ease:'power2.inOut'},17.8);
    });
    tl.to(selectedRow.querySelector('.offer-surface'),{borderColor:'rgba(183,208,123,.45)',backgroundColor:'rgba(183,208,123,.1)',duration:.5},18)
      .to(q('.offer-sort'),{opacity:0,duration:.25},18.2)
      .fromTo(q('.shift-note'),{y:8,opacity:0},{y:0,opacity:1,duration:.5,immediateRender:false},18.65);

    // The selected DOM row becomes the quote. Only its surface scales: text
    // and details travel independently, preserving sharp, readable typography.
    move(destinations.selected,22,.65);
    press(22.7);
    nav('quote',22.95);
    tl.set(selectedRow,{zIndex:3},22.9)
      .to(rows.filter(row=>row!==selectedRow),{opacity:0,y:'+=8',duration:.45},22.95)
      .to(all('.offers-heading,.shift-note'),{opacity:0,duration:.4},22.95)
      .to(all('.date-panel,.request-panel'),{opacity:0,duration:.65},22.95)
      .to(pointer,{opacity:0,duration:.25},22.95)
      .to(selectedRow,{x:target.left-rowRect.left,y:target.top-rowRect.top,duration:1.05,ease:'power3.inOut'},23.05)
      .to(selectedRow.querySelector('.offer-surface'),{borderColor:'rgba(183,208,123,0)',duration:.15},22.95)
      .set(selectedRow.querySelector('.offer-surface'),{backgroundColor:'var(--canvas)'},23.05)
      .to(selectedRow.querySelector('.offer-surface'),{scaleX:target.width/rowRect.width,scaleY:target.height/rowRect.height,duration:1.05,ease:'power3.inOut'},23.05)
      .to(identity,{x:padding-(identityRect.left-rowRect.left),y:metric('--quote-title-y')-(identityRect.top-rowRect.top),duration:1.05,ease:'power3.inOut'},23.05)
      .to(name,{scale:nameScale,duration:1.05,ease:'power3.inOut'},23.05)
      .to(identity.querySelector('.offer-region'),{y:12,duration:1.05,ease:'power3.inOut'},23.05)
      .to(price,{x:padding-(priceRect.left-rowRect.left),y:metric('--quote-price-y')-(priceRect.top-rowRect.top),scale:priceScale,duration:1.05,ease:'power3.inOut'},23.05)
      .to([...selectedRow.querySelectorAll('.offer-availability,.offer-price-unit,.offer-total,.offer-arrow')],{opacity:0,duration:.3},22.95)
      .fromTo(details,{opacity:0,y:8},{opacity:1,y:0,duration:.6,immediateRender:false},23.75);
    move(destinations.save,26.2,.7);
    press(27);
    tl.to(q('.quote-save'),{backgroundColor:'rgba(183,208,123,.06)',borderColor:'rgba(183,208,123,.12)',duration:.4},27.05)
      .to(all('.save-label,.save-arrow'),{opacity:0,duration:.2},27.05)
      .to(all('.saved-label,.save-check'),{opacity:1,duration:.3},27.2)
      .to(pointer,{opacity:0,duration:.3},27.55);

    // Keep the selected row alive: the large quote contracts into its catalog
    // position while its type is retargeted independently of the surface.
    nav('desk',30);
    tl.to(details,{opacity:0,duration:.35},30)
      .to(transferFrame,{opacity:1,duration:.25},30)
      .to(transferFrame,{scaleX:deskSlot.width/target.width,scaleY:deskSlot.height/target.height,duration:1.25,ease:'power3.inOut'},30.12)
      .to(transferFrame,{opacity:0,duration:.3},31.2)
      .to(selectedRow,{x:deskSlot.left-rowRect.left,y:deskSlot.top-rowRect.top,duration:1.25,ease:'power3.inOut'},30.12)
      .to(selectedRow.querySelector('.offer-surface'),{scaleX:deskSlot.width/rowRect.width,scaleY:deskSlot.height/rowRect.height,duration:1.25,ease:'power3.inOut'},30.12)
      .to(identity,{x:catalogNameRect.left-deskSlot.left-(identityRect.left-rowRect.left),y:catalogNameRect.top-deskSlot.top-(identityRect.top-rowRect.top),duration:1.25,ease:'power3.inOut'},30.12)
      .to(name,{scale:parseFloat(getComputedStyle(catalogName).fontSize)/parseFloat(getComputedStyle(name).fontSize),duration:1.25,ease:'power3.inOut'},30.12)
      .to(identity.querySelector('.offer-region'),{opacity:0,duration:.3},30.12)
      .to(price,{x:catalogPriceRect.left-deskSlot.left-(priceRect.left-rowRect.left),y:catalogPriceRect.top-deskSlot.top-(priceRect.top-rowRect.top),scale:parseFloat(getComputedStyle(catalogPrice).fontSize)/parseFloat(getComputedStyle(price).fontSize),duration:1.25,ease:'power3.inOut'},30.12)
      .to(q('.desk-quote-slot'),{opacity:1,duration:.25},31.18)
      .to(selectedRow,{opacity:0,duration:.25},31.18);
    all('.desk-card:not(.desk-quote-slot)').forEach((card,index)=>{
      const at=31.25+index*.45;
      tl.fromTo(card,{opacity:0,y:12},{opacity:1,y:0,duration:.85,immediateRender:false},at);
      const tiles = [...card.querySelectorAll('[data-gpu-coverage-cell]')];
      if (tiles.length) tl.fromTo(tiles,{opacity:0},{opacity:1,stagger:.005,duration:.45,immediateRender:false},at+.3);
    });
    tl.to({}, {duration:1},STORY_DURATION-1);

    tl.time(Math.max(.0001,previousTime),true).pause();
    if(reducedMotion) {
      requestedPlaying=false;
      tl.time(chapterAt(previousTime).inspect,true);
    } else if(keepPlaying) tl.play();
    stage.dataset.ready='';
    syncPlayer();
    return ()=>{ previousTime=tl.time(); keepPlaying=requestedPlaying&&!document.hidden; };
  });
}

function seek(time,announce=false) {
  if(!timeline) return;
  requestedPlaying=false;
  timeline.pause().time(Math.max(.0001,storyTime(time)),true);
  syncPlayer(announce);
}
function togglePlayback() {
  if(!timeline) return;
  if(reducedMotion) {
    const index=STORY_CHAPTERS.indexOf(chapterAt(timeline.time()));
    seek(STORY_CHAPTERS[(index+1)%STORY_CHAPTERS.length].inspect,true);
  } else if(!timeline.paused()) {
    requestedPlaying=false; timeline.pause();
  } else {
    requestedPlaying=true;
    if(timeline.time()>=STORY_DURATION) timeline.restart();
    else timeline.play();
  }
  syncPlayer();
}
playButton.addEventListener('click',togglePlayback);
replayButton.addEventListener('click',()=>{
  seek(0);
  if(!reducedMotion&&timeline) {requestedPlaying=true;timeline.play();}
  syncPlayer(true);
});
scrubber.addEventListener('input',()=>seek(scrubber.value));
scrubber.addEventListener('change',()=>syncPlayer(true));
chapterNav.addEventListener('click',event=>{
  const button=event.target.closest('[data-chapter]');
  const chapter=STORY_CHAPTERS.find(item=>item.id===button?.dataset.chapter);
  if(chapter) seek(chapter.inspect,true);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){requestedPlaying=false;timeline?.pause();syncPlayer();}
});
try {
  await document.fonts.ready;
  createStory();
  [playButton,replayButton,scrubber,...chapterNav.querySelectorAll('button')].forEach(control=>{control.disabled=false;});
  const observer=new ResizeObserver(entries=>{
    const rect=entries[0].contentRect;
    const next=Math.round(rect.width)+':'+Math.round(rect.height);
    if(next===stageSize)return;
    stageSize=next;
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(createStory);
  });
  observer.observe(stage);
  window.addEventListener('pagehide',()=>{observer.disconnect();cancelAnimationFrame(resizeFrame);requestedPlaying=false;timeline?.pause();syncPlayer();});
  window.addEventListener('pageshow',()=>{observer.observe(stage);syncPlayer();});
} catch(error) {
  console.error('Walkthrough unavailable:',error);
  status.classList.remove('sr-only');
  status.classList.add('fallback');
  status.textContent='The walkthrough could not start. You can still open Desk using the link above.';
}
