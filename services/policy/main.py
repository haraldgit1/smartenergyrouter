from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="policy")

@app.get("/health")
def health():
    return {"status": "ok", "service": "policy"}

class Echo(BaseModel):
    msg: str

@app.post("/echo")
def echo(payload: Echo):
    return {"service": "policy", "echo": payload.msg}
