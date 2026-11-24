/**
 * Procedural nocturnal botanical soundscape synthesizer (Web Audio API).
 * Starts only after explicit user interaction and releases all audio nodes cleanly on dispose.
 */
export function createFernhollowAudio() {
  let ctx = null;
  let masterGain = null;
  let chimeTimer = null;
  let isPlaying = false;
  let isDisposed = false;
  const activeNodes = [];

  function initAudioGraph() {
    if (ctx || isDisposed || typeof window === "undefined") return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // 1. Warm nocturnal harmonic pad (D2 + A2 + F#3 soft mist)
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.setValueAtTime(360, ctx.currentTime);
    padFilter.Q.setValueAtTime(0.9, ctx.currentTime);
    padFilter.connect(masterGain);

    const filterLfo = ctx.createOscillator();
    const filterLfoGain = ctx.createGain();
    filterLfo.type = "sine";
    filterLfo.frequency.setValueAtTime(0.08, ctx.currentTime);
    filterLfoGain.gain.setValueAtTime(140, ctx.currentTime);
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(padFilter.frequency);
    filterLfo.start();
    activeNodes.push(filterLfo);

    const padVoices = [
      { freq: 73.42, gain: 0.14, type: "sine" },
      { freq: 110.0, gain: 0.08, type: "triangle" },
      { freq: 146.83, gain: 0.05, type: "sine" },
      { freq: 185.0, gain: 0.03, type: "sine" },
    ];

    for (const voice of padVoices) {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, ctx.currentTime);
      gainNode.gain.setValueAtTime(voice.gain, ctx.currentTime);
      osc.connect(gainNode);
      gainNode.connect(padFilter);
      osc.start();
      activeNodes.push(osc);
    }

    // 2. Soft night valley wind texture (filtered brown/pink noise)
    const bufferSize = ctx.sampleRate * 3;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const channelData = noiseBuffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      channelData[i] = lastOut * 2.2;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.setValueAtTime(420, ctx.currentTime);
    windFilter.Q.setValueAtTime(1.4, ctx.currentTime);

    const windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.06, ctx.currentTime);

    const windLfo = ctx.createOscillator();
    const windLfoGain = ctx.createGain();
    windLfo.type = "sine";
    windLfo.frequency.setValueAtTime(0.11, ctx.currentTime);
    windLfoGain.gain.setValueAtTime(0.035, ctx.currentTime);
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windGain.gain);
    windLfo.start();
    activeNodes.push(windLfo);

    noiseSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGain);
    noiseSource.start();
    activeNodes.push(noiseSource);

    return true;
  }

  function scheduleDewChimes() {
    if (chimeTimer) clearInterval(chimeTimer);
    const notes = [587.33, 659.25, 739.99, 880.0, 987.77];

    chimeTimer = setInterval(() => {
      if (!ctx || !masterGain || !isPlaying || ctx.state !== "running") return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const freq = notes[Math.floor(Math.random() * notes.length)];

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.024, now + 0.18);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);

      osc.connect(env);
      env.connect(masterGain);
      osc.start(now);
      osc.stop(now + 2.7);
    }, 3400);
  }

  async function unmute() {
    if (isDisposed) return false;
    const ready = initAudioGraph();
    if (!ready || !ctx || !masterGain) return false;

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(Math.max(masterGain.gain.value, 0.0001), now);
    masterGain.gain.linearRampToValueAtTime(0.45, now + 0.9);
    isPlaying = true;
    scheduleDewChimes();
    return true;
  }

  function mute() {
    if (!ctx || !masterGain) {
      isPlaying = false;
      return;
    }
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.4);
    isPlaying = false;
    if (chimeTimer) {
      clearInterval(chimeTimer);
      chimeTimer = null;
    }
  }

  function dispose() {
    isDisposed = true;
    isPlaying = false;
    if (chimeTimer) {
      clearInterval(chimeTimer);
      chimeTimer = null;
    }
    for (const node of activeNodes) {
      try {
        node.stop();
      } catch {
        // Node may already be stopped
      }
      try {
        node.disconnect();
      } catch {
        // Ignore cleanup disconnect errors
      }
    }
    activeNodes.length = 0;

    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
      masterGain = null;
    }
  }

  return {
    unmute,
    mute,
    dispose,
    getIsPlaying: () => isPlaying,
  };
}

