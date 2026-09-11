#!/usr/bin/env bash
# Validate the rendered dashboard bundle against the hub's datasource provisioning.
# Prerequisites: kubectl (Kustomize) and Python 3 with PyYAML.
if ! command -v kubectl >/dev/null 2>&1 || ! python3 -c 'import yaml' 2>/dev/null; then
    skip "Grafana bundle invariants" "kubectl and Python PyYAML are required"
else
    _grafana_check=$(python3 - 2>&1 <<'PY'
import json
import subprocess
from pathlib import Path

import yaml

rendered = subprocess.check_output(
    ["kubectl", "kustomize", "k8s/system/grafana"], text=True
)
objects = list(yaml.safe_load_all(rendered))
appset = yaml.safe_load(
    Path("argocd-apps/system/appset-helm-prometheus-mgmt.yaml").read_text()
)
values = appset["spec"]["template"]["spec"]["source"]["helm"]["valuesObject"]
sources = values["grafana"]["datasources"]["datasources.yaml"]["datasources"]
provisioned = {source["uid"] for source in sources}
builtins = {"-- Mixed --", "grafana", "-- Grafana --"}
errors = []
dashboard_count = 0


def check(node, variables, name):
    if isinstance(node, dict):
        source = node.get("datasource")
        if isinstance(source, dict) and isinstance(source.get("uid"), str):
            uid = source["uid"]
            if uid.startswith("$"):
                variable = variables.get(uid.lstrip("$").strip("{}"))
                if variable is None:
                    errors.append(f"{name}: undefined datasource variable {uid}")
                elif variable["type"] == "custom":
                    choices = {item.strip() for item in variable["query"].split(",")}
                    choices.add(variable["current"]["value"])
                    choices.update(option["value"] for option in variable.get("options", []))
                    for choice in choices - provisioned:
                        errors.append(f"{name}: unprovisioned datasource choice {choice}")
                elif variable["type"] == "datasource":
                    if not any(s["type"] == variable["query"] for s in sources):
                        errors.append(f"{name}: no datasource for {variable['query']}")
                else:
                    errors.append(f"{name}: unsupported datasource variable {uid}")
            elif uid not in provisioned | builtins:
                errors.append(f"{name}: unprovisioned datasource {uid}")
        for value in node.values():
            check(value, variables, name)
    elif isinstance(node, list):
        for value in node:
            check(value, variables, name)


for obj in objects:
    if obj["kind"] == "Ingress" or (
        obj["kind"] == "Service"
        and obj.get("spec", {}).get("type") in {"LoadBalancer", "NodePort"}
    ):
        errors.append(f"{obj['metadata']['name']}: dashboard bundle bypasses managed ingress")
    if obj["kind"] != "ConfigMap":
        continue
    for filename, content in obj.get("data", {}).items():
        if filename.endswith(".json"):
            dashboard = json.loads(content)
            dashboard_count += 1
            variables = {v["name"]: v for v in dashboard.get("templating", {}).get("list", [])}
            check(dashboard, variables, filename)

if dashboard_count == 0:
    errors.append("no dashboards rendered")
if errors:
    raise SystemExit("\n".join(sorted(set(errors))))
print(f"{dashboard_count} dashboards: ingress and datasource references validated")
PY
    )
    _grafana_rc=$?
    if [ "$_grafana_rc" -eq 0 ]; then
        pass "Grafana bundle ingress and datasource invariants"
    else
        fail "Grafana bundle ingress and datasource invariants" "$_grafana_check"
    fi
    unset _grafana_check _grafana_rc
fi
