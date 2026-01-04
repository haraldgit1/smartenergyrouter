# console_api/mdm_menu.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .deps import get_db, get_current_user
from .models import MdmMenuItem, MdmRole, MdmRoleMenu

router = APIRouter(prefix="/mdm", tags=["mdm-menu"])

class MenuItemDTO(BaseModel):
    menu_key: str
    label: str
    description: str | None = None
    route_path: str
    icon_name: str | None = None
    section: str
    sort_order: int

@router.get("/menu", response_model=list[MenuItemDTO])
def get_menu_for_current_user(
    db: Session = Depends(get_db),
    user = Depends(get_current_user),
):
    # Annahme: user.roles ist eine Liste seiner Rollen-Keys ['admin','planner',...]
    role_keys = [r.role_key for r in user.roles]

    items = (
        db.query(MdmMenuItem)
        .join(MdmRoleMenu, MdmRoleMenu.menu_id == MdmMenuItem.id)
        .join(MdmRole, MdmRole.id == MdmRoleMenu.role_id)
        .filter(MdmRole.role_key.in_(role_keys))
        .order_by(MdmMenuItem.section, MdmMenuItem.sort_order)
        .all()
    )

    return [
        MenuItemDTO(
            menu_key=i.menu_key,
            label=i.label,
            description=i.description,
            route_path=i.route_path,
            icon_name=i.icon_name,
            section=i.section,
            sort_order=i.sort_order,
        )
        for i in items
    ]

