from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="llm_svc")

@app.get("/health")
def health():
    return {"status": "ok", "service": "llm_svc"}

class Echo(BaseModel):
    msg: str

@app.post("/echo")
def echo(payload: Echo):
    return {"service": "llm_svc", "echo": payload.msg}
