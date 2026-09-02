import { getAllContent, deleteContent } from '../lib/contentLedger.js';
import { log } from '../lib/log.js';

const countEl = document.getElementById('count');
const searchInput = document.getElementById('searchInput');
const stateFilter = document.getElementById('stateFilter');
const typeFilter = document.getElementById('typeFilter');
const refreshBtn = document.getElementById('refreshBtn');
const deleteBtn = document.getElementById('deleteBtn');
const emptyEl = document.getElementById('empty');
const tableEl = document.getElementById('table');
const tableBodyEl = document.getElementById('tableBody');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const statusEl = document.getElementById('status');

let allContent = [];
const selectedKeys = new Set();

function getFilteredContent() {
  const search = searchInput.value.trim().toLowerCase();
  const state = stateFilter.value;
  const type = typeFilter.value;
  return allContent.filter((r) => {
    if (state && r.state !== state) return false;
    if (type && r.contentType !== type) return false;
    if (search && !(r.text ?? '').toLowerCase().includes(search)) return false;
    return true;
  });
}

function updateDeleteButton() {
  deleteBtn.textContent = `Delete Selected (${selectedKeys.size})`;
  deleteBtn.disabled = selectedKeys.size === 0;
}

// Reflects whether every CURRENTLY VISIBLE (filtered) row is selected — same
// reasoning as the Person Ledger manager: "select all" only ever acts on
// what's actually shown, so switching filters can't silently select
// something Greg never saw.
function updateSelectAllCheckboxState(filtered) {
  const visibleKeys = filtered.map((r) => r.date);
  selectAllCheckbox.checked = visibleKeys.length > 0 && visibleKeys.every((key) => selectedKeys.has(key));
}

function renderTable() {
  const filtered = getFilteredContent();
  countEl.textContent = `${filtered.length} of ${allContent.length} total shown`;

  tableBodyEl.innerHTML = '';
  emptyEl.style.display = allContent.length ? 'none' : 'block';
  tableEl.style.display = allContent.length ? 'table' : 'none';

  for (const record of filtered) {
    const row = document.createElement('tr');

    const checkboxCell = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedKeys.has(record.date);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selectedKeys.add(record.date);
      else selectedKeys.delete(record.date);
      updateDeleteButton();
      updateSelectAllCheckboxState(filtered);
    });
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    const dateCell = document.createElement('td');
    dateCell.textContent = record.date;
    row.appendChild(dateCell);

    const dayCell = document.createElement('td');
    dayCell.textContent = record.dayKey ?? '—';
    row.appendChild(dayCell);

    const typeCell = document.createElement('td');
    typeCell.textContent = record.contentType ?? '—';
    row.appendChild(typeCell);

    const stateCell = document.createElement('td');
    const stateBadge = document.createElement('span');
    stateBadge.className = `state-badge state-${record.state}`;
    stateBadge.textContent = record.state;
    stateCell.appendChild(stateBadge);
    row.appendChild(stateCell);

    const previewCell = document.createElement('td');
    previewCell.className = 'preview';
    const text = record.text ?? '';
    previewCell.textContent = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    row.appendChild(previewCell);

    tableBodyEl.appendChild(row);
  }

  updateSelectAllCheckboxState(filtered);
  updateDeleteButton();
}

selectAllCheckbox.addEventListener('change', () => {
  const filtered = getFilteredContent();
  if (selectAllCheckbox.checked) {
    for (const r of filtered) selectedKeys.add(r.date);
  } else {
    for (const r of filtered) selectedKeys.delete(r.date);
  }
  renderTable();
});

searchInput.addEventListener('input', renderTable);
stateFilter.addEventListener('change', renderTable);
typeFilter.addEventListener('change', renderTable);

async function loadContent() {
  countEl.textContent = 'Loading…';
  allContent = await getAllContent();
  renderTable();
}

refreshBtn.addEventListener('click', loadContent);

deleteBtn.addEventListener('click', async () => {
  const count = selectedKeys.size;
  if (!count) return;
  const confirmed = confirm(
    `Delete ${count} selected day(s) of content entirely? This cannot be undone unless you've ` +
      `already exported a backup in Settings.`
  );
  if (!confirmed) return;

  const keys = [...selectedKeys];
  const deleted = await deleteContent(keys);
  selectedKeys.clear();
  await log('info', 'Content Ledger: manually deleted selected records', { requested: keys.length, deleted });
  statusEl.textContent = `Deleted ${deleted} record(s).`;
  await loadContent();
});

loadContent();
