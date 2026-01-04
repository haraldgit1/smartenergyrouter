# app/mdm_reports.py

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from app.mdm_devices import db_fetch_all, db_fetch_one  # gleiche DB-Helper wie in mdm_usecases
import csv
import io

# Für PDF
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm

router = APIRouter(prefix="/mdm/reports", tags=["mdm-reports"])


# =======================================================
# UseCases – Listen-Export als CSV
# GET /mdm/reports/usecases/list.csv
# =======================================================
@router.get("/usecases/list.csv")
async def export_usecases_list_csv():
    sql = """
        SELECT
            usecase_id,
            key,
            name,
            category,
            description
        FROM usecases
        ORDER BY key ASC;
    """

    rows = await db_fetch_all(sql)

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")

    writer.writerow(["UseCase ID", "Key", "Name", "Category", "Description"])

    for r in rows:
        writer.writerow([
            r.get("usecase_id", ""),
            r.get("key", ""),
            r.get("name", ""),
            r.get("category", "") or "",
            r.get("description", "") or "",
        ])

    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="usecases_list.csv"'
        },
    )


# =======================================================
# UseCases – Listen-Export als PDF
# GET /mdm/reports/usecases/list.pdf
# =======================================================
@router.get("/usecases/list.pdf")
async def export_usecases_list_pdf():
    sql = """
        SELECT
            usecase_id,
            key,
            name,
            category,
            description
        FROM usecases
        ORDER BY key ASC;
    """

    rows = await db_fetch_all(sql)

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    width, height = A4
    margin_left = 20 * mm
    margin_right = 20 * mm
    margin_top = 20 * mm
    margin_bottom = 20 * mm

    y = height - margin_top

    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_left, y, "UseCases – Listenreport")
    y -= 15

    c.setFont("Helvetica", 9)
    c.drawString(margin_left, y, "Smart Energy Router – MDM / UseCases")
    y -= 20

    c.setFont("Helvetica-Bold", 9)
    col_x = [
        margin_left,
        margin_left + 20 * mm,   # Key
        margin_left + 60 * mm,   # Name
        margin_left + 120 * mm,  # Category
    ]

    c.drawString(col_x[0], y, "ID")
    c.drawString(col_x[1], y, "Key")
    c.drawString(col_x[2], y, "Name")
    c.drawString(col_x[3], y, "Category")
    y -= 12

    c.setFont("Helvetica", 8)

    for r in rows:
        if y < margin_bottom + 20:
            c.showPage()
            y = height - margin_top
            c.setFont("Helvetica-Bold", 9)
            c.drawString(col_x[0], y, "ID")
            c.drawString(col_x[1], y, "Key")
            c.drawString(col_x[2], y, "Name")
            c.drawString(col_x[3], y, "Category")
            y -= 12
            c.setFont("Helvetica", 8)

        usecase_id = str(r.get("usecase_id", ""))
        key = str(r.get("key", "") or "")
        name = str(r.get("name", "") or "")
        category = str(r.get("category", "") or "")

        max_name_len = 40
        if len(name) > max_name_len:
            name = name[: max_name_len - 3] + "..."

        max_key_len = 25
        if len(key) > max_key_len:
            key = key[: max_key_len - 3] + "..."

        c.drawString(col_x[0], y, usecase_id)
        c.drawString(col_x[1], y, key)
        c.drawString(col_x[2], y, name)
        c.drawString(col_x[3], y, category)

        y -= 11

    c.showPage()
    c.save()
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="usecases_list.pdf"'
        },
    )


# =======================================================
# Devices – Listen-Export als CSV
# GET /mdm/reports/devices/list.csv
# =======================================================
@router.get("/devices/list.csv")
async def export_devices_list_csv():
    sql = """
        SELECT
            device_id,
            name,
            type,
            location,
            rated_power_kw,
            backend_type,
            backend_ref,
            mode,
            enabled,
            created_at,
            updated_at
        FROM devices
        ORDER BY device_id ASC;
    """

    rows = await db_fetch_all(sql)

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")

    writer.writerow([
        "Device ID",
        "Name",
        "Type",
        "Location",
        "Rated Power kW",
        "Backend Type",
        "Backend Ref",
        "Mode",
        "Enabled",
        "Created At",
        "Updated At",
    ])

    for r in rows:
        writer.writerow([
            r.get("device_id", ""),
            r.get("name", "") or "",
            r.get("type", "") or "",
            r.get("location", "") or "",
            r.get("rated_power_kw", ""),
            r.get("backend_type", "") or "",
            r.get("backend_ref", "") or "",
            r.get("mode", "") or "",
            "yes" if r.get("enabled") else "no",
            r.get("created_at", ""),
            r.get("updated_at", ""),
        ])

    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="devices_list.csv"'
        },
    )


