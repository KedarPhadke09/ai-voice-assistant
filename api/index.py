import os
import json
import time
import requests
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
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
    "4. Respond with maximum speed and clarity."
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
    # Include up to last 10 messages for context and speed
    for h in history[-10:]:
        role = "user" if h.role.lower() in ["user", "human"] else "model"
        contents.append({
            "role": role,
            "parts": [{"text": h.content}]
        })
    
    # Append the latest user message
    contents.append({
        "role": "user",
        "parts": [{"text": message}]
    })
    return contents

def call_gemini_stream(contents: List[Dict[str, Any]], model: str, api_key: str, system_prompt: str, temperature: float = 0.7):
    """
    Streams response tokens from Gemini API using Server-Sent Events (SSE).
    Implements automatic fallback if the requested model is overloaded (e.g., 503 spike).
    """
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
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "generationConfig": {
                "temperature": temperature,
                "maxOutputTokens": 800
            }
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
                # Try fallback model
                continue
            else:
                # Other HTTP error, break and return error message
                err_text = r.text[:200]
                yield f"data: {json.dumps({'error': f'Gemini API error ({r.status_code}): {err_text}', 'done': True})}\n\n"
                return
        except requests.exceptions.RequestException:
            continue

    if response is None:
        yield f"data: {json.dumps({'error': 'All Gemini models are temporarily busy or timed out. Please retry in a few seconds.', 'done': True})}\n\n"
        return

    # Emit metadata chunk with active model
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
        "fallback_models": FALLBACK_MODELS,
        "timestamp": time.time()
    }

@app.get("/api/models")
def get_models():
    return {
        "default": DEFAULT_MODEL,
        "models": [
            {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash (Ultra Fast - Voice Optimized)", "recommended": True},
            {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash (High Speed)", "recommended": False},
            {"id": "gemini-3.5-flash", "name": "Gemini 3.5 Flash (Balanced)", "recommended": False},
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "recommended": False}
        ]
    }

@app.post("/api/chat/stream")
def chat_stream(request: ChatRequest):
    api_key = request.api_key.strip() if request.api_key else DEFAULT_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing Gemini API key.")

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
                return {
                    "response": text,
                    "model": candidate,
                    "status": "success"
                }
            else:
                last_err = f"HTTP {r.status_code}: {r.text[:150]}"
        except Exception as e:
            last_err = str(e)
            continue

    raise HTTPException(status_code=500, detail=f"Failed to generate response: {last_err}")

# Mount public directory for static assets when running locally or served through FastAPI
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(static_dir, "index.html"))
