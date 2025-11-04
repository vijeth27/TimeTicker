import React, { useEffect, useMemo, useRef, useState } from "react";

export default function App() {
  return (
    <div className="min-h-screen w-full bg-neutral-900 text-neutral-100 p-4 md:p-6 lg:p-8">
      <div className="max-w-3xl mx-auto grid gap-6">
        <header className="bg-neutral-800 rounded-2xl shadow p-4 md:p-6">
          <h1 className="text-2xl font-semibold">Task Ticker</h1>
          <p className="text-sm text-neutral-300 mt-1">
            Enter your Notion integration secret and Tasks database ID, then load tasks.
          </p>
        </header>
        <PomodoroNotionWidget />
      </div>
    </div>
  );
}

function PomodoroNotionWidget() {
  // --- Config state ---
  const [notionSecret, setNotionSecret] = useState( () => localStorage.getItem("npw.secret") || "" );
  const [databaseId, setDatabaseId] = useState( () => localStorage.getItem("npw.dbid") || "" );

  const [workMin, setWorkMin] = useState(() => Number(localStorage.getItem("npw.work")) || 25);
  const [shortMin, setShortMin] = useState(() => Number(localStorage.getItem("npw.short")) || 5);
  const [longMin, setLongMin] = useState(() => Number(localStorage.getItem("npw.long")) || 15);

  // --- Timer state ---
  const [mode, setMode] = useState("work"); // "work" | "short" | "long"
  const [remaining, setRemaining] = useState(() => (Number(localStorage.getItem("npw.remaining")) || (25 * 60)));
  const [isRunning, setIsRunning] = useState(false);

  // --- Tasks ---
  const [tasks, setTasks] = useState([]); // { id, name, planned, finished, status }
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState(() => localStorage.getItem("npw.selectedTaskId") || "");
  const selectedTask = useMemo(() => tasks.find(t => t.id === selectedTaskId), [tasks, selectedTaskId]);

  // Persist config
  useEffect(() => { localStorage.setItem("npw.secret", notionSecret) }, [notionSecret]);
  useEffect(() => { localStorage.setItem("npw.dbid", databaseId) }, [databaseId]);
  useEffect(() => { localStorage.setItem("npw.work", String(workMin)) }, [workMin]);
  useEffect(() => { localStorage.setItem("npw.short", String(shortMin)) }, [shortMin]);
  useEffect(() => { localStorage.setItem("npw.long", String(longMin)) }, [longMin]);
  useEffect(() => { localStorage.setItem("npw.selectedTaskId", selectedTaskId) }, [selectedTaskId]);
  useEffect(() => { localStorage.setItem("npw.remaining", String(remaining)) }, [remaining]);

  // When mode or duration changes and timer is not running, reset remaining accordingly
  useEffect(() => {
    if (!isRunning) {
      const s = mode === "work" ? workMin*60 : mode === "short" ? shortMin*60 : longMin*60;
      setRemaining(s);
    }
  }, [mode, workMin, shortMin, longMin, isRunning]);

  // Timer tick
  useInterval(() => {
    setRemaining(prev => {
      if (prev <= 1) {
        playDing();
        if (mode === "work" && selectedTask) {
          incrementFinished(selectedTask.id).catch(console.error);
        }
        const nextMode = mode === "work" ? "short" : "work";
        setMode(nextMode);
        setIsRunning(false);
        return nextMode === "work" ? workMin*60 : shortMin*60;
      }
      return prev - 1;
    })
  }, isRunning ? 1000 : null);

  const notionHeaders = useMemo(() => notionSecret ? {
    "Authorization": `Bearer ${notionSecret}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28"
  } : null, [notionSecret]);

  async function fetchTasks() {
    if (!databaseId || !notionHeaders) return;
    setLoadingTasks(true);
    const filters = {
      and: [
        { property: "Pomodorified", status: { equals: "Yes" } },
        { or: [
            { property: "Status", status: { equals: "Not Started" }},
            { property: "Status", status: { equals: "In Progress" }},
          ]
        }
      ]
    };
    let res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({ filter: filters, sorts: [{ property: "Status", direction: "ascending" }] })
    });
    if (!res.ok) {
      // Fallback with Pomodorified as select
      res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
        method: "POST",
        headers: notionHeaders,
        body: JSON.stringify({
          filter: {
            and: [
              { property: "Pomodorified", select: { equals: "Yes" } },
              { or: [
                  { property: "Status", status: { equals: "Not Started" }},
                  { property: "Status", status: { equals: "In Progress" }},
                ]
              }
            ]
          }
        })
      });
    }
    if (!res.ok) {
      const msg = await res.text();
      console.error("Notion query error:", msg);
      alert("Couldn't load tasks from Notion. Check property names/types, DB ID, and integration permissions.");
      setLoadingTasks(false);
      return;
    }
    const data = await res.json();
    setTasks(parseTasks(data));
    setLoadingTasks(false);
  }

  function parseTasks(data) {
    return (data.results || []).map(page => {
      const props = page.properties || {};
      const name = props["Name"]?.title?.map(t => t.plain_text).join("") || "Untitled";
      const planned = numberVal(props["Planned"]);
      const finished = numberVal(props["Finished"]);
      const status = props["Status"]?.status?.name || "";
      return { id: page.id, name, planned, finished, status };
    });
  }

  function numberVal(p) {
    if (!p) return 0;
    if (typeof p.number === "number") return p.number;
    return 0;
  }

  async function incrementFinished(pageId) {
    if (!notionHeaders) return;
    try {
      const t = tasks.find(x => x.id === pageId);
      const newVal = (t?.finished || 0) + 1;
      const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeaders,
        body: JSON.stringify({ properties: { Finished: { number: newVal } } })
      });
      if (!res.ok) {
        const msg = await res.text();
        console.error("Failed to update Finished:", msg);
        alert("Timer finished, but failed to update 'Finished' in Notion. See console.");
        return;
      }
      setTasks(prev => prev.map(x => x.id === pageId ? { ...x, finished: newVal } : x));
    } catch (e) {
      console.error(e);
    }
  }

  async function playDing() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.7);
  }

  const totalSeconds = mode === "work" ? workMin*60 : mode === "short" ? shortMin*60 : longMin*60;
  const progress = 1 - (remaining / Math.max(totalSeconds, 1));
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="grid gap-6">
      {/* Secrets & Controls */}
      <section className="bg-neutral-800 rounded-2xl shadow p-4 md:p-6">
        <div className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Notion Secret</span>
            <input type="password" className="border border-neutral-700 bg-neutral-900 rounded-xl px-3 py-2" placeholder="secret_xxx" value={notionSecret} onChange={e=>setNotionSecret(e.target.value)} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Tasks Database ID</span>
            <input type="text" className="border border-neutral-700 bg-neutral-900 rounded-xl px-3 py-2" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={databaseId} onChange={e=>setDatabaseId(e.target.value)} />
          </label>
          <div className="flex items-center gap-2">
            <button onClick={fetchTasks} className="rounded-xl px-4 py-2 bg-neutral-100 text-neutral-900 hover:opacity-90">Load tasks</button>
            {loadingTasks && <span className="text-sm text-neutral-400">Loading…</span>}
          </div>
        </div>
      </section>

      {/* Timer */}
      <section className="bg-neutral-800 rounded-2xl shadow p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button onClick={()=>setMode("work")} className={`px-3 py-1.5 rounded-full border border-neutral-600 ${mode==="work"?"bg-neutral-100 text-neutral-900":"bg-neutral-800"}`}>Work</button>
          <button onClick={()=>setMode("short")} className={`px-3 py-1.5 rounded-full border border-neutral-600 ${mode==="short"?"bg-neutral-100 text-neutral-900":"bg-neutral-800"}`}>Short break</button>
          <button onClick={()=>setMode("long")} className={`px-3 py-1.5 rounded-full border border-neutral-600 ${mode==="long"?"bg-neutral-100 text-neutral-900":"bg-neutral-800"}`}>Long break</button>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <DurationInput label="Work" minutes={workMin} setMinutes={setWorkMin} />
          <DurationInput label="Short" minutes={shortMin} setMinutes={setShortMin} />
          <DurationInput label="Long" minutes={longMin} setMinutes={setLongMin} />
        </div>

        <div className="grid gap-3">
          <div className="text-[64px] font-semibold tracking-tight text-center select-none">
            {mm}:{ss}
          </div>
          <div className="w-full h-3 bg-neutral-900 rounded-full overflow-hidden border border-neutral-700">
            <div className="h-full bg-neutral-100" style={{ width: `${Math.min(100, Math.max(0, progress*100)).toFixed(1)}%`}} />
          </div>
          <div className="flex items-center justify-center gap-3">
            {!isRunning ? (
              <button onClick={()=>setIsRunning(true)} className="px-5 py-2 rounded-xl bg-neutral-100 text-neutral-900">Start</button>
            ) : (
              <button onClick={()=>setIsRunning(false)} className="px-5 py-2 rounded-xl border border-neutral-600">Pause</button>
            )}
            <button onClick={()=>{ setIsRunning(false); setRemaining(totalSeconds); }} className="px-5 py-2 rounded-xl border border-neutral-600">Reset</button>
            <button onClick={playDing} className="px-5 py-2 rounded-xl border border-neutral-600">Test ding</button>
          </div>
          <p className="text-xs text-neutral-400 text-center">On completion: auto-load {mode==="work"?"Short break":"Work"} and stop; plays a ding.</p>
        </div>
      </section>

      {/* Tasks */}
      <section className="bg-neutral-800 rounded-2xl shadow p-4 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Tasks (Pomodorified = Yes & Status ∈ {"{"}"Not Started", "In Progress"{"}"})</h2>
          <button onClick={fetchTasks} className="px-3 py-1.5 rounded-xl border border-neutral-600">Refresh</button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-neutral-300">No tasks to show yet. Click <em>Load tasks</em> above once your secret + DB ID are set, or adjust filters in Notion.</p>
        ) : (
          <ul className="divide-y divide-neutral-700">
            {tasks.map(t => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <input type="radio" name="selTask" checked={selectedTaskId===t.id} onChange={()=>setSelectedTaskId(t.id)} />
                <div className="flex-1">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-neutral-300">Status: {t.status} · Finished {t.finished}{Number.isFinite(t.planned)?` / ${t.planned}`: ""}</div>
                </div>
                <button className="px-2 py-1 text-xs rounded-lg border border-neutral-600" onClick={()=>incrementFinished(t.id)}>+1 Finished</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-neutral-400 mt-3">Tip: select a task before starting a <strong>Work</strong> session to auto-increment "Finished" at the end.</p>
      </section>
    </div>
  );
}

function DurationInput({ label, minutes, setMinutes }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm text-neutral-300">{label} (min)</span>
      <input type="number" min={1} max={180} value={minutes} onChange={e=>setMinutes(Math.max(1, Number(e.target.value||0)))} className="border border-neutral-700 bg-neutral-900 rounded-xl px-3 py-1.5 w-28" />
    </label>
  );
}

function useInterval(callback, delay) {
  const savedRef = useRef(callback);
  useEffect(() => { savedRef.current = callback; }, [callback]);
  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedRef.current && savedRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}