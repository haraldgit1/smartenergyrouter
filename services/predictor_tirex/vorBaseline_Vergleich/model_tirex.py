# services/predictor_tirex/model_tirex.py

from __future__ import annotations

import numpy as np
import torch
from tirex import load_model, ForecastModel
from tirex.util import select_quantile_subset

# Globales Modell-Handle (einmal laden, mehrfach nutzen)
_MODEL: ForecastModel | None = None


def load_tirex_model() -> ForecastModel:
    """
    Lädt das TiRex-Modell in CPU-Konfiguration.

    - device="cpu"
    - backend="torch"  (kein Custom-CUDA-Kram)
    """
    global _MODEL
    if _MODEL is None:
        # CPU + torch-Backend explizit erzwingen
        _MODEL = load_model(
            "NX-AI/TiRex",
            device="cpu",
            backend="torch",
        )
    return _MODEL


def call_tirex(
    model: ForecastModel,
    X: np.ndarray,
    horizon_steps: int,
) -> dict[str, np.ndarray]:
    """
    Ruft TiRex für einen einzelnen Zeitverlauf auf.

    X: (history_steps, num_features) – normierte Features
       -> Wir verwenden aktuell nur Feature 0 (load_kw) als univariate Serie.
    horizon_steps: Anzahl der Zukunftsschritte.

    Rückgabe:
      dict mit 'q10', 'q50', 'q90' (normiert, wird in main.py zurückskaliert).
    """
    if X.ndim != 2:
        raise ValueError(f"Erwarte X mit Shape (history_steps, num_features), bekommen: {X.shape}")

    # Univariate Serie: load_kw (erste Spalte in X)
    y_hist = X[:, 0].astype("float32")  # (history_steps,)
    # Batch-Dimension hinzufügen: (1, history_steps)
    context = torch.from_numpy(y_hist).unsqueeze(0)

    # Vorhersage mit TiRex
    # quantiles: [batch, forecast_len, quantile_count]
    # mean:      [batch, forecast_len]
    with torch.no_grad():
        quantiles, mean = model.forecast(
            context=context,
            prediction_length=horizon_steps,
            output_type="torch",  # laut Doku: Tensor [batch, forecast_len, quantile_count]
        )

    # Gewünschte Quantile auswählen (0.1, 0.5, 0.9)
    # select_quantile_subset arbeitet auf dem letzten Quantil-Dim. :contentReference[oaicite:1]{index=1}
    q_subset = select_quantile_subset(quantiles, [0.1, 0.5, 0.9])  # [batch, horizon, 3]

    # Batch-Dim=0 entfernen und nach NumPy konvertieren
    q_np = q_subset[0].detach().cpu().numpy()  # (horizon_steps, 3)

    q10 = q_np[:, 0]
    q50 = q_np[:, 1]
    q90 = q_np[:, 2]

    return {"q10": q10, "q50": q50, "q90": q90}

