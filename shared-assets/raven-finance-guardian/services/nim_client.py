"""
Typed NIM client interface for Raven Nest workers.

Provides a consistent interface for calling NIM services (OCR, Parse, etc.)
with fallback to mock responses when NIM is unavailable (local dev/testing).
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.request import urlopen, Request
from urllib.error import URLError


@dataclass
class NimResponse:
    text: str = ""
    fields: dict = field(default_factory=dict)
    confidence: float = 0.0
    model_id: str = ""
    model_revision: str = ""
    latency_ms: float = 0.0
    error: Optional[str] = None
    provider: str = ""
    request_id: str = ""

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass
class NimClientConfig:
    endpoint: str
    model_id: str
    timeout_seconds: int = 30
    max_retries: int = 2
    retry_delay_seconds: float = 0.5

    @classmethod
    def from_env(
        cls,
        service_name: str,
        default_endpoint: str = "",
        default_model_id: str = "",
    ) -> NimClientConfig:
        prefix = f"RAVEN_NIM_{service_name.upper()}"
        return cls(
            endpoint=os.environ.get(f"{prefix}_URL", default_endpoint),
            model_id=os.environ.get(f"{prefix}_MODEL", default_model_id),
            timeout_seconds=int(os.environ.get(f"{prefix}_TIMEOUT", "30")),
            max_retries=int(os.environ.get(f"{prefix}_RETRIES", "2")),
            retry_delay_seconds=float(os.environ.get(f"{prefix}_RETRY_DELAY", "0.5")),
        )

    @classmethod
    def from_profile_layer(cls, layer_config) -> NimClientConfig:
        return cls(
            endpoint=layer_config.endpoint or "",
            model_id=layer_config.model or "",
        )


class NimClient:
    def __init__(
        self,
        endpoint: str,
        model_id: str,
        timeout_seconds: int = 30,
        max_retries: int = 2,
        retry_delay_seconds: float = 0.5,
    ):
        self._endpoint = endpoint.rstrip("/")
        self._model_id = model_id
        self._timeout = timeout_seconds
        self._max_retries = max_retries
        self._retry_delay = retry_delay_seconds

    @classmethod
    def from_config(cls, config: NimClientConfig) -> NimClient:
        return cls(
            endpoint=config.endpoint,
            model_id=config.model_id,
            timeout_seconds=config.timeout_seconds,
            max_retries=config.max_retries,
            retry_delay_seconds=config.retry_delay_seconds,
        )

    @property
    def endpoint(self) -> str:
        return self._endpoint

    @property
    def model_id(self) -> str:
        return self._model_id

    def ocr(self, image_b64: str) -> NimResponse:
        return self._call("/v1/ocr", {"image": image_b64})

    def parse(self, text: str) -> NimResponse:
        return self._call("/v1/parse", {"text": text})

    def classify(self, text: str, labels: list[str]) -> NimResponse:
        return self._call("/v1/classify", {"text": text, "labels": labels})

    def _call(self, path: str, payload: dict) -> NimResponse:
        url = self._endpoint + path
        body = json.dumps(payload).encode()
        last_error = None

        for attempt in range(1 + self._max_retries):
            if attempt > 0:
                time.sleep(self._retry_delay * attempt)

            req = Request(url, data=body, method="POST")
            req.add_header("Content-Type", "application/json")

            start = time.monotonic()
            try:
                with urlopen(req, timeout=self._timeout) as resp:
                    latency = (time.monotonic() - start) * 1000
                    data = json.loads(resp.read().decode())
                    return NimResponse(
                        text=data.get("text", ""),
                        fields=data.get("fields", {}),
                        confidence=data.get("confidence", 0.0),
                        model_id=data.get("model_id", self._model_id),
                        model_revision=data.get("model_revision", ""),
                        latency_ms=round(latency, 1),
                        provider=data.get("provider", ""),
                        request_id=data.get("request_id", ""),
                    )
            except URLError as e:
                last_error = f"NIM unreachable: {e.reason}"
            except Exception as e:
                last_error = str(e)

        latency = (time.monotonic() - start) * 1000
        return NimResponse(
            model_id=self._model_id,
            latency_ms=round(latency, 1),
            error=last_error,
        )


class MockNimClient(NimClient):
    """Returns synthetic responses for local testing without NIM."""

    def __init__(self, model_id: str = "mock-nim"):
        super().__init__(
            "http://localhost:0", model_id,
            max_retries=0, retry_delay_seconds=0,
        )

    def ocr(self, image_b64: str) -> NimResponse:
        return NimResponse(
            text="Rechnung Nr. 2026-001\nMuster AG\nBahnhofstrasse 1\n8001 Zürich\nTotal CHF 1'248.55\nMWSt 8.1% CHF 93.60\nIBAN CH93 0076 2011 6238 5295 7",
            confidence=0.94,
            model_id=self._model_id,
            latency_ms=5.0,
        )

    def parse(self, text: str) -> NimResponse:
        return NimResponse(
            text=text,
            fields={
                "vendor": "Muster AG",
                "invoice_number": "2026-001",
                "date": "2026-09-15",
                "total_chf": "1248.55",
                "vat_rate": "8.1",
                "vat_amount": "93.60",
                "net_amount": "1154.95",
                "iban": "CH9300762011623852957",
                "currency": "CHF",
            },
            confidence=0.93,
            model_id=self._model_id,
            latency_ms=8.0,
        )

    def classify(self, text: str, labels: list[str]) -> NimResponse:
        return NimResponse(
            text="invoice",
            fields={"label": "invoice", "source_type": "invoice"},
            confidence=0.97,
            model_id=self._model_id,
            latency_ms=3.0,
        )
