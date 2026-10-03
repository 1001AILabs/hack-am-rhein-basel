"""
NIM health-check client.
Verifies each NIM microservice is reachable and ready before pipeline runs.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional
from urllib.request import urlopen, Request
from urllib.error import URLError
import json


@dataclass
class NimServiceStatus:
    name: str
    endpoint: str
    healthy: bool
    latency_ms: float
    error: Optional[str] = None
    model_id: Optional[str] = None


def check_nim_health(
    name: str,
    endpoint: str,
    timeout_seconds: int = 10,
) -> NimServiceStatus:
    health_paths = ["/v1/health/ready", "/health/ready", "/health"]

    for path in health_paths:
        url = endpoint.rstrip("/") + path
        start = time.monotonic()
        try:
            req = Request(url, method="GET")
            with urlopen(req, timeout=timeout_seconds) as resp:
                latency = (time.monotonic() - start) * 1000
                body = resp.read().decode("utf-8", errors="replace")

                model_id = None
                try:
                    data = json.loads(body)
                    model_id = data.get("model_id") or data.get("model")
                except (json.JSONDecodeError, AttributeError):
                    pass

                return NimServiceStatus(
                    name=name,
                    endpoint=endpoint,
                    healthy=resp.status == 200,
                    latency_ms=round(latency, 1),
                    model_id=model_id,
                )
        except URLError:
            continue
        except Exception as e:
            latency = (time.monotonic() - start) * 1000
            return NimServiceStatus(
                name=name,
                endpoint=endpoint,
                healthy=False,
                latency_ms=round(latency, 1),
                error=str(e),
            )

    return NimServiceStatus(
        name=name,
        endpoint=endpoint,
        healthy=False,
        latency_ms=0,
        error=f"No health endpoint responded at {endpoint}",
    )


def check_all_nim_services(
    profile_layers: dict,
) -> list[NimServiceStatus]:
    results = []
    for layer_name, layer_config in profile_layers.items():
        if layer_config.endpoint and layer_config.model:
            if layer_config.model in ("python-only",):
                continue
            status = check_nim_health(
                name=f"{layer_name}/{layer_config.model}",
                endpoint=layer_config.endpoint,
            )
            results.append(status)
    return results


def print_health_report(statuses: list[NimServiceStatus]) -> None:
    print(f"\n{'Service':<40} {'Status':<10} {'Latency':<12} {'Model'}")
    print("-" * 90)
    for s in statuses:
        status_icon = "OK" if s.healthy else "FAIL"
        latency = f"{s.latency_ms:.0f} ms" if s.latency_ms else "—"
        model = s.model_id or s.error or "—"
        print(f"{s.name:<40} {status_icon:<10} {latency:<12} {model}")
    print()

    healthy_count = sum(1 for s in statuses if s.healthy)
    total = len(statuses)
    print(f"  {healthy_count}/{total} services healthy")
