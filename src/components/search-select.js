"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

// dropdown ที่พิมพ์ค้นหาได้ ใช้แทน <select> ทุกที่
// - ควบคุมจากภายนอก: value + onChange(value)
// - ใช้ใน <form> แบบ GET: name + defaultValue (ส่งค่าผ่าน hidden input)
// options: [{ value, label }] — value เป็น string
export default function SearchSelect({
  id, name, value, defaultValue = "", onChange, options, placeholder = "— เลือก —", emptyLabel, disabled, submitOnChange,
}) {
  const [inner, setInner] = useState(String(defaultValue ?? ""));
  const current = value !== undefined ? String(value ?? "") : inner;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef(null);
  const input = useRef(null);
  const hidden = useRef(null);
  const listId = useId();

  const all = useMemo(
    () => (emptyLabel !== undefined ? [{ value: "", label: emptyLabel }, ...options] : options).map((o) => ({ ...o, value: String(o.value) })),
    [options, emptyLabel]
  );
  const selected = all.find((o) => o.value === current);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? all.filter((o) => o.label.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : all;
  }, [all, q]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    box.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi, open]);

  function show() {
    if (disabled) return;
    setQ("");
    setHi(Math.max(0, all.findIndex((o) => o.value === current)));
    setOpen(true);
  }

  function pick(o) {
    if (value === undefined) setInner(o.value);
    onChange?.(o.value);
    setOpen(false);
    input.current?.blur();
    if (submitOnChange && hidden.current?.form) {
      hidden.current.value = o.value;
      hidden.current.form.requestSubmit();
    }
  }

  function onKey(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); return show(); }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) pick(shown[hi]); }
    else if (e.key === "Escape" || e.key === "Tab") setOpen(false);
  }

  return (
    <div className={`ss${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={box}>
      {name && <input type="hidden" name={name} value={current} ref={hidden} />}
      <input
        id={id}
        ref={input}
        className="ss-input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={open ? "พิมพ์เพื่อค้นหา…" : placeholder}
        value={open ? q : selected?.label ?? ""}
        onFocus={show}
        onClick={() => !open && show()}
        onChange={(e) => { setQ(e.target.value); setHi(0); if (!open) setOpen(true); }}
        onKeyDown={onKey}
      />
      <span className="ss-caret" aria-hidden="true" />
      {open && (
        <ul className="ss-list" id={listId} role="listbox">
          {shown.length === 0 && <li className="ss-empty">ไม่พบ “{q}”</li>}
          {shown.map((o, i) => (
            <li
              key={o.value}
              data-i={i}
              role="option"
              aria-selected={o.value === current}
              className={`${i === hi ? "hi" : ""}${o.value === current ? " sel" : ""}`}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
