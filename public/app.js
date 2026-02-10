// State
let lastResults = null;
let lastColumns = null;

// DOM Elements
const refreshBtn = document.getElementById('refreshBtn');
const statusText = document.getElementById('statusText');
const searchBtn = document.getElementById('searchBtn');
const downloadBtn = document.getElementById('downloadBtn');
const controlTitleInput = document.getElementById('controlTitleInput');
const customPropertyInput = document.getElementById('customPropertyInput');
const tableHead = document.getElementById('tableHead');
const tableBody = document.getElementById('tableBody');
const resultCount = document.getElementById('resultCount');
const previewNote = document.getElementById('previewNote');

// Load status on page load
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateStatusDisplay(data);
  } catch (error) {
    statusText.textContent = 'Error loading status';
    console.error(error);
  }
}

function updateStatusDisplay(data) {
  const date = new Date(data.lastLoaded);
  const formatted = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  statusText.textContent = `${data.fileCount.toLocaleString()} files | ${data.objectCount.toLocaleString()} objects | Loaded: ${formatted}`;
}

// Refresh data
async function refreshData() {
  refreshBtn.disabled = true;
  statusText.textContent = 'Refreshing...';
  
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    updateStatusDisplay(data);
  } catch (error) {
    statusText.textContent = 'Error refreshing data';
    console.error(error);
  } finally {
    refreshBtn.disabled = false;
  }
}

// Get selected filters
function getFilters() {
  const filters = {};

  // controlTitle contains
  const controlTitleValue = controlTitleInput.value.trim();
  if (controlTitleValue) {
    filters.controlTitleContains = controlTitleValue.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Has property checkboxes
  const propertyCheckboxes = document.querySelectorAll('input[name="hasProperty"]:checked');
  const properties = Array.from(propertyCheckboxes).map(cb => cb.value);
  
  // Custom properties
  const customPropertyValue = customPropertyInput.value.trim();
  if (customPropertyValue) {
    const customProps = customPropertyValue.split(',').map(s => s.trim()).filter(Boolean);
    properties.push(...customProps);
  }

  if (properties.length > 0) {
    filters.hasProperty = properties;
  }

  return filters;
}

// Get selected columns
function getColumns() {
  const columnCheckboxes = document.querySelectorAll('input[name="column"]:checked');
  return Array.from(columnCheckboxes).map(cb => cb.value);
}

// Perform search
async function search() {
  const filters = getFilters();
  const columns = getColumns();

  if (columns.length === 0) {
    alert('Please select at least one output column');
    return;
  }

  searchBtn.disabled = true;
  searchBtn.textContent = 'Searching...';
  downloadBtn.disabled = true;

  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters, columns })
    });

    const data = await res.json();
    lastResults = data.results;
    lastColumns = data.columns;

    displayResults(data);
    downloadBtn.disabled = data.count === 0;
  } catch (error) {
    console.error(error);
    alert('Error performing search');
  } finally {
    searchBtn.disabled = false;
    searchBtn.textContent = '🔍 Search';
  }
}

// Display results in table
function displayResults(data) {
  const { results, columns, count } = data;

  resultCount.textContent = `(${count.toLocaleString()} found)`;

  // Clear table
  tableHead.innerHTML = '';
  tableBody.innerHTML = '';

  if (count === 0) {
    tableBody.innerHTML = '<tr><td colspan="100" class="empty-state">No results found</td></tr>';
    previewNote.textContent = '';
    return;
  }

  // Build header
  const headerRow = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  }
  tableHead.appendChild(headerRow);

  // Build rows (limit preview to 100)
  const previewLimit = 100;
  const displayResults = results.slice(0, previewLimit);

  for (const row of displayResults) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      td.textContent = row[col] ?? '';
      td.title = row[col] ?? ''; // Show full text on hover
      tr.appendChild(td);
    }
    tableBody.appendChild(tr);
  }

  // Preview note
  if (count > previewLimit) {
    previewNote.textContent = `Showing first ${previewLimit} of ${count.toLocaleString()} results. Download CSV for full data.`;
  } else {
    previewNote.textContent = '';
  }
}

// Download CSV
function downloadCSV() {
  if (!lastResults || !lastColumns) return;

  // Build CSV content
  const escapeCSV = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  let csv = lastColumns.join(',') + '\n';
  
  for (const row of lastResults) {
    const values = lastColumns.map(col => escapeCSV(row[col]));
    csv += values.join(',') + '\n';
  }

  // Create download
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `preset-analysis-${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Event listeners
refreshBtn.addEventListener('click', refreshData);
searchBtn.addEventListener('click', search);
downloadBtn.addEventListener('click', downloadCSV);

// Allow Enter key to trigger search
controlTitleInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') search();
});
customPropertyInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') search();
});

// Load status on page load
loadStatus();
