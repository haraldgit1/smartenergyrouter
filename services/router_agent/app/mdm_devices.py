# mdm_devices.py
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# -------------------------------------------------------
# DB-Helper – HIER AN DEINE INFRASTRUKTUR ANPASSEN
# -------------------------------------------------------
# Du hast vermutlich irgendwo schon so etwas wie:
#   async def fetch_all(sql, *params): ...
#   async def fetch_one(sql, *params): ...
#   async def execute(sql, *params): ...
# Binde diese 3 Wrapper an deine bestehenden Funktionen.

async def db_fetch_all(sql: str, *params):
    raise NotImplementedError("db_fetch_all: bitte an deine DB anbinden")

async def db_fetch_one(sql: str, *params):
    raise NotImplementedError("db_fetch_one: bitte an deine DB anbinden")

async def db_execute(sql: str, *params):
    raise NotImplementedError("db_execute: bitte an deine DB anbinden")


router = APIRouter(prefix="/mdm/devices", tags=["mdm-devices"])


# -------------------------------------------------------
# Pydantic-Modelle
# -------------------------------------------------------

class DeviceBase(BaseModel):
    device_id: str = Field(
        ...,
        description="Primary Key, z.B. boiler1 / battery1 / meter_house"
    )
    name: str
    type: str
    location: Optional[str] = None
    rated_power_kw: Optional[float] = None
    backend_type: Optional[str] = None
    backend_ref: Optional[str] = None
    mode: str = Field("simulation", description="simulation | live")
    enabled: bool = True


class DeviceCreate(DeviceBase):
    # Für Neuanlage erlauben wir alle Felder wie in DeviceBase.
    # (device_id gibst du bewusst vor, weil die in deinem System Semantik hat)
    pass


class DeviceUpdate(BaseModel):
    # Partial-Update – alle Felder optional
    name: Optional[str] = None
    type: Optional[str] = None
    location: Optional[str] = None
    rated_power_kw: Optional[float] = None
    backend_type: Optional[str] = None
    backend_ref: Optional[str] = None
    mode: Optional[str] = None
    enabled: Optional[bool] = None


class DeviceOut(DeviceBase):
    created_at: datetime
    updated_at: datetime


class DevicesPage(BaseModel):
    items: List[DeviceOut]
    total: int
    page: int
    page_size: int


# -------------------------------------------------------
# GET /mdm/devices – Liste mit Filter + Paging
# -------------------------------------------------------

