# services/predictor_tirex/model_baseline.py

import numpy as np

class BaselineModel:
    def __init__(self, quantile_spread_low: float = 0.15, quantile_spread_high: float = 0.25):
        self.quantile_spread_low = quantile_spread_low
        self.quantile_spread_high = quantile_spread_high

    def forecast(self, context: np.ndarray, prediction_length: int) -> dict:
        """
        context: np.ndarray [history_steps, num_features] (normiert)
        prediction_length: Anzahl Zukunftsschritte
        Rückgabe: dict mit 'q10', 'q50', 'q90' (normiert)
        """
        y_hist = context[:, 0]  # load_kw (normiert)

        if len(y_hist) >= 24:
            mean_last = float(y_hist[-24:].mean())
        else:
            mean_last = float(y_hist.mean())

        q50 = np.full(prediction_length, mean_last, dtype=np.float32)
        q10 = q50 * (1.0 - self.quantile_spread_low)
        q90 = q50 * (1.0 + self.quantile_spread_high)

        return {"q10": q10, "q50": q50, "q90": q90}


def load_baseline_model() -> BaselineModel:
    return BaselineModel()


def call_baseline(model: BaselineModel, X: np.ndarray, horizon_steps: int) -> dict:
    return model.forecast(context=X, prediction_length=horizon_steps)

