// Pyodide Web Worker — loads Python WASM and executes code on demand
// Uses classic worker syntax (importScripts) for maximum compatibility

const PYODIDE_VERSION = "0.27.5";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let pyodide = null;
let BACKEND_URL = "";
let pendingRuns = [];

async function initPyodide() {
  if (pyodide) return pyodide;

  self.postMessage({ type: "status", text: "Loading Python runtime…" });

  // Load pyodide script
  self.importScripts(PYODIDE_CDN + "pyodide.js");

  pyodide = await self.loadPyodide({ indexURL: PYODIDE_CDN });

  self.postMessage({ type: "status", text: "Installing packages…" });

  await pyodide.loadPackage(["numpy", "pandas", "matplotlib", "scipy"]);

  // Inject persistent helpers
  await pyodide.runPythonAsync(`
import sys, io, base64, json
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

_charts = []
_csvs   = []
_BACKEND = ""

def _set_backend(url):
    global _BACKEND
    _BACKEND = url

def save_csv(df, filename="data.csv"):
    buf = io.StringIO()
    df.to_csv(buf)
    csv_b64 = base64.b64encode(buf.getvalue().encode()).decode()
    _csvs.append({"filename": filename, "data": csv_b64})
    print(f"[CSV saved: {filename}]")

def _capture_charts():
    charts = []
    for i in plt.get_fignums():
        fig = plt.figure(i)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                    facecolor=fig.get_facecolor())
        buf.seek(0)
        charts.append(base64.b64encode(buf.read()).decode())
        plt.close(fig)
    return charts

def _reset():
    global _charts, _csvs
    _charts = []
    _csvs   = []
    plt.close("all")
`);

  self.postMessage({ type: "status", text: "Python ready" });
  return pyodide;
}

// fetch_data implementation using XMLHttpRequest (no async/await needed in sync context)
// We inject it fresh per execution with the current BACKEND_URL
function buildFetchDataCode(backend) {
  return `
import urllib.request, json as _json

def fetch_data(symbol, range_="1y", interval="1d"):
    """Fetch OHLCV data via backend proxy. Returns DataFrame with Date index."""
    url = f"${'{'}backend{'}'}/api/proxy/yahoo?symbol={symbol}&range={range_}&interval={interval}"
    url = url.replace("${'{'}backend{'}'}", "${BACKEND_URL}")
    # Use the actual backend URL
    url = f"${'{BACKEND_URL}'}/api/proxy/yahoo?symbol={symbol}&range={range_}&interval={interval}"
    with urllib.request.urlopen(url.replace("${'{'}BACKEND_URL{'}'}", _backend_url)) as r:
        data = _json.loads(r.read())
    if "error" in data:
        raise ValueError(f"fetch_data error: {data['error']} ({symbol})")
    df = pd.DataFrame(data["rows"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    for col in ["Open","High","Low","Close","Volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df

_backend_url = "${backend}"
`;
}

self.onmessage = async (e) => {
  const { type, code, backend, id } = e.data;

  if (type === "init") {
    BACKEND_URL = backend;
    return;
  }

  if (type !== "run") return;

  try {
    const py = await initPyodide();

    // Reset state
    await py.runPythonAsync(`_reset()`);

    // Capture stdout
    let stdout = "";
    py.setStdout({ batched: (s) => { stdout += s + "\n"; } });
    py.setStderr({ batched: (s) => { stdout += "[err] " + s + "\n"; } });

    // Inject fetch_data with current backend URL using urllib (sync, works in Pyodide)
    const fetchCode = `
import urllib.request as _urllib_request, json as _json_mod

_BACKEND_URL = "${BACKEND_URL}"

def fetch_data(symbol, range_="1y", interval="1d"):
    """Fetch OHLCV data via backend proxy. Returns DataFrame with Date index.
    range: '1mo','3mo','6mo','1y','2y','5y','10y','max'
    """
    url = f"{_BACKEND_URL}/api/proxy/yahoo?symbol={symbol}&range={range_}&interval={interval}"
    with _urllib_request.urlopen(url) as resp:
        data = _json_mod.loads(resp.read())
    if "error" in data:
        raise ValueError(f"fetch_data({symbol}): {data['error']}")
    df = pd.DataFrame(data["rows"])
    df["Date"] = pd.to_datetime(df["Date"])
    df = df.set_index("Date").sort_index()
    for col in ["Open","High","Low","Close","Volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    return df
`;
    await py.runPythonAsync(fetchCode);

    // Run user code
    await py.runPythonAsync(code);

    // Capture charts
    const chartPyList = await py.runPythonAsync("_capture_charts()");
    const charts = chartPyList.toJs ? Array.from(chartPyList.toJs()) : [];

    // Capture CSVs
    const csvPyList = await py.runPythonAsync("_csvs");
    const rawCsvs = csvPyList.toJs ? Array.from(csvPyList.toJs()) : [];
    const csvs = rawCsvs.map(c => c instanceof Map ? Object.fromEntries(c) : c);

    self.postMessage({ type: "result", id, stdout: stdout.trim(), charts, csvs });

  } catch (err) {
    self.postMessage({ type: "error", id, text: String(err.message || err) });
  }
};
