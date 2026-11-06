/* ============================================================
   util.js — DOM、随机、格式化、存储、下载
   所有模块都挂在一个全局命名空间下，保持 file:// 可直接运行。
   ============================================================ */

window.U = (function () {

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  /** 创建元素：el('div', {class:'x', html:'<b>1</b>'}, child1, child2) */
  function el(tag, attrs) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) {
      const child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(c => c && node.appendChild(c));
      else node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const sleep = ms => new Promise(res => setTimeout(res, Math.max(0, ms)));
  const nextFrame = () => new Promise(res => requestAnimationFrame(res));

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const randint = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  function sample(arr, n) { return shuffle(arr).slice(0, n); }

  /** FNV-1a，用于按被试编号决定区组顺序（同一编号永远同一顺序） */
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /** 匿名编号：去掉容易看错的 0/O/1/I */
  function pid() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return 'P-' + s;
  }

  const pad2 = n => (n < 10 ? '0' : '') + n;

  function fmt(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    const d = digits === undefined ? 0 : digits;
    return Number(n).toFixed(d);
  }

  function pct(x, digits) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x * 100).toFixed(digits === undefined ? 0 : digits) + '%';
  }

  /* ---------- localStorage ---------- */

  const KEY = 'attn-lab.v1';

  function readStore() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeStore(obj) {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* 隐私模式忽略 */ }
  }

  function patchStore(patch) {
    const s = readStore();
    Object.assign(s, patch);
    writeStore(s);
    return s;
  }

  /* ---------- CSV / 下载 ---------- */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCSV(headers, rows) {
    const lines = [headers.map(csvCell).join(',')];
    rows.forEach(r => lines.push(r.map(csvCell).join(',')));
    return '\ufeff' + lines.join('\r\n');
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function timestamp() {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
  }

  return {
    $, $$, el, clear, esc, sleep, nextFrame, clamp, lerp, shuffle, randint, sample,
    hash, pid, fmt, pct, pad2, timestamp,
    store: { read: readStore, write: writeStore, patch: patchStore },
    toCSV, download
  };
})();
