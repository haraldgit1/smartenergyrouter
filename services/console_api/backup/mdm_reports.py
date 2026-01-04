# console_api/mdm_reports.py

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from .deps import get_db  # so, wie du es auch in anderen Modulen verwendest
import csv
import io

router = APIRouter(prefix="/mdm/reports", tags=["mdm-reports"])


# -----------------------------------
# UseCases – Listen-Export als CSV
# GET /mdm/reports/usecases/list.csv
# -----------------------------------
@router.get("/usecases/list.csv")
def export_usecases_list_csv(db: Session = Depends(get_db)):
  # einfache Auswahl der wichtigsten Felder
  result = db.execute(
      text(
          """
          SELECT
            usecase_id,
            name,
            category,
            description
          FROM usecases
          ORDER BY usecase_id
          """
      )
  ).mappings().all()

  buffer = io.StringIO()
  writer = csv.writer(buffer, delimiter=";")

  # Kopfzeile
  writer.writerow(["UseCase ID", "Name", "Category", "Description"])

  for row in result:
    writer.writerow([
      row.get("usecase_id", ""),
      row.get("name", ""),
      row.get("category", ""),
      row.get("description", "") or "",
    ])

  buffer.seek(0)

  return StreamingResponse(
      buffer,
      media_type="text/csv; charset=utf-8",
      headers={
          "Content-Disposition": 'attachment; filename="usecases_list.csv"'
      },
  )


# ---------------------------------------------------------
# UseCases – Listen-Export als PDF (Platzhalter / Stub)
# GET /mdm/reports/usecases/list.pdf
# ---------------------------------------------------------
@router.get("/usecases/list.pdf")
def export_usecases_list_pdf_placeholder():
  """
  Platzhalter-Endpunkt, damit der Link nicht 404 liefert.
  Hier können wir später WeasyPrint/wkhtmltopdf integrieren.
  """
  return PlainTextResponse(
      "PDF-Export für UseCases ist noch nicht implementiert.",
      media_type="text/plain; charset=utf-8",
      status_code=501,  # 501 = Not Implemented
  )

