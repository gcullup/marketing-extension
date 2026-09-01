import { getSettings, saveSettings, exportAll, importAll, getDefaultSettings } from '../lib/store.js';
import { log, getLogs, clearLogs } from '../lib/log.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function linesToKeywords(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function keywordsToLines(arr) {
  return (arr ?? []).join('\n');
}

function toInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function renderForm(s) {
  $('targetPersona').value = s.targetPersona ?? '';
  $('includeKeywords').value = keywordsToLines(s.includeKeywords);
  $('excludeKeywords').value = keywordsToLines(s.excludeKeywords);

  $('confidenceThreshold').value = s.confidenceThreshold ?? 90;
  $('confidenceValue').textContent = s.confidenceThreshold ?? 90;

  $('rejectFloor').value = s.rejectFloor ?? 25;
  $('rejectFloorValue').textContent = s.rejectFloor ?? 25;

  for (const day of DAYS) {
    $(`scan-${day}`).value = s.scanLimitsByDay?.[day] ?? 0;
  }

  for (const day of DAYS) {
    $(`send-${day}`).value = s.caps?.maxRequestsPerDayByDay?.[day] ?? 0;
  }

  $('maxMessagesPerDay').value = s.caps?.maxMessagesPerDay ?? 15;

  $('introTemplate').value = s.messageTemplates?.intro ?? '';
  $('birthdayTemplate').value = s.messageTemplates?.birthday ?? '';

  $('minDelaySeconds').value = s.timing?.minDelaySeconds ?? 300;
  $('maxDelaySeconds').value = s.timing?.maxDelaySeconds ?? 1800;
  $('spreadHours').value = s.timing?.spreadHours ?? 8;

  $('apiKey').value = s.claude?.apiKey ?? '';
  $('model').value = s.claude?.model ?? '';

  $('testMode').checked = s.testMode !== false;
  $('autoSend').checked = s.autoSend === true;
  $('autoSendWarning').style.display = $('autoSend').checked ? 'block' : 'none';
}

async function populate() {
  renderForm(await getSettings());
}

function collectFromForm() {
  const scanLimitsByDay = {};
  for (const day of DAYS) {
    scanLimitsByDay[day] = toInt($(`scan-${day}`).value, 0);
  }

  const maxRequestsPerDayByDay = {};
  for (const day of DAYS) {
    maxRequestsPerDayByDay[day] = toInt($(`send-${day}`).value, 0);
  }

  return {
    targetPersona: $('targetPersona').value.trim(),
    includeKeywords: linesToKeywords($('includeKeywords').value),
    excludeKeywords: linesToKeywords($('excludeKeywords').value),
    confidenceThreshold: toInt($('confidenceThreshold').value, 90),
    rejectFloor: toInt($('rejectFloor').value, 25),
    scanLimitsByDay,
    caps: {
      maxRequestsPerDayByDay,
      maxMessagesPerDay: toInt($('maxMessagesPerDay').value, 15),
    },
    messageTemplates: {
      intro: $('introTemplate').value,
      birthday: $('birthdayTemplate').value,
    },
    timing: {
      minDelaySeconds: toInt($('minDelaySeconds').value, 300),
      maxDelaySeconds: toInt($('maxDelaySeconds').value, 1800),
      spreadHours: toInt($('spreadHours').value, 8),
    },
    claude: {
      apiKey: $('apiKey').value,
      model: $('model').value.trim(),
    },
    testMode: $('testMode').checked,
    autoSend: $('autoSend').checked,
  };
}

$('confidenceThreshold').addEventListener('input', (e) => {
  $('confidenceValue').textContent = e.target.value;
});

$('rejectFloor').addEventListener('input', (e) => {
  $('rejectFloorValue').textContent = e.target.value;
});

$('autoSend').addEventListener('change', (e) => {
  $('autoSendWarning').style.display = e.target.checked ? 'block' : 'none';
});

$('saveBtn').addEventListener('click', async () => {
  const values = collectFromForm();
  if (values.timing.minDelaySeconds > values.timing.maxDelaySeconds) {
    $('saveStatus').style.color = 'crimson';
    $('saveStatus').textContent = 'Min delay must not exceed max delay.';
    return;
  }
  if (values.rejectFloor >= values.confidenceThreshold) {
    $('saveStatus').style.color = 'crimson';
    $('saveStatus').textContent =
      'Auto-deny threshold must be lower than auto-approve threshold, or there is no review band.';
    return;
  }
  await saveSettings(values);
  await log('info', 'Settings saved');
  $('saveStatus').style.color = 'green';
  $('saveStatus').textContent = 'Saved.';
  setTimeout(() => ($('saveStatus').textContent = ''), 2500);
});

$('resetBtn').addEventListener('click', () => {
  renderForm(getDefaultSettings());
  $('saveStatus').style.color = '#8a5300';
  $('saveStatus').textContent = 'Form reset to defaults — click Save Settings to keep this.';
});

$('exportBtn').addEventListener('click', async () => {
  const dump = await exportAll();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tng-marketing-extension-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  await log('info', 'Data exported');
});

$('importBtn').addEventListener('click', () => $('importFile').click());

$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const dump = JSON.parse(text);
    await importAll(dump);
    await log('info', 'Data imported', { file: file.name });
    $('importStatus').textContent = `Imported ${file.name}. Reloading…`;
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    $('importStatus').textContent = `Import failed: ${err.message}`;
  }
});

async function renderLogs() {
  const entries = await getLogs();
  const recent = entries.slice(-20).reverse();
  // The `meta` object (e.g. a Remove attempt's actual reason) was always
  // being recorded, but this viewer only ever showed the bare message —
  // the real diagnostic detail was sitting in storage, invisible in the UI.
  // Using textContent (not innerHTML) even though meta can carry scraped
  // names/AI text, so this stays safe regardless of what it contains.
  $('logList').textContent = recent.length
    ? recent
        .map((e) => {
          const base = `[${new Date(e.ts).toLocaleString()}] ${e.level.toUpperCase()}  ${e.message}`;
          const hasMeta = e.meta && Object.keys(e.meta).length > 0;
          return hasMeta ? `${base}\n    ${JSON.stringify(e.meta)}` : base;
        })
        .join('\n')
    : 'No log entries yet.';
}

$('refreshLogsBtn').addEventListener('click', renderLogs);
$('clearLogsBtn').addEventListener('click', async () => {
  await clearLogs();
  await renderLogs();
});

populate();
renderLogs();
