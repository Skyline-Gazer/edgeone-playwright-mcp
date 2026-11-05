#!/usr/bin/env bash
# One-time GitHub Project bootstrap. Run on an authenticated DevBox with gh CLI.
set -euo pipefail
export GH_PAGER=cat PAGER=cat GIT_PAGER=cat

OWNER=Skyline-Gazer
REPO=Skyline-Gazer/edgeone-playwright-mcp
TITLE="EdgeOne Browser MCP"
command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 1; }
gh auth status >/dev/null || { echo "Login with gh auth login first" >&2; exit 1; }

# gh project requires the project OAuth scope: gh auth refresh -s project.
NUMBER="$(gh project list --owner "$OWNER" --limit 100 --format json \
  --jq '.projects[] | select(.title == "EdgeOne Browser MCP") | .number' | head -n 1)"
if [[ -z "$NUMBER" ]]; then
  NUMBER="$(gh project create --owner "$OWNER" --title "$TITLE" \
    --format json --jq '.number')"
fi
echo "Project: https://github.com/orgs/$OWNER/projects/$NUMBER"
gh project link "$NUMBER" --owner "$OWNER" --repo "$REPO"

existing_fields="$(gh project field-list "$NUMBER" --owner "$OWNER" --format json --jq '.fields[].name')"
create_field() {
  local name="$1" type="$2" options="${3:-}"
  if printf '%s\n' "$existing_fields" | grep -Fxq "$name"; then return 0; fi
  if [[ "$type" == SINGLE_SELECT ]]; then
    gh project field-create "$NUMBER" --owner "$OWNER" --name "$name" \
      --data-type SINGLE_SELECT --single-select-options "$options" >/dev/null
  else
    gh project field-create "$NUMBER" --owner "$OWNER" --name "$name" --data-type "$type" >/dev/null
  fi
}
create_field Phase SINGLE_SELECT "P0,P1,P2,P3"
create_field Priority SINGLE_SELECT "P0,P1,P2"
create_field Type SINGLE_SELECT "Epic,Task,Bug,Docs"
create_field "Start date" DATE
create_field "Target date" DATE
# Keep built-in Status options Todo, In Progress, Done. No PARTIAL field option.

for num in $(seq 1 14); do
  gh project item-add "$NUMBER" --owner "$OWNER" \
    --url "https://github.com/$REPO/issues/$num" >/dev/null 2>&1 || true
done

# Native sub-issues, not markdown checklists.
for row in "1:5" "1:6" "1:7" "2:8" "2:9" "2:10" "3:11" "3:12" "4:13" "4:14"; do
  parent="${row%%:*}"; child="${row##*:}"
  id="$(gh api "repos/$REPO/issues/$child" --jq '.id')"
  linked="$(gh api "repos/$REPO/issues/$parent/sub_issues" \
    --jq ".[] | select(.id == $id) | .id" 2>/dev/null || true)"
  if [[ -z "$linked" ]]; then
    gh api -X POST "repos/$REPO/issues/$parent/sub_issues" \
      -F "sub_issue_id=$id" >/dev/null
  fi
done

echo "----- Readback -----"
gh project item-list "$NUMBER" --owner "$OWNER" --limit 100 --format json \
  --jq '{items: (.items | length)}'
gh project field-list "$NUMBER" --owner "$OWNER" --format json \
  --jq '[.fields[].name]'
echo
echo "Create three GitHub UI views (gh CLI does not create views):"
echo "  Roadmap — use Start date / Target date; group by Phase; dates remain unset until evidenced."
echo "  Hierarchy — enable Show hierarchy and Sub-issues progress."
echo "  Active — table/board filtered to Status Todo or In Progress (exclude Done)."
echo "Then configure auto-add of this repo's new Issues if useful and verify item hierarchy."
