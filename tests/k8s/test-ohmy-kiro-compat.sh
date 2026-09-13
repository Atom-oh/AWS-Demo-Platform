#!/usr/bin/env bash
# Local vendor-boundary fixtures only; no Kiro, cloud or Kubernetes operations.
if python3 tests/k8s/test-ohmy-kiro-compat.py; then
    pass "oh-my-cloud-skills Kiro compatibility argv and process transparency"
else
    fail "oh-my-cloud-skills Kiro compatibility argv and process transparency" "Python regression suite failed"
fi
