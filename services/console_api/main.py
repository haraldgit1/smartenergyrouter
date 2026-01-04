# services/console_api/main.py

import os
from typing import Any, List, Optional
from datetime import datetime, timezone

import asyncpg
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.mdm_devices import router as mdm_devices_router
from app.mdm_usecases import router as mdm_usecases_router 

from app.mdm_menu import router as mdm_menu_router 
from app.mdm_reports import router as mdm_reports_router 

#from app.ki import router as ki
from app.ki_forecast import router as ki_forecast

from models_optimize import OptimizeRequest, OptimizeJobResponse
from db import create_optimize_job, get_optimize_job
from rabbitmq_publisher import publish_optimize_request


# -------------------------------------------------------------------
# Konfiguration (per ENV)
# -------------------------------------------------------------------

DB_HOST = os.getenv("DB_HOST", "db")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "energy")
DB_USER = os.getenv("DB_USER", "energy")
DB_PASSWORD = os.getenv("DB_PASSWORD", "energy")

API_TITLE = "Smart Energy Router – Console API"
API_VERSION = "0.1.0"


# -------------------------------------------------------------------
# Pydantic-Modelle (Response-Schemas)
# -------------------------------------------------------------------

class DeviceOverview(BaseModel):
    device_id: str
    device_name: str
    device_type: Optional[str] = None
    device_location: Optional[str] = None
    device_mode: Optional[str] = None
    device_enabled: bool
    device_created_at: Optional[datetime] = None
    device_updated_at: Optional[datetime] = None

    usecase_count: int

    last_event_id: Optional[int] = None
    last_event_ts: Optional[datetime] = None
    last_event_type: Optional[str] = None
    last_event_severity: Optional[str] = None
    last_event_flow_id: Optional[str] = None
    last_event_service_name: Optional[str] = None
    last_event_message: Optional[str] = None
    # HIER wichtig: Any statt dict
    last_event_payload: Optional[Any] = None


class DeviceUsecaseExpanded(BaseModel):
    device_id: str
    device_name: str
    device_type: Optional[str] = None
    device_location: Optional[str] = None
    device_mode: Optional[str] = None
    device_enabled: bool

    usecase_id: int
    usecase_key: str
    usecase_name: str
    usecase_category: Optional[str] = None

    effective_config: Optional[Any] = None
    mapping_enabled: bool
    mapping_created_at: Optional[datetime] = None
    mapping_updated_at: Optional[datetime] = None

class UsecaseOverview(BaseModel):
    usecase_id: int
    usecase_key: str
    usecase_name: str
    category: Optional[str] = None
    description: Optional[str] = None
    default_config: Optional[Any] = None   # kann JSONB / dict sein
    device_count: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Event(BaseModel):
    event_id: int
    ts: datetime
    event_type: str
    severity: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    flow_id: Optional[str] = None
    service_name: Optional[str] = None
    message: Optional[str] = None
    # HIER ebenfalls Any
    payload: Optional[Any] = None
    created_at: Optional[datetime] = None

class FlowSummary(BaseModel):
    flow_id: str
    started_at: datetime
    ended_at: datetime
    duration_seconds: Optional[int] = None
    event_count: int
    primary_device_id: Optional[str] = None
    device_count: int
    services_involved: Optional[List[Optional[str]]] = None

class FlowDetail(BaseModel):
    summary: FlowSummary
    events: List[Event]


class DeviceDetail(BaseModel):
    device: DeviceOverview
    usecases: List[DeviceUsecaseExpanded]
    events: List[Event]


# -------------------------------------------------------------------
# FastAPI App + CORS
# -------------------------------------------------------------------

app = FastAPI(title=API_TITLE, version=API_VERSION)

origins = [
    "http://18.158.43.62:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,          # oder ["*"] zum Testen
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# CORS – fürs erste großzügig, später einschränken
#app.add_middleware(
#    CORSMiddleware,
#    allow_origins=["*"],   # später: nur deine Web-UI-Domain(en)
#    allow_credentials=True,
#    allow_methods=["*"],
#    allow_headers=["*"],
#)

app.include_router(mdm_devices_router) 
app.include_router(mdm_usecases_router) 

app.include_router(mdm_menu_router) 
app.include_router(mdm_reports_router) 

#app.include_router(ki) 
app.include_router(ki_forecast) 

# -------------------------------------------------------------------
# DB Pool Management
# -------------------------------------------------------------------

@app.on_event("startup")
async def startup() -> None:
    app.state.db_pool = await asyncpg.create_pool(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        min_size=1,
        max_size=10,
    )


@app.on_event("shutdown")
async def shutdown() -> None:
    pool = app.state.db_pool
    if pool:
        await pool.close()


async def fetch_all(request: Request, query: str, *args: Any):
    pool: asyncpg.Pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        rows = await conn.fetch(query, *args)
    return rows


async def fetch_one(request: Request, query: str, *args: Any):
    pool: asyncpg.Pool = request.app.state.db_pool
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, *args)
    return row


