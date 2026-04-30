(function () {
  const Engine = window.ChordVoicingEngine;
  if (!Engine) {
    console.error('ChordVoicingEngine not loaded');
    return;
  }

  let playTimer = null;
  let barTicker = null;
  let currentSong = null;
  let currentMapping = [];
  let currentBarIndex = -1;
  let localRepl = null;
  let chordPreviewTimeout = null;
  let currentVoicingSeed = Math.floor(Math.random() * 0x7fffffff);
  let currentDisplayContexts = [];

  function getSongData() {
    const el = document.getElementById('songData');
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || '{}');
    } catch (err) {
      console.error('Failed to parse songData JSON', err);
      return null;
    }
  }

  function parseTimeSignature(value) {
    const text = String(value || '44').trim();
    if (/^\d{2}$/.test(text)) return { beatsPerBar: parseInt(text[0], 10), beatUnit: parseInt(text[1], 10) };
    const match = text.match(/^(\d+)\/(\d+)$/);
    if (match) return { beatsPerBar: parseInt(match[1], 10), beatUnit: parseInt(match[2], 10) };
    return { beatsPerBar: 4, beatUnit: 4 };
  }

  function chordToTokens(symbol) {
    return Engine.toTokens(symbol);
  }

  function createSeededRng(seed) {
    let state = (seed >>> 0) || 1;
    return function () {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function allocateBeats(chords, beatsPerBar) {
    const count = Math.max(1, chords.length || 0);
    if (count === 1) return [beatsPerBar];
    const out = [];
    let remaining = beatsPerBar;
    for (let i = 0; i < count; i += 1) {
      const left = count - i;
      const dur = Math.max(1, Math.floor(remaining / left));
      out.push(dur);
      remaining -= dur;
    }
    while (remaining > 0) {
      out[out.length - 1] += 1;
      remaining -= 1;
    }
    return out;
  }

  function buildMeasurePatterns(song) {
    const measures = Array.isArray(song.measures) ? song.measures : [];
    const bassBars = [];
    const chordBars = [];

    measures.forEach((measure) => {
      const items = Array.isArray(measure) ? measure : [];
      if (!items.length) {
        bassBars.push('~');
        chordBars.push('~');
        return;
      }

      const tokens = items.map((symbol) => chordToTokens(symbol));
      const bassParts = tokens.map(t => t.bass || '~');
      const chordParts = tokens.map(t => t.normalizedSymbol || '~');

      if (items.length === 1) {
        bassBars.push(bassParts[0]);
        chordBars.push(chordParts[0]);
      } else {
        bassBars.push(`[${bassParts.join(' ')}]`);
        chordBars.push(`[${chordParts.join(' ')}]`);
      }
    });

    return { bassBars, chordBars, totalBars: measures.length };
  }

  function normalizeChordForStrudel(symbol) {
    return Engine.toTokens(symbol).normalizedSymbol;
  }

  function buildClickBars(song) {
    const { beatsPerBar } = parseTimeSignature(song.timeSignature);
    const measures = Array.isArray(song.measures) ? song.measures : [];
    return measures.map(() => {
      const beats = [];
      for (let i = 1; i <= beatsPerBar; i += 1) beats.push(i === 2 || i === 4 ? 'hh' : '~');
      return `[${beats.join(' ')}]`;
    });
  }

  function getPatternParts(song, bpmOverride) {
    const bpm = Number(bpmOverride) || Number(song.bpm) || 100;
    const { beatsPerBar } = parseTimeSignature(song.timeSignature);
    const timeline = buildMeasurePatterns(song);
    const cpm = bpm / beatsPerBar;
    const bassPattern = timeline.bassBars.join(' ');
    const chordPattern = timeline.chordBars.join(' ');
    const totalBars = Math.max(1, timeline.totalBars);
    return { bpm, cpm, bassPattern, chordPattern, totalBars };
  }

  function buildExplicitPatterns(song) {
    const measures = Array.isArray(song.measures) ? song.measures : [];
    const flatSymbols = [];
    for (const measure of measures) {
      const items = Array.isArray(measure) ? measure : [];
      for (const symbol of items) flatSymbols.push(symbol);
    }
    const led = Engine.voiceLeadSequence(flatSymbols, { low: 57, high: 84, center: 68, rng: createSeededRng(currentVoicingSeed), randomWindow: 3 });
    let idx = 0;

    const bassBars = measures.map((measure) => {
      const items = Array.isArray(measure) ? measure : [];
      if (!items.length) return '~';
      const bassParts = items.map(() => (led[idx++]?.bass || '~'));
      return items.length === 1 ? `[${bassParts[0]}]` : `[${bassParts.map(x => `[${x}]`).join(' ')}]`;
    });

    idx = 0;
    const voicingBars = measures.map((measure) => {
      const items = Array.isArray(measure) ? measure : [];
      if (!items.length) return '~';
      const voiced = items.map(() => {
        const token = led[idx++];
        return token && token.voices && token.voices.length ? `[${token.voices.join(',')}]` : '~';
      });
      return items.length === 1 ? voiced[0] : `[${voiced.join(' ')}]`;
    });

    const clickBars = buildClickBars(song);
    return {
      bassPattern: `<${bassBars.join(' ')}>` ,
      voicingPattern: `<${voicingBars.join(' ')}>` ,
      clickPattern: `<${clickBars.join(' ')}>`
    };
  }

  function buildDisplayVoicingContexts(song) {
    const displayBars = Array.isArray(song.displayBars) ? song.displayBars : [];
    const flatSymbols = [];
    displayBars.forEach((bar) => {
      const chords = Array.isArray(bar.resolvedChords) ? bar.resolvedChords : [];
      chords.forEach((symbol) => flatSymbols.push(symbol));
    });
    return Engine.voiceLeadSequence(flatSymbols, { low: 57, high: 84, center: 68, rng: createSeededRng(currentVoicingSeed), randomWindow: 3 });
  }

  function buildPatternObject(song, bpmOverride) {
    const { cpm } = getPatternParts(song, bpmOverride);
    const { bassPattern, voicingPattern, clickPattern } = buildExplicitPatterns(song);
    return stack(
      note(bassPattern).fast(2).room(.5).gain(0.9),
      note(voicingPattern).fast(2).room(.5).gain(0.45),
      s(clickPattern).fast(2).gain(0.5)
    ).cpm(cpm);
  }

  function quoteJs(text) {
    return `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function buildReplExportCode(song, bpmOverride) {
    const { cpm } = getPatternParts(song, bpmOverride);
    const { bassPattern, voicingPattern, clickPattern } = buildExplicitPatterns(song);
    return [
      `stack(`,
      `  note(${quoteJs(bassPattern)}).fast(2).room(.5).gain(0.9),`,
      `  note(${quoteJs(voicingPattern)}).fast(2).room(.5).gain(0.45),`,
      `  s(${quoteJs(clickPattern)}).fast(2).gain(0.5)`,
      `).cpm(${cpm.toFixed(4)})`
    ].join('\n');
  }

  async function ensureStrudel() {
    if (!window.__irealStrudelReady) {
      if (typeof window.initStrudel !== 'function') throw new Error('Strudel library did not load');
      await window.initStrudel();
      window.__irealStrudelReady = true;
    }
    if (!localRepl) {
      if (typeof window.webaudioRepl !== 'function') throw new Error('Strudel webaudioRepl() unavailable');
      localRepl = window.webaudioRepl();
    }
  }

  async function stopPlaybackAudio() {
    clearPlaybackVisuals();
    try {
      if (localRepl && typeof localRepl.stop === 'function') {
        try { await localRepl.stop(); } catch (_) {}
      }
      if (typeof window.stop === 'function') {
        try { await window.stop(); } catch (_) {}
      }
      if (typeof window.hush === 'function') {
        try { await window.hush(); } catch (_) {}
      }
      if (typeof window.silence === 'function') {
        try { await window.silence(); } catch (_) {}
      }
    } catch (err) {
      console.error('Stop error', err);
    }
  }

  function setStatus(text, isError) {
    const el = document.getElementById('playbackStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.error = isError ? '1' : '0';
  }

  function clearPlaybackVisuals() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    if (barTicker) {
      clearInterval(barTicker);
      barTicker = null;
    }
    currentBarIndex = -1;
    document.querySelectorAll('.measure.is-playing').forEach(el => el.classList.remove('is-playing'));
  }

  function setPlayingBar(displayBarIndex) {
    document.querySelectorAll('.measure.is-playing').forEach(el => el.classList.remove('is-playing'));
    if (!displayBarIndex) return;
    const el = document.querySelector(`.measure[data-bar-index="${displayBarIndex}"]`);
    if (el) el.classList.add('is-playing');
  }

  function measureSignature(measure) {
    return JSON.stringify(Array.isArray(measure) ? measure : []);
  }

  function buildPlaybackToDisplayMap(song) {
    const displayBars = Array.isArray(song.displayBars) ? song.displayBars : [];
    const expandedMeasures = Array.isArray(song.measures) ? song.measures : [];
    const displaySignatures = displayBars.map(bar => measureSignature(bar.resolvedChords || []));
    const mapping = [];
    let pointer = 0;

    expandedMeasures.forEach((measure) => {
      const sig = measureSignature(measure);
      let chosen = -1;
      if (pointer > 0) {
        const prevBar = displayBars[pointer - 1];
        if (prevBar && prevBar.repeatEnd) {
          for (let i = pointer - 1; i >= 0; i -= 1) {
            if (displayBars[i].repeatStart && displaySignatures[i] === sig) {
              chosen = i;
              break;
            }
          }
        }
      }
      if (chosen < 0) {
        for (let i = pointer; i < displaySignatures.length; i += 1) {
          if (displaySignatures[i] === sig) {
            chosen = i;
            break;
          }
        }
      }
      if (chosen < 0) {
        for (let i = 0; i < pointer; i += 1) {
          if (displaySignatures[i] === sig) {
            chosen = i;
            break;
          }
        }
      }
      if (chosen < 0 && displaySignatures.length) chosen = Math.min(pointer, displaySignatures.length - 1);
      mapping.push(chosen + 1);
      pointer = Math.max(0, chosen + 1);
    });
    return mapping;
  }

  function startBarHighlightLoop(song, bpmOverride) {
    clearPlaybackVisuals();
    const bpm = Number(bpmOverride) || Number(song.bpm) || 100;
    const { beatsPerBar } = parseTimeSignature(song.timeSignature);
    const msPerBar = (60000 / bpm) * beatsPerBar;
    const totalBars = (song.measures || []).length;
    if (!totalBars) return;
    const tick = () => {
      currentBarIndex = (currentBarIndex + 1) % totalBars;
      setPlayingBar(currentMapping[currentBarIndex]);
    };
    tick();
    barTicker = setInterval(tick, msPerBar);
  }

  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('Clipboard API unavailable');
  }

  async function openInStrudel(code) {
    try {
      await copyText(code);
    } catch (err) {
      console.warn('Clipboard write failed before opening Strudel', err);
    }
    window.open('https://strudel.cc/', '_blank', 'noopener');
    setStatus('Strudel REPL opened. Code copied to clipboard — paste and keep editing there.', false);
  }

  function positionInspector(pop, rect) {
    const pad = 12;
    const width = pop.offsetWidth || 260;
    const height = pop.offsetHeight || 180;
    let left = rect.left + window.scrollX;
    let top = rect.bottom + window.scrollY + 8;
    const maxLeft = window.scrollX + window.innerWidth - width - pad;
    if (left > maxLeft) left = maxLeft;
    if (top + height > window.scrollY + window.innerHeight - pad) {
      top = rect.top + window.scrollY - height - 8;
    }
    if (left < window.scrollX + pad) left = window.scrollX + pad;
    if (top < window.scrollY + pad) top = window.scrollY + pad;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  async function playPreviewChord(chordSymbol, context = null) {
    await ensureStrudel();
    if (chordPreviewTimeout) {
      clearTimeout(chordPreviewTimeout);
      chordPreviewTimeout = null;
    }
    const bass = context?.bass || Engine.toBass(chordSymbol) || '~';
    const voices = context?.voices && context.voices.length ? `[${context.voices.join(',')}]` : Engine.toStrudelVoicingEvent(chordSymbol);
    const previewPattern = stack(
      note(`<[${bass}]>`).fast(2).room(.5).gain(0.9),
      note(`<${voices}>`).fast(2).room(.5).gain(0.45)
    ).cpm(30);
    if (!localRepl || typeof localRepl.setPattern !== 'function' || typeof localRepl.start !== 'function') {
      throw new Error('Local Strudel repl unavailable');
    }
    await localRepl.setPattern(previewPattern, true);
    await localRepl.start();
    chordPreviewTimeout = setTimeout(() => {
      if (localRepl && typeof localRepl.stop === 'function') localRepl.stop().catch(() => {});
      chordPreviewTimeout = null;
    }, 900);
  }

  function setupChordInspector() {
    const pop = document.getElementById('chordInspectorPop');
    const titleEl = document.getElementById('cipTitle');
    const bassEl = document.getElementById('cipBass');
    const voicesEl = document.getElementById('cipVoices');
    const playBtn = document.getElementById('cipPlayBtn');
    if (!pop || !titleEl || !bassEl || !voicesEl || !playBtn) return;

    let currentChord = null;
    let currentContext = null;
    let hideTimer = null;
    let tokenIndex = 0;

    const hide = () => {
      pop.classList.remove('show');
      pop.setAttribute('aria-hidden', 'true');
    };

    const showFor = (el) => {
      const chord = el.dataset.chord;
      if (!chord) return;
      currentChord = chord;
      const context = currentDisplayContexts[tokenIndexMap.get(el)] || Engine.toTokens(chord);
      currentContext = context;
      titleEl.textContent = chord;
      bassEl.textContent = context.bass || '—';
      voicesEl.textContent = context.voices && context.voices.length ? context.voices.join(', ') : '—';
      pop.classList.add('show');
      pop.setAttribute('aria-hidden', 'false');
      positionInspector(pop, el.getBoundingClientRect());
    };

    const tokenIndexMap = new WeakMap();
    document.querySelectorAll('.chord-token').forEach((el) => {
      tokenIndexMap.set(el, tokenIndex++);
      el.addEventListener('mouseenter', () => {
        if (hideTimer) clearTimeout(hideTimer);
        showFor(el);
      });
      el.addEventListener('mouseleave', () => {
        hideTimer = setTimeout(hide, 120);
      });
      el.addEventListener('click', (e) => {
        e.preventDefault();
        if (hideTimer) clearTimeout(hideTimer);
        showFor(el);
      });
    });

    pop.addEventListener('mouseenter', () => {
      if (hideTimer) clearTimeout(hideTimer);
    });
    pop.addEventListener('mouseleave', () => {
      hideTimer = setTimeout(hide, 120);
    });

    playBtn.addEventListener('click', async () => {
      if (!currentChord) return;
      try {
        await playPreviewChord(currentChord, currentContext);
      } catch (err) {
        console.error(err);
        setStatus(`Preview failed: ${err.message || err}`, true);
      }
    });
  }

  function setupSongPage(song) {
    currentSong = song;
    currentMapping = buildPlaybackToDisplayMap(song);
    currentVoicingSeed = Math.floor(Math.random() * 0x7fffffff);
    currentDisplayContexts = buildDisplayVoicingContexts(song);

    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const copyBtn = document.getElementById('copyCodeBtn');
    const openBtn = document.getElementById('openReplBtn');
    const tempoInput = document.getElementById('tempoInput');
    const codeEl = document.getElementById('strudelCode');
    if (!playBtn || !stopBtn || !copyBtn || !openBtn || !tempoInput || !codeEl) return;

    function refreshCode() {
      const code = buildReplExportCode(song, tempoInput.value);
      codeEl.value = code;
      return code;
    }

    function getExportCode() {
      return buildReplExportCode(song, tempoInput.value);
    }

    refreshCode();
    setupChordInspector();

    playBtn.addEventListener('click', async () => {
      try {
        refreshCode();
        await ensureStrudel();
        await stopPlaybackAudio();
        const pattern = buildPatternObject(song, tempoInput.value);
        if (!localRepl || typeof localRepl.setPattern !== 'function' || typeof localRepl.start !== 'function') throw new Error('Local Strudel repl unavailable');
        await localRepl.setPattern(pattern, true);
        await localRepl.start();
        startBarHighlightLoop(song, tempoInput.value);
        setStatus(`Playing at ${tempoInput.value || song.bpm || 100} BPM · loops over ${song.measures.length} performance bars`, false);
      } catch (err) {
        console.error(err);
        clearPlaybackVisuals();
        setStatus(`Play failed: ${err.message || err}`, true);
      }
    });

    stopBtn.addEventListener('click', async () => {
      try {
        await stopPlaybackAudio();
        setStatus('Stopped', false);
      } catch (err) {
        console.error(err);
        setStatus(`Stop failed: ${err.message || err}`, true);
      }
    });

    copyBtn.addEventListener('click', async () => {
      try {
        refreshCode();
        const code = getExportCode();
        await copyText(code);
        setStatus('REPL-safe Strudel code copied', false);
      } catch (err) {
        console.error(err);
        setStatus(`Copy failed: ${err.message || err}`, true);
      }
    });

    openBtn.addEventListener('click', async () => {
      refreshCode();
      const code = getExportCode();
      await openInStrudel(code);
    });

    tempoInput.addEventListener('change', refreshCode);
    tempoInput.addEventListener('input', refreshCode);
  }

  window.buildReplExportCode = buildReplExportCode;

  document.addEventListener('DOMContentLoaded', () => {
    const song = getSongData();
    if (song) setupSongPage(song);
  });
})();
