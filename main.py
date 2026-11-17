import uvicorn
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"🚀 Starting Gemini 3.8 Flash Voice Assistant at http://localhost:{port}")
    uvicorn.run("api.index:app", host="0.0.0.0", port=port, reload=True)