# -------------------------------------------------------------------
# Health Endpoint
# -------------------------------------------------------------------

@app.get("/health")
async def health(request: Request):
    try:
        row = await fetch_one(request, "SELECT NOW() AS db_time;")
        return {
            "status": "ok",
            "service": "console_api",
            "db_time": str(row["db_time"]),
        }
    except Exception as exc:
        return {
            "status": "error",
            "service": "console_api",
            "error": str(exc),
        }


# -------------------------------------------------------------------
# Devices
# -------------------------------------------------------------------

@app.get("/api/devices", response_model=List[DeviceOverview])
async def list_devices(request: Request):
    query = """
        SELECT
            device_id,
            device_name,
            device_type,
            device_location,
            device_mode,
            device_enabled,
            device_created_at,
            device_updated_at,
            usecase_count,
            last_event_id,
            last_event_ts,
            last_event_type,
            last_event_severity,
            last_event_flow_id,
            last_event_service_name,
            last_event_message,
            last_event_payload
        FROM public.v_devices_overview
        ORDER BY device_id;
    """
    rows = await fetch_all(request, query)
    return [DeviceOverview(**dict(row)) for row in rows]


@app.get("/api/devices/{device_id}", response_model=DeviceDetail)
async def get_device_detail(device_id: str, request: Request):
    # 1) Device-Overview
    device_row = await fetch_one(
        request,
        """
        SELECT
            device_id,
            device_name,
            device_type,
            device_location,
            device_mode,
            device_enabled,
            device_created_at,
            device_updated_at,
            usecase_count,
            last_event_id,
            last_event_ts,
            last_event_type,
            last_event_severity,
            last_event_flow_id,
            last_event_service_name,
            last_event_message,
            last_event_payload
        FROM public.v_devices_overview
        WHERE device_id = $1;
        """,
        device_id,
    )
    if not device_row:
        raise HTTPException(status_code=404, detail="Device not found")

    device = DeviceOverview(**dict(device_row))

    # 2) UseCases des Geräts
    usecase_rows = await fetch_all(
        request,
        """
        SELECT
            device_id,
            device_name,
            device_type,
            device_location,
            device_mode,
            device_enabled,
            usecase_id,
            usecase_key,
            usecase_name,
            usecase_category,
            effective_config,
            mapping_enabled,
            mapping_created_at,
            mapping_updated_at
        FROM public.v_device_usecases_expanded
        WHERE device_id = $1
        ORDER BY usecase_name;
        """,
        device_id,
    )
    usecases = [DeviceUsecaseExpanded(**dict(r)) for r in usecase_rows]

    # 3) Letzte Events für dieses Gerät
    event_rows = await fetch_all(
        request,
        """
        SELECT
            event_id,
            ts,
            event_type,
            severity,
            entity_type,
            entity_id,
            flow_id,
            service_name,
            message,
            payload,
            created_at
        FROM public.events
        WHERE entity_type = 'device'
          AND entity_id   = $1
        ORDER BY ts DESC
        LIMIT 100;
        """,
        device_id,
    )
    events = [Event(**dict(r)) for r in event_rows]

    return DeviceDetail(device=device, usecases=usecases, events=events)


# -------------------------------------------------------------------
# UseCases
# -------------------------------------------------------------------

@app.get("/api/usecases", response_model=List[UsecaseOverview])
async def list_usecases(request: Request):
    rows = await fetch_all(
        request,
        """
        SELECT
            usecase_id,
            usecase_key,
            usecase_name,
            category,
            description,
            default_config,
            device_count,
            created_at,
            updated_at
        FROM public.v_usecases_overview
        ORDER BY usecase_key;
        """,
    )
    return [UsecaseOverview(**dict(r)) for r in rows]


