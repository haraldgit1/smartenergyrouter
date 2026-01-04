# console_api/models_optimize.py
from pydantic import BaseModel, Field
from typing import Optional, Dict

class OptimizeRequest(BaseModel):
    device: str = Field(..., example="boiler1")
    usecase: str = Field(..., example="price_follow_boiler")
    horizon_hours: int = Field(..., ge=1, le=168, example=24)
    constraints: Dict[str, object] = Field(default_factory=dict)

class OptimizeJobResponse(BaseModel):
    job_id: str
    status: str
    plan_id: Optional[str] = None

