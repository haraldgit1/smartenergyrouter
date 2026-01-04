from typing import Optional, List, Any
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# DB-Helper aus mdm_devices wiederverwenden
from app.mdm_devices import db_fetch_all, db_fetch_one, db_execute

router = APIRouter(prefix="/mdm/usecases", tags=["mdm-usecases"])


# -------------------------------------------------------
# Pydantic-Modelle
# -------------------------------------------------------

class UsecaseBase(BaseModel):
    # API-Name: usecase_key (mapped auf DB-Spalte: key)
    usecase_key: str = Field(
        ...,
        description="Natürlicher Key, z.B. price_follow_boiler, ev_smart_charging"
    )
    name: str
    category: Optional[str] = None
    description: Optional[str] = None
    # JSONB → als Any typisieren, damit es egal ist, ob asyncpg dict oder str liefert
    default_config: Optional[Any] = None


class UsecaseCreate(UsecaseBase):
    pass


class UsecaseUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    default_config: Optional[Any] = None


class UsecaseOut(UsecaseBase):
    usecase_id: int
    created_at: datetime
    updated_at: datetime


class UsecasePage(BaseModel):
    items: List[UsecaseOut]
    total: int
    page: int
    page_size: int


# -------------------------------------------------------
# GET /mdm/usecases – Liste mit Filter + Paging
# -------------------------------------------------------

@router.get("", response_model=UsecasePage)
async def list_usecases(
    key: Optional[str] = Query(None, description="Filter: usecase_key (Teilstring)"),
    name: Optional[str] = Query(None, description="Filter: Name (Teilstring)"),
    category: Optional[str] = Query(None, description="Filter: Kategorie"),
    q: Optional[str] = Query(None, description="Volltext über Key/Name/Beschreibung/Kategorie"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    where_clauses = []
    params: list = []

    if key:
        where_clauses.append(f"key ILIKE ${len(params) + 1}")
        params.append(f"%{key}%")

    if name:
        where_clauses.append(f"name ILIKE ${len(params) + 1}")
        params.append(f"%{name}%")

    if category:
        where_clauses.append(f"category = ${len(params) + 1}")
        params.append(category)

    if q:
        idx = len(params) + 1
        where_clauses.append(
            "("
            f"key ILIKE ${idx} OR "
            f"name ILIKE ${idx} OR "
            f"coalesce(description,'') ILIKE ${idx} OR "
            f"coalesce(category,'') ILIKE ${idx}"
            ")"
        )
        params.append(f"%{q}%")

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    offset = (page - 1) * page_size

    # total count
    sql_total = f"SELECT count(*) AS cnt FROM usecases {where_sql};"
    row_total = await db_fetch_one(sql_total, *params)
    total = row_total["cnt"] if row_total else 0

    # eigentliche Daten
    sql_items = (
        "SELECT usecase_id, key, name, category, description, default_config, "
        "created_at, updated_at "
        "FROM usecases "
        f"{where_sql} "
        "ORDER BY key ASC "
        f"LIMIT ${len(params) + 1} OFFSET ${len(params) + 2};"
    )
    params_items = list(params) + [page_size, offset]
    rows = await db_fetch_all(sql_items, *params_items)

    items = [
        UsecaseOut(
            usecase_id=r["usecase_id"],
            usecase_key=r["key"],
            name=r["name"],
            category=r["category"],
            description=r["description"],
            default_config=r["default_config"],
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )
        for r in rows
    ]

    return UsecasePage(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


# -------------------------------------------------------
# GET /mdm/usecases/{usecase_key} – Einzelner UseCase
# -------------------------------------------------------

@router.get("/{usecase_key}", response_model=UsecaseOut)
async def get_usecase(usecase_key: str):
    sql = (
        "SELECT usecase_id, key, name, category, description, default_config, "
        "created_at, updated_at "
        "FROM usecases WHERE key = $1;"
    )
    row = await db_fetch_one(sql, usecase_key)
    if not row:
        raise HTTPException(status_code=404, detail="UseCase not found")

    return UsecaseOut(
        usecase_id=row["usecase_id"],
        usecase_key=row["key"],
        name=row["name"],
        category=row["category"],
        description=row["description"],
        default_config=row["default_config"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# POST /mdm/usecases – Neuanlage
# -------------------------------------------------------

@router.post("", response_model=UsecaseOut, status_code=201)
async def create_usecase(payload: UsecaseCreate):
    # prüfen, ob Key schon existiert
    exist = await db_fetch_one(
        "SELECT key FROM usecases WHERE key = $1;",
        payload.usecase_key,
    )
    if exist:
        raise HTTPException(
            status_code=400,
            detail=f"UseCase with key '{payload.usecase_key}' already exists",
        )

    sql = (
        "INSERT INTO usecases (key, name, category, description, default_config) "
        "VALUES ($1,$2,$3,$4,$5) "
        "RETURNING usecase_id, key, name, category, description, default_config, "
        "created_at, updated_at;"
    )

    row = await db_fetch_one(
        sql,
        payload.usecase_key,
        payload.name,
        payload.category,
        payload.description,
        payload.default_config,
    )

    return UsecaseOut(
        usecase_id=row["usecase_id"],
        usecase_key=row["key"],
        name=row["name"],
        category=row["category"],
        description=row["description"],
        default_config=row["default_config"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# PATCH /mdm/usecases/{usecase_key} – Update
# -------------------------------------------------------

@router.patch("/{usecase_key}", response_model=UsecaseOut)
async def update_usecase(usecase_key: str, payload: UsecaseUpdate):
    exist = await db_fetch_one(
        "SELECT key FROM usecases WHERE key = $1;",
        usecase_key,
    )
    if not exist:
        raise HTTPException(status_code=404, detail="UseCase not found")

    updates = []
    params: list = []
    idx = 1

    for field_name, column in [
        ("name", "name"),
        ("category", "category"),
        ("description", "description"),
        ("default_config", "default_config"),
    ]:
        value = getattr(payload, field_name)
        if value is not None:
            updates.append(f"{column} = ${idx}")
            params.append(value)
            idx += 1

    if not updates:
        return await get_usecase(usecase_key)

    updates.append("updated_at = now()")

    sql = (
        "UPDATE usecases SET "
        + ", ".join(updates)
        + f" WHERE key = ${idx} "
        "RETURNING usecase_id, key, name, category, description, default_config, "
        "created_at, updated_at;"
    )

    params.append(usecase_key)
    row = await db_fetch_one(sql, *params)

    return UsecaseOut(
        usecase_id=row["usecase_id"],
        usecase_key=row["key"],
        name=row["name"],
        category=row["category"],
        description=row["description"],
        default_config=row["default_config"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# -------------------------------------------------------
# DELETE /mdm/usecases/{usecase_key}
# -------------------------------------------------------

@router.delete("/{usecase_key}", status_code=204)
async def delete_usecase(usecase_key: str):
    await db_execute("DELETE FROM usecases WHERE key = $1;", usecase_key)
    return

