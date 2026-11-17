/**
 * Astra AI Voice Assistant • Client Engine
 * Ultra-Fast Speech-to-Text, Streaming LLM (Gemini 3.8 Flash), & Pipelined TTS
 */

(() => {
  // --- State ---
  const state = {
    isListening: false,
    isSpeaking: false,
    voiceOutputEnabled: true,
    continuousMode: false,
    activeModel: localStorage.getItem('astra_model') || 'gemini-3.8-flash',
    apiKeyOverride: localStorage.getItem('astra_api_key') || '',
    speechRate: parseFloat(localStorage.getItem('astra_speech_rate') || '1.15'),
    speechPitch: parseFloat(localStorage.getItem('astra_speech_pitch') || '1.0'),
    selectedVoiceURI: localStorage.getItem('astra_voice_uri') || '',
    history: [],
    speechQueue: [],
    isProcessingSentence: false,
    recognition: null,
    audioContext: null,
    analyser: null,
    micStream: null,
    canvasAnimationId: null
  };

  // --- DOM Elements ---
  const micBtn = document.getElementById('micBtn');
  const orbCore = document.getElementById('orbCore');
  const orbContainer = document.querySelector('.orb-container');
  const orbIcon = document.getElementById('orbIcon');
  const voiceStatus = document.getElementById('voiceStatus');
  const interimTranscript = document.getElementById('interimTranscript');
  const textInput = document.getElementById('textInput');
  const sendBtn = document.getElementById('sendBtn');
  const messagesContainer = document.getElementById('messagesContainer');
  const voiceOutputToggle = document.getElementById('voiceOutputToggle');
  const continuousModeToggle = document.getElementById('continuousModeToggle');
  const stopSpeechBtn = document.getElementById('stopSpeechBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const currentModelBadge = document.getElementById('currentModelBadge');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');
  const modelSelect = document.getElementById('modelSelect');
  const voiceSelect = document.getElementById('voiceSelect');
  const speechRateSlider = document.getElementById('speechRate');
  const speechRateVal = document.getElementById('speechRateVal');
  const speechPitchSlider = document.getElementById('speechPitch');
  const speechPitchVal = document.getElementById('speechPitchVal');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const quickChips = document.getElementById('quickChips');
  const canvas = document.getElementById('waveformCanvas');
  const canvasCtx = canvas.getContext('2d');

  // --- Initialize Web Speech API (Voice Recognition) ---
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      updateStatus("⚠️ Web Speech API not supported in this browser. You can still type!");
      micBtn.style.opacity = '0.5';
      micBtn.title = "Speech recognition not supported in this browser";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      state.isListening = true;
      micBtn.classList.add('listening');
      orbContainer.classList.add('listening');
      orbContainer.classList.remove('speaking');
      orbIcon.textContent = '🎙️';
      updateStatus("Listening... Speak now");
      initAudioVisualizer();
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (interim) {
        interimTranscript.textContent = `"${interim}"`;
      }

      if (finalTranscript) {
        interimTranscript.textContent = '';
        state.isListening = false;
        micBtn.classList.remove('listening');
        orbContainer.classList.remove('listening');
        orbIcon.textContent = '⚡';
        sendMessage(finalTranscript.trim());
      }
    };

    recognition.onerror = (event) => {
      console.warn("Speech recognition error:", event.error);
      state.isListening = false;
      micBtn.classList.remove('listening');
      orbContainer.classList.remove('listening');
      orbIcon.textContent = '⚡';
      if (event.error !== 'no-speech') {
        updateStatus(`Mic status: ${event.error}`);
      } else {
        updateStatus("Ready • Tap mic to speak");
      }
    };

    recognition.onend = () => {
      state.isListening = false;
      micBtn.classList.remove('listening');
      orbContainer.classList.remove('listening');
      if (!state.isSpeaking) {
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");
      }
    };

    state.recognition = recognition;
  }

  function toggleListening() {
    if (!state.recognition) {
      alert("Microphone voice recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    // Stop speaking if currently speaking
    stopSpeaking();

    if (state.isListening) {
      try {
        state.recognition.stop();
      } catch (e) {}
    } else {
      try {
        state.recognition.start();
      } catch (e) {
        console.error("Error starting recognition:", e);
      }
    }
  }

  // --- Voice Synthesis (Instant Pipelined TTS) ---
  let availableVoices = [];

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    availableVoices = window.speechSynthesis.getVoices();

    voiceSelect.innerHTML = '<option value="">Default System Voice</option>';
    availableVoices.forEach((v) => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' [Default]' : ''}`;
      if (v.voiceURI === state.selectedVoiceURI) {
        opt.selected = true;
      }
      voiceSelect.appendChild(opt);
    });
  }

  if ('speechSynthesis' in window) {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  function stopSpeaking() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    state.speechQueue = [];
    state.isSpeaking = false;
    state.isProcessingSentence = false;
    orbContainer.classList.remove('speaking');
    stopSpeechBtn.style.display = 'none';
    if (!state.isListening) {
      orbIcon.textContent = '⚡';
      updateStatus("Ready • Tap mic to speak");
    }
  }

  function queueSpeech(text) {
    if (!state.voiceOutputEnabled || !('speechSynthesis' in window)) return;
    
    // Clean text of markdown formatting for natural voice delivery
    const cleanText = text
      .replace(/[*#_`~>\[\]\(\)\{\}\\]/g, '')
      .replace(/\n+/g, ' ')
      .trim();

    if (!cleanText) return;

    state.speechQueue.push(cleanText);
    processNextSpeech();
  }

  function processNextSpeech() {
    if (state.isProcessingSentence || state.speechQueue.length === 0) return;
    if (!('speechSynthesis' in window)) return;

    state.isProcessingSentence = true;
    state.isSpeaking = true;
    orbContainer.classList.add('speaking');
    orbIcon.textContent = '🔊';
    stopSpeechBtn.style.display = 'inline-flex';
    updateStatus("Speaking response...");

    const sentence = state.speechQueue.shift();
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = state.speechRate;
    utterance.pitch = state.speechPitch;

    if (state.selectedVoiceURI) {
      const voice = availableVoices.find(v => v.voiceURI === state.selectedVoiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onend = () => {
      state.isProcessingSentence = false;
      if (state.speechQueue.length > 0) {
        processNextSpeech();
      } else {
        state.isSpeaking = false;
        orbContainer.classList.remove('speaking');
        stopSpeechBtn.style.display = 'none';
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");

        // Hands-free continuous conversation mode
        if (state.continuousMode && !state.isListening) {
          setTimeout(() => {
            toggleListening();
          }, 450);
        }
      }
    };

    utterance.onerror = (e) => {
      console.warn("Speech synthesis error:", e);
      state.isProcessingSentence = false;
      processNextSpeech();
    };

    window.speechSynthesis.speak(utterance);
  }

  // --- Audio Frequency Visualizer Canvas ---
  async function initAudioVisualizer() {
    try {
      if (!state.audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContext();
      }

      if (state.audioContext.state === 'suspended') {
        await state.audioContext.resume();
      }

      if (!state.micStream) {
        state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        const source = state.audioContext.createMediaStreamSource(state.micStream);
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 64;
        source.connect(state.analyser);
      }
    } catch (e) {
      console.log("AudioContext/Mic Visualizer optional fallback:", e.message);
    }
  }

  function drawWaveform() {
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = 60;
    const numPoints = 36;

    let freqData = new Uint8Array(32);
    if (state.analyser && (state.isListening || state.isSpeaking)) {
      state.analyser.getByteFrequencyData(freqData);
    } else {
      // Ambient artificial wave pulse
      const t = Date.now() * 0.003;
      for (let i = 0; i < 32; i++) {
        freqData[i] = Math.sin(t + i * 0.3) * 20 + 25;
      }
    }

    // Outer Glow Ring
    canvasCtx.beginPath();
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const freqIndex = i % freqData.length;
      const intensity = freqData[freqIndex] / 255;
      const boost = (state.isListening || state.isSpeaking) ? intensity * 45 : intensity * 15;
      const r = baseRadius + boost;

      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }
    }
    canvasCtx.closePath();

    if (state.isListening) {
      canvasCtx.strokeStyle = 'rgba(255, 0, 127, 0.7)';
      canvasCtx.shadowColor = '#ff007f';
    } else if (state.isSpeaking) {
      canvasCtx.strokeStyle = 'rgba(157, 78, 221, 0.8)';
      canvasCtx.shadowColor = '#9d4edd';
    } else {
      canvasCtx.strokeStyle = 'rgba(0, 245, 212, 0.35)';
      canvasCtx.shadowColor = '#00f5d4';
    }

    canvasCtx.lineWidth = 2.5;
    canvasCtx.shadowBlur = 12;
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;

    state.canvasAnimationId = requestAnimationFrame(drawWaveform);
  }

  // --- Send Message & Stream Response (Fast AF Pipeline) ---
  async function sendMessage(text) {
    if (!text || text.trim() === '') return;
    text = text.trim();

    // Interrupt any ongoing speech
    stopSpeaking();

    // Append User Message to UI
    appendMessage('user', text);
    textInput.value = '';

    // Create Assistant Message container in UI for streaming
    const assistantMsgElem = appendMessage('assistant', '');
    const textContainer = assistantMsgElem.querySelector('.message-text');
    const metaTag = assistantMsgElem.querySelector('.meta-tag');

    // UI Status
    updateStatus("⚡ Gemini 3.8 Flash thinking & streaming...");
    orbIcon.textContent = '⏳';

    const tStart = performance.now();
    let accumulatedText = "";
    let sentenceBuffer = "";

    try {
      const response = await fetch('/api/chat/stream', {
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

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let streamDone = false;
      let firstChunkReceived = false;

      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) break;

        const raw = decoder.decode(value, { stream: true });
        const lines = raw.split("\n\n");

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;
          const jsonStr = line.replace("data: ", "").trim();

          try {
            const data = jsonStr ? JSON.parse(jsonStr) : {};

            if (data.type === 'meta' && data.model) {
              if (metaTag) metaTag.textContent = `${data.model}`;
            }

            if (data.chunk) {
              if (!firstChunkReceived) {
                firstChunkReceived = true;
                const ttft = Math.round(performance.now() - tStart);
                if (metaTag) metaTag.textContent = `TTFT ${ttft}ms • ${state.activeModel}`;
              }

              accumulatedText += data.chunk;
              sentenceBuffer += data.chunk;
              textContainer.textContent = accumulatedText;
              scrollChatToBottom();

              // Sentence-by-Sentence TTS Pipelining:
              // The moment we hit punctuation, send the sentence to TTS queue immediately!
              const sentenceMatch = sentenceBuffer.match(/^([\s\S]*?[.!?\n])\s+([\s\S]*)$/);
              if (sentenceMatch) {
                const completeSentence = sentenceMatch[1].trim();
                sentenceBuffer = sentenceMatch[2]; // Remaining partial sentence
                if (completeSentence) {
                  queueSpeech(completeSentence);
                }
              }
            }

            if (data.error) {
              accumulatedText += `\n[Error: ${data.error}]`;
              textContainer.textContent = accumulatedText;
            }

            if (data.done) {
              streamDone = true;
            }
          } catch (e) {
            // Partial JSON buffer, ignore
          }
        }
      }

      // Flush any remaining text in the sentence buffer
      if (sentenceBuffer.trim()) {
        queueSpeech(sentenceBuffer.trim());
      }

      // Add to conversation history
      state.history.push({ role: 'user', content: text });
      state.history.push({ role: 'model', content: accumulatedText });

      // Add replay voice button to the assistant message
      addReplayButton(assistantMsgElem, accumulatedText);

    } catch (err) {
      console.error("Chat error:", err);
      textContainer.textContent = `Sorry, couldn't get a response: ${err.message}. Please check your API key or connection.`;
      if (metaTag) metaTag.textContent = 'Error';
    } finally {
      if (!state.isSpeaking) {
        orbIcon.textContent = '⚡';
        updateStatus("Ready • Tap mic to speak");
      }
    }
  }

  // --- UI Helpers ---
  function appendMessage(role, text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = role === 'user' ? '👤' : '⚡';

    const bodyDiv = document.createElement('div');
    bodyDiv.className = 'message-body';

    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = text;

    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    if (role === 'assistant') {
      metaDiv.innerHTML = `<span class="meta-tag">Streaming...</span>`;
    } else {
      metaDiv.innerHTML = `<span>You</span>`;
    }

    bodyDiv.appendChild(textDiv);
    bodyDiv.appendChild(metaDiv);
    msgDiv.appendChild(avatarDiv);
    msgDiv.appendChild(bodyDiv);

    messagesContainer.appendChild(msgDiv);
    scrollChatToBottom();
    return msgDiv;
  }

  function addReplayButton(msgElem, fullText) {
    const metaDiv = msgElem.querySelector('.message-meta');
    if (!metaDiv) return;

    const replayBtn = document.createElement('button');
    replayBtn.className = 'speak-replay-btn';
    replayBtn.title = 'Listen to this response';
    replayBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
      <span>Replay</span>
    `;
    replayBtn.onclick = () => {
      stopSpeaking();
      queueSpeech(fullText);
    };

    metaDiv.appendChild(replayBtn);
  }

  function updateStatus(text) {
    if (voiceStatus) {
      voiceStatus.innerHTML = `<span class="status-text">${text}</span>`;
    }
  }

  function scrollChatToBottom() {
    const chatSection = document.getElementById('chatSection');
    if (chatSection) {
      chatSection.scrollTop = chatSection.scrollHeight;
    }
  }

  // --- Event Listeners ---
  micBtn.addEventListener('click', toggleListening);
  orbCore.addEventListener('click', toggleListening);

  sendBtn.addEventListener('click', () => {
    sendMessage(textInput.value);
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendMessage(textInput.value);
    }
  });

  voiceOutputToggle.addEventListener('click', () => {
    state.voiceOutputEnabled = !state.voiceOutputEnabled;
    voiceOutputToggle.classList.toggle('active', state.voiceOutputEnabled);
    voiceOutputToggle.querySelector('span').textContent = `Voice Audio: ${state.voiceOutputEnabled ? 'ON' : 'OFF'}`;
    if (!state.voiceOutputEnabled) {
      stopSpeaking();
    }
  });

  continuousModeToggle.addEventListener('click', () => {
    state.continuousMode = !state.continuousMode;
    continuousModeToggle.classList.toggle('active', state.continuousMode);
    continuousModeToggle.querySelector('span').textContent = `Hands-free: ${state.continuousMode ? 'ON' : 'OFF'}`;
  });

  stopSpeechBtn.addEventListener('click', stopSpeaking);

  clearChatBtn.addEventListener('click', () => {
    stopSpeaking();
    state.history = [];
    messagesContainer.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'message assistant welcome';
    welcome.innerHTML = `
      <div class="message-avatar">⚡</div>
      <div class="message-body">
        <div class="message-text">Chat cleared! Tap the mic or type to start a new conversation with Gemini 3.8 Flash.</div>
      </div>
    `;
    messagesContainer.appendChild(welcome);
  });

  // Quick Chips
  quickChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.prompt) {
      sendMessage(chip.dataset.prompt);
    }
  });

  // Settings Modal Handlers
  settingsBtn.addEventListener('click', () => {
    modelSelect.value = state.activeModel;
    speechRateSlider.value = state.speechRate;
    speechRateVal.textContent = `${state.speechRate.toFixed(2)}x`;
    speechPitchSlider.value = state.speechPitch;
    speechPitchVal.textContent = `${state.speechPitch.toFixed(2)}x`;
    apiKeyInput.value = state.apiKeyOverride;
    settingsModal.classList.add('open');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('open');
  });

  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.classList.remove('open');
    }
  });

  speechRateSlider.addEventListener('input', (e) => {
    speechRateVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
  });

  speechPitchSlider.addEventListener('input', (e) => {
    speechPitchVal.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
  });

  saveSettingsBtn.addEventListener('click', () => {
    state.activeModel = modelSelect.value;
    state.selectedVoiceURI = voiceSelect.value;
    state.speechRate = parseFloat(speechRateSlider.value);
    state.speechPitch = parseFloat(speechPitchSlider.value);
    state.apiKeyOverride = apiKeyInput.value.trim();

    localStorage.setItem('astra_model', state.activeModel);
    localStorage.setItem('astra_voice_uri', state.selectedVoiceURI);
    localStorage.setItem('astra_speech_rate', state.speechRate.toString());
    localStorage.setItem('astra_speech_pitch', state.speechPitch.toString());
    localStorage.setItem('astra_api_key', state.apiKeyOverride);

    currentModelBadge.querySelector('.model-name').textContent = state.activeModel;
    settingsModal.classList.remove('open');
  });

  resetSettingsBtn.addEventListener('click', () => {
    state.activeModel = 'gemini-3.8-flash';
    state.selectedVoiceURI = '';
    state.speechRate = 1.15;
    state.speechPitch = 1.0;
    state.apiKeyOverride = '';

    localStorage.removeItem('astra_model');
    localStorage.removeItem('astra_voice_uri');
    localStorage.removeItem('astra_speech_rate');
    localStorage.removeItem('astra_speech_pitch');
    localStorage.removeItem('astra_api_key');

    modelSelect.value = 'gemini-3.8-flash';
    speechRateSlider.value = 1.15;
    speechRateVal.textContent = '1.15x';
    speechPitchSlider.value = 1.0;
    speechPitchVal.textContent = '1.0x';
    apiKeyInput.value = '';
    currentModelBadge.querySelector('.model-name').textContent = 'gemini-3.8-flash';
    settingsModal.classList.remove('open');
  });

  // --- Boot Initialization ---
  window.addEventListener('DOMContentLoaded', () => {
    initSpeechRecognition();
    drawWaveform();
    currentModelBadge.querySelector('.model-name').textContent = state.activeModel;
  });
})();
