# app/mdm_menu.py

from typing import Optional, List

from fastapi import APIRouter
from pydantic import BaseModel
from app.mdm_devices import db_fetch_all  # gleiche DB-Helper wie bei mdm_usecases

router = APIRouter(prefix="/mdm", tags=["mdm-menu"])


class MenuItemDTO(BaseModel):
    menu_key: str
    label: str
    description: Optional[str] = None
    route_path: str
    icon_name: Optional[str] = None
    section: str
    sort_order: int


@router.get("/menu", response_model=List[MenuItemDTO])
async def get_menu():
    """
    Liefert alle Menüeinträge aus mdm_menu_items.
    Aktuell ohne Rollenfilter – jeder sieht alles (Phase: Admin-only).
    Rollenlogik können wir später ergänzen.
    """
    sql = """
        SELECT
          menu_key,
          label,
          description,
          route_path,
          icon_name,
          section,
          sort_order
        FROM mdm_menu_items
        ORDER BY section, sort_order, menu_key;
    """

    rows = await db_fetch_all(sql)

    return [
        MenuItemDTO(
            menu_key=r["menu_key"],
            label=r["label"],
            description=r["description"],
            route_path=r["route_path"],
            icon_name=r["icon_name"],
            section=r["section"],
            sort_order=r["sort_order"],
        )
        for r in rows
    ]

