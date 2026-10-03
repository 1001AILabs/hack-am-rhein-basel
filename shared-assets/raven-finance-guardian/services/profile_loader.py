"""
Typed pipeline profile loader.
Loads hardware/model configuration from YAML profiles.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import yaml


@dataclass
class LayerConfig:
    model: Optional[str] = None
    gpu: Optional[int] = None
    endpoint: Optional[str] = None
    language_packs: list[str] = field(default_factory=list)


@dataclass
class AuditConfig:
    inference_location: str = "on-premise"
    data_egress: str = "NONE"
    signature_mode: str = "software-test"


@dataclass
class PipelineProfile:
    hardware_profile: str
    description: str
    gpu_count: int
    physical_vram_gb: int
    planning_vram_gb: int
    layers: dict[str, LayerConfig]
    audit: AuditConfig

    def get_layer(self, name: str) -> Optional[LayerConfig]:
        return self.layers.get(name)

    def has_gpu(self) -> bool:
        return self.gpu_count > 0

    def active_models(self) -> list[str]:
        return [
            lc.model
            for lc in self.layers.values()
            if lc.model and lc.model not in ("python-only", "null")
        ]


def load_profile(name: str, profiles_dir: Optional[str] = None) -> PipelineProfile:
    if profiles_dir is None:
        profiles_dir = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "configs", "profiles"
        )

    profile_path = Path(profiles_dir) / f"{name}.yaml"
    if not profile_path.exists():
        available = [p.stem for p in Path(profiles_dir).glob("*.yaml")]
        raise FileNotFoundError(
            f"Profile '{name}' not found at {profile_path}. "
            f"Available: {available}"
        )

    with open(profile_path) as f:
        raw = yaml.safe_load(f)

    layers = {}
    for layer_name, layer_data in raw.get("layers", {}).items():
        if isinstance(layer_data, dict):
            layers[layer_name] = LayerConfig(
                model=layer_data.get("model"),
                gpu=layer_data.get("gpu"),
                endpoint=layer_data.get("endpoint"),
                language_packs=layer_data.get("language_packs", []),
            )

    audit_data = raw.get("audit", {})
    audit = AuditConfig(
        inference_location=audit_data.get("inference_location", "on-premise"),
        data_egress=audit_data.get("data_egress", "NONE"),
        signature_mode=audit_data.get("signature_mode", "software-test"),
    )

    # Support MiB (precise) or GB (approximate) VRAM fields
    if "physical_vram_mib" in raw:
        physical = raw["physical_vram_mib"] // 1024
        planning = raw.get("planning_vram_mib", raw["physical_vram_mib"]) // 1024
    else:
        physical = raw.get("physical_vram_gb", raw.get("total_vram_gb", 0))
        planning = raw.get("planning_vram_gb", physical)

    return PipelineProfile(
        hardware_profile=raw["hardware_profile"],
        description=raw.get("description", ""),
        gpu_count=raw.get("gpu_count", 0),
        physical_vram_gb=physical,
        planning_vram_gb=planning,
        layers=layers,
        audit=audit,
    )