# =======================================================
# Devices – Listen-Export als PDF
# GET /mdm/reports/devices/list.pdf
# =======================================================
@router.get("/devices/list.pdf")
async def export_devices_list_pdf():
    sql = """
        SELECT
            device_id,
            name,
            type,
            location,
            mode,
            enabled
        FROM devices
        ORDER BY device_id ASC;
    """

    rows = await db_fetch_all(sql)

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    width, height = A4
    margin_left = 20 * mm
    margin_top = 20 * mm
    margin_bottom = 20 * mm

    y = height - margin_top

    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_left, y, "Devices – Listenreport")
    y -= 15

    c.setFont("Helvetica", 9)
    c.drawString(margin_left, y, "Smart Energy Router – MDM / Devices")
    y -= 20

    c.setFont("Helvetica-Bold", 9)
    col_x = [
        margin_left,            # Device ID
        margin_left + 35 * mm,  # Name
        margin_left + 95 * mm,  # Type
        margin_left + 125 * mm, # Location
        margin_left + 160 * mm, # Mode
    ]

    c.drawString(col_x[0], y, "ID")
    c.drawString(col_x[1], y, "Name")
    c.drawString(col_x[2], y, "Type")
    c.drawString(col_x[3], y, "Location")
    c.drawString(col_x[4], y, "Mode")
    y -= 12

    c.setFont("Helvetica", 8)

    for r in rows:
        if y < margin_bottom + 20:
            c.showPage()
            y = height - margin_top
            c.setFont("Helvetica-Bold", 9)
            c.drawString(col_x[0], y, "ID")
            c.drawString(col_x[1], y, "Name")
            c.drawString(col_x[2], y, "Type")
            c.drawString(col_x[3], y, "Location")
            c.drawString(col_x[4], y, "Mode")
            y -= 12
            c.setFont("Helvetica", 8)

        device_id = str(r.get("device_id", "") or "")
        name = str(r.get("name", "") or "")
        dev_type = str(r.get("type", "") or "")
        location = str(r.get("location", "") or "")
        mode = str(r.get("mode", "") or "")
        enabled = r.get("enabled")

        max_name_len = 30
        if len(name) > max_name_len:
            name = name[: max_name_len - 3] + "..."

        max_loc_len = 25
        if len(location) > max_loc_len:
            location = location[: max_loc_len - 3] + "..."

        if enabled is False:
            mode = f"{mode} (off)"

        c.drawString(col_x[0], y, device_id)
        c.drawString(col_x[1], y, name)
        c.drawString(col_x[2], y, dev_type)
        c.drawString(col_x[3], y, location)
        c.drawString(col_x[4], y, mode)

        y -= 11

    c.showPage()
    c.save()
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="devices_list.pdf"'
        },
    )


# =======================================================
# Devices – Datenblatt CSV
# GET /mdm/reports/devices/{device_id}/sheet.csv
# =======================================================
@router.get("/devices/{device_id}/sheet.csv")
async def export_device_sheet_csv(device_id: str):
    sql = """
        SELECT
            device_id,
            name,
            type,
            location,
            rated_power_kw,
            backend_type,
            backend_ref,
            mode,
            enabled,
            created_at,
            updated_at
        FROM devices
        WHERE device_id = $1;
    """

    row = await db_fetch_one(sql, device_id)
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")

    writer.writerow(["Field", "Value"])

    def w(field, value):
        writer.writerow([field, "" if value is None else value])

    w("Device ID", row.get("device_id"))
    w("Name", row.get("name"))
    w("Type", row.get("type"))
    w("Location", row.get("location"))
    w("Rated Power kW", row.get("rated_power_kw"))
    w("Backend Type", row.get("backend_type"))
    w("Backend Ref", row.get("backend_ref"))
    w("Mode", row.get("mode"))
    w("Enabled", "yes" if row.get("enabled") else "no")
    w("Created At", row.get("created_at"))
    w("Updated At", row.get("updated_at"))

    buffer.seek(0)

    filename = f"device_{device_id}_sheet.csv"

    return StreamingResponse(
        buffer,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


# =======================================================
# Devices – Datenblatt PDF
# GET /mdm/reports/devices/{device_id}/sheet.pdf
# =======================================================
@router.get("/devices/{device_id}/sheet.pdf")
async def export_device_sheet_pdf(device_id: str):
    sql = """
        SELECT
            device_id,
            name,
            type,
            location,
            rated_power_kw,
            backend_type,
            backend_ref,
            mode,
            enabled,
            created_at,
            updated_at
        FROM devices
        WHERE device_id = $1;
    """

    row = await db_fetch_one(sql, device_id)
    if not row:
        raise HTTPException(status_code=404, detail="Device not found")

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    width, height = A4
    margin_left = 25 * mm
    margin_top = 20 * mm
    margin_bottom = 20 * mm

    y = height - margin_top

    c.setFont("Helvetica-Bold", 14)
    c.drawString(margin_left, y, f"Device – Datenblatt")
    y -= 16

    c.setFont("Helvetica", 10)
    c.drawString(margin_left, y, f"Device ID: {row.get('device_id')}")
    y -= 18

    c.setFont("Helvetica", 9)

    def draw_field(label: str, value, y: float) -> float:
        if y < margin_bottom + 20:
            c.showPage()
            y = height - margin_top
            c.setFont("Helvetica", 9)
        text = "" if value is None else str(value)
        c.drawString(margin_left, y, f"{label}: {text}")
        return y - 12

    y = draw_field("Name", row.get("name"), y)
    y = draw_field("Type", row.get("type"), y)
    y = draw_field("Location", row.get("location"), y)
    y = draw_field("Rated Power kW", row.get("rated_power_kw"), y)
    y = draw_field("Backend Type", row.get("backend_type"), y)
    y = draw_field("Backend Ref", row.get("backend_ref"), y)
    y = draw_field("Mode", row.get("mode"), y)
    y = draw_field("Enabled", "yes" if row.get("enabled") else "no", y)
    y = draw_field("Created At", row.get("created_at"), y)
    y = draw_field("Updated At", row.get("updated_at"), y)

    c.showPage()
    c.save()
    buffer.seek(0)

    filename = f"device_{device_id}_sheet.pdf"

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )

