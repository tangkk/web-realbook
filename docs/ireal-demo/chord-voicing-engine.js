(function () {
  const NOTE_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const PC_TO_NOTE = ['c', 'c#', 'd', 'eb', 'e', 'f', 'f#', 'g', 'ab', 'a', 'bb', 'b'];

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

  function buildExplicitSixVoicing(chord) {
    if (!chord || !chord.root) return null;
    const q = normalizeQualityText(chord.qualityText);
    const rootMidi = 60 + chord.root.pc;
    if (/^-6$/.test(q)) return [rootMidi, rootMidi + 3, rootMidi + 7, rootMidi + 9].map(midiToNoteName);
    if (/^6$/.test(q)) return [rootMidi, rootMidi + 4, rootMidi + 7, rootMidi + 9].map(midiToNoteName);
    return null;
  }

  function toTokens(symbol) {
    const chord = parseChordSymbol(symbol);
    if (!chord) return { bass: '~', voices: [], chord: null, normalizedSymbol: String(symbol || '') };
    const bass = midiToNoteName(bassMidi(chord));
    const explicitSix = buildExplicitSixVoicing(chord);
    const voices = explicitSix || pitchClassesToVoicingMidi(chord).map(midiToNoteName);
    return {
      bass,
      voices,
      chord,
      normalizedSymbol: String(symbol || '').replace(/m7b5/gi, 'h7'),
    };
  }

  function toVoicing(symbol) {
    return toTokens(symbol).voices;
  }

  function toBass(symbol) {
    return toTokens(symbol).bass;
  }

  function toStrudelVoicingEvent(symbol) {
    const voices = toVoicing(symbol);
    return voices.length ? `[${voices.join(',')}]` : '~';
  }

  function toStrudelBassEvent(symbol) {
    const bass = toBass(symbol);
    return bass ? `[${bass}]` : '~';
  }

  window.ChordVoicingEngine = {
    midiToNoteName,
    parseRoot,
    parseChordSymbol,
    normalizeQualityText,
    buildChordPitchClasses,
    pitchClassesToVoicingMidi,
    buildExplicitSixVoicing,
    toTokens,
    toVoicing,
    toBass,
    toStrudelVoicingEvent,
    toStrudelBassEvent,
  };
})();
