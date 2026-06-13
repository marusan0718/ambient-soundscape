const SOUND_SOURCES = [
  { id: "analogPad", name: "Analog Pad", layer: "PAD", type: "Detuned Analog / Low-Mid", volume: -13 },
  { id: "dreamPad", name: "Dream Pad", layer: "PAD", type: "Chorus Pad / High", volume: -18 },
  { id: "ambientPiano", name: "Ambient Piano", layer: "LINE", type: "Piano + Reverb / Wide", volume: -18 },
  { id: "glassBell", name: "Glass Bell", layer: "LINE", type: "FM Synthesis / High", volume: -22 },
  { id: "glockenspiel", name: "Glockenspiel", layer: "LINE", type: "Bell Mallet / High", volume: -24 },
  { id: "marimba", name: "Marimba", layer: "DOT", type: "Mallet Synth / Mid", volume: -15 },
  { id: "woodBlock", name: "Wood Block", layer: "DOT", type: "Percussive Wood / Mid", volume: -18 },
  { id: "crystalAccent", name: "Crystal Accent", layer: "DOT", type: "Crystal Partial / High", volume: -22 },
  { id: "brushedMetal", name: "Brushed Metal", layer: "DOT", type: "Metal Texture / High", volume: -28 }
];

const SCALES = {
  "D major pentatonic": ["D3", "E3", "F#3", "A3", "B3", "D4", "E4", "F#4", "A4", "B4", "D5", "E5", "F#5"],
  "A minor pentatonic": ["A2", "C3", "D3", "E3", "G3", "A3", "C4", "D4", "E4", "G4", "A4", "C5", "D5"]
};
const PAD_NOTES = ["D2", "A2", "E3", "F#3", "B3"];
const PAD_CHORDS = [
  ["D2", "A2", "E3", "F#3"],
  ["B1", "F#2", "A2", "E3"],
  ["A1", "E2", "B2", "D3"],
  ["E2", "B2", "D3", "F#3"]
];
const RHYTHM_PATTERNS = [
  { name: "Sparse Droplets", slots: [0, 7, 13], accent: [0] },
  { name: "Tidal Pulse", slots: [0, 4, 9, 14], accent: [0, 9] },
  { name: "Glass Steps", slots: [1, 5, 8, 12, 15], accent: [8] },
  { name: "Wood Ripples", slots: [0, 3, 6, 10, 13], accent: [0, 10] },
  { name: "Floating Grid", slots: [0, 2, 6, 11, 15], accent: [6] },
  { name: "Quiet Breathing", slots: [0, 8], accent: [0] }
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function choose(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function noteAt(scale, index) {
  return scale[clamp(index, 0, scale.length - 1)];
}

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

class AudioEngine {
  constructor() {
    this.Tone = window.Tone;
    this.started = false;
    this.lastNotes = {};
    this.activeIds = new Set();
    this.muted = new Map();
    this.sourceVolumes = new Map(SOUND_SOURCES.map((source) => [source.id, source.volume]));
    this.settings = {
      masterVolume: -14,
      reverbAmount: 0.42,
      lowpass: 5200,
      tremoloAmount: 0.12
    };
    this.environment = null;
    this.composition = this.createComposition(this.env());
    this.nativePulse = 0;
    this.loops = [];
  }

  async start() {
    if (!this.Tone) {
      this.startNative();
      this.started = true;
      return;
    }
    await this.Tone.start();
    if (!this.graphReady) {
      this.createGraph();
      this.createLoops();
      this.graphReady = true;
    }
    this.Tone.Transport.start();
    this.started = true;
  }

  stop() {
    if (this.nativeReady) {
      clearInterval(this.nativeScheduler);
      clearInterval(this.nativePadScheduler);
      this.activeIds.clear();
      this.started = false;
      return;
    }
    if (!this.graphReady) return;
    this.Tone.Transport.stop();
    this.Tone.Transport.cancel();
    this.releasePads();
    this.createLoops();
    this.activeIds.clear();
    this.started = false;
  }

  createGraph() {
    const Tone = this.Tone;
    this.master = new Tone.Volume(this.settings.masterVolume).toDestination();
    this.filter = new Tone.Filter(this.settings.lowpass, "lowpass").connect(this.master);
    this.tremolo = new Tone.Tremolo(0.08, this.settings.tremoloAmount).start().connect(this.filter);
    this.reverb = new Tone.Reverb({ decay: 7.5, preDelay: 0.06, wet: this.settings.reverbAmount }).connect(this.tremolo);
    this.chorus = new Tone.Chorus(0.12, 2.4, 0.28).start();

    this.channels = {};
    for (const source of SOUND_SOURCES) {
      this.channels[source.id] = new Tone.Volume(source.volume).connect(this.reverb);
    }
    this.dreamPadCh = new Tone.Volume(-2).connect(this.chorus);
    this.chorus.connect(this.channels.dreamPad);

    this.analogPad = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 5,
      oscillator: { type: "fatsine", count: 3, spread: 18 },
      envelope: { attack: 5, decay: 2, sustain: 0.72, release: 8 }
    }).connect(this.channels.analogPad);

    this.dreamPad = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 4,
      oscillator: { type: "triangle" },
      envelope: { attack: 7, decay: 1.4, sustain: 0.6, release: 9 }
    }).connect(this.dreamPadCh);

    this.piano = new Tone.PolySynth(Tone.Synth, {
      maxPolyphony: 4,
      oscillator: { type: "sine" },
      envelope: { attack: 0.04, decay: 1.2, sustain: 0.18, release: 5.5 }
    }).connect(this.channels.ambientPiano);

    this.glassBell = new Tone.FMSynth({
      harmonicity: 2.8,
      modulationIndex: 7,
      envelope: { attack: 0.02, decay: 2.6, sustain: 0.02, release: 5 },
      modulationEnvelope: { attack: 0.01, decay: 1.3, sustain: 0, release: 2.2 }
    }).connect(this.channels.glassBell);

    this.glockenspiel = new Tone.FMSynth({
      harmonicity: 3.7,
      modulationIndex: 12,
      envelope: { attack: 0.003, decay: 1.15, sustain: 0, release: 1.8 },
      modulationEnvelope: { attack: 0.002, decay: 0.7, sustain: 0, release: 1.2 }
    }).connect(this.channels.glockenspiel);

    this.marimba = new Tone.MembraneSynth({
      pitchDecay: 0.015,
      octaves: 2.5,
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.45, sustain: 0.02, release: 1.4 }
    }).connect(this.channels.marimba);

    this.woodBlock = new Tone.NoiseSynth({
      noise: { type: "brown" },
      envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.05 }
    }).connect(this.channels.woodBlock);

    this.crystalAccent = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.005, decay: 0.55, sustain: 0.01, release: 2.8 }
    }).connect(this.channels.crystalAccent);

    this.brushedMetal = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.25, decay: 0.6, sustain: 0.08, release: 1.7 }
    }).connect(this.channels.brushedMetal);
  }

  startNative() {
    if (!this.nativeReady) {
      this.createNativeGraph();
      this.nativeReady = true;
    }
    this.nativeContext.resume();
    clearInterval(this.nativeScheduler);
    clearInterval(this.nativePadScheduler);
    this.nativeScheduler = setInterval(() => {
      const now = this.nativeContext.currentTime;
      this.nativePlayPulse(now);
      if (Math.random() < this.composition.lineChance * 0.34) this.nativePlayLine(now + 0.04);
      if (Math.random() < this.composition.textureChance * 0.18) this.nativePlayTexture(now + 0.02);
      this.nativePulse = (this.nativePulse + 1) % 16;
    }, 360);
    this.nativePadScheduler = setInterval(() => this.nativePlayPad(this.nativeContext.currentTime), 12000);
    this.nativePlayPad(this.nativeContext.currentTime + 0.1);
  }

  createNativeGraph() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      throw new Error("Web Audio API is not available in this browser");
    }
    this.nativeContext = new AudioContext();
    const ctx = this.nativeContext;
    this.nativeMaster = ctx.createGain();
    this.nativeMaster.gain.value = dbToGain(this.settings.masterVolume);
    this.nativeFilter = ctx.createBiquadFilter();
    this.nativeFilter.type = "lowpass";
    this.nativeFilter.frequency.value = this.settings.lowpass;
    this.nativeTremoloGain = ctx.createGain();
    this.nativeTremoloGain.gain.value = 1;
    this.nativeReverb = ctx.createConvolver();
    this.nativeReverb.buffer = this.createImpulse(7.2, 2.8);
    this.nativeReverbWet = ctx.createGain();
    this.nativeReverbWet.gain.value = this.settings.reverbAmount * 0.45;
    this.nativeDry = ctx.createGain();
    this.nativeDry.gain.value = 0.82;
    this.nativeBus = ctx.createGain();
    this.nativeBus.gain.value = 1;
    this.nativeBus.connect(this.nativeDry);
    this.nativeBus.connect(this.nativeReverbWet);
    this.nativeReverbWet.connect(this.nativeReverb);
    this.nativeDry.connect(this.nativeFilter);
    this.nativeReverb.connect(this.nativeFilter);
    this.nativeFilter.connect(this.nativeTremoloGain);
    this.nativeTremoloGain.connect(this.nativeMaster);
    this.nativeMaster.connect(ctx.destination);
    this.nativeChannels = {};

    for (const source of SOUND_SOURCES) {
      const gain = ctx.createGain();
      gain.gain.value = dbToGain(source.volume);
      gain.connect(this.nativeBus);
      this.nativeChannels[source.id] = gain;
    }
  }

  createImpulse(seconds, decay) {
    const ctx = this.nativeContext;
    const length = Math.floor(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  noteToFrequency(note) {
    const match = /^([A-G]#?)(\d)$/.exec(note);
    if (!match) return 440;
    const semis = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
    const midi = (Number(match[2]) + 1) * 12 + semis[match[1]];
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  nativeEnvelope(gain, start, peak, attack, decay, sustain, release, duration) {
    gain.gain.cancelScheduledValues(start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak * sustain, 0.0002), start + attack + decay);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration + release);
  }

  nativeOsc({ id, note, time, duration = 1, type = "sine", peak = 0.14, attack = 0.02, decay = 0.5, sustain = 0.12, release = 1.2, detune = 0 }) {
    if (this.muted.get(id)) return;
    const ctx = this.nativeContext;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = typeof note === "number" ? note : this.noteToFrequency(note);
    osc.detune.value = detune;
    this.nativeEnvelope(gain, time, peak, attack, decay, sustain, release, duration);
    osc.connect(gain);
    gain.connect(this.nativeChannels[id]);
    osc.start(time);
    osc.stop(time + duration + release + 0.2);
    this.markActive(id, Math.max(500, (duration + release) * 600));
  }

  nativeNoise({ id, time, duration = 0.25, peak = 0.07, attack = 0.004, decay = 0.08, sustain = 0.01, release = 0.1, highpass = 800 }) {
    if (this.muted.get(id)) return;
    const ctx = this.nativeContext;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * (duration + release + 0.1)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    filter.type = "highpass";
    filter.frequency.value = highpass;
    this.nativeEnvelope(gain, time, peak, attack, decay, sustain, release, duration);
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.nativeChannels[id]);
    source.start(time);
    this.markActive(id, Math.max(500, (duration + release) * 700));
  }

  nativePlayPad(time) {
    const env = this.env();
    const direction = env.tide.direction === "上潮" ? 1 : -1;
    const baseChord = choose(PAD_CHORDS);
    const movingNote = this.nextNote("nativePadMotion", direction > 0 ? 4 : 2, direction > 0 ? 9 : 7);
    const chord = [...baseChord.slice(0, 3), movingNote];
    const swell = 0.055 + this.composition.padMotion * 0.035;
    chord.forEach((note, i) => {
      this.nativeOsc({ id: "analogPad", note, time: time + i * 0.08, duration: 7.5 + i * 0.6, type: i % 2 ? "triangle" : "sine", peak: swell, attack: 1.2 + i * 0.35, decay: 1.1, sustain: 0.42 + this.composition.padMotion * 0.18, release: 4.5, detune: i * 9 - 13 });
    });
    this.nativePlayPadRipple(time + 1.4, direction);
    if (env.timeBand === "Morning" || env.weather.weather === "雨" || Math.random() < this.composition.padMotion) {
      this.nativeOsc({ id: "dreamPad", note: this.nextNote("nativeDream", 7, 11), time: time + 0.35, duration: 6.4, type: "triangle", peak: 0.052, attack: 1.4, decay: 1.2, sustain: 0.42, release: 4.2, detune: direction * 5 });
      this.nativeOsc({ id: "dreamPad", note: this.nextNote("nativeDreamAnswer", 6, 10), time: time + 3.2, duration: 4.8, type: "sine", peak: 0.028, attack: 1.1, decay: 0.9, sustain: 0.32, release: 3.8, detune: direction * -7 });
    }
  }

  nativePlayPadRipple(time, direction) {
    const steps = choose([2, 3, 4]);
    const spacing = 0.75 + (1 - this.composition.padMotion) * 0.35;
    for (let i = 0; i < steps; i++) {
      const low = direction > 0 ? 4 + i : 7 - i;
      const high = direction > 0 ? 8 + i : 10 - i;
      this.nativeOsc({
        id: i % 2 ? "dreamPad" : "analogPad",
        note: this.nextNote(`nativePadRipple${i}`, clamp(low, 2, 9), clamp(high, 5, 11)),
        time: time + i * spacing,
        duration: 2.8 + this.composition.padMotion * 1.4,
        type: i % 2 ? "triangle" : "sine",
        peak: 0.018 + this.composition.padMotion * 0.018,
        attack: 0.65,
        decay: 0.7,
        sustain: 0.24,
        release: 2.4,
        detune: direction * (i + 1) * 4
      });
    }
  }

  nativePlayLine(time) {
    const env = this.env();
    if (env.tide.tideStillPhase === "center" && Math.random() < 0.7) return;
    if (env.timeBand === "Night" && Math.random() < 0.7) return;
    const rising = env.tide.direction === "上潮";
    const start = Math.floor(4 + Math.random() * 4);
    const scale = this.composition.scale;
    const phrase = [start, start + (rising ? 1 : -1), start + (rising ? 3 : -2)].map((i) => noteAt(scale, clamp(i + this.pitchBias(), 0, scale.length - 1)));
    const roll = Math.random();
    if (roll < 0.45) {
      phrase.forEach((note, idx) => this.nativeOsc({ id: "ambientPiano", note, time: time + idx * 0.52, duration: 1.1, type: "sine", peak: 0.08, attack: 0.025, decay: 0.8, sustain: 0.1, release: 2.8 }));
    } else if (roll < 0.76) {
      this.nativeOsc({ id: "glassBell", note: phrase[2], time, duration: 1.2, type: "sine", peak: 0.055, attack: 0.006, decay: 1.2, sustain: 0.04, release: 2.8 });
      this.nativeOsc({ id: "glassBell", note: this.noteToFrequency(phrase[2]) * 2.01, time, duration: 0.8, type: "sine", peak: 0.018, attack: 0.006, decay: 0.7, sustain: 0.01, release: 1.8 });
    } else {
      this.nativeOsc({ id: "glockenspiel", note: phrase[1], time, duration: 0.55, type: "triangle", peak: 0.045, attack: 0.003, decay: 0.6, sustain: 0.01, release: 1.5 });
    }
  }

  nativePlayDot(time) {
    const env = this.env();
    const freezePenalty = env.tide.tideStill ? 0.45 : 0;
    const nightPenalty = env.timeBand === "Night" ? 0.38 : 0;
    const probability = clamp(this.composition.dotChance + env.tide.speedNorm * 0.38 - freezePenalty - nightPenalty, 0.02, 0.82);
    if (Math.random() > probability) return;
    const roll = Math.random();
    if (roll < 0.42) {
      this.nativeOsc({ id: "marimba", note: this.nextNote("nativeMarimba", 2, 7), time, duration: 0.24, type: "sine", peak: 0.17, attack: 0.006, decay: 0.22, sustain: 0.02, release: 0.8 });
    } else if (roll < 0.72) {
      this.nativeNoise({ id: "woodBlock", time, duration: 0.055, peak: 0.065, attack: 0.002, decay: 0.045, sustain: 0.01, release: 0.04, highpass: 380 });
    } else if (roll < 0.9) {
      this.nativeOsc({ id: "crystalAccent", note: this.nextNote("nativeCrystal", 8, 12), time, duration: 0.5, type: "sine", peak: 0.05, attack: 0.003, decay: 0.35, sustain: 0.01, release: 1.8 });
    } else {
      this.nativeOsc({ id: "glockenspiel", note: this.nextNote("nativeGlock", 8, 12), time, duration: 0.25, type: "triangle", peak: 0.04, attack: 0.003, decay: 0.25, sustain: 0.01, release: 0.9 });
    }
  }

  nativePlayPulse(time) {
    const pattern = this.composition.rhythm;
    const slot = this.nativePulse % 16;
    const activeSlot = pattern.slots.includes(slot);
    const offGrid = Math.random() < this.composition.syncopation && !activeSlot;

    if (!activeSlot && !offGrid) return;
    this.nativePlayDot(time + (offGrid ? choose([0.05, 0.11, 0.17]) : 0));
    if (pattern.accent.includes(slot) && Math.random() < this.composition.accentChance) {
      this.nativePlayRhythmFigure(time + 0.04);
    }
  }

  nativePlayRhythmFigure(time) {
    const env = this.env();
    const spacing = 0.14 + (1 - env.tide.speedNorm) * 0.12;
    const length = choose([2, 3, 4]);
    for (let i = 0; i < length; i++) {
      const source = Math.random() < 0.62 ? "marimba" : "woodBlock";
      if (source === "marimba") {
        this.nativeOsc({ id: "marimba", note: this.nextNote(`nativeFigure${i}`, 2, 8), time: time + i * spacing, duration: 0.18, type: "sine", peak: 0.12, attack: 0.004, decay: 0.16, sustain: 0.02, release: 0.55 });
      } else {
        this.nativeNoise({ id: "woodBlock", time: time + i * spacing, duration: 0.045, peak: 0.045, attack: 0.002, decay: 0.04, sustain: 0.01, release: 0.04, highpass: 420 });
      }
    }
    if (Math.random() < 0.25) {
      this.nativeOsc({ id: "crystalAccent", note: this.nextNote("nativeFigureCrystal", 8, 12), time: time + length * spacing + 0.08, duration: 0.42, type: "sine", peak: 0.04, attack: 0.004, decay: 0.28, sustain: 0.01, release: 1.4 });
    }
  }

  nativePlayTexture(time) {
    const env = this.env();
    const chance = env.weather.weather === "雨" ? 0.8 : 0.26;
    if (Math.random() > chance || env.timeBand === "Night") return;
    this.nativeNoise({ id: "brushedMetal", time, duration: 0.75, peak: 0.032, attack: 0.25, decay: 0.35, sustain: 0.07, release: 1.3, highpass: 2600 });
  }

  createLoops() {
    if (this.loops.length) {
      this.loops.forEach((loop) => loop.dispose());
    }
    const Tone = this.Tone;
    this.loops = [
      new Tone.Loop((time) => this.playPad(time), "16m").start(0),
      new Tone.Loop((time) => this.playLine(time), "1m").start("1m"),
      new Tone.Loop((time) => this.playDot(time), "8n").start("2n"),
      new Tone.Loop((time) => this.playRhythmFigure(time), "2n").start("4n"),
      new Tone.Loop((time) => this.playTexture(time), "2m").start("1m")
    ];
  }

  updateEnvironment(environment) {
    this.environment = environment;
    this.updateComposition(environment);
    if (this.nativeReady) {
      const ctx = this.nativeContext;
      const highTide = environment.tide.tideLevel > 150;
      const humid = environment.weather.humidity > 75;
      const wind = environment.weather.windSpeed > 7;
      const filterWobble = wind ? Math.sin(Date.now() / 1600) * 550 : 0;
      const timeGain = environment.timeBand === "Night" ? -9 : environment.timeBand === "Evening" ? -3 : 0;
      this.nativeMaster.gain.setTargetAtTime(dbToGain(this.settings.masterVolume + timeGain), ctx.currentTime, 0.6);
      this.nativeReverbWet.gain.setTargetAtTime(clamp(this.settings.reverbAmount + (humid ? 0.16 : 0), 0, 0.9) * 0.45, ctx.currentTime, 0.7);
      this.nativeFilter.frequency.setTargetAtTime(clamp(this.settings.lowpass + filterWobble + (environment.weather.weather === "晴れ" ? 700 : 0), 700, 9000), ctx.currentTime, 0.7);
      const trem = clamp(this.settings.tremoloAmount + (highTide ? 0.18 : 0), 0, 0.85);
      this.nativeTremoloGain.gain.setTargetAtTime(1 - trem * 0.25 + Math.sin(Date.now() / 600) * trem * 0.08, ctx.currentTime, 0.5);
      this.applyNativeLayerBalances(environment);
      return;
    }
    if (!this.graphReady) return;

    const highTide = environment.tide.tideLevel > 150;
    const humid = environment.weather.humidity > 75;
    const wind = environment.weather.windSpeed > 7;
    const filterWobble = wind ? Math.sin(Date.now() / 1600) * 550 : 0;
    const timeGain = environment.timeBand === "Night" ? -9 : environment.timeBand === "Evening" ? -3 : 0;
    const freeze = environment.tide.tideStillPhase === "center";

    this.master.volume.rampTo(this.settings.masterVolume + timeGain, 1.5);
    this.reverb.wet.rampTo(clamp(this.settings.reverbAmount + (humid ? 0.18 : 0) + (freeze ? 0.08 : 0), 0, 0.92), 2);
    this.filter.frequency.rampTo(clamp(this.settings.lowpass + filterWobble + (environment.weather.weather === "晴れ" ? 700 : 0), 700, 9000), 1.4);
    this.tremolo.depth.rampTo(clamp(this.settings.tremoloAmount + (highTide ? 0.18 : 0), 0, 0.85), 2);
    this.applyLayerBalances(environment);
  }

  updateComposition(environment) {
    const signature = [
      environment.timeBand,
      environment.weather.weather,
      environment.tide.direction,
      Math.round(environment.tide.speedNorm * 4),
      environment.tide.tideStillPhase,
      environment.tide.tideLevel > 150 ? "high" : "normal"
    ].join("|");
    const now = Date.now();

    if (this.composition?.signature === signature && now - this.composition.createdAt < 28000) {
      return;
    }

    this.composition = this.createComposition(environment, signature);
    if (this.Tone?.Transport) {
      this.Tone.Transport.bpm.rampTo(this.composition.bpm, 3);
    }
    window.dispatchEvent(new CustomEvent("composition-change", { detail: this.composition }));
  }

  createComposition(environment, signature = "initial") {
    const { timeBand, tide, weather } = environment;
    const speed = tide.speedNorm || 0.35;
    const isNight = timeBand === "Night";
    const isEvening = timeBand === "Evening";
    const isMorning = timeBand === "Morning";
    const isRain = weather.weather === "雨";
    const isSunny = weather.weather === "晴れ";
    const frozen = tide.tideStillPhase === "center";
    const rhythmPool = frozen
      ? [RHYTHM_PATTERNS[5], RHYTHM_PATTERNS[0]]
      : isNight
        ? [RHYTHM_PATTERNS[0], RHYTHM_PATTERNS[5]]
        : speed > 0.68
          ? [RHYTHM_PATTERNS[1], RHYTHM_PATTERNS[2], RHYTHM_PATTERNS[3], RHYTHM_PATTERNS[4]]
          : [RHYTHM_PATTERNS[0], RHYTHM_PATTERNS[2], RHYTHM_PATTERNS[4]];
    const scaleName = isEvening || isNight || tide.direction === "下潮" ? "A minor pentatonic" : "D major pentatonic";
    const weatherColor = isRain ? "rain shimmer" : isSunny ? "clear high light" : "soft cloud pad";
    const timeColor = isMorning ? "morning glass" : timeBand === "Afternoon" ? "afternoon stability" : isEvening ? "evening low flow" : "night minimum";
    const density = clamp((isNight ? 0.16 : 0.32) + speed * 0.48 + (isMorning ? 0.12 : 0) + (isRain ? 0.08 : 0) - (frozen ? 0.34 : 0), 0.06, 0.92);

    return {
      signature,
      createdAt: Date.now(),
      name: `${timeColor} / ${weatherColor}`,
      scaleName,
      scale: SCALES[scaleName],
      rhythm: choose(rhythmPool),
      density,
      bpm: Math.round(42 + speed * 28 + (isMorning ? 4 : 0) - (isNight ? 8 : 0)),
      dotChance: clamp(0.08 + density * 0.62, 0.04, 0.82),
      lineChance: clamp(0.12 + density * 0.36 + (tide.direction === "上潮" ? 0.08 : 0), 0.06, 0.62),
      textureChance: clamp((isRain ? 0.56 : 0.18) + (weather.windSpeed > 7 ? 0.2 : 0), 0.08, 0.82),
      accentChance: clamp(0.12 + speed * 0.42 + (isSunny ? 0.12 : 0), 0.08, 0.68),
      syncopation: clamp(0.03 + speed * 0.2 + (weather.windSpeed > 7 ? 0.12 : 0), 0.02, 0.36),
      padMotion: frozen ? 0.2 : clamp(0.36 + speed * 0.5 + (tide.tideLevel > 150 ? 0.12 : 0), 0.2, 0.92),
      directionStep: tide.direction === "上潮" ? 1 : -1
    };
  }

  applyLayerBalances(environment) {
    const { timeBand, tide, weather } = environment;
    const speed = tide.speedNorm;
    const rain = weather.weather === "雨";
    const cloudy = weather.weather === "曇り";
    const sunny = weather.weather === "晴れ";
    const freezeCut = tide.tideStill ? -5 : 0;

    const gains = {
      analogPad: (timeBand === "Afternoon" ? 2 : 0) + (cloudy ? 3 : 0),
      dreamPad: (timeBand === "Morning" ? 3 : 0) + (rain ? 3 : 0) + (sunny ? 1 : 0),
      ambientPiano: timeBand === "Afternoon" ? 2 : timeBand === "Night" ? -7 : 0,
      glassBell: (timeBand === "Morning" ? 3 : 0) + (sunny ? 2 : 0) + speed * 2,
      glockenspiel: (sunny ? 1.5 : 0) + speed * 1.5,
      marimba: 4 + speed * 6 + freezeCut + (timeBand === "Night" ? -5 : 0),
      woodBlock: 5 + speed * 5 + freezeCut + (timeBand === "Night" ? -6 : 0),
      crystalAccent: 3 + speed * 4 + (sunny ? 2 : 0) + freezeCut,
      brushedMetal: 2 + (rain ? 7 : 0) + (weather.windSpeed > 7 ? 2 : 0) + freezeCut - 1
    };

    for (const source of SOUND_SOURCES) {
      const muted = this.muted.get(source.id);
      const target = muted ? -80 : this.sourceVolumes.get(source.id) + (gains[source.id] || 0);
      this.channels[source.id].volume.rampTo(target, 1.2);
    }
  }

  applyNativeLayerBalances(environment) {
    const { timeBand, tide, weather } = environment;
    const speed = tide.speedNorm;
    const rain = weather.weather === "雨";
    const cloudy = weather.weather === "曇り";
    const sunny = weather.weather === "晴れ";
    const freezeCut = tide.tideStill ? -5 : 0;
    const gains = {
      analogPad: (timeBand === "Afternoon" ? 2 : 0) + (cloudy ? 3 : 0),
      dreamPad: (timeBand === "Morning" ? 3 : 0) + (rain ? 3 : 0) + (sunny ? 1 : 0),
      ambientPiano: timeBand === "Afternoon" ? 2 : timeBand === "Night" ? -7 : 0,
      glassBell: (timeBand === "Morning" ? 3 : 0) + (sunny ? 2 : 0) + speed * 2,
      glockenspiel: (sunny ? 1.5 : 0) + speed * 1.5,
      marimba: 4 + speed * 6 + freezeCut + (timeBand === "Night" ? -5 : 0),
      woodBlock: 5 + speed * 5 + freezeCut + (timeBand === "Night" ? -6 : 0),
      crystalAccent: 3 + speed * 4 + (sunny ? 2 : 0) + freezeCut,
      brushedMetal: 2 + (rain ? 7 : 0) + (weather.windSpeed > 7 ? 2 : 0) + freezeCut - 1
    };
    for (const source of SOUND_SOURCES) {
      const targetDb = this.muted.get(source.id) ? -80 : this.sourceVolumes.get(source.id) + (gains[source.id] || 0);
      this.nativeChannels[source.id].gain.setTargetAtTime(dbToGain(targetDb), this.nativeContext.currentTime, 0.5);
    }
  }

  setMasterVolume(value) {
    this.settings.masterVolume = Number(value);
    if (this.nativeMaster) this.nativeMaster.gain.setTargetAtTime(dbToGain(this.settings.masterVolume), this.nativeContext.currentTime, 0.2);
    if (this.master) this.master.volume.rampTo(this.settings.masterVolume, 0.5);
  }

  setReverbAmount(value) {
    this.settings.reverbAmount = Number(value);
    if (this.nativeReverbWet) this.nativeReverbWet.gain.setTargetAtTime(this.settings.reverbAmount * 0.45, this.nativeContext.currentTime, 0.2);
    if (this.reverb) this.reverb.wet.rampTo(this.settings.reverbAmount, 0.5);
  }

  setLowpass(value) {
    this.settings.lowpass = Number(value);
    if (this.nativeFilter) this.nativeFilter.frequency.setTargetAtTime(this.settings.lowpass, this.nativeContext.currentTime, 0.2);
    if (this.filter) this.filter.frequency.rampTo(this.settings.lowpass, 0.5);
  }

  setTremoloAmount(value) {
    this.settings.tremoloAmount = Number(value);
    if (this.nativeTremoloGain) this.nativeTremoloGain.gain.setTargetAtTime(1 - this.settings.tremoloAmount * 0.18, this.nativeContext.currentTime, 0.2);
    if (this.tremolo) this.tremolo.depth.rampTo(this.settings.tremoloAmount, 0.5);
  }

  setSourceVolume(id, value) {
    this.sourceVolumes.set(id, Number(value));
    if (this.nativeChannels?.[id] && !this.muted.get(id)) {
      this.nativeChannels[id].gain.setTargetAtTime(dbToGain(Number(value)), this.nativeContext.currentTime, 0.2);
    }
    if (this.channels?.[id] && !this.muted.get(id)) {
      this.channels[id].volume.rampTo(Number(value), 0.3);
    }
  }

  setMuted(id, muted) {
    this.muted.set(id, muted);
    if (this.nativeChannels?.[id]) {
      this.nativeChannels[id].gain.setTargetAtTime(muted ? 0.0001 : dbToGain(this.sourceVolumes.get(id)), this.nativeContext.currentTime, 0.2);
    }
    if (this.channels?.[id]) {
      this.channels[id].volume.rampTo(muted ? -80 : this.sourceVolumes.get(id), 0.4);
    }
  }

  markActive(id, duration = 900) {
    this.activeIds.add(id);
    window.dispatchEvent(new CustomEvent("source-activity", { detail: { id, active: true } }));
    clearTimeout(this[`timer_${id}`]);
    this[`timer_${id}`] = setTimeout(() => {
      this.activeIds.delete(id);
      window.dispatchEvent(new CustomEvent("source-activity", { detail: { id, active: false } }));
    }, duration);
  }

  env() {
    return this.environment || {
      timeBand: "Afternoon",
      tide: { speedNorm: 0.35, direction: "上潮", tideStill: false, tideStillPhase: "none", tideLevel: 100 },
      weather: { weather: "曇り", humidity: 60, windSpeed: 2 }
    };
  }

  pitchBias() {
    const env = this.env();
    const direction = env.tide.direction === "上潮" ? 1 : -1;
    return Math.round(direction * (env.tide.speedNorm * 2 + (env.tide.tideLevel > 150 ? 1 : 0)));
  }

  nextNote(id, baseMin, baseMax) {
    const env = this.env();
    const direction = env.tide.direction === "上潮" ? 1 : -1;
    let index = Math.floor(baseMin + Math.random() * (baseMax - baseMin + 1)) + this.pitchBias();

    if (this.lastNotes[id] === index) {
      index += direction;
    }
    index = clamp(index, baseMin, baseMax);
    this.lastNotes[id] = index;
    return noteAt(this.composition.scale, index);
  }

  playPad(time) {
    if (!this.graphReady) return;
    const env = this.env();
    const freeze = env.tide.tideStillPhase === "center";
    const direction = env.tide.direction === "上潮" ? 1 : -1;
    const chance = clamp((env.timeBand === "Night" ? 0.5 : 0.72) + this.composition.padMotion * 0.24, 0.24, 0.96);
    if (Math.random() > chance) return;

    const padChord = [...choose(PAD_CHORDS).slice(0, 3), this.nextNote("tonePadMotion", direction > 0 ? 4 : 2, direction > 0 ? 9 : 7)];
    this.analogPad.triggerAttackRelease(padChord, freeze ? "12m" : "8m", time, 0.56);
    this.markActive("analogPad", 5000);

    const rippleCount = choose([2, 3, 4]);
    for (let i = 0; i < rippleCount; i++) {
      const low = direction > 0 ? 4 + i : 7 - i;
      const high = direction > 0 ? 8 + i : 10 - i;
      const note = this.nextNote(`tonePadRipple${i}`, clamp(low, 2, 9), clamp(high, 5, 11));
      const target = i % 2 ? this.dreamPad : this.analogPad;
      target.triggerAttackRelease(note, "2m", time + 0.9 + i * choose([0.55, 0.72, 0.9]), 0.14 + this.composition.padMotion * 0.08);
    }
    this.markActive("analogPad", 5000);

    if (env.timeBand === "Morning" || env.weather.weather === "雨" || Math.random() < this.composition.padMotion) {
      this.dreamPad.triggerAttackRelease([this.nextNote("dreamPad", 5, 9), this.nextNote("dreamPad2", 8, 11)], "6m", time + 0.25, 0.34);
      this.markActive("dreamPad", 5000);
    }
  }

  playLine(time) {
    const env = this.env();
    if (env.tide.tideStillPhase === "center" && Math.random() < 0.74) return;
    if (env.timeBand === "Night" && Math.random() < 0.7) return;
    if (Math.random() > this.composition.lineChance) return;

    const rising = env.tide.direction === "上潮";
    const start = Math.floor(4 + Math.random() * 4);
    const scale = this.composition.scale;
    const phrase = [start, start + (rising ? 1 : -1), start + (rising ? 3 : -2)].map((i) => noteAt(scale, clamp(i + this.pitchBias(), 0, scale.length - 1)));
    const sourceRoll = Math.random();

    if (sourceRoll < 0.45) {
      phrase.forEach((note, idx) => this.piano.triggerAttackRelease(note, "2n", time + idx * choose([0.42, 0.56, 0.72, 0.9]), 0.22));
      this.markActive("ambientPiano", 2400);
    } else if (sourceRoll < 0.76) {
      this.glassBell.triggerAttackRelease(phrase[phrase.length - 1], "2n", time, 0.17);
      this.markActive("glassBell", 1800);
    } else {
      this.glockenspiel.triggerAttackRelease(phrase[1], "8n", time, 0.1);
      this.markActive("glockenspiel", 1200);
    }
  }

  playDot(time) {
    const env = this.env();
    const freezePenalty = env.tide.tideStill ? 0.45 : 0;
    const nightPenalty = env.timeBand === "Night" ? 0.38 : 0;
    const probability = clamp(this.composition.dotChance + env.tide.speedNorm * 0.25 - freezePenalty - nightPenalty, 0.02, 0.82);
    if (Math.random() > probability) return;

    const roll = Math.random();
    if (roll < 0.42) {
      this.marimba.triggerAttackRelease(this.nextNote("marimba", 2, 7), "8n", time, 0.42);
      this.markActive("marimba", 700);
    } else if (roll < 0.72) {
      this.woodBlock.triggerAttackRelease("16n", time, 0.12 + env.tide.speedNorm * 0.08);
      this.markActive("woodBlock", 500);
    } else if (roll < 0.9) {
      this.crystalAccent.triggerAttackRelease(this.nextNote("crystal", 8, 12), "4n", time, 0.11);
      this.markActive("crystalAccent", 900);
    } else {
      this.glockenspiel.triggerAttackRelease(this.nextNote("glockDot", 8, 12), "16n", time, 0.075);
      this.markActive("glockenspiel", 650);
    }
  }

  playRhythmFigure(time) {
    const env = this.env();
    if (env.tide.tideStillPhase === "center" && Math.random() < 0.78) return;
    if (Math.random() > this.composition.accentChance) return;

    const pattern = this.composition.rhythm;
    const slots = pattern.slots.slice(0, choose([2, 3, 4, 5]));
    const unit = choose([0.16, 0.22, 0.28, 0.34]) + (1 - env.tide.speedNorm) * 0.08;
    slots.forEach((slot, idx) => {
      const t = time + idx * unit + (this.composition.syncopation > 0.18 && idx % 2 ? 0.06 : 0);
      if (Math.random() < 0.58) {
        this.marimba.triggerAttackRelease(this.nextNote(`figureMarimba${idx}`, 2, 8), "16n", t, pattern.accent.includes(slot) ? 0.34 : 0.22);
        this.markActive("marimba", 600);
      } else {
        this.woodBlock.triggerAttackRelease("16n", t, pattern.accent.includes(slot) ? 0.12 : 0.08);
        this.markActive("woodBlock", 500);
      }
    });

    if (Math.random() < 0.22 + env.tide.speedNorm * 0.18) {
      this.crystalAccent.triggerAttackRelease(this.nextNote("figureCrystal", 8, 12), "8n", time + slots.length * unit + 0.08, 0.085);
      this.markActive("crystalAccent", 900);
    }
  }

  playTexture(time) {
    const env = this.env();
    const chance = this.composition.textureChance;
    if (Math.random() > chance || env.timeBand === "Night") return;
    this.brushedMetal.triggerAttackRelease("2n", time, 0.06);
    this.markActive("brushedMetal", 1800);
  }

  releasePads() {
    if (this.analogPad) this.analogPad.releaseAll();
    if (this.dreamPad) this.dreamPad.releaseAll();
  }
}

window.SOUND_SOURCES = SOUND_SOURCES;
window.AudioEngine = AudioEngine;
