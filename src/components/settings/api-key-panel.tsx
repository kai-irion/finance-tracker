"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { getSetting, setSetting, OPENROUTER_API_KEY_SETTING, GOOGLE_MAPS_API_KEY_SETTING } from "@/lib/appSettings";

function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 6)}${"•".repeat(8)}${key.slice(-4)}`;
}

export function ApiKeyPanel() {
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [mapsCurrentKey, setMapsCurrentKey] = useState<string | null>(null);
  const [mapsLoading, setMapsLoading] = useState(true);
  const [mapsEditing, setMapsEditing] = useState(false);
  const [mapsInputValue, setMapsInputValue] = useState("");
  const [mapsSaving, setMapsSaving] = useState(false);
  const [mapsMessage, setMapsMessage] = useState<string | null>(null);
  const [mapsTesting, setMapsTesting] = useState(false);
  const [mapsTestResult, setMapsTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const key = await getSetting(supabase, OPENROUTER_API_KEY_SETTING);
    setCurrentKey(key);
    setLoading(false);
  }

  async function loadMaps() {
    setMapsLoading(true);
    const key = await getSetting(supabase, GOOGLE_MAPS_API_KEY_SETTING);
    setMapsCurrentKey(key);
    setMapsLoading(false);
  }

  useEffect(() => {
    load();
    loadMaps();
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!inputValue.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await setSetting(supabase, OPENROUTER_API_KEY_SETTING, inputValue.trim());
      setInputValue("");
      setEditing(false);
      setTestResult(null);
      await load();
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-openrouter", { method: "POST" });
      const data: { ok: boolean; reply?: string; error?: string } = await res.json();
      setTestResult({ ok: data.ok, text: data.ok ? `Connected — model replied "${data.reply}".` : data.error ?? "Failed." });
    } catch (err) {
      setTestResult({ ok: false, text: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveMaps(e: FormEvent) {
    e.preventDefault();
    if (!mapsInputValue.trim()) return;
    setMapsSaving(true);
    setMapsMessage(null);
    try {
      await setSetting(supabase, GOOGLE_MAPS_API_KEY_SETTING, mapsInputValue.trim());
      setMapsInputValue("");
      setMapsEditing(false);
      setMapsTestResult(null);
      await loadMaps();
      setMapsMessage("Saved.");
    } catch (err) {
      setMapsMessage(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setMapsSaving(false);
    }
  }

  async function handleTestMaps() {
    setMapsTesting(true);
    setMapsTestResult(null);
    try {
      const res = await fetch("/api/settings/test-google-maps", { method: "POST" });
      const data: { ok: boolean; reply?: string; error?: string } = await res.json();
      setMapsTestResult({ ok: data.ok, text: data.ok ? `Connected — got place types "${data.reply}".` : data.error ?? "Failed." });
    } catch (err) {
      setMapsTestResult({ ok: false, text: err instanceof Error ? err.message : "Test failed." });
    } finally {
      setMapsTesting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="card p-4">
        <h2 className="text-sm font-medium mb-1 text-neutral-700">OpenRouter API key</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Powers category emoji suggestions and AI-assisted transaction classification. Uses
          whichever free model OpenRouter currently has available — no need to pick one
          yourself. Get a free key at{" "}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="underline">
            openrouter.ai/keys
          </a>
          . Stored in your Supabase project, not in a config file.
        </p>

        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : editing ? (
          <form onSubmit={handleSave} className="flex flex-col gap-3">
            <input
              autoFocus
              type="password"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="sk-or-v1-…"
              className="input font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving || !inputValue.trim()}
                className="btn btn-primary"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setInputValue("");
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            {currentKey ? (
              <span className="text-sm font-mono text-neutral-700">{maskKey(currentKey)}</span>
            ) : (
              <span className="text-sm text-neutral-500">Not configured</span>
            )}
            <button
              onClick={() => setEditing(true)}
              className="btn btn-secondary"
            >
              {currentKey ? "Change" : "Add key"}
            </button>
            {currentKey && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="btn btn-secondary"
              >
                {testing ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>
        )}

        {message && <p className="text-sm text-success mt-3">{message}</p>}
        {testResult && (
          <p className={`text-sm mt-3 ${testResult.ok ? "text-success" : "text-danger"}`}>
            {testResult.text}
          </p>
        )}
      </div>

      <div className="card p-4 mt-4">
        <h2 className="text-sm font-medium mb-1 text-neutral-700">Google Maps API key</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Looks up uncategorized merchants on Google Maps (Places API) and maps the place type
          (restaurant, supermarket, gym, …) to one of your categories — used by the
          &quot;Classify with Maps&quot; button on the Needs review tab. Unlike OpenRouter, this is a billed API
          (Google gives a monthly free credit, but usage beyond it costs money); results are
          cached per merchant so the same merchant is never looked up twice. Enable &quot;Places API
          (New)&quot; for a key in{" "}
          <a href="https://console.cloud.google.com/apis/library/places-backend.googleapis.com" target="_blank" rel="noreferrer" className="underline">
            Google Cloud Console
          </a>
          . Stored in your Supabase project, not in a config file.
        </p>

        {mapsLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : mapsEditing ? (
          <form onSubmit={handleSaveMaps} className="flex flex-col gap-3">
            <input
              autoFocus
              type="password"
              value={mapsInputValue}
              onChange={(e) => setMapsInputValue(e.target.value)}
              placeholder="AIza…"
              className="input font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={mapsSaving || !mapsInputValue.trim()}
                className="btn btn-primary"
              >
                {mapsSaving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMapsEditing(false);
                  setMapsInputValue("");
                }}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center gap-3">
            {mapsCurrentKey ? (
              <span className="text-sm font-mono text-neutral-700">{maskKey(mapsCurrentKey)}</span>
            ) : (
              <span className="text-sm text-neutral-500">Not configured</span>
            )}
            <button
              onClick={() => setMapsEditing(true)}
              className="btn btn-secondary"
            >
              {mapsCurrentKey ? "Change" : "Add key"}
            </button>
            {mapsCurrentKey && (
              <button
                onClick={handleTestMaps}
                disabled={mapsTesting}
                className="btn btn-secondary"
              >
                {mapsTesting ? "Testing…" : "Test connection"}
              </button>
            )}
          </div>
        )}

        {mapsMessage && <p className="text-sm text-success mt-3">{mapsMessage}</p>}
        {mapsTestResult && (
          <p className={`text-sm mt-3 ${mapsTestResult.ok ? "text-success" : "text-danger"}`}>
            {mapsTestResult.text}
          </p>
        )}
      </div>
    </div>
  );
}
