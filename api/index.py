import os
import json
import time
import requests
from typing import List, Optional, Dict, Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

DEFAULT_API_KEY = os.environ.get("GEMINI_API_KEY", "")
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.5-flash", "gemini-2.5-flash"]

SYSTEM_PROMPT = (
    "You are Astra, an ultra-fast, intelligent, and charismatic AI Voice Assistant powered by Gemini 3.8 Flash. "
    "Your responses will be read aloud through text-to-speech, so follow these guidelines:\n"
    "1. Keep answers concise, natural, and conversational (1 to 3 sentences for everyday questions, unless the user asks for details).\n"
    "2. Avoid using markdown syntax like bullet points, tables, asterisks, hash signs, or code snippets unless specifically asked, as they sound awkward when read aloud.\n"
    "3. Be direct, lively, and engaging. Speak as if talking in real-time on a voice call.\n"
    "4. Respond with maximum speed and clarity.\n"
    "5. You are fully fluent in both English and Hindi (and Hinglish). If the user speaks or writes in Hindi or Hinglish, respond warmly and naturally in the same language."
)

app = FastAPI(
    title="Gemini 3.8 Flash AI Voice Assistant",
    description="High-speed AI voice assistant chatbot powered by Google Gemini 3.8 Flash",
    version="1.0.0"
)

# Enable CORS for web clients and Vercel deployments
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = []
    model: Optional[str] = None
    api_key: Optional[str] = None
    temperature: Optional[float] = 0.7
    system_instruction: Optional[str] = None

def build_gemini_contents(message: str, history: List[ChatMessage]) -> List[Dict[str, Any]]:
    contents = []
    for h in history[-10:]:
        role = "user" if h.role.lower() in ["user", "human"] else "model"
        contents.append({
            "role": role,
            "parts": [{"text": h.content}]
        })
    contents.append({
        "role": "user",
        "parts": [{"text": message}]
    })
    return contents

def call_gemini_stream(contents: List[Dict[str, Any]], model: str, api_key: str, system_prompt: str, temperature: float = 0.7):
    models_to_try = [model]
    for fb in FALLBACK_MODELS:
        if fb not in models_to_try:
            models_to_try.append(fb)

    active_model = model
    response = None

    for candidate_model in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{candidate_model}:streamGenerateContent?alt=sse&key={api_key}"
        payload = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {"temperature": temperature, "maxOutputTokens": 800}
        }
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "AI-Voice-Assistant/1.0"
        }

        try:
            r = requests.post(url, headers=headers, json=payload, stream=True, timeout=25)
            if r.status_code == 200:
                active_model = candidate_model
                response = r
                break
            elif r.status_code in [503, 429, 404]:
                continue
            else:
                err_text = r.text[:200]
                yield f"data: {json.dumps({'error': f'Gemini API error ({r.status_code}): {err_text}', 'done': True})}\n\n"
                return
        except requests.exceptions.RequestException:
            continue

    if response is None:
        yield f"data: {json.dumps({'error': 'All Gemini models are temporarily busy or timed out. Please retry in a moment.', 'done': True})}\n\n"
        return

    yield f"data: {json.dumps({'model': active_model, 'type': 'meta'})}\n\n"

    try:
        for line in response.iter_lines():
            if not line:
                continue
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                raw_json = line_str[6:].strip()
                try:
                    data = json.loads(raw_json)
                    candidates = data.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text_chunk = part.get("text", "")
                            if text_chunk:
                                yield f"data: {json.dumps({'chunk': text_chunk, 'done': False})}\n\n"
                except json.JSONDecodeError:
                    continue
        yield f"data: {json.dumps({'done': True})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e), 'done': True})}\n\n"

@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "service": "AI Voice Assistant API",
        "default_model": DEFAULT_MODEL,
        "has_api_key": bool(DEFAULT_API_KEY),
        "timestamp": time.time()
    }

@app.get("/api/models")
def get_models():
    return {
        "default": DEFAULT_MODEL,
        "models": [
            {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash (Ultra Fast)", "recommended": True},
            {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash", "recommended": False},
            {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash", "recommended": False},
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "recommended": False}
        ]
    }

@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    api_key = request.api_key.strip() if request.api_key else DEFAULT_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API key. Please configure GEMINI_API_KEY in .env or settings.")

    model = request.model.strip() if request.model else DEFAULT_MODEL
    system_prompt = request.system_instruction or SYSTEM_PROMPT
    contents = build_gemini_contents(request.message, request.history or [])

    return StreamingResponse(
        call_gemini_stream(
            contents=contents,
            model=model,
            api_key=api_key,
            system_prompt=system_prompt,
            temperature=request.temperature or 0.7
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/api/chat")
def chat_sync(request: ChatRequest):
    api_key = request.api_key.strip() if request.api_key else DEFAULT_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API key.")

    model = request.model.strip() if request.model else DEFAULT_MODEL
    system_prompt = request.system_instruction or SYSTEM_PROMPT
    contents = build_gemini_contents(request.message, request.history or [])

    models_to_try = [model] + [m for m in FALLBACK_MODELS if m != model]
    last_err = ""

    for candidate in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{candidate}:generateContent?key={api_key}"
        payload = {
            "contents": contents,
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "generationConfig": {"temperature": request.temperature or 0.7, "maxOutputTokens": 600}
        }
        try:
            r = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=20)
            if r.status_code == 200:
                data = r.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"]
                return {"response": text, "model": candidate, "status": "success"}
            else:
                last_err = f"HTTP {r.status_code}: {r.text[:150]}"
        except Exception as e:
            last_err = str(e)
            continue

    raise HTTPException(status_code=500, detail=f"Failed to generate response: {last_err}")

# Static directory resolution
base_dir = os.path.dirname(os.path.dirname(__file__))
static_dir = os.path.join(base_dir, "public")

# Explicit file routes so both /styles.css and /app.js ALWAYS return 200 OK
@app.get("/styles.css")
def get_styles():
    css_file = os.path.join(static_dir, "styles.css")
    if os.path.isfile(css_file):
        return FileResponse(css_file, media_type="text/css")
    raise HTTPException(status_code=404, detail="styles.css not found")

@app.get("/app.js")
def get_script():
    js_file = os.path.join(static_dir, "app.js")
    if os.path.isfile(js_file):
        return FileResponse(js_file, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")

@app.get("/")
def get_index():
    index_file = os.path.join(static_dir, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file, media_type="text/html")
    raise HTTPException(status_code=404, detail="index.html not found")

# Also mount static directory at /static and / for all other assets
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="public")