@app.get("/api/usecases/{usecase_key}", response_model=dict)
async def get_usecase_detail(usecase_key: str, request: Request):
    # Basisdaten
    uc_row = await fetch_one(
        request,
        """
        SELECT
            usecase_id,
            usecase_key,
            usecase_name,
            category,
            description,
            default_config,
            device_count,
            created_at,
            updated_at
        FROM public.v_usecases_overview
        WHERE usecase_key = $1;
        """,
        usecase_key,
    )
    if not uc_row:
        raise HTTPException(status_code=404, detail="UseCase not found")

    usecase = UsecaseOverview(**dict(uc_row))

    # Geräte, die diesen UseCase nutzen
    dev_rows = await fetch_all(
        request,
        """
        SELECT
            device_id,
            device_name,
            device_type,
            device_location,
            device_mode,
            device_enabled,
            usecase_id,
            usecase_key,
            usecase_name,
            usecase_category,
            effective_config,
            mapping_enabled,
            mapping_created_at,
            mapping_updated_at
        FROM public.v_device_usecases_expanded
        WHERE usecase_key = $1
        ORDER BY device_id;
        """,
        usecase_key,
    )
    devices = [DeviceUsecaseExpanded(**dict(r)) for r in dev_rows]

    return {
        "usecase": usecase.dict(),
        "devices": [d.dict() for d in devices],
    }


# -------------------------------------------------------------------
# Flows
# -------------------------------------------------------------------

@app.get("/api/flows", response_model=List[FlowSummary])
async def list_flows(
    request: Request,
    hours: int = 24,
):
    """
    Liste der Flows, standardmäßig letzte 24 Stunden.
    Optional: ?hours=6 etc.
    """
    # Guard für sinnvolle Grenzen
    if hours <= 0:
        hours = 1
    if hours > 168:  # max 7 Tage
        hours = 168

    rows = await fetch_all(
        request,
        """
        SELECT
            flow_id,
            started_at,
            ended_at,
            duration_seconds,
            event_count,
            primary_device_id,
            device_count,
            services_involved
        FROM public.v_flows_summary
        WHERE started_at >= NOW() - ($1::text || ' hours')::interval
        ORDER BY started_at DESC
        LIMIT 500;
        """,
        str(hours),
    )
    # services_involved kommt als List[Optional[str]] aus asyncpg
    return [FlowSummary(**dict(r)) for r in rows]


@app.get("/api/flows/{flow_id}", response_model=FlowDetail)
async def get_flow_detail(flow_id: str, request: Request):
    # Summary
    s_row = await fetch_one(
        request,
        """
        SELECT
            flow_id,
            started_at,
            ended_at,
            duration_seconds,
            event_count,
            primary_device_id,
            device_count,
            services_involved
        FROM public.v_flows_summary
        WHERE flow_id = $1;
        """,
        flow_id,
    )
    if not s_row:
        raise HTTPException(status_code=404, detail="Flow not found")

    summary = FlowSummary(**dict(s_row))

    # Events des Flows
    e_rows = await fetch_all(
        request,
        """
        SELECT
            event_id,
            ts,
            event_type,
            severity,
            entity_type,
            entity_id,
            flow_id,
            service_name,
            message,
            payload,
            created_at
        FROM public.v_flow_events_ordered
        WHERE flow_id = $1
        ORDER BY ts;
        """,
        flow_id,
    )
    events = [Event(**dict(r)) for r in e_rows]

    return FlowDetail(summary=summary, events=events)


@app.post("/optimize", response_model=OptimizeJobResponse)
def create_optimization(request: OptimizeRequest):
    # 1) Job in DB anlegen
    job = create_optimize_job(
        device=request.device,
        usecase=request.usecase,
        horizon_hours=request.horizon_hours,
        constraints=request.constraints
    )

    job_id = str(job["job_id"])

    # 2) Message an RabbitMQ schicken
    message = {
        "job_id": job_id,
        "device": request.device,
        "usecase": request.usecase,
        "horizon_hours": request.horizon_hours,
        "constraints": request.constraints,
        "requested_at": datetime.now(timezone.utc).isoformat()
    }
    publish_optimize_request(message)

    return OptimizeJobResponse(
        job_id=job_id,
        status=job["status"],
        plan_id=job["plan_id"]
    )


@app.get("/optimize/{job_id}")
def get_optimization(job_id: str):
    job = get_optimize_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Hier können wir später auch aggregierte KPI-Daten
    # aus schedule_journal dazunehmen.
    return job
