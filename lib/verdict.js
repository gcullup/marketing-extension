// Applies the three-band confidence policy: auto-add / needs human review /
// reject. Pure logic, no chrome.* dependency, so it's testable directly.
//
// Boundaries are inclusive on both ends: confidence exactly at the auto-add
// threshold auto-adds, confidence exactly at the reject floor rejects.
// Everything strictly in between goes to review — this is the middle band
// that a prior single-cutoff design got wrong (see ARCHITECTURE.md).
export function computeVerdict(confidence, { autoAddThreshold, rejectFloor }) {
  if (confidence >= autoAddThreshold) return 'auto-add';
  if (confidence <= rejectFloor) return 'reject';
  return 'review';
}