@router.get("", response_model=DevicesPage)
async def list_devices(
    key: Optional[str] = Query(None, description="Filter: device_id (Teilstring)"),
    name: Optional[str] = Query(None, description="Filter: Name (Teilstring)"),
    type: Optional[str] = Query(None, description="Filter: Typ (z.B. boiler, meter)"),
    location: Optional[str] = Query(None, description="Filter: Location (Teilstring)"),
    mode: Optional[str] = Query(None, description="Filter: simulation | live"),
    enabled: Optional[bool] = Query(None, description="Filter: enabled true/false"),
    q: Optional[str] = Query(None, description="Volltext über mehrere Felder"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    where_clauses = []
    params: list = []

    # Matching deiner MDM-Suchfelder:
    # key      -> device_id
    # name     -> name
    # type     -> type
    # location -> location
    # q        -> Volltext

    if key:
        where_clauses.append(f"device_id ILIKE ${len(params) + 1}")
        params.append(f"%{key}%")

    if name:
        where_clauses.append(f"name ILIKE ${len(params) + 1}")
        params.append(f"%{name}%")

    if type:
        where_clauses.append(f"type = ${len(params) + 1}")
        params.append(type)

    if location:
        where_clauses.append(f"location ILIKE ${len(params) + 1}")
        params.append(f"%{location}%")

    if mode:
        where_clauses.append(f"mode = ${len(params) + 1}")
        params.append(mode)

    if enabled is not None:
        where_clauses.append(f"enabled = ${len(params) + 1}")
        params.append(enabled)

    if q:
        idx = len(params) + 1
        where_clauses.append(
            "("
            f"device_id ILIKE ${idx} OR "
            f"name ILIKE ${idx} OR "
            f"type ILIKE ${idx} OR "
            f"coalesce(location,'') ILIKE ${idx} OR "
            f"coalesce(backend_type,'') ILIKE ${idx} OR "
            f"coalesce(backend_ref,'') ILIKE ${idx}"
            ")"
        )
        params.append(f"%{q}%")

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    offset = (page - 1) * page_size

    # total count
    sql_total = f"SELECT count(*) AS cnt FROM devices {where_sql};"
    row_total = await db_fetch_one(sql_total, *params)
    total = row_total["cnt"] if row_total else 0

    # eigentliche Daten
    sql_items = (
        "SELECT device_id, name, type, location, rated_power_kw, "
        "backend_type, backend_ref, mode, enabled, created_at, updated_at "
        "FROM devices "
        f"{where_sql} "
        "ORDER BY device_id ASC "
        f"LIMIT ${len(params) + 1} OFFSET ${len(params) + 2};"
    )
    params_items = list(params) + [page_size, offset]
    rows = await db_fetch_all(sql_items, *params_items)

    items = [
        DeviceOut(
            device_id=r["device_id"],
            name=r["name"],
            type=r["type"],
            location=r["location"],
            rated_power_kw=r["rated_power_kw"],
            backend_type=r["backend_type"],
            backend_ref=r["backend_ref"],
            mode=r["mode"],
            enabled=r["enabled"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]

    return DevicesPage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# -------------------------------------------------------
# GET /mdm/devices/{device_id} – Einzelnes Device
# -------------------------------------------------------

@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(device_id: str):
    sql = (
        "SELECT device_id, name, type, location, rated_power_kw, "
        "backend_type, backend_ref, mode, enabled, created_at, updated_at "
        "FROM devices WHERE device_id = $1;"
    )
    row = await db_fetch_one(sql, device_id)
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    return DeviceOut(
        device_id=row["device_id"],
        name=row["name"],
        type=row["type"],
        location=row["location"],
        rated_power_kw=row["rated_power_kw"],
        backend_type=row["backend_type"],
        backend_ref=row["backend_ref"],
        mode=row["mode"],
        enabled=row["enabled"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# POST /mdm/devices – Neuanlage
# -------------------------------------------------------

@router.post("", response_model=DeviceOut, status_code=201)
async def create_device(payload: DeviceCreate):
    # Optional: prüfen, ob device_id schon existiert
    exist = await db_fetch_one(
        "SELECT device_id FROM devices WHERE device_id = $1;",
        payload.device_id,
    )
    if exist:
        raise HTTPException(
            status_code=400,
            detail=f"Device with id '{payload.device_id}' already exists",
        )

    sql = (
        "INSERT INTO devices ("
        "device_id, name, type, location, rated_power_kw, "
        "backend_type, backend_ref, mode, enabled"
        ") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) "
        "RETURNING device_id, name, type, location, rated_power_kw, "
        "backend_type, backend_ref, mode, enabled, created_at, updated_at;"
    )

    row = await db_fetch_one(
        sql,
        payload.device_id,
        payload.name,
        payload.type,
        payload.location,
        payload.rated_power_kw,
        payload.backend_type,
        payload.backend_ref,
        payload.mode,
        payload.enabled,
    )

    return DeviceOut(
        device_id=row["device_id"],
        name=row["name"],
        type=row["type"],
        location=row["location"],
        rated_power_kw=row["rated_power_kw"],
        backend_type=row["backend_type"],
        backend_ref=row["backend_ref"],
        mode=row["mode"],
        enabled=row["enabled"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# PATCH /mdm/devices/{device_id} – Update
# -------------------------------------------------------

@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(device_id: str, payload: DeviceUpdate):
    exist = await db_fetch_one(
        "SELECT device_id FROM devices WHERE device_id = $1;",
        device_id,
    )
    if not exist:
        raise HTTPException(status_code=404, detail="Device not found")

    updates = []
    params: list = []
    idx = 1

    for field_name, column in [
        ("name", "name"),
        ("type", "type"),
        ("location", "location"),
        ("rated_power_kw", "rated_power_kw"),
        ("backend_type", "backend_type"),
        ("backend_ref", "backend_ref"),
        ("mode", "mode"),
        ("enabled", "enabled"),
    ]:
        value = getattr(payload, field_name)
        if value is not None:
            updates.append(f"{column} = ${idx}")
            params.append(value)
            idx += 1

    if not updates:
        # nichts zu ändern, aktuellen Stand liefern
        return await get_device(device_id)

    # updated_at ebenfalls setzen
    updates.append(f"updated_at = now()")

    sql = (
        "UPDATE devices SET "
        + ", ".join(updates)
        + f" WHERE device_id = ${idx} "
        "RETURNING device_id, name, type, location, rated_power_kw, "
        "backend_type, backend_ref, mode, enabled, created_at, updated_at;"
    )

    params.append(device_id)
    row = await db_fetch_one(sql, *params)

    return DeviceOut(
        device_id=row["device_id"],
        name=row["name"],
        type=row["type"],
        location=row["location"],
        rated_power_kw=row["rated_power_kw"],
        backend_type=row["backend_type"],
        backend_ref=row["backend_ref"],
        mode=row["mode"],
        enabled=row["enabled"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# DELETE /mdm/devices/{device_id} – Löschen
# -------------------------------------------------------

@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: str):
    await db_execute("DELETE FROM devices WHERE device_id = $1;", device_id)
    return

