import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { getAllPeople } from '../lib/ledger.js';

const statusEl = document.getElementById('status');
const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');

async function init() {
  try {
    const settings = await getSettings();
    statusEl.textContent = `Storage OK. Target persona: "${settings.targetPersona}"`;
    await log('info', 'Side panel opened');
  } catch (err) {
    statusEl.textContent = `Storage error: ${err.message}`;
  }
}

pingBtn.addEventListener('click', async () => {
  pingResult.textContent = 'Pinging content script on the active tab…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    pingResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (response) => {
    if (chrome.runtime.lastError) {
      pingResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    pingResult.textContent = `Content script responded: ${JSON.stringify(response)}`;
  });
});

const testScrapeBtn = document.getElementById('testScrapeBtn');
const scrapeResult = document.getElementById('scrapeResult');

testScrapeBtn.addEventListener('click', async () => {
  scrapeResult.textContent = 'Scraping (read-only)…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    scrapeResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_SCRAPE' }, (response) => {
    if (chrome.runtime.lastError) {
      scrapeResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    scrapeResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testClickBtn = document.getElementById('testClickBtn');
const clickResult = document.getElementById('clickResult');

testClickBtn.addEventListener('click', async () => {
  clickResult.textContent = 'Clicking first candidate and waiting for navigation…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    clickResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_CLICK_FIRST_CANDIDATE' }, (response) => {
    if (chrome.runtime.lastError) {
      clickResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    clickResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testFullScrapeBtn = document.getElementById('testFullScrapeBtn');
const fullScrapeResult = document.getElementById('fullScrapeResult');

testFullScrapeBtn.addEventListener('click', async () => {
  fullScrapeResult.textContent = 'Clicking, waiting, scrolling, extracting… this can take up to ~15s.';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    fullScrapeResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_FULL_CANDIDATE_SCRAPE' }, (response) => {
    if (chrome.runtime.lastError) {
      fullScrapeResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    fullScrapeResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testAiScreenBtn = document.getElementById('testAiScreenBtn');
const aiScreenResult = document.getElementById('aiScreenResult');

testAiScreenBtn.addEventListener('click', async () => {
  aiScreenResult.textContent = 'Scraping first candidate (click + scroll + extract)…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    aiScreenResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'TEST_FULL_CANDIDATE_SCRAPE' }, (scrapeResponse) => {
    if (chrome.runtime.lastError) {
      aiScreenResult.textContent = `No response from content script: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!scrapeResponse?.ok) {
      aiScreenResult.textContent = `Scrape failed: ${scrapeResponse?.reason ?? 'unknown error'}`;
      return;
    }

    if (scrapeResponse.skippedScrape) {
      // Already in the ledger — the content script caught this before ever
      // clicking or scrolling, so there's nothing new to send for scoring.
      aiScreenResult.textContent = JSON.stringify(scrapeResponse, null, 2);
      return;
    }

    aiScreenResult.textContent = `Scraped ${scrapeResponse.targetName}. Screening (exclude → exact-include → AI)…`;
    chrome.runtime.sendMessage(
      {
        type: 'SCREEN_CANDIDATE',
        text: scrapeResponse.text,
        links: scrapeResponse.links,
        targetName: scrapeResponse.targetName,
        profileUrl: scrapeResponse.finalUrl,
      },
      (screenResponse) => {
        if (chrome.runtime.lastError) {
          aiScreenResult.textContent = `No response from background: ${chrome.runtime.lastError.message}`;
          return;
        }
        aiScreenResult.textContent = JSON.stringify(
          { targetName: scrapeResponse.targetName, finalUrl: scrapeResponse.finalUrl, ...screenResponse },
          null,
          2
        );
      }
    );
  });
});

const viewLedgerBtn = document.getElementById('viewLedgerBtn');
const ledgerResult = document.getElementById('ledgerResult');

viewLedgerBtn.addEventListener('click', async () => {
  const people = await getAllPeople();
  if (!people.length) {
    ledgerResult.textContent = 'Ledger is empty — no one has been screened yet.';
    return;
  }
  const summary = people.map((p) => ({
    name: p.name,
    state: p.state,
    tier: p.screening?.tier,
    confidence: p.screening?.confidence,
  }));
  ledgerResult.textContent = `${people.length} record(s):\n${JSON.stringify(summary, null, 2)}`;
});

init();
