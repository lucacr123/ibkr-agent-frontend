// ── Pyodide Web Worker ─────────────────────────────────────────────────────
// Loads Python (Pyodide/WASM) once, then executes code on demand.
// Communicates with App.jsx via postMessage.

importScripts("https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js");

let pyodide = null;
let packagesLoaded = false;

async function loadPyodideAndPackages() {
  if (pyodide) return pyodide;
  postMessage({ type: "status", text: "Loading Python runtime…" });
  pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/" });
  postMessage({ type: "status", text: "Installing packages (numpy, pandas, matplotlib, scipy)…" });
  await pyodide.loadPackagesFromImports("import numpy, pandas, matplotlib, scipy");
  packagesLoaded = true;
  postMessage({ type: "status", text: "Python ready" });
  return pyodide;
}

// Pre-load on worker start
loadPyodideAndPackages().catch(e => postMessage({ type: "error", text: e.message }));

// ── Backend URL (passed from main thread on first run) ─────────────────────
let BACKEND_URL = "";

// ── Execute handler ───────────────────────────────────────────────────────
self.onmessage = async (e) => {
  const { type, code, backend, id } = e.data;

  if (type === "init") {
    BACKEND_URL = backend;
    return;
  }

  if (type !== "run") return;

  try {
    const py = await loadPyodideAndPackages();

    // Capture stdout
    let stdout = "";
    py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
    py.setStderr({ batched: (s) => { stdout += "[stderr] " + s + "\n"; } });

    // ── Inject helper functions available in every script ─────────────────
    await py.runPythonAsync(`
import sys, io, base64, json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from js import fetch as js_fetch, Object
import asyncio

_BACKEND = "${BACKEND_URL}"
_charts = []
_csvs   = []

async def fetch_data(symbol, range_="1y", interval="1d"):
    """Fetch OHLCV data from Yahoo Finance via backend proxy.
    Returns a pandas DataFrame with columns: Date, Open, High, Low, Close, Volume.
    range: '1mo','3mo','6mo','1y','2y','5y','10y','max'
    """
    url = f"{_BACKEND}/api/proxy/yahoo?symbol={symbol}&range={range_}&interval={interval}"
    resp = await js_fetch(url)
    data = await resp.json()
    data = data.to_py()
    if "error" in data:
        raise ValueError(f"fetch_data error: {data['error']} ({symbol})")
    df = pd.DataFrame(data["rows"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    for col in ["Open","High","Low","Close","Volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df

def save_csv(df, filename="data.csv"):
    """Save a DataFrame as a downloadable CSV."""
    buf = io.StringIO()
    df.to_csv(buf)
    csv_b64 = base64.b64encode(buf.getvalue().encode()).decode()
    _csvs.append({"filename": filename, "data": csv_b64})
    print(f"[CSV saved: {filename}]")

def _capture_charts():
    """Capture all open matplotlib figures as base64 PNGs."""
    charts = []
    for i in plt.get_fignums():
        fig = plt.figure(i)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
        buf.seek(0)
        charts.append(base64.b64encode(buf.read()).decode())
        plt.close(fig)
    return charts
`);

    // Run the user's code
    await py.runPythonAsync(code);

    // Capture any charts produced
    const chartData = await py.runPythonAsync("_capture_charts()");
    const charts = chartData.toJs ? chartData.toJs() : [];

    // Capture any CSVs
    const csvData = await py.runPythonAsync("_csvs");
    const csvs = csvData.toJs ? csvData.toJs() : [];

    postMessage({
      type: "result",
      id,
      stdout: stdout.trim(),
      charts: Array.from(charts),
      csvs: Array.from(csvs).map(c => c instanceof Map ? Object.fromEntries(c) : c),
    });

  } catch (err) {
    postMessage({
      type: "error",
      id,
      text: err.message || String(err),
    });
  }
};
