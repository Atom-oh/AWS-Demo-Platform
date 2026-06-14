#!/usr/bin/env bash
# 의장 종합. 인자: <diff> <workdir> <pr_number> <pr_title> <out review.md>
set -euo pipefail
DIFF="$1"; WORK="$2"; PR_NUMBER="$3"; PR_TITLE="$4"; OUT="$5"
SLOT="$WORK/slot"
RESP="$(tr '\n' ',' < "$WORK/responded.txt" 2>/dev/null | sed 's/,$//')"
[ -z "$RESP" ] && RESP="(none — Claude solo)"

# 패널 출력 합본
PANEL=""
for f in "$SLOT"/*.md; do
  [ -s "$f" ] || continue
  PANEL+="

=== 패널: $(basename "$f" .md) ===
$(cat "$f")"
done

cat > "$WORK/synth-prompt.txt" <<PROMPT_EOF
You are the CHAIR reviewing PR #${PR_NUMBER}: ${PR_TITLE}.
Read CLAUDE.md + docs/architecture.md + .claude/skills/code-review/SKILL.md.
Below are independent panel reviews (Codex, Kiro models, Antigravity) of the diff.
패널: ${RESP}

Synthesize ONE final review:
1. **Summary** (2-3 sentences in Korean)
2. **Issues** — CRITICAL/MAJOR/MINOR. 패널 간 합의/이견을 표시.
3. **Suggestions**
4. **Verdict**

Project rules (AWS-Demo-Platform): CloudFront-only ingress(TGB), Internal ALB SG=CF VPC Origin SG+10/8, ACM data lookup(*.atomai.click), HPA-2(min=max=1), Atlantis --write-git-creds, ExternalSecret external-secrets.io/v1, cross-account ExternalId, kube context safety, Terraform 1.9.8 pin, naming demo-platform-*/\/demo-platform/*, ADR Mermaid+bilingual.
한국어+영문 기술용어 혼용. Output ONLY the review markdown.
IMPORTANT: 마지막 줄은 정확히 하나:
  VERDICT: PASS
  VERDICT: FAIL
CRITICAL/MAJOR 있으면 FAIL, 아니면 PASS.

=== PANEL REVIEWS ===
${PANEL}
PROMPT_EOF

# claude 실패해도 fallback 이 돌도록 || true (set -e 우회)
cat "$DIFF" | claude -p "$(cat "$WORK/synth-prompt.txt")" --output-format text > "$OUT" || true
if [ ! -s "$OUT" ]; then
  echo "리뷰 생성 실패 — Claude CLI가 빈 응답을 반환했습니다." > "$OUT"
  echo "VERDICT: FAIL" >> "$OUT"
fi
echo "Synthesis: $(wc -c < "$OUT") bytes (panel: ${RESP})"
