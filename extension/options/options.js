const status = document.getElementById('status');

function csvEscape(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${String(text).replace(/"/g, '""')}"`;
}

document.getElementById('export').addEventListener('click', async () => {
  const { blvLogs = [] } = await chrome.storage.local.get('blvLogs');
  const rows = [['event', 'data', 'ts'], ...blvLogs.map(row => [row.event, row.data, row.ts])];
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blv-page-navigator-logs.csv';
  a.click();
  URL.revokeObjectURL(url);
  status.textContent = `Exported ${blvLogs.length} log entries.`;
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('blvLogs');
  status.textContent = 'Logs cleared.';
});
