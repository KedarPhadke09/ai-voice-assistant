/**
 * Astra AI Voice Assistant • Client Engine
 * Speech-to-Text, Streaming LLM (Gemini 3.8 Flash), Audio Synthesizer, & Instant Pipelined TTS
 */

(() => {
  // --- Audio Sound Effects Synthesizer ---
  class SoundFX {
    constructor() {
      this.ctx = null;
    }

    init() {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    playChime(type) {
      try {
        this.init();
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        if (type === 'start') {
          // Futuristic rising chirp
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.start(now);
          osc.stop(now + 0.22);
        } else if (type === 'end') {
          // Gentle falling confirm
          osc.type = 'sine';
          osc.frequency.setValueAtTime(780, now);
          osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          osc.start(now);
          osc.stop(now + 0.2);
        }
      } catch (e) {
        // AudioContext audio chimes are optional
      }
    }
  }

  const sfx = new SoundFX();

  // --- State ---
  const state = {
    isListening: false,
    isSpeaking: false,
    voiceAudioEnabled: true,
    handsFreeMode: false,
    activeModel: localStorage.getItem('astra_model') || 'gemini-3.8-flash',
    apiKeyOverride: localStorage.getItem('astra_api_key') || '',
    speechRate: parseFloat(localStorage.getItem('astra_speed') || '1.15'),
    speechPitch: parseFloat(localStorage.getItem('astra_pitch') || '1.0'),
    selectedVoiceURI: localStorage.getItem('astra_voice') || '',
    history: [],
    speechQueue: [],
    isProcessingSentence: false,
    recognition: null,
    audioContext: null,
    analyser: null,
    micStream: null,
    canvasAnimId: null
  };

  // --- DOM Elements ---
  const micBtn = document.getElementById('micBtn');
  const hologramOrb = document.getElementById('hologramOrb');
  const orbWrapper = document.getElementById('orbWrapper');
  const orbIcon = document.getElementById('orbIcon');
  const stateLabel = document.getElementById('stateLabel');
  const liveTranscript = document.getElementById('liveTranscript');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const messagesList = document.getElementById('messagesList');
  const voiceAudioToggle = document.getElementById('voiceAudioToggle');
  const audioToggleText = document.getElementById('audioToggleText');
  const handsFreeToggle = document.getElementById('handsFreeToggle');
  const handsFreeText = document.getElementById('handsFreeText');
  const stopSpeechBtn = document.getElementById('stopSpeechBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const modelBadgeText = document.getElementById('modelBadgeText');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModal = document.getElementById('closeSettingsModal');
  const applySettingsBtn = document.getElementById('applySettingsBtn');
  const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');
  const modelDropdown = document.getElementById('modelDropdown');
  const voiceDropdown = document.getElementById('voiceDropdown');
  const speedRange = document.getElementById('speedRange');
  const speedTag = document.getElementById('speedTag');
  const pitchRange = document.getElementById('pitchRange');
  const pitchTag = document.getElementById('pitchTag');
  const apiKeyField = document.getElementById('apiKeyField');
  const quickChips = document.getElementById('quickChips');
  const canvas = document.getElementById('waveformCanvas');
  const ctx = canvas.getContext('2d');

  // --- Initialize Web Speech API (Microphone Recognition) ---
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      updateStatus("⚠️ Voice input not supported in this browser. Please type!");
      if (micBtn) {
        micBtn.style.opacity = '0.6';
        micBtn.title = "Microphone input not supported in this browser";
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      state.isListening = true;
      sfx.playChime('start');
      micBtn.classList.add('listening');
      orbWrapper.classList.add('listening');
      orbWrapper.classList.remove('speaking');
      orbIcon.textContent = '🎙️';
      updateStatus("Listening... speak now");
      setupMicStream();
    };

    recognition.onresult = (e) => {
      let interim = '';
      let final = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript;
        } else {
          interim += e.results[i][0].transcript;
        }
      }

      if (interim) {
        liveTranscript.textContent = `"${interim}"`;
      }

      if (final) {
        liveTranscript.textContent = '';
        state.isListening = false;
        micBtn.classList.remove('listening');
        orbWrapper.classList.remove('listening');
        orbIcon.textContent = '⚡';
        sfx.playChime('end');
        sendMessage(final.trim());
      }
    };

    recognition.onerror = (e) => {
      console.warn("Speech recognition error:", e.error);
      state.isListening = false;
      micBtn.classList.remove('listening');
      orbWrapper.classList.remove('listening');
      orbIcon.textContent = '⚡';
      if (e.error === 'not-allowed') {
        updateStatus("Microphone access blocked. Allow mic in browser settings.");
      } else if (e.error !== 'no-speech') {
        updateStatus(`Mic: ${e.error}`);
      } else {
        updateStatus("Ready • Tap mic to speak");
      }
    };

    recognition.onend = () => {
      state.isListening = false;
      micBtn.classList.remove('listening');
      orbWrapper.classList.remove('listening');
      if (!state.isSpeaking) {
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");
      }
    };

    state.recognition = recognition;
  }

  function toggleListening() {
    stopSpeaking();

    if (!state.recognition) {
      alert("Microphone recognition requires a Web Speech API compatible browser (Google Chrome, Microsoft Edge, Safari). You can also type in the input box!");
      return;
    }

    if (state.isListening) {
      try {
        state.recognition.stop();
      } catch (e) {}
    } else {
      try {
        state.recognition.start();
      } catch (e) {
        console.warn("Recognition start failed, restarting:", e);
        try {
          state.recognition.abort();
          setTimeout(() => state.recognition.start(), 200);
        } catch (err) {}
      }
    }
  }

  // --- Voice Synthesis (Instant Pipelined TTS) ---
  let voices = [];

  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
    voices = window.speechSynthesis.getVoices();

    voiceDropdown.innerHTML = '<option value="">Default System Voice</option>';
    voices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' [Default]' : ''}`;
      if (v.voiceURI === state.selectedVoiceURI) {
        opt.selected = true;
      }
      voiceDropdown.appendChild(opt);
    });
  }

  if ('speechSynthesis' in window) {
    populateVoices();
    window.speechSynthesis.onvoiceschanged = populateVoices;
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    state.speechQueue = [];
    state.isSpeaking = false;
    state.isProcessingSentence = false;
    orbWrapper.classList.remove('speaking');
    stopSpeechBtn.style.display = 'none';
    if (!state.isListening) {
      orbIcon.textContent = '⚡';
      updateStatus("Ready • Tap mic to speak");
    }
  }

  function queueSpeech(text) {
    if (!state.voiceAudioEnabled || !('speechSynthesis' in window)) return;

    // Remove markdown symbols that sound awkward when read aloud
    const cleaned = text
      .replace(/[*#_`~>\[\]\(\)\{\}\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return;
    state.speechQueue.push(cleaned);
    processNextSpeechChunk();
  }

  function processNextSpeechChunk() {
    if (state.isProcessingSentence || state.speechQueue.length === 0) return;
    if (!('speechSynthesis' in window)) return;

    state.isProcessingSentence = true;
    state.isSpeaking = true;
    orbWrapper.classList.add('speaking');
    orbIcon.textContent = '🔊';
    stopSpeechBtn.style.display = 'inline-flex';
    updateStatus("Astra is speaking...");

    const sentence = state.speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = state.speechRate;
    utterance.pitch = state.speechPitch;

    if (state.selectedVoiceURI) {
      const v = voices.find(x => x.voiceURI === state.selectedVoiceURI);
      if (v) utterance.voice = v;
    }

    utterance.onend = () => {
      state.isProcessingSentence = false;
      if (state.speechQueue.length > 0) {
        processNextSpeechChunk();
      } else {
        state.isSpeaking = false;
        orbWrapper.classList.remove('speaking');
        stopSpeechBtn.style.display = 'none';
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");

        // Hands-free continuous loop
        if (state.handsFreeMode && !state.isListening) {
          setTimeout(() => {
            toggleListening();
          }, 450);
        }
      }
    };

    utterance.onerror = () => {
      state.isProcessingSentence = false;
      processNextSpeechChunk();
    };

    window.speechSynthesis.speak(utterance);
  }

  // --- Canvas Audio Spectrum & Waveform Visualizer ---
  async function setupMicStream() {
    try {
      if (!state.audioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) state.audioContext = new AudioCtx();
      }
      if (state.audioContext && state.audioContext.state === 'suspended') {
        await state.audioContext.resume();
      }
      if (!state.micStream && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = state.audioContext.createMediaStreamSource(state.micStream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 64;
        source.connect(state.analyser);
      }
    } catch (e) {
      // Mic audio visualizer optional fallback
    }
  }

  function renderWaveform() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const baseR = 64;
    const points = 40;

    let freqs = new Uint8Array(32);
    if (state.analyser && (state.isListening || state.isSpeaking)) {
      state.analyser.getByteFrequencyData(freqs);
    } else {
      const time = Date.now() * 0.003;
      for (let i = 0; i < 32; i++) {
        freqs[i] = Math.sin(time + i * 0.28) * 18 + 24;
      }
    }

    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const fIndex = i % freqs.length;
      const intensity = freqs[fIndex] / 255;
      const boost = (state.isListening || state.isSpeaking) ? intensity * 50 : intensity * 16;
      const r = baseR + boost;

      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    if (state.isListening) {
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.85)';
      ctx.shadowColor = '#ec4899';
    } else if (state.isSpeaking) {
      ctx.strokeStyle = 'rgba(157, 78, 221, 0.85)';
      ctx.shadowColor = '#9d4edd';
    } else {
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.45)';
      ctx.shadowColor = '#00f5d4';
    }

    ctx.lineWidth = 3;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    state.canvasAnimId = requestAnimationFrame(renderWaveform);
  }

  // --- Send Message & Stream Response (Fast AF) ---
  async function sendMessage(text) {
    if (!text || text.trim() === '') return;
    text = text.trim();

    stopSpeaking();

    // Append user message
    appendMessage('user', text);
    chatInput.value = '';

    // Create assistant response container
    const assistantMsg = appendMessage('assistant', '');
    const bubble = assistantMsg.querySelector('.msg-bubble');
    const badgeMini = assistantMsg.querySelector('.badge-mini');

    updateStatus("⚡ Gemini 3.8 Flash thinking & streaming...");
    orbIcon.textContent = '⏳';

    const tStart = performance.now();
    let fullText = "";
    let sentenceBuffer = "";

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: state.history,
          model: state.activeModel,
          api_key: state.apiKeyOverride || undefined,
          temperature: 0.7
        })
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let firstToken = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        const raw = decoder.decode(value, { stream: true });
        const events = raw.split("\n\n");

        for (const ev of events) {
          if (!ev.trim() || !ev.startsWith("data: ")) continue;
          const jsonStr = ev.replace("data: ", "").trim();

          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'meta' && data.model) {
              if (badgeMini) badgeMini.textContent = data.model;
            }

            if (data.chunk) {
              if (!firstToken) {
                firstToken = true;
                const ttft = Math.round(performance.now() - tStart);
                if (badgeMini) badgeMini.textContent = `${state.activeModel} • ${ttft}ms`;
                if (modelBadgeText) modelBadgeText.textContent = `${state.activeModel} • ${ttft}ms`;
              }

              fullText += data.chunk;
              sentenceBuffer += data.chunk;
              bubble.textContent = fullText;
              scrollChat();

              // Pipelined speech: sentence boundary detection (. ! ? \n)
              const match = sentenceBuffer.match(/^([\s\S]*?[.!?\n])\s+([\s\S]*)$/);
              if (match) {
                const completeSentence = match[1].trim();
                sentenceBuffer = match[2];
                if (completeSentence) {
                  queueSpeech(completeSentence);
                }
              }
            }

            if (data.error) {
              fullText += `\n[${data.error}]`;
              bubble.textContent = fullText;
            }

            if (data.done) {
              done = true;
            }
          } catch (err) {}
        }
      }

      // Flush remaining sentence
      if (sentenceBuffer.trim()) {
        queueSpeech(sentenceBuffer.trim());
      }

      state.history.push({ role: 'user', content: text });
      state.history.push({ role: 'model', content: fullText });

      addReplayBtn(assistantMsg, fullText);

    } catch (e) {
      console.error("Stream error:", e);
      bubble.textContent = `Sorry, couldn't reach Gemini: ${e.message}. Please verify your API key or connection.`;
      if (badgeMini) badgeMini.textContent = 'Error';
    } finally {
      if (!state.isSpeaking) {
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");
      }
    }
  }

  // --- UI Helpers ---
  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '👤' : '⚡';

    const content = document.createElement('div');
    content.className = 'msg-content';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    if (role === 'assistant') {
      meta.innerHTML = `<span class="badge-mini">Streaming...</span><span class="time-stamp">Now</span>`;
    } else {
      meta.innerHTML = `<span class="time-stamp">You</span>`;
    }

    content.appendChild(bubble);
    content.appendChild(meta);
    msg.appendChild(avatar);
    msg.appendChild(content);

    messagesList.appendChild(msg);
    scrollChat();
    return msg;
  }

  function addReplayBtn(msgElem, text) {
    const meta = msgElem.querySelector('.msg-meta');
    if (!meta) return;

    const replay = document.createElement('button');
    replay.className = 'btn-replay';
    replay.title = 'Replay response audio';
    replay.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
      <span>Replay</span>
    `;
    replay.onclick = () => {
      stopSpeaking();
      queueSpeech(text);
    };
    meta.appendChild(replay);
  }

  function updateStatus(text) {
    if (stateLabel) stateLabel.textContent = text;
  }

  function scrollChat() {
    const feed = document.getElementById('chatFeed');
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  // --- Event Listeners ---
  micBtn.addEventListener('click', toggleListening);
  hologramOrb.addEventListener('click', toggleListening);

  sendBtn.addEventListener('click', () => {
    sendMessage(chatInput.value);
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendMessage(chatInput.value);
    }
  });

  voiceAudioToggle.addEventListener('click', () => {
    state.voiceAudioEnabled = !state.voiceAudioEnabled;
    voiceAudioToggle.classList.toggle('active', state.voiceAudioEnabled);
    audioToggleText.textContent = `Voice Audio: ${state.voiceAudioEnabled ? 'ON' : 'OFF'}`;
    if (!state.voiceAudioEnabled) {
      stopSpeaking();
    }
  });

  handsFreeToggle.addEventListener('click', () => {
    state.handsFreeMode = !state.handsFreeMode;
    handsFreeToggle.classList.toggle('active', state.handsFreeMode);
    handsFreeText.textContent = `Hands-free: ${state.handsFreeMode ? 'ON' : 'OFF'}`;
  });

  stopSpeechBtn.addEventListener('click', stopSpeaking);

  clearChatBtn.addEventListener('click', () => {
    stopSpeaking();
    state.history = [];
    messagesList.innerHTML = '';
    const intro = document.createElement('div');
    intro.className = 'message assistant intro';
    intro.innerHTML = `
      <div class="msg-avatar">⚡</div>
      <div class="msg-content">
        <div class="msg-bubble">Conversation cleared! Tap the mic or type to speak with Gemini 3.8 Flash.</div>
      </div>
    `;
    messagesList.appendChild(intro);
  });

  quickChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.prompt) {
      sendMessage(chip.dataset.prompt);
    }
  });

  // Settings Modal Handlers
  settingsBtn.addEventListener('click', () => {
    modelDropdown.value = state.activeModel;
    speedRange.value = state.speechRate;
    speedTag.textContent = `${state.speechRate.toFixed(2)}x`;
    pitchRange.value = state.speechPitch;
    pitchTag.textContent = `${state.speechPitch.toFixed(2)}x`;
    apiKeyField.value = state.apiKeyOverride;
    settingsModal.classList.add('open');
  });

  closeSettingsModal.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.remove('open');
  });

  speedRange.addEventListener('input', (e) => {
    speedTag.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
  });

  pitchRange.addEventListener('input', (e) => {
    pitchTag.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
  });

  applySettingsBtn.addEventListener('click', () => {
    state.activeModel = modelDropdown.value;
    state.selectedVoiceURI = voiceDropdown.value;
    state.speechRate = parseFloat(speedRange.value);
    state.speechPitch = parseFloat(pitchRange.value);
    state.apiKeyOverride = apiKeyField.value.trim();

    localStorage.setItem('astra_model', state.activeModel);
    localStorage.setItem('astra_voice', state.selectedVoiceURI);
    localStorage.setItem('astra_speed', state.speechRate.toString());
    localStorage.setItem('astra_pitch', state.speechPitch.toString());
    localStorage.setItem('astra_api_key', state.apiKeyOverride);

    if (modelBadgeText) modelBadgeText.textContent = `${state.activeModel} • 180ms`;
    settingsModal.classList.remove('open');
  });

  resetDefaultsBtn.addEventListener('click', () => {
    state.activeModel = 'gemini-3.8-flash';
    state.selectedVoiceURI = '';
    state.speechRate = 1.15;
    state.speechPitch = 1.0;
    state.apiKeyOverride = '';

    localStorage.removeItem('astra_model');
    localStorage.removeItem('astra_voice');
    localStorage.removeItem('astra_speed');
    localStorage.removeItem('astra_pitch');
    localStorage.removeItem('astra_api_key');

    modelDropdown.value = 'gemini-3.8-flash';
    speedRange.value = 1.15;
    speedTag.textContent = '1.15x';
    pitchRange.value = 1.0;
    pitchTag.textContent = '1.0x';
    apiKeyField.value = '';
    if (modelBadgeText) modelBadgeText.textContent = 'gemini-3.8-flash • 180ms';
    settingsModal.classList.remove('open');
  });

  // --- Boot Initialization ---
  window.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    renderWaveform();
    if (modelBadgeText) modelBadgeText.textContent = `${state.activeModel} • 180ms`;
  });
})();
