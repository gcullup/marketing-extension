import { getAllPeople, deletePeople, STATES } from '../lib/ledger.js';
import { log } from '../lib/log.js';

const countEl = document.getElementById('count');
const searchInput = document.getElementById('searchInput');
const stateFilter = document.getElementById('stateFilter');
const refreshBtn = document.getElementById('refreshBtn');
const deleteBtn = document.getElementById('deleteBtn');
const emptyEl = document.getElementById('empty');
const tableEl = document.getElementById('table');
const tableBodyEl = document.getElementById('tableBody');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const statusEl = document.getElementById('status');

let allPeople = [];
const selectedIds = new Set();

// Populated from the same STATES enum lib/ledger.js uses internally, rather
// than hardcoding a second copy of the state list here that could drift out
// of sync if a new state is ever added.
function populateStateFilter() {
  for (const state of Object.values(STATES)) {
    const option = document.createElement('option');
    option.value = state;
    option.textContent = state;
    stateFilter.appendChild(option);
  }
}

function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString() : '—';
}

function getFilteredPeople() {
  const search = searchInput.value.trim().toLowerCase();
  const state = stateFilter.value;
  return allPeople.filter((p) => {
    if (state && p.state !== state) return false;
    if (search && !(p.name ?? '').toLowerCase().includes(search)) return false;
    return true;
  });
}

function updateDeleteButton() {
  deleteBtn.textContent = `Delete Selected (${selectedIds.size})`;
  deleteBtn.disabled = selectedIds.size === 0;
}

function renderTable() {
  const filtered = getFilteredPeople();
  countEl.textContent = `${filtered.length} of ${allPeople.length} total shown`;

  tableBodyEl.innerHTML = '';
  emptyEl.style.display = allPeople.length ? 'none' : 'block';
  tableEl.style.display = allPeople.length ? 'table' : 'none';

  for (const person of filtered) {
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedIds.has(person.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedIds.add(person.id);
      else selectedIds.delete(person.id);
      updateDeleteButton();
      updateSelectAllCheckboxState(filtered);
    });
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const nameCell = document.createElement('td');
    const nameLink = document.createElement('a');
    nameLink.href = person.profileUrl ?? '#';
    nameLink.target = '_blank';
    nameLink.rel = 'noopener';
    nameLink.textContent = person.name ?? '(unknown name)';
    nameCell.appendChild(nameLink);
    row.appendChild(nameCell);

    const stateCell = document.createElement('td');
    const stateBadge = document.createElement('span');
    stateBadge.className = `state-badge state-${person.state}`;
    stateBadge.textContent = person.state;
    stateCell.appendChild(stateBadge);
    row.appendChild(stateCell);

    const tierCell = document.createElement('td');
    tierCell.textContent = person.screening?.tier ?? '—';
    row.appendChild(tierCell);

    const confidenceCell = document.createElement('td');
    confidenceCell.textContent = person.screening?.confidence ?? '—';
    row.appendChild(confidenceCell);

    const discoveredCell = document.createElement('td');
    discoveredCell.textContent = formatDate(person.discoveredAt);
    row.appendChild(discoveredCell);

    tableBodyEl.appendChild(row);
  }

  updateSelectAllCheckboxState(filtered);
  updateDeleteButton();
}

// Reflects whether every CURRENTLY VISIBLE (filtered) row is selected —
// selecting "all" only ever acts on what's actually shown, not the whole
// ledger, so switching filters doesn't silently select things Greg never saw.
function updateSelectAllCheckboxState(filtered) {
  const visibleIds = filtered.map((p) => p.id);
  selectAllCheckbox.checked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
}

selectAllCheckbox.addEventListener('change', () => {
  const filtered = getFilteredPeople();
  if (selectAllCheckbox.checked) {
    for (const p of filtered) selectedIds.add(p.id);
  } else {
    for (const p of filtered) selectedIds.delete(p.id);
  }
  renderTable();
});

searchInput.addEventListener('input', renderTable);
stateFilter.addEventListener('change', renderTable);

async function loadPeople() {
  countEl.textContent = 'Loading…';
  allPeople = await getAllPeople();
  renderTable();
}

refreshBtn.addEventListener('click', loadPeople);

deleteBtn.addEventListener('click', async () => {
  const count = selectedIds.size;
  if (!count) return;
  const confirmed = confirm(
    `Delete ${count} selected record(s) from the ledger entirely? This cannot be undone unless ` +
      `you've already exported a backup in Settings. Anyone who reappears in a future scan will be ` +
      `freshly re-screened.`
  );
  if (!confirmed) return;

  const ids = [...selectedIds];
  const deleted = await deletePeople(ids);
  selectedIds.clear();
  await log('info', 'Ledger: manually deleted selected records', { requested: ids.length, deleted });
  statusEl.textContent = `Deleted ${deleted} record(s).`;
  await loadPeople();
});

populateStateFilter();
loadPeople();
