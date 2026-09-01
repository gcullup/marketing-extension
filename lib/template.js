// Renders a message template against a person — currently just {firstName}
// substitution. Per Greg's design (2026-09-01): the Step 9 greeting DM is a
// fixed, user-authored block of text (Settings' "Introductory message
// template"), not AI-drafted — this replaces the token and nothing else.

export function firstNameOf(fullName) {
  if (!fullName) return '';
  return fullName.trim().split(/\s+/)[0] ?? '';
}

export function renderTemplate(template, person) {
  return (template ?? '').replace(/\{firstName\}/g, firstNameOf(person?.name));
}
