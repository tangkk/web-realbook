(function () {
  const NOTE_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const PC_TO_NOTE = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];

  let playTimer = null;
  let barTicker = null;
  let currentSong = null;
  let currentMapping = [];
  let currentBarIndex = -1;
  let localRepl = null;

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

  function midiToNoteName(midi) {
    const octave = Math.floor(midi / 12) - 1;
    const pc = ((midi % 12) + 12) % 12;
    return `${PC_TO_NOTE[pc]}${octave}`;
  }

  function parseRoot(rootText) {
    const m = String(rootText || '').match(/^([A-G])([b#]?)/);
    if (!m) return null;
    let pc = NOTE_TO_PC[m[1]];
    if (m[2] === '#') pc += 1;
    if (m[2] === 'b') pc -= 1;
    return { letter: m[1], accidental: m[2] || '', pc: (pc + 12) % 12 };
  }

  function parseChordSymbol(symbol) {
    if (!symbol || symbol === '/' || symbol === 'W') return null;
    const cleaned = String(symbol).trim();
    const slashParts = cleaned.split('/');
    const head = slashParts[0];
    const bassText = slashParts[1] || null;
    const m = head.match(/^([A-G])([b#]?)(.*)$/);
    if (!m) return null;
    return {
      raw: cleaned,
      root: parseRoot(`${m[1]}${m[2] || ''}`),
      qualityText: m[3] || '',
      bass: bassText ? parseRoot(bassText) : null,
    };
  }

  function uniqSorted(values) {
    return [...new Set(values)].sort((a, b) => a - b);
  }

  function normalizeQualityText(q) {
    return String(q || '').replace(/m7b5/gi, 'h7');
  }

  function buildChordPitchClasses(chord) {
    if (!chord || !chord.root) return [];
    const q = normalizeQualityText(chord.qualityText);
    let triad = [0, 4, 7];
    let seventh = null;
    let extras = [];

    if (/sus/.test(q)) triad = [0, 5, 7];
    else if (/o/.test(q)) triad = [0, 3, 6];
    else if (/h/.test(q)) triad = [0, 3, 6];
    else if (/-/.test(q)) triad = [0, 3, 7];
    else if (/#5|\+/.test(q)) triad = [0, 4, 8];
    else triad = [0, 4, 7];

    if (/\^7/.test(q)) seventh = 11;
    else if (/h/.test(q)) seventh = 10;
    else if (/o7/.test(q)) seventh = 9;
    else if (/-6/.test(q)) seventh = 9;
    else if (/\b6(?!\d)/.test(q)) seventh = 8;
    else if (/6(?!\d)/.test(q)) seventh = 9;
    else if (/-/.test(q) && /7/.test(q)) seventh = 10;
    else if (/7/.test(q)) seventh = 10;
    else if (/\^/.test(q)) seventh = 11;

    if (/b5/.test(q) && !/h/.test(q)) triad[2] = 6;
    if (/#5|\+/.test(q)) triad[2] = 8;

    if (/b9/.test(q)) extras.push(13);
    else if (/#9/.test(q)) extras.push(15);
    else if (/9/.test(q)) extras.push(14);

    if (/#11/.test(q)) extras.push(18);
    else if (/11/.test(q)) extras.push(17);

    if (/b13/.test(q)) extras.push(20);
    else if (/13/.test(q)) extras.push(21);

    const pcs = [...triad];
    if (seventh != null) pcs.push(seventh);
    pcs.push(...extras);
    return uniqSorted(pcs.map(i => (chord.root.pc + i) % 12));
  }

  function pitchClassesToVoicingMidi(chord) {
    const pcs = buildChordPitchClasses(chord);
    if (!pcs.length) return [];
    const bassPc = chord.root.pc;
    const ordered = pcs.sort((a, b) => {
      const da = (a - bassPc + 12) % 12;
      const db = (b - bassPc + 12) % 12;
      return da - db;
    });
    const notes = [];
    let lastMidi = 59;
    ordered.forEach((pc, idx) => {
      let midi = idx === 0 ? 60 + pc : lastMidi + 1;
      while ((midi % 12 + 12) % 12 !== pc) midi += 1;
      while (midi < 60) midi += 12;
      while (midi > 84) midi -= 12;
      if (idx > 0 && midi <= lastMidi) midi += 12;
      while (midi > 84 && idx > 0) midi -= 12;
      notes.push(midi);
      lastMidi = midi;
    });
    return notes;
  }

  function bassMidi(chord) {
    if (!chord) return null;
    const base = chord.bass || chord.root;
    if (!base) return null;
    return 36 + base.pc;
  }

  function chordToTokens(symbol) {
    const chord = parseChordSymbol(symbol);
    if (!chord) return { bass: '~', voices: [] };
    const bass = midiToNoteName(bassMidi(chord));
    const voicing = pitchClassesToVoicingMidi(chord).map(midiToNoteName);
    return {
      bass,
      voices: voicing,
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
      const chordParts = items.map(symbol => normalizeChordForStrudel(symbol));

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

  function escapePatternText(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function normalizeChordForStrudel(symbol) {
    return String(symbol || '').replace(/m7b5/gi, 'h7');
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

  function buildPatternObject(song, bpmOverride) {
    const { cpm, bassPattern, chordPattern, totalBars } = getPatternParts(song, bpmOverride);
    return stack(
      note(bassPattern).fast(2).slow(totalBars).gain(0.9),
      chord(chordPattern).voicing().fast(2).slow(totalBars).gain(0.45)
    ).cpm(cpm);
  }

  function buildStrudelCode(song, bpmOverride) {
    const { cpm, bassPattern, chordPattern, totalBars } = getPatternParts(song, bpmOverride);
    return [
      `stack(`,
      `  note('${escapePatternText(bassPattern)}').fast(2).slow(${totalBars}).gain(0.9),`,
      `  chord('${escapePatternText(chordPattern)}').voicing().fast(2).slow(${totalBars}).gain(0.45)`,
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

  async function triggerInitialChord(song) {
    const first = buildInitialTrigger(song);
    if (!first) return;
    try {
      if (first.bass) {
        window.note(first.bass).gain(0.9).play();
      }
      if (first.chord) {
        window.chord(first.chord).voicing().gain(0.45).play();
      }
    } catch (err) {
      console.warn('Initial trigger failed', err);
    }
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

  function setupSongPage(song) {
    currentSong = song;
    currentMapping = buildPlaybackToDisplayMap(song);

    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const copyBtn = document.getElementById('copyCodeBtn');
    const openBtn = document.getElementById('openReplBtn');
    const tempoInput = document.getElementById('tempoInput');
    const codeEl = document.getElementById('strudelCode');
    if (!playBtn || !stopBtn || !copyBtn || !openBtn || !tempoInput || !codeEl) return;

    function refreshCode() {
      const code = buildStrudelCode(song, tempoInput.value);
      codeEl.value = code;
      return code;
    }

    refreshCode();

    playBtn.addEventListener('click', async () => {
      try {
        refreshCode();
        await ensureStrudel();
        await stopPlaybackAudio();
        const pattern = buildPatternObject(song, tempoInput.value);
        if (!localRepl || typeof localRepl.setPattern !== 'function' || typeof localRepl.start !== 'function') {
          throw new Error('Local Strudel repl unavailable');
        }
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
        const code = refreshCode();
        await copyText(code);
        setStatus('Strudel code copied', false);
      } catch (err) {
        console.error(err);
        setStatus(`Copy failed: ${err.message || err}`, true);
      }
    });

    openBtn.addEventListener('click', async () => {
      const code = refreshCode();
      await openInStrudel(code);
    });

    tempoInput.addEventListener('change', refreshCode);
    tempoInput.addEventListener('input', refreshCode);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const song = getSongData();
    if (song) setupSongPage(song);
  });
})();
