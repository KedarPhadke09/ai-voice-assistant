# ⚡ Astra AI • Ultra-Fast Voice Assistant (Gemini 3.8 Flash)

An ultra-responsive, real-time AI voice assistant chatbot built with **Python FastAPI** and powered by **Google Gemini 3.8 Flash**, designed for instant deployment on **Vercel**.

![Astra Voice Assistant](https://img.shields.io/badge/Gemini-3.8%20Flash-00f5d4?style=for-the-badge&logo=google)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=for-the-badge&logo=vercel)
![Latency](https://img.shields.io/badge/Latency-Sub--300ms-ff007f?style=for-the-badge)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FKedarPhadke09%2Fai-voice-assistant&env=GEMINI_API_KEY,GEMINI_MODEL&envDescription=Enter%20your%20Google%20Gemini%20API%20Key&project-name=ai-voice-assistant)

---

## 🌟 Highlights

- ⚡ **Gemini 3.8 Flash Power**: Powered by Google's cutting-edge `gemini-3.8-flash` model, delivering low latency and real-time token streaming.
- 🎙️ **Zero-Latency Voice Input**: Uses the in-browser Web Speech API (`SpeechRecognition`) for immediate client-side transcription with real-time interim speech previews.
- 🔊 **Pipelined Instant TTS**: Sentence-by-sentence streaming speech synthesis! The assistant begins speaking the first sentence while subsequent tokens are still streaming from Gemini (TTFS < 250ms).
- 🌊 **Reactive Audio Visualizer**: Futuristic neon waveform visualizer on HTML5 Canvas reacting dynamically to microphone input frequencies and voice output.
- 🔄 **Hands-Free Continuous Mode**: Automatically listens for your next question once Astra finishes answering.
- 🐍 **Modern Python Backend**: Clean, typed **FastAPI** serverless backend configured with SSE (Server-Sent Events) streaming and automatic model resilience.
- 🚀 **1-Click Vercel Deployment**: Pre-configured `vercel.json` with native Python runtime support and global CDN static caching.

---

## 📁 Project Architecture

```
ai-voice-assistant/
├── api/
│   └── index.py            # FastAPI Serverless app with SSE streaming & model fallbacks
├── public/
│   ├── index.html          # Cyber-luxe voice assistant UI
│   ├── styles.css          # Glassmorphism dark mode with neon glow animations
│   └── app.js              # Speech recognition, audio visualizer & pipelined TTS
├── .env.example            # Environment variables template
├── .gitignore              # Ignored files (secrets, caches, venv)
├── main.py                 # Local development server runner
├── requirements.txt        # Lightweight production Python dependencies
└── vercel.json             # Vercel deployment configuration
```

---

## 🚀 Deployment on Vercel

### Method 1: Deploy with GitHub & Vercel Dashboard (Recommended)

1. Push this repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: complete ultra-fast Gemini 3.8 Flash AI voice assistant"
   git push origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new) and log in.
3. Select your repository `KedarPhadke09/ai-voice-assistant` and click **Import**.
4. In **Environment Variables**, add:
   - `GEMINI_API_KEY`: `your_gemini_api_key_here`
   - `GEMINI_MODEL`: `gemini-3.8-flash`
5. Click **Deploy**. Vercel will build and serve your application globally!

---

### Method 2: Deploy using Vercel CLI

1. Install Vercel CLI (if not already installed):
   ```bash
   npm install -g vercel
   ```
2. Log in and deploy:
   ```bash
   vercel
   ```
3. Set your production environment variable:
   ```bash
   vercel env add GEMINI_API_KEY production
   ```
4. Deploy to production:
   ```bash
   vercel --prod
   ```

---

## 💻 Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/KedarPhadke09/ai-voice-assistant.git
   cd ai-voice-assistant
   ```

2. **Create a virtual environment & install dependencies**:
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # macOS/Linux:
   source venv/bin/activate

   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

4. **Run the local server**:
   ```bash
   python main.py
   # Or using uvicorn directly:
   uvicorn api.index:app --reload --port 8000
   ```

5. Open your browser and navigate to:
   ```
   http://localhost:8000
   ```

---

## ⚙️ Configuration & Customization

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | *(Configured)* | Google Gemini API key |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Target LLM model |
| `PORT` | `8000` | Port for local execution |

### In-App Settings Modal
You can customize the assistant directly inside the UI:
- **Model Selector**: Switch between `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`, etc.
- **Voice Selector**: Pick from any available browser voices (natural, female, male, Google voices).
- **Speech Speed Slider**: Adjust playback speed (1.0x to 2.0x) for ultra-rapid voice responses.
- **Custom Key**: Visitors can optionally test with their own Gemini key stored in browser `localStorage`.

---

## 🛡️ License

MIT License © 2026 Kedar Phadke
